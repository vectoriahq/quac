"""Mirrors `packages/quac/src/parse/parseDataSource.ts`, as far as the server route reads a layer's source.

The server route never writes where a layer's data comes from, so this reads
only what decides the catalogue: whether the layer is an image, which makes it
read-only, and for a file the shape its `|geometrytype=` keeps, which finds
the files QGIS splits into a layer per shape. No address, path, filter or
credential is kept apart from `raw`, which the server route never writes.

It departs from the JavaScript in one way, recorded under `departures` in
`port-exemptions.json`: a source the `wms` or `xyzvectortiles`
provider reads is kind `image`, whatever its address. The JavaScript reads it
as `wms`, `wmts` or `xyz`, or `unsupported` where its address is not one the
`URL` class accepts. In a served catalogue the kind decides only whether a
layer is editable, and a layer of either provider is an image, which QGIS
Server does not publish for WFS, so the server route makes it read-only either
way. An ArcGIS FeatureServer or Delimited Text source is read as
`unsupported`, a kind the server route treats as it treats theirs.
"""

from __future__ import annotations

import re
from typing import Optional

from ..js_compat import js_trim
from ..model.qgs_project import DataSource


def parse_data_source(raw: str, provider_hint: Optional[str] = None) -> DataSource:
    """Parses a QGIS `<datasource>` string into its kind, using the `<provider>` as a hint."""
    trimmed = js_trim(raw)
    if not trimmed:
        return DataSource(kind='unsupported', raw=raw)
    hint = provider_hint.lower() if provider_hint else None

    if hint in ('wms', 'xyzvectortiles'):
        return DataSource(kind='image', raw=raw)
    if hint in ('arcgisfeatureserver', 'delimitedtext'):
        return DataSource(kind='unsupported', raw=raw)

    if _looks_like_wfs(trimmed):
        source, _sql = _split_off_wfs_sql(trimmed)
        params = _parse_space_separated_key_values(source)
        if params.get('url') and (params.get('typename') or params.get('typeName')):
            return DataSource(kind='wfs', raw=raw)

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
    source, _subset = _split_off_subset(trimmed)
    option_parts = source.split('|')[1:]
    return DataSource(kind='file', raw=raw, geometry_type_filter=_read_geometry_type_filter(option_parts))


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
