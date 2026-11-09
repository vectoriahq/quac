"""Mirrors `packages/quac/src/generate/normalizedProject.ts`, as far as the plugin's first-release fields need: the shared writer and its helpers.

The readers that take a field back out of a catalogue (`readCollection*`) are
for an application reading a catalogue, not for a producer, and are not
ported; `port-exemptions.json` lists them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional, Union

from ..model.qgs_project import BoundingBox, EditLock, LayerScaleRange
from ..model.quac_extension import declare_quac_extension

STAC_VERSION = '1.1.0'

TABLE_EXTENSION = 'https://stac-extensions.github.io/table/v1.3.0/schema.json'

VECTOR_EXTENSION = 'https://stac-extensions.github.io/vector/v0.1.0/schema.json'

QUAC_LOCKS_FIELD = 'quac:locks'

QUAC_MUTUALLY_EXCLUSIVE_FIELD = 'quac:mutually_exclusive'


@dataclass
class QgisServerNames:
    """The names QGIS Server gives a layer: its WMS layer name, and its WFS type name where the project publishes it for WFS."""

    wms_name: Optional[str]
    wfs_type_name: Optional[str]


@dataclass
class NormalizedLayer:
    id: str
    title: str
    description: str
    bbox: Optional[BoundingBox]
    geometry_type: Optional[str]
    wkb_types: list[str]
    qgis_server_names: Optional[QgisServerNames]
    table_columns: list[dict[str, Any]]
    license: Optional[str]
    temporal_interval: Optional[list[Optional[str]]]
    display_field: Optional[str]
    visibility_checked: Optional[bool]
    editable: Optional[bool]
    identifiable: Optional[bool]
    scale_range: Optional[LayerScaleRange]
    opacity: Optional[float]
    locks: dict[str, EditLock]
    assets: dict[str, Any] = field(default_factory=dict)
    links: list[dict[str, Any]] = field(default_factory=list)
    extensions: list[str] = field(default_factory=list)
    kind: str = 'layer'


@dataclass
class NormalizedGroup:
    id: str
    title: str
    description: str
    children: list['NormalizedNode']
    mutually_exclusive: bool = False
    kind: str = 'group'


NormalizedNode = Union[NormalizedGroup, NormalizedLayer]


@dataclass
class NormalizedProject:
    id: str
    title: str
    description: str
    bbox: Optional[BoundingBox]
    nodes: list[NormalizedNode]


def generate_stac_from_normalized(project: NormalizedProject) -> dict[str, Any]:
    """
    Builds a STAC Catalog tree from a NormalizedProject, listing the QUAC schema
    in `stac_extensions` where `declare_quac_extension` says: the project is
    the top-level Catalog, a group a nested Catalog and a layer a Collection.
    """
    collections, catalogs, links = _walk_nodes(project.nodes)
    catalog: dict[str, Any] = {
        'type': 'Catalog',
        'stac_version': STAC_VERSION,
        'id': project.id,
        **({'title': project.title} if project.title else {}),
        'description': project.description,
        'links': [{'rel': 'self', 'href': './catalog.json'}, {'rel': 'root', 'href': './catalog.json'}, *links],
    }
    if project.bbox:
        catalog['extent'] = build_stac_extent(project.bbox)
    if collections:
        catalog['collections'] = collections
    if catalogs:
        catalog['catalogs'] = catalogs
    return declare_quac_extension(catalog)


def _walk_nodes(nodes: list[NormalizedNode]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    collections: list[dict[str, Any]] = []
    catalogs: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    for node in nodes:
        if isinstance(node, NormalizedLayer):
            collection = _build_collection(node)
            collections.append(collection)
            links.append({'rel': 'child', 'href': f'./collections/{collection["id"]}.json', 'type': 'application/json', 'title': collection['title']})
            continue
        sub_collections, sub_catalogs, sub_links = _walk_nodes(node.children)
        sub_catalog: dict[str, Any] = {
            'type': 'Catalog',
            'stac_version': STAC_VERSION,
            'id': node.id,
            **({'title': node.title} if node.title else {}),
            'description': node.description,
            'links': [
                {'rel': 'self', 'href': f'./catalogs/{node.id}/catalog.json'},
                {'rel': 'parent', 'href': '../../catalog.json'},
                {'rel': 'root', 'href': '../../catalog.json'},
                *sub_links,
            ],
        }
        if node.mutually_exclusive:
            sub_catalog[QUAC_MUTUALLY_EXCLUSIVE_FIELD] = True
        if sub_collections:
            sub_catalog['collections'] = sub_collections
        if sub_catalogs:
            sub_catalog['catalogs'] = sub_catalogs
        catalogs.append(sub_catalog)
        links.append({'rel': 'child', 'href': f'./catalogs/{node.id}/catalog.json', 'type': 'application/json', 'title': node.title})
    return collections, catalogs, links


def _build_collection(layer: NormalizedLayer) -> dict[str, Any]:
    stac_extensions = list(layer.extensions)
    if layer.table_columns:
        stac_extensions.append(TABLE_EXTENSION)
    vector_geometry_types = _geojson_geometry_types(layer.wkb_types)
    if vector_geometry_types:
        stac_extensions.append(VECTOR_EXTENSION)

    collection: dict[str, Any] = {
        'type': 'Collection',
        'stac_version': STAC_VERSION,
        'id': layer.id,
        'title': layer.title,
        'description': layer.description,
        'license': layer.license if layer.license is not None else 'other',
        'extent': build_stac_extent(layer.bbox, layer.temporal_interval),
    }
    if layer.geometry_type:
        collection['summaries'] = {'quac:geometry_type': [layer.geometry_type]}
    collection['assets'] = layer.assets
    collection['links'] = [
        {'rel': 'self', 'href': f'./collections/{layer.id}.json'},
        {'rel': 'parent', 'href': '../catalog.json'},
        {'rel': 'root', 'href': '../catalog.json'},
        *layer.links,
    ]

    if layer.display_field:
        collection['quac:display_field'] = layer.display_field
    if layer.visibility_checked is not None:
        collection['quac:visibility_checked'] = layer.visibility_checked
    if layer.editable is not None:
        collection['quac:editable'] = layer.editable
    if layer.identifiable is not None:
        collection['quac:identifiable'] = layer.identifiable
    if layer.scale_range and layer.scale_range.min_scale:
        collection['quac:min_scale'] = layer.scale_range.min_scale
    if layer.scale_range and layer.scale_range.max_scale:
        collection['quac:max_scale'] = layer.scale_range.max_scale
    if layer.opacity is not None:
        collection['quac:opacity'] = layer.opacity
    if layer.locks:
        collection[QUAC_LOCKS_FIELD] = dict(layer.locks)

    if stac_extensions:
        collection['stac_extensions'] = stac_extensions
    if vector_geometry_types:
        collection['vector:geometry_types'] = vector_geometry_types
    if layer.qgis_server_names and layer.qgis_server_names.wms_name:
        collection['quac:qgis_server_wms_name'] = layer.qgis_server_names.wms_name
    if layer.qgis_server_names and layer.qgis_server_names.wfs_type_name:
        collection['quac:qgis_server_wfs_type_name'] = layer.qgis_server_names.wfs_type_name
    if layer.table_columns:
        collection['table:columns'] = [with_data_type(column) for column in layer.table_columns]
    return collection


# The STAC common metadata data type each column type holds its values in.
_DATA_TYPE_BY_COLUMN_TYPE = {
    'int': 'int32',
    'long': 'int64',
    'double': 'float64',
    'string': 'other',
    'boolean': 'other',
    'date': 'other',
    'time': 'other',
    'timestamp': 'other',
}


def with_data_type(column: dict[str, Any]) -> dict[str, Any]:
    """The column with `data_type` written beside its `type`; a `type` outside the Table extension's, such as an unmapped QGIS Server type name, gets none."""
    column = dict(column)
    column_type = column.get('type')
    if column_type in _DATA_TYPE_BY_COLUMN_TYPE:
        column['data_type'] = _DATA_TYPE_BY_COLUMN_TYPE[column_type]
    return column


# The geometry types GeoJSON defines, the only values `vector:geometry_types` takes.
_GEOJSON_GEOMETRY_TYPES = {'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'}

_WKB_SUFFIX = re.compile(r'(ZM|Z|M|25D)$')


def _geojson_geometry_types(wkb_types: list[str]) -> Optional[list[str]]:
    """
    The GeoJSON geometry types of WKB type names, each once: a name less any
    Z, M, ZM or 25D suffix, where that is a GeoJSON type. None where there are
    no names, or where one has no GeoJSON type.
    """
    types: dict[str, None] = {}
    for wkb_type in wkb_types:
        base = _WKB_SUFFIX.sub('', wkb_type, count=1)
        if base not in _GEOJSON_GEOMETRY_TYPES:
            return None
        types[base] = None
    return list(types) if types else None


def union_bboxes(boxes: list[Optional[BoundingBox]]) -> Optional[BoundingBox]:
    """The box covering every given box, or None when none is given."""
    union: Optional[BoundingBox] = None
    for box in boxes:
        if box is None:
            continue
        if union is None:
            union = BoundingBox(box.xmin, box.ymin, box.xmax, box.ymax)
        else:
            union = BoundingBox(min(union.xmin, box.xmin), min(union.ymin, box.ymin), max(union.xmax, box.xmax), max(union.ymax, box.ymax))
    return union


def build_stac_extent(bbox: Optional[BoundingBox], interval: Optional[list[Optional[str]]] = None) -> dict[str, Any]:
    """STAC's extent: the one box, or the world where none is known, and the temporal interval, open at both ends where none is given."""
    return {
        'spatial': {'bbox': [[bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax]] if bbox else [[-180, -90, 180, 90]]},
        'temporal': {'interval': [list(interval) if interval is not None else [None, None]]},
    }


def slugify(text: str) -> str:
    """Lower-cases, replaces non-alphanumerics with hyphens, collapses repeats."""
    slug = re.sub(r'[^a-z0-9_-]+', '-', text.lower())
    slug = re.sub(r'-+', '-', slug)
    return re.sub(r'^-|-$', '', slug)
