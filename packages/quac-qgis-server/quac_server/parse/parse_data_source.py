"""Mirrors `packages/quac/src/parse/parseDataSource.ts`, as far as a catalogue's data asset reads a layer's source.

It reads a file source's path, or an online file's address, the GeoPackage
table it names, the shape its `|geometrytype=` keeps, its Delimited Text
options and its feature filter; a WFS source's address, feature type and
filter; and an ArcGIS FeatureServer source's address and filter. The server
route writes none of them, and never writes `raw`.

It departs from the JavaScript in two ways, recorded under `departures` in
`port-exemptions.json`. A source the `wms` or `xyzvectortiles` provider reads
is kind `image`, whatever its address: the JavaScript reads it as `wms`, `wmts`
or `xyz`, or `unsupported` where its address is not one the `URL` class
accepts. And an online file's address is written as the `URL` class writes
it, by `_url_href`, for the addresses it covers, not every address the class
accepts.
"""

from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import unquote_to_bytes

from ..js_compat import js_trim
from ..model.qgs_project import DataSource


def parse_data_source(raw: str, provider_hint: Optional[str] = None) -> DataSource:
    """Parses a QGIS `<datasource>` string into its kind and what a data asset says of it, using the `<provider>` as a hint."""
    trimmed = js_trim(raw)
    if not trimmed:
        return DataSource(kind='unsupported', raw=raw)
    hint = provider_hint.lower() if provider_hint else None

    if hint in ('wms', 'xyzvectortiles'):
        return DataSource(kind='image', raw=raw)
    if hint == 'arcgisfeatureserver':
        return _parse_arcgis_feature_server_data_source(raw, trimmed) or DataSource(kind='unsupported', raw=raw)
    if hint == 'delimitedtext':
        return _parse_delimited_text_data_source(raw, trimmed) or DataSource(kind='unsupported', raw=raw)

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
            return DataSource(kind='wfs', raw=raw, url=url, type_name=type_name, feature_filter=feature_filter)

    if _looks_like_file_path(trimmed) or provider_hint == 'ogr':
        return _parse_file_data_source(raw, trimmed)
    return DataSource(kind='unsupported', raw=raw)


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
    parts = _split_url(url)
    if parts is None or parts['scheme'] not in ('http', 'https') or parts['userinfo'] or parts['query']:
        return None
    where = js_trim(sql) if sql is not None and js_trim(sql) else None
    return DataSource(kind='arcgis', raw=raw, url=re.sub(r'/\Z', '', url), where=where)


_HTTP_HEADER = re.compile(r'''(?:^|\s)http-header:[\w-]+\s*=\s*(['"])(?!\1)''', re.ASCII)

_SERVICE_LAYER = re.compile(r'/(FeatureServer|MapServer)/\d+/?\Z', re.ASCII)

# An `http` or `https` address: its scheme, then any slashes, then its authority, path, query and fragment.
_HTTP_URL = re.compile(r'^([a-zA-Z][a-zA-Z0-9+.-]*):[/\\]*([^/\\?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?\Z', re.DOTALL)


def _split_url(address: str) -> Optional[dict[str, Any]]:
    """
    An `http` or `https` address taken apart as the `URL` class takes it, its
    scheme and host in lower case, its port without a default one. None where
    the class would refuse it, or it is no `http` or `https` address.
    """
    address = re.sub(r'[\t\n\r]', '', js_trim(address))
    match = _HTTP_URL.match(address)
    if match is None or match.group(1).lower() not in ('http', 'https'):
        return None
    scheme = match.group(1).lower()
    authority = match.group(2)
    userinfo, _, host_port = authority.rpartition('@')
    host, colon, port = host_port.partition(':') if not host_port.startswith('[') else (host_port, '', '')
    if not host or (colon and port and not port.isdigit()):
        return None
    try:
        host = host.encode('ascii').decode('ascii').lower() if host.isascii() else host.encode('idna').decode('ascii').lower()
    except UnicodeError:
        return None
    port_number = int(port) if colon and port else None
    if port_number is not None and port_number > 65535:
        return None
    if port_number == {'http': 80, 'https': 443}[scheme]:
        port_number = None
    return {
        'scheme': scheme,
        'userinfo': userinfo,
        'host': host,
        'port': port_number,
        'path': match.group(3).replace('\\', '/'),
        'query': match.group(4),
        'fragment': match.group(5),
    }


def _url_href(address: str) -> Optional[str]:
    """
    An `http` or `https` address as the `URL` class writes its `href`: scheme
    and host in lower case, a default port left off, `.` and `..` taken out of
    the path, and each character the class escapes in the path, query and
    fragment percent-encoded. None where the class would refuse it, and for an
    address holding a user name or password.
    """
    parts = _split_url(address)
    if parts is None or parts['userinfo']:
        return None
    href = f"{parts['scheme']}://{parts['host']}{'' if parts['port'] is None else ':' + str(parts['port'])}{_url_path(parts['path'])}"
    if parts['query'] is not None:
        href += '?' + _percent_encode(parts['query'], ' "#<>\'')
    if parts['fragment'] is not None:
        href += '#' + _percent_encode(parts['fragment'], ' "<>`')
    return href


def _url_path(path: str) -> str:
    """A special URL's path as the `URL` class writes it: `/` where empty, its dot segments taken out, and escaped."""
    segments: list[str] = []
    parts = path.split('/')[1:] if path else ['']
    for index, part in enumerate(parts):
        last = index == len(parts) - 1
        lowered = part.lower()
        if lowered in ('..', '.%2e', '%2e.', '%2e%2e'):
            if segments:
                segments.pop()
            if last:
                segments.append('')
        elif lowered in ('.', '%2e'):
            if last:
                segments.append('')
        else:
            segments.append(_percent_encode(part, ' "#<>?^`{}'))
    return '/' + '/'.join(segments)


def _percent_encode(text: str, also: str) -> str:
    """Each control character, each character outside ASCII and each of `also` percent-encoded as UTF-8; a `%` is kept as written."""
    return ''.join(
        ''.join(f'%{byte:02X}' for byte in char.encode('utf-8')) if ord(char) < 0x20 or ord(char) > 0x7E or char in also else char
        for char in text
    )


def _url_pathname(url: str) -> str:
    """The path of an address `_url_href` wrote."""
    parts = _split_url(url)
    return parts['path'] if parts else ''
