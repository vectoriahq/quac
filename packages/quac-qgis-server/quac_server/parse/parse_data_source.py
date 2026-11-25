"""Mirrors `packages/quac/src/parse/parseDataSource.ts`, as far as a catalogue's data asset and web map link read a layer's source.

It reads a file source's path, or an online file's address, the GeoPackage
table it names, the shape its `|geometrytype=` keeps, its Delimited Text
options and its feature filter; a WFS source's address, feature type,
coordinate system and filter; an ArcGIS FeatureServer source's address and filter; and a WMS, WMTS
or XYZ source of the `wms` or `xyzvectortiles` provider. The server route
writes none of them, and never writes `raw`.

An address is read as the `URL` class reads it by `js_compat.split_url`, for
the addresses it covers, not every address the class accepts, a departure
recorded under `departures` in `port-exemptions.json`.
"""

from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import unquote_to_bytes

from ..js_compat import js_trim, split_url, url_search_params, url_to_string
from ..model.qgs_project import DataSource
from ..model.stac_wms import wms_endpoint
from ..model.stac_wmts import wmts_endpoint


def parse_data_source(raw: str, provider_hint: Optional[str] = None) -> DataSource:
    """Parses a QGIS `<datasource>` string into its kind and what a data asset or web map link says of it, using the `<provider>` as a hint."""
    trimmed = js_trim(raw)
    unsupported = DataSource(kind='unsupported', raw=raw, hint=provider_hint)
    if not trimmed:
        return unsupported
    hint = provider_hint.lower() if provider_hint else None

    if hint == 'wms':
        params = url_search_params(trimmed)
        if _needs_credentials_or_headers(params):
            return unsupported
        if _get(params, 'type') == 'xyz':
            return _parse_xyz_data_source(params, raw) or unsupported
        if _has(params, 'tileMatrixSet'):
            return _parse_wmts_data_source(params, raw) or unsupported
        # Any other `type` is a tile format this does not read, such as a local MBTiles file.
        if _has(params, 'type'):
            return unsupported
        url = _get(params, 'url')
        layers = [name for value in _get_all(params, 'layers') for name in value.split(',')]
        if url and wms_endpoint(url) and layers and all(js_trim(name) for name in layers):
            version = _get(params, 'version')
            if version and version not in ('1.1.1', '1.3.0'):
                return unsupported
            dimensions: dict[str, str] = {}
            for key in ('time', 'elevation'):
                value = _get(params, key)
                if value:
                    dimensions[key.upper()] = value
            image_format = _get(params, 'format')
            crs = _get(params, 'crs')
            transparent = _get(params, 'transparent')
            return DataSource(
                kind='wms',
                raw=raw,
                url=url,
                layers=layers,
                styles=[name for value in _get_all(params, 'styles') for name in value.split(',')],
                format=image_format if image_format is not None else 'image/png',
                crs=crs if crs is not None else 'EPSG:3857',
                version=version if version in ('1.1.1', '1.3.0') else None,
                transparent=transparent is None or transparent.lower() != 'false',
                dimensions=dimensions,
            )
        return unsupported

    if hint == 'xyzvectortiles':
        return _parse_vector_xyz_data_source(url_search_params(trimmed), raw) or unsupported
    if hint == 'arcgisfeatureserver':
        return _parse_arcgis_feature_server_data_source(raw, trimmed) or unsupported
    if hint == 'delimitedtext':
        return _parse_delimited_text_data_source(raw, trimmed) or unsupported

    if _looks_like_wfs(trimmed):
        source, sql = _split_off_wfs_sql(trimmed)
        params = _parse_space_separated_key_values(source)
        url = params.get('url')
        type_name = params['typename'] if 'typename' in params else params.get('typeName')
        if url and type_name:
            # QGIS sends the server a `SELECT` statement where the source has one, and the `filter` otherwise.
            wfs_filter = params.get('filter') if js_trim(params.get('filter') or '') else None
            feature_filter: Optional[dict[str, str]] = None
            if sql:
                feature_filter = {'expression': sql, 'dialect': 'wfs_sql'}
            elif wfs_filter:
                feature_filter = {'expression': wfs_filter, 'dialect': 'ogc_filter' if js_trim(wfs_filter).startswith('<') else 'qgis_expression'}
            srs_name = params['srsname'] if 'srsname' in params else params.get('srsName')
            return DataSource(kind='wfs', raw=raw, url=url, type_name=type_name, srs_name=srs_name, feature_filter=feature_filter)

    if _looks_like_file_path(trimmed) or provider_hint == 'ogr':
        return _parse_file_data_source(raw, trimmed)
    return DataSource(kind='unsupported', raw=raw, hint=provider_hint if provider_hint is not None else _sniff_provider_hint(trimmed))


def _get(params: list[tuple[str, str]], key: str) -> Optional[str]:
    """`URLSearchParams.get`: the first value of `key`, or None."""
    return next((value for name, value in params if name == key), None)


def _get_all(params: list[tuple[str, str]], key: str) -> list[str]:
    """`URLSearchParams.getAll`."""
    return [value for name, value in params if name == key]


def _has(params: list[tuple[str, str]], key: str) -> bool:
    """`URLSearchParams.has`."""
    return any(name == key for name, _value in params)


def _needs_credentials_or_headers(params: list[tuple[str, str]]) -> bool:
    """
    Whether a wms-provider source names credentials or a header to send. QGIS
    writes some of these keys with no value on sources needing neither, such as
    `http-header:referer=`, so only a key with a value counts.
    """
    return any(
        js_trim(value) and (key in ('authcfg', 'username', 'password', 'referer') or key.startswith('http-header:'))
        for key, value in params
    )


_XYZ_ZOOM_OR_QUADKEY = re.compile(r'\{(z|quadkey)\}')
_DIGITS = re.compile(r'^\d+\Z', re.ASCII)


def _parse_xyz_data_source(params: list[tuple[str, str]], raw: str) -> Optional[DataSource]:
    """
    An XYZ tile layer. QGIS's `{q}` is Bing's quadkey, written as the `{quadkey}`
    the tile layer fills in. None for a template that is not an absolute
    `http` or `https` address holding `{z}` or a quadkey.
    """
    url = _get(params, 'url')
    url = url.replace('{q}', '{quadkey}') if url is not None else None
    if not url or not _XYZ_ZOOM_OR_QUADKEY.search(url):
        return None
    parsed = split_url(url)
    if parsed is None or parsed['userinfo']:
        return None
    zmax = _get(params, 'zmax')
    return DataSource(kind='xyz', raw=raw, tiles='image', url=url, max_zoom=int(zmax) if zmax and _DIGITS.match(zmax) else None)


def _parse_vector_xyz_data_source(params: list[tuple[str, str]], raw: str) -> Optional[DataSource]:
    """
    An XYZ vector tile layer. None for any other `type`, such as a local
    MBTiles file, for a source needing credentials or headers, and for a
    template without `{z}`, `{x}` and `{y}`.
    """
    if _get(params, 'type') != 'xyz' or _needs_credentials_or_headers(params):
        return None
    parsed = _parse_xyz_data_source(params, raw)
    if parsed is None or parsed.kind != 'xyz' or not all(placeholder in (parsed.url or '') for placeholder in ('{z}', '{x}', '{y}')):
        return None
    parsed.tiles = 'vector'
    return parsed


def _parse_wmts_data_source(params: list[tuple[str, str]], raw: str) -> Optional[DataSource]:
    """A WMTS layer. QGIS names one layer, one style and one tile matrix set; its `tileDimensions` are `name=value` pairs separated by `;`."""
    url = wmts_endpoint(_get(params, 'url') or '')
    layer = _get(params, 'layers')
    layer = js_trim(layer) if layer is not None else None
    tile_matrix_set = _get(params, 'tileMatrixSet')
    tile_matrix_set = js_trim(tile_matrix_set) if tile_matrix_set is not None else None
    if not url or not layer or not tile_matrix_set:
        return None
    dimensions: dict[str, str] = {}
    for pair in (_get(params, 'tileDimensions') or '').split(';'):
        separator = pair.find('=')
        if separator > 0:
            dimensions[pair[:separator]] = pair[separator + 1:]
    style = _get(params, 'styles')
    return DataSource(
        kind='wmts',
        raw=raw,
        url=url,
        layer=layer,
        tile_matrix_set=tile_matrix_set,
        style=style if style is not None else '',
        format=_get(params, 'format') or 'image/png',
        dimensions=dimensions,
    )


_WFS_URL = re.compile(r'\burl\s*=\s*[\'"]', re.ASCII)
_WFS_TYPENAME = re.compile(r'\btypename\s*=\s*[\'"]', re.ASCII | re.IGNORECASE)


def _looks_like_wfs(raw: str) -> bool:
    return bool(_WFS_URL.search(raw)) and bool(_WFS_TYPENAME.search(raw))


def _looks_like_file_path(raw: str) -> bool:
    """No `=` before the first `|`, and a path separator, a file extension or a parent reference."""
    path_part = raw.split('|')[0]
    if '=' in path_part:
        return False
    return bool(re.search(r'[\\/.]', path_part)) or path_part.startswith('.')


def _parse_file_data_source(raw: str, trimmed: str) -> DataSource:
    source, subset = _split_off_subset(trimmed)
    path_part, *option_parts = source.split('|')
    url = _read_online_file_url(js_trim(path_part))
    normalised_path = url if url is not None else js_trim(path_part).replace('\\', '/')
    filename = _basename(_url_pathname(url)) if url is not None else _basename(normalised_path)
    layer_name: Optional[str] = None
    for option in option_parts:
        match = _LAYER_NAME_OPTION.match(js_trim(option))
        if match:
            layer_name = js_trim(match.group(1))
            break
    return DataSource(
        kind='file',
        raw=raw,
        geometry_type_filter=_read_geometry_type_filter(option_parts),
        filename=filename,
        rel_path=normalised_path or filename,
        url=url,
        layer_name=layer_name,
        feature_filter={'expression': subset, 'dialect': 'ogr_sql'} if subset else None,
    )


_LAYER_NAME_OPTION = re.compile(r'^layername\s*=\s*(.*)$', re.IGNORECASE)


def _basename(path_like: str) -> str:
    """The last segment of a path, split at either slash, since a project's author may be on any system."""
    return re.split(r'[\\/]', path_like)[-1]


def _read_online_file_url(path: str) -> Optional[str]:
    """
    The address of an online file: the path after GDAL's `/vsicurl/` prefix, or
    a path that is itself an `http` or `https` address. None for a file on
    disk, and for an address with credentials in it.
    """
    address = re.sub(r'^/vsicurl/', '', path, count=1, flags=re.IGNORECASE)
    if not re.match(r'^https?://', address, re.IGNORECASE):
        return None
    return _url_href(address)


def _split_off_subset(source: str) -> tuple[str, Optional[str]]:
    """An OGR source's `|subset=` filter and the source without it; everything after the option is the filter."""
    at = source.find('|subset=')
    if at == -1:
        return source, None
    subset = source[at + len('|subset='):]
    return source[:at], subset if js_trim(subset) else None


# A file source option read as `geometrytype=`, the type name captured.
GEOMETRY_TYPE_OPTION = re.compile(r'^geometrytype=([a-zA-Z0-9]*)$', re.IGNORECASE)

_UNIQUE_GEOMETRY_TYPE = re.compile(r'^uniqueGeometryType=yes$', re.IGNORECASE)


def _read_geometry_type_filter(option_parts: list[str]) -> Optional[str]:
    """
    The shape a file source's `|geometrytype=` option keeps, read as QGIS's OGR
    provider reads it: the key in any case, the value matched exactly against
    its type names, then reduced to its single-part, straight-edged shape.
    `uniqueGeometryType=yes` turns the filter off. Only the first
    `geometrytype=` counts.
    """
    type_name: Optional[str] = None
    for option in option_parts:
        geometry_type = GEOMETRY_TYPE_OPTION.match(js_trim(option))
        if geometry_type and type_name is None:
            type_name = geometry_type.group(1)
        if _UNIQUE_GEOMETRY_TYPE.match(js_trim(option)):
            return None
    return None if type_name is None else _GEOMETRY_TYPE_FILTERS.get(type_name)


_GEOMETRY_TYPE_FILTERS = {
    'Point': 'Point',
    'MultiPoint': 'Point',
    'Point25D': 'Point',
    'MultiPoint25D': 'Point',
    'LineString': 'LineString',
    'MultiLineString': 'LineString',
    'LineString25D': 'LineString',
    'MultiLineString25D': 'LineString',
    'CircularString': 'LineString',
    'CircularStringZ': 'LineString',
    'CompoundCurve': 'LineString',
    'CompoundCurveZ': 'LineString',
    'MultiCurve': 'LineString',
    'MultiCurveZ': 'LineString',
    'Polygon': 'Polygon',
    'MultiPolygon': 'Polygon',
    'Polygon25D': 'Polygon',
    'MultiPolygon25D': 'Polygon',
    'CurvePolygon': 'Polygon',
    'CurvePolygonZ': 'Polygon',
    'MultiSurface': 'Polygon',
    'MultiSurfaceZ': 'Polygon',
}

_KEY_VALUE = re.compile(r'(\w+)\s*=\s*(?:\'((?:\\.|[^\'\\])*)\'|"((?:\\.|[^"\\])*)")', re.ASCII)
_ESCAPE = re.compile(r'\\(.)')


def _parse_space_separated_key_values(raw: str) -> dict[str, str]:
    """QGIS's WFS-style URI: space-separated `key='value'` or `key="value"` pairs, a backslash escaping the next character."""
    out: dict[str, str] = {}
    for match in _KEY_VALUE.finditer(raw):
        value = match.group(2) if match.group(2) is not None else (match.group(3) or '')
        out[match.group(1)] = _ESCAPE.sub(r'\1', value)
    return out


def _split_off_wfs_sql(source: str) -> tuple[str, Optional[str]]:
    """A WFS source's trailing `sql=` statement and the source without it: the first `sql=` starting a word outside a quoted value."""
    quote: Optional[str] = None
    at = 0
    while at < len(source):
        char = source[at]
        if quote:
            if char == '\\':
                at += 1
            elif char == quote:
                quote = None
        elif char in ('\'', '"'):
            quote = char
        elif source.startswith('sql=', at) and (at == 0 or source[at - 1].isspace()):
            sql = source[at + len('sql='):]
            return source[:at], sql if js_trim(sql) else None
        at += 1
    return source, None


def _parse_delimited_text_data_source(raw: str, trimmed: str) -> Optional[DataSource]:
    """
    A Delimited Text source: the file its `file:` URL names, and the options
    its query gives, read as `QgsDelimitedTextFile::setFromUrl` reads them. A
    tab is written `\\t`. None where the split is not `csv` or `plain`, or the
    URL names no file.
    """
    query_start = trimmed.find('?')
    location = trimmed if query_start == -1 else trimmed[:query_start]
    query: dict[str, str] = {}
    for pair in ('' if query_start == -1 else trimmed[query_start + 1:]).split('&'):
        if not pair:
            continue
        separator = pair.find('=')
        key = _decode_query_part(pair if separator == -1 else pair[:separator])
        # The first value wins, as `QUrlQuery::queryItemValue` gives it.
        if key not in query:
            query[key] = '' if separator == -1 else _decode_query_part(pair[separator + 1:])

    split_type = query['type'] if 'type' in query else query.get('delimiterType', 'csv')
    if split_type not in ('csv', 'plain'):
        return None
    path = _file_path_of_url(location)
    if not path:
        return None

    def decode_chars(chars: str) -> str:
        return chars.replace('\\t', '\t')

    def is_yes(value: Optional[str], fallback: bool) -> bool:
        return fallback if value is None else not value.upper().startswith('N')

    skip_lines = _parse_int(query.get('skipLines', '0'))
    options: dict[str, Any] = {
        'delimiter': decode_chars(query.get('delimiter', ',')),
        # `plain` is the older name, whose quotes were either kind and which had no escape.
        'quote': decode_chars(query.get('quote', '\'"' if split_type == 'plain' else '"')),
        'escape': decode_chars(query.get('escape', '' if split_type == 'plain' else '"')),
        'skip_lines': skip_lines if skip_lines is not None and skip_lines > 0 else 0,
        'header': is_yes(query.get('useHeader'), True),
        'trim': 'trimFields' in query and is_yes(query.get('trimFields'), False),
    }
    if not options['delimiter']:
        return None

    # The filter is a QGIS expression here, not GDAL's SQL.
    subset = query.get('subset') if js_trim(query.get('subset') or '') else None
    file = _parse_file_data_source(raw, path)
    file.delimited_text = options
    if subset:
        file.feature_filter = {'expression': subset, 'dialect': 'qgis_expression'}
    return file


def _parse_int(text: str) -> Optional[int]:
    """`Number.parseInt(text, 10)`, None where it gives `NaN`."""
    match = re.match(r'^[+-]?[0-9]+', js_trim(text))
    return int(match.group(0)) if match else None


def _decode_query_part(part: str) -> str:
    """A query key or value with its percent-escapes decoded, kept as it is where one is malformed, as `decodeURIComponent` throws on it."""
    if re.search(r'%(?![0-9a-fA-F]{2})', part):
        return part
    try:
        return unquote_to_bytes(part).decode('utf-8')
    except UnicodeDecodeError:
        return part


def _file_path_of_url(location: str) -> str:
    """
    The path a `file:` URL names: `file:./data.csv` is relative, `file:///C:/x.csv`
    a Windows drive and `file:///home/x.csv` an absolute path. A location
    without the scheme is a path already.
    """
    path = re.sub(r'^file:', '', location, count=1, flags=re.IGNORECASE)
    if path.startswith('///'):
        path = path[2:]
    elif path.startswith('//'):
        path = path[1:]
    if re.match(r'^/[a-zA-Z]:/', path):
        path = path[1:]
    return _decode_query_part(js_trim(path))


def _parse_arcgis_feature_server_data_source(raw: str, trimmed: str) -> Optional[DataSource]:
    """
    A layer of an ArcGIS FeatureServer or MapServer: its address and the
    `sql=` QGIS sends to the service as the query's `where`. None for a source
    needing a sign-in or a header, for one limited to a box, and for an address
    that is not a service layer.
    """
    source, sql = _split_off_wfs_sql(trimmed)
    params = _parse_space_separated_key_values(source)
    if any(js_trim(params.get(key) or '') for key in ('authcfg', 'urlprefix', 'referer', 'bbox')):
        return None
    # `http-header:` keys hold a colon, which the key-value reader leaves out.
    if _HTTP_HEADER.search(source):
        return None
    url = params.get('url')
    if not url or not _SERVICE_LAYER.search(url):
        return None
    parts = split_url(url)
    if parts is None or parts['scheme'] not in ('http', 'https') or parts['userinfo'] or parts['query']:
        return None
    where = js_trim(sql) if sql is not None and js_trim(sql) else None
    return DataSource(kind='arcgis', raw=raw, url=re.sub(r'/\Z', '', url), where=where)


_HTTP_HEADER = re.compile(r'''(?:^|\s)http-header:[\w-]+\s*=\s*(['"])(?!\1)''', re.ASCII)

_SERVICE_LAYER = re.compile(r'/(FeatureServer|MapServer)/\d+/?\Z', re.ASCII)

_POSTGRES_HINT = re.compile(r'\bdbname\s*=', re.ASCII)
_WMS_HINT = re.compile(r'\bservice\s*=\s*[\'"]?(wms|wmts)', re.ASCII | re.IGNORECASE)


def _sniff_provider_hint(raw: str) -> Optional[str]:
    if _POSTGRES_HINT.search(raw):
        return 'postgres'
    if _WMS_HINT.search(raw):
        return 'wms'
    return None


def _url_href(address: str) -> Optional[str]:
    """
    An `http` or `https` address as the `URL` class writes its `href`. None
    where the class would refuse it, and for an address holding a user name or
    password.
    """
    parts = split_url(address)
    return None if parts is None or parts['userinfo'] else url_to_string(parts)


def _url_pathname(url: str) -> str:
    """The path of an address `_url_href` wrote."""
    parts = split_url(url)
    return parts['path'] if parts else ''
