"""Mirrors `packages/quac/src/util/catalogueFileFormats.ts`, as far as a QGIS layer's data and style assets need: each format's extensions, role and media type."""

from __future__ import annotations

import re
from typing import Optional, Union

from ..js_compat import js_trim

GEOJSON_MEDIA_TYPE = 'application/geo+json'

# QGIS layer style. QML has no registered media type, so this is an unregistered one.
QML_STYLE_MEDIA_TYPE = 'application/x-qgis-qml+xml'

# The roles of a file a project layer's data source can name.
PROJECT_DATA_ROLES = ('data', 'table')

# Each format's id, role, extensions and media type, in the order a lookup by extension tries them.
CATALOGUE_FILE_FORMATS: tuple[dict[str, object], ...] = (
    {'id': 'geojson', 'role': 'data', 'extensions': ('geojson', 'json'), 'media_type': GEOJSON_MEDIA_TYPE},
    {'id': 'geoparquet', 'role': 'data', 'extensions': ('parquet',), 'media_type': 'application/vnd.apache.parquet'},
    {'id': 'flatgeobuf', 'role': 'data', 'extensions': ('fgb',), 'media_type': 'application/vnd.flatgeobuf'},
    {'id': 'geopackage', 'role': 'data', 'extensions': ('gpkg',), 'media_type': 'application/geopackage+sqlite3'},
    {'id': 'cog', 'role': 'data', 'extensions': ('tif', 'tiff'), 'media_type': 'image/tiff; application=geotiff; profile=cloud-optimized'},
    {'id': 'csv', 'role': 'table', 'extensions': ('csv',), 'media_type': 'text/csv'},
    {'id': 'shapefile', 'role': 'data', 'extensions': ('shp',), 'media_type': 'application/x-esri-shape'},
    {'id': 'sld', 'role': 'style', 'extensions': ('sld',), 'media_type': 'application/vnd.ogc.sld+xml'},
    {'id': 'qml', 'role': 'style', 'extensions': ('qml',), 'media_type': QML_STYLE_MEDIA_TYPE},
    {'id': 'qgis-project', 'role': 'project', 'extensions': ('qgs', 'qgz'), 'media_type': None},
)

RoleFilter = Union[str, tuple[str, ...], None]


def has_role(format_: dict[str, object], role: RoleFilter) -> bool:
    if not role:
        return True
    return format_['role'] == role if isinstance(role, str) else format_['role'] in role


def _lower_case_extension(name_or_path: str) -> Optional[str]:
    """`getLowerCaseExtension` in `util/fileName.ts`: the last extension of the path's file name, lower-cased, or None."""
    trimmed = js_trim(name_or_path)
    file_name = re.split(r'[/\\]', trimmed)[-1] if trimmed else ''
    match = re.search(r'\.([^.]+)\Z', file_name)
    extension = js_trim(match.group(1)).lower() if match else ''
    return extension or None


def is_layer_file_of_format(name_or_path: str, format_id: str) -> bool:
    """Whether a file name is in the given format."""
    extension = _lower_case_extension(name_or_path)
    found = next((format_ for format_ in CATALOGUE_FILE_FORMATS if extension in format_['extensions']), None) if extension else None  # type: ignore[operator]
    return found is not None and found['id'] == format_id


def declared_media_type_for_file(filename: str, role: RoleFilter) -> str:
    """The media type a file is declared as in a catalogue, or `application/octet-stream`."""
    extension = filename.split('.')[-1].lower()
    if not extension:
        return 'application/octet-stream'
    found = next((format_ for format_ in CATALOGUE_FILE_FORMATS if extension in format_['extensions'] and has_role(format_, role)), None)  # type: ignore[operator]
    media_type = found['media_type'] if found else None
    return media_type if isinstance(media_type, str) else 'application/octet-stream'
