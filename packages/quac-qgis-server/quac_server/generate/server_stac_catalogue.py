"""Mirrors `packages/quac/src/generate/serverStacCatalogue.ts`, for the plugin's first-release fields.

The catalogue a QGIS Server serves for a project, as a pure function of the
project's text and the server's address. It starts from the catalogue the
project file gives (`generate_stac_catalogue`) and applies the project's own
QGIS Server settings, as GetProjectSettings does:

- A layer or group whose name the project leaves out of WMS is left out, with
  every layer inside the group. A layer published for WFS but left out of WMS
  is left out too, because a server's Collection id is the WMS name. A file
  the project splits into a layer per shape is left out.
- Each Collection's id is the layer's WMS name.
- Its data is reached through the server only: a WFS GetFeature data asset
  where the project publishes the layer for WFS, and a WMS link always, to
  `server_wms_endpoint`, in the CRS `choose_wms_crs` picks from
  `server_wms_crs_list`.
- The top-level Catalog's extent covers the served layers only.
- A field the project hides from WMS or from WFS is left out of
  `table:columns`, and dropped as the display field; a lock whose expression
  uses one becomes `True`, so that hiding a field never unlocks an edit.

The access answers of the person asking are not applied.

Raises ValueError for a server address `server_wms_endpoint` refuses: one
that is not an `http` or `https` address, has no host, holds a space or a
control character, or holds a user name or password.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from ..js_compat import encode_uri_component, search_params_to_string
from ..model.qgs_project import BoundingBox, LayerEntry, QgsProject
from ..model.quac_extension import QUAC_SCHEMA_URL, declare_quac_extension
from ..model.stac_wms import WEB_MAP_LINKS_EXTENSION, WMS_REQUEST_PARAMETERS, choose_wms_crs
from ..util.catalogue_file_formats import GEOJSON_MEDIA_TYPE
from ..util.wfs_versions import WFS_CAPABILITIES_VERSION
from .server_layer_tree import server_layer_tree, wms_published_layer_ids
from .normalized_project import build_stac_extent, union_bboxes, with_data_type
from .stac_catalogue import effective_wgs84_bbox, generate_stac_catalogue
from .wms_stac_catalogue import map_qt_type_to_stac_table_type


def generate_server_stac_catalogue(
    project: QgsProject,
    server_address: str,
    field_types: Optional[dict[str, dict[str, dict[str, str]]]] = None,
    layer_wgs84_extents: Optional[dict[str, BoundingBox]] = None,
) -> dict[str, Any]:
    """
    The catalogue a QGIS Server would serve for `project` from `server_address`.

    `field_types` holds each layer's fields' types as GetProjectSettings reports
    them, `{'type': ..., 'typeName': ...}` by layer id and field name, and
    `layer_wgs84_extents` the WGS84 box of a layer whose project saves no
    `<wgs84extent>`, by layer id: the two inputs the plugin takes from QGIS
    rather than the project's text, as the JavaScript's `fieldTypes` and
    `layerWgs84Extents` are.
    """
    wms_href = server_wms_endpoint(server_address)
    if not wms_href:
        raise ValueError('The server address must be an http or https address with a host, and hold no user name, password, space or control character, in its query either.')
    extents = layer_wgs84_extents or {}
    catalogue = generate_stac_catalogue(project, extents)
    restricted = set(project.wms_publishing.restricted_layers if project.wms_publishing else [])
    served_layer_ids = wms_published_layer_ids(server_layer_tree(project))

    served_ids: dict[str, str] = {}

    def walk_ids(node: dict[str, Any]) -> None:
        for collection in node.get('collections') or []:
            wms_name = collection.get('quac:qgis_server_wms_name')
            if collection['id'] in served_layer_ids and isinstance(wms_name, str):
                served_ids[collection['id']] = wms_name
        for child in node.get('catalogs') or []:
            walk_ids(child)

    walk_ids(catalogue)

    context = _ServeContext(
        layers_by_id={layer.id: layer for layer in project.layers},
        served_ids=served_ids,
        wfs_published=set(project.wfs_transaction_layers.published if project.wfs_transaction_layers else []),
        server_address=server_address,
        wms_href=wms_href,
        wms_crs=choose_wms_crs(server_wms_crs_list(project)),
        field_types=field_types or {},
    )

    def serve_catalog(node: dict[str, Any]) -> dict[str, Any]:
        collections = [_serve_collection(collection, context) for collection in node.get('collections') or [] if collection['id'] in served_ids]
        catalogs = [serve_catalog(child) for child in node.get('catalogs') or [] if (child.get('title') or '') not in restricted]
        served = {key: value for key, value in node.items() if key not in ('collections', 'catalogs', 'stac_extensions')}
        served['links'] = [*(link for link in node['links'] if link['rel'] != 'child'), *_child_links(collections, catalogs)]
        if collections:
            served['collections'] = collections
        if catalogs:
            served['catalogs'] = catalogs
        return served

    served = serve_catalog(catalogue)
    served_box = union_bboxes([effective_wgs84_bbox(context.layers_by_id[layer_id], extents) if layer_id in context.layers_by_id else None for layer_id in served_ids])
    if served_box:
        served['extent'] = build_stac_extent(served_box)
    else:
        served.pop('extent', None)
    return declare_quac_extension(served)


_SERVER_ADDRESS = re.compile(r'^(https?)://([^/?#]*)([^?#]*)(?:\?([^#]*))?', re.IGNORECASE)


def server_wms_endpoint(server_address: str) -> Optional[str]:
    """
    The address a served layer's WMS link names: the server's address as
    written, its scheme lower-cased, less its fragment and any query parameter
    a WMS request sets, such as `SERVICE` or `REQUEST`. Other parameters, such
    as `MAP`, are kept as written. None for an address that is not `http` or
    `https`, has no host, holds a user name or password, or holds a space or a
    control character. A query holding `@` or the word `password`, in any case
    and escaped or not, is refused too: it may hold a project's database
    connection, which every served address would repeat.
    """
    if any(ord(char) <= 0x20 or ord(char) == 0x7F for char in server_address):
        return None
    match = _SERVER_ADDRESS.match(server_address)
    if match is None:
        return None
    scheme, authority, path, query = match.groups()
    if not authority or '@' in authority:
        return None
    if re.search(r'@|%40|password', query or '', re.IGNORECASE):
        return None
    kept = [pair for pair in (query or '').split('&') if pair != '' and pair.split('=')[0].upper() not in WMS_REQUEST_PARAMETERS]
    return f'{scheme.lower()}://{authority}{path}{"?" + "&".join(kept) if kept else ""}'


def server_wms_crs_list(project: QgsProject) -> list[str]:
    """
    The CRSs QGIS Server offers a project's WMS layers in: the project's
    restriction where it saves one, else the project's own CRS, EPSG:4326 and
    EPSG:3857. The list is the same for every layer.
    """
    if project.wms_crs_list:
        return list(project.wms_crs_list)
    project_crs = project.project_crs or ''
    crs_list = [project_crs]
    if project_crs.upper() != 'EPSG:4326':
        crs_list.append('EPSG:4326')
    if project_crs.upper() != 'EPSG:3857':
        crs_list.append('EPSG:3857')
    return crs_list


class _ServeContext:
    def __init__(self, layers_by_id: dict[str, LayerEntry], served_ids: dict[str, str], wfs_published: set[str], server_address: str, wms_href: str, wms_crs: str, field_types: dict[str, dict[str, dict[str, str]]]) -> None:
        self.field_types = field_types
        self.layers_by_id = layers_by_id
        # The project's layer id of each served Collection, mapped to its WMS name.
        self.served_ids = served_ids
        self.wfs_published = wfs_published
        self.server_address = server_address
        self.wms_href = wms_href
        # The CRS every layer's WMS link asks for.
        self.wms_crs = wms_crs


def _child_links(collections: list[dict[str, Any]], catalogs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    links = [_child_link(f'./collections/{encode_uri_component(collection["id"])}.json', collection.get('title')) for collection in collections]
    links += [_child_link(f'./catalogs/{encode_uri_component(catalog["id"])}/catalog.json', catalog.get('title')) for catalog in catalogs]
    return links


def _child_link(href: str, title: Optional[str]) -> dict[str, Any]:
    link: dict[str, Any] = {'rel': 'child', 'href': href, 'type': 'application/json'}
    if title is not None:
        link['title'] = title
    return link


def _hidden_fields_of(layer: Optional[LayerEntry]) -> set[str]:
    """The fields of a layer QGIS Server hides from either service."""
    hidden = layer.server_hidden_fields if layer is not None else None
    return set([*hidden.wms, *hidden.wfs]) if hidden else set()


def _mentions_any(expression: Any, fields: set[str]) -> bool:
    """
    Whether an expression names one of the fields, in double quotes or bare.
    It errs towards yes: a word inside a string literal that matches a field
    name counts, so a hidden name is never kept by mistake.
    """
    if not isinstance(expression, str) or not fields:
        return False
    return any(re.search(rf'(^|[^A-Za-z0-9_]){re.escape(field)}(\Z|[^A-Za-z0-9_])', expression) for field in fields)


# Fields that name where a layer's own data comes from, which a server's catalogue never carries.
_SOURCE_FIELDS = ('quac:wfs_endpoint', 'quac:wfs_type_name', 'quac:wfs_srs_name', 'quac:arcgis_layer_url', 'quac:arcgis_where', 'quac:max_zoom')


def _serve_collection(source: dict[str, Any], context: _ServeContext) -> dict[str, Any]:
    layer_id = source['id']
    hidden = _hidden_fields_of(context.layers_by_id.get(layer_id))
    wms_name = context.served_ids[layer_id]
    wfs_type_name = source.get('quac:qgis_server_wfs_type_name') if layer_id in context.wfs_published else None

    collection = {**source, 'id': wms_name}
    for key in _SOURCE_FIELDS:
        collection.pop(key, None)
    collection['links'] = [{
        'rel': 'wms',
        'href': context.wms_href,
        'type': 'image/png',
        'wms:layers': [wms_name],
        'wms:styles': [''],
        'wms:transparent': True,
        'quac:wms_crs': context.wms_crs,
    }]

    if isinstance(wfs_type_name, str):
        params = [('SERVICE', 'WFS'), ('VERSION', WFS_CAPABILITIES_VERSION), ('REQUEST', 'GetFeature'), ('TYPENAMES', wfs_type_name), ('OUTPUTFORMAT', 'application/json')]
        separator = '&' if '?' in context.server_address else '?'
        collection['assets'] = {'data': {
            'href': f'{context.server_address}{separator}{search_params_to_string(params)}',
            'type': GEOJSON_MEDIA_TYPE,
            'title': f'WFS GetFeature: {wms_name}',
            'roles': ['data'],
        }}
        collection['quac:wfs_endpoint'] = context.server_address
        collection['quac:wfs_type_name'] = wfs_type_name
    else:
        collection.pop('assets', None)
        collection['quac:editable'] = False

    extensions = [url for url in source.get('stac_extensions') or [] if url not in (QUAC_SCHEMA_URL, WEB_MAP_LINKS_EXTENSION)]
    extensions.append(WEB_MAP_LINKS_EXTENSION)
    collection['stac_extensions'] = extensions

    if str(collection.get('quac:display_field')) in hidden:
        collection.pop('quac:display_field', None)
    _serve_locks(collection, hidden)
    _serve_columns(collection, hidden, context.field_types.get(layer_id, {}))
    return collection


def _serve_locks(collection: dict[str, Any], hidden: set[str]) -> None:
    locks = collection.get('quac:locks')
    if not isinstance(locks, dict):
        return
    collection['quac:locks'] = {
        edit: True if isinstance(lock, dict) and _mentions_any(lock.get('expression'), hidden) else lock
        for edit, lock in locks.items()
    }


def _with_field_type(column: dict[str, Any], field_type: Optional[dict[str, str]]) -> dict[str, Any]:
    """The column with the `type` QGIS Server reports for its field, and the `data_type` beside it, where QGIS Server reports one."""
    column_type = map_qt_type_to_stac_table_type(field_type.get('type', ''), field_type.get('typeName', '')) if field_type else None
    return with_data_type({**column, 'type': column_type}) if column_type else column


def _serve_columns(collection: dict[str, Any], hidden: set[str], field_types: dict[str, dict[str, str]]) -> None:
    columns = collection.get('table:columns')
    if not isinstance(columns, list):
        return
    kept = [_with_field_type(column, field_types.get(column['name'])) for column in columns if column['name'] not in hidden]
    if kept:
        collection['table:columns'] = kept
    else:
        collection.pop('table:columns', None)
