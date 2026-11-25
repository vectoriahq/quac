"""Mirrors `packages/quac/src/generate/normalizedProject.ts`, as far as a QGIS project's catalogue needs: the shared writer and its helpers.

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
from ..model.stac_projection import PROJ_CODE, PROJECTION_EXTENSION

STAC_VERSION = '1.1.0'

TABLE_EXTENSION = 'https://stac-extensions.github.io/table/v1.3.0/schema.json'

VECTOR_EXTENSION = 'https://stac-extensions.github.io/vector/v0.1.0/schema.json'

QUAC_RELATED_TO_FIELD = 'quac:related_to'

QUAC_PRIVATE_FIELD = 'quac:private'

QUAC_LOCKS_FIELD = 'quac:locks'

QUAC_FILTERS_FIELD = 'quac:filters'

QUAC_LEGEND_IMAGE_FIELD = 'quac:legend_image'

QUAC_ICON_FIELD = 'quac:icon'

QUAC_ADDED_MESSAGE_FIELD = 'quac:added_message'

QUAC_MUTUALLY_EXCLUSIVE_FIELD = 'quac:mutually_exclusive'

# The WGS84 box the source's author saved the map showing, on the top-level Catalog.
_INITIAL_VIEW_FIELD = 'quac:initial_view'

# The id of the Collection the source names as the map's opening active layer, on the top-level Catalog.
QUAC_ACTIVE_COLLECTION_FIELD = 'quac:active_collection'


@dataclass
class CollectionRelationField:
    """One field on each side of a relation's join: the parent Collection's and this Collection's."""

    parent: str
    child: str


@dataclass
class CollectionRelation:
    """
    One relation a Collection declares in `quac:related_to`: its id, the name
    it is shown under (empty where the source gives none), the parent
    Collection its records hang off, and the field pairs joining them.
    """

    id: str
    name: str
    parent_collection_id: str
    fields: list[CollectionRelationField]


@dataclass
class CollectionFilter:
    """A filter a Collection declares in `quac:filters`: the field it filters by, and the name it is shown under, None where it has none."""

    field: str
    name: Optional[str]


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
    # Relations with this layer as the child, written as `quac:related_to`.
    related_to: list[CollectionRelation] = field(default_factory=list)
    is_private: bool = False
    legend_image: Optional[str] = None
    icon: Optional[str] = None
    added_message: Optional[str] = None
    filters: list[CollectionFilter] = field(default_factory=list)
    # Fields that name the layer's source, such as `quac:wfs_endpoint`, copied straight onto the Collection.
    vendor_fields: dict[str, Any] = field(default_factory=dict)
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
    # The WGS84 box the source's author saved the map showing, a different fact from `bbox`.
    initial_view: Optional[BoundingBox] = None
    # The id of the Collection the source names as the map's opening active layer, written only where the tree holds it.
    active_collection_id: Optional[str] = None


def generate_stac_from_normalized(project: NormalizedProject) -> dict[str, Any]:
    """
    Builds a STAC Catalog tree from a NormalizedProject, listing the QUAC schema
    in `stac_extensions` where `declare_quac_extension` says: the project is
    the top-level Catalog, a group a nested Catalog and a layer a Collection.
    """
    collections, catalogs, links = _walk_nodes(project.nodes, './')
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
    if project.initial_view:
        view = project.initial_view
        catalog[_INITIAL_VIEW_FIELD] = [view.xmin, view.ymin, view.xmax, view.ymax]
    if collections:
        catalog['collections'] = collections
    if catalogs:
        catalog['catalogs'] = catalogs
    if project.active_collection_id and any(collection['id'] == project.active_collection_id for collection in _tree_collections(catalog)):
        catalog[QUAC_ACTIVE_COLLECTION_FIELD] = project.active_collection_id
    return declare_quac_extension(catalog)


def _tree_collections(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    """Every Collection in a Catalog tree, as `collectCatalogueCollections` in `packages/quac/src/model/stacTreeWalk.ts` collects them."""
    return [*(catalog.get('collections') or []), *(collection for child in catalog.get('catalogs') or [] for collection in _tree_collections(child))]


def _walk_nodes(nodes: list[NormalizedNode], folder: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Every relative href in the catalogue starts from the top-level document,
    the one document that holds the whole tree. `folder` is where the Catalog
    holding `nodes` would sit as a file of its own, relative to that document:
    `./` for the top level and `./catalogs/<id>/` for a group, nested group by
    group.
    """
    collections: list[dict[str, Any]] = []
    catalogs: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    for node in nodes:
        if isinstance(node, NormalizedLayer):
            collection = _build_collection(node, folder)
            collections.append(collection)
            links.append({'rel': 'child', 'href': f'{folder}collections/{collection["id"]}.json', 'type': 'application/json', 'title': collection['title']})
            continue
        group_folder = f'{folder}catalogs/{node.id}/'
        sub_collections, sub_catalogs, sub_links = _walk_nodes(node.children, group_folder)
        sub_catalog: dict[str, Any] = {
            'type': 'Catalog',
            'stac_version': STAC_VERSION,
            'id': node.id,
            **({'title': node.title} if node.title else {}),
            'description': node.description,
            'links': [
                {'rel': 'self', 'href': f'{group_folder}catalog.json'},
                {'rel': 'parent', 'href': f'{folder}catalog.json'},
                {'rel': 'root', 'href': './catalog.json'},
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
        links.append({'rel': 'child', 'href': f'{group_folder}catalog.json', 'type': 'application/json', 'title': node.title})
    return collections, catalogs, links


def _build_collection(layer: NormalizedLayer, folder: str) -> dict[str, Any]:
    stac_extensions = list(layer.extensions)
    if layer.table_columns:
        stac_extensions.append(TABLE_EXTENSION)
    vector_geometry_types = _geojson_geometry_types(layer.wkb_types)
    if vector_geometry_types:
        stac_extensions.append(VECTOR_EXTENSION)
    if any(isinstance(asset.get(PROJ_CODE), str) for asset in layer.assets.values()):
        stac_extensions.append(PROJECTION_EXTENSION)

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
        {'rel': 'self', 'href': f'{folder}collections/{layer.id}.json'},
        {'rel': 'parent', 'href': f'{folder}catalog.json'},
        {'rel': 'root', 'href': './catalog.json'},
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
    # A Collection with this is a related dataset rather than a map layer, and the field states what its records hang off.
    if layer.related_to:
        collection[QUAC_RELATED_TO_FIELD] = [_relation_to_json(relation) for relation in layer.related_to]
    if layer.is_private:
        collection[QUAC_PRIVATE_FIELD] = True
    if layer.locks:
        collection[QUAC_LOCKS_FIELD] = dict(layer.locks)
    if layer.filters:
        collection[QUAC_FILTERS_FIELD] = [{'field': entry.field, 'name': entry.name} if entry.name else {'field': entry.field} for entry in layer.filters]
    if layer.legend_image:
        collection[QUAC_LEGEND_IMAGE_FIELD] = layer.legend_image
    if layer.icon:
        collection[QUAC_ICON_FIELD] = layer.icon
    if layer.added_message:
        collection[QUAC_ADDED_MESSAGE_FIELD] = layer.added_message
    for key, value in layer.vendor_fields.items():
        collection[key] = value

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


def _relation_to_json(relation: CollectionRelation) -> dict[str, Any]:
    """One relation as `quac:related_to` stores it: a name the source left blank is left off."""
    return {
        'id': relation.id,
        **({'name': relation.name} if relation.name else {}),
        'parent_collection_id': relation.parent_collection_id,
        'fields': [{'parent': pair.parent, 'child': pair.child} for pair in relation.fields],
    }


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
