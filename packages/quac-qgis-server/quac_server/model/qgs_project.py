"""Mirrors `packages/quac/src/model/QgsProject.ts`, as far as the plugin's first-release fields read a project."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Union

# An edit's lock: `True`, or `{'expression': ...}`, the expression locking the feature it is true for.
EditLock = Union[bool, dict[str, str]]


@dataclass
class ServerHiddenFields:
    """The fields QGIS Server leaves out of WMS and of WFS."""

    wms: list[str]
    wfs: list[str]


@dataclass
class BoundingBox:
    xmin: float
    ymin: float
    xmax: float
    ymax: float


@dataclass
class LayerScaleRange:
    """The scales the layer is drawn between; None on a side with no limit."""

    min_scale: Optional[float]
    max_scale: Optional[float]


@dataclass
class LayerResourceMetadata:
    """The parts of a layer's `<resourceMetadata>` the first-release fields read."""

    abstract: Optional[str] = None
    license: Optional[str] = None
    temporal_interval: Optional[list[Optional[str]]] = None


@dataclass
class FieldValueMapEntry:
    """One entry of a Value Map widget's list: the value QGIS stores in the field, and the label shown for it."""

    value: str
    label: str


@dataclass
class FieldValueRelation:
    """
    A field's Value Relation widget, as far as `quac:value_relation` reads it:
    the lookup layer it names, by id and by name, the fields stored and shown,
    and how the list is filtered and ordered.
    """

    layer_id: str
    layer_name: str
    key_field: str
    value_field: str
    filter_expression: str
    allow_null: bool
    allow_multi: bool
    # What orders the list: `key`, `value`, or `field`, the lookup field in `order_field`.
    order_by: str
    order_field: Optional[str]
    descending: bool


@dataclass
class DataSource:
    """
    Where a layer's data comes from: its kind, the source as the project holds
    it, and what a data asset or web map link says of it. For a file, its name,
    its path as the project writes it, or the address of an online file, the
    GeoPackage table it names, the shape its `|geometrytype=` keeps, its
    Delimited Text options and its feature filter; for a WFS layer, its service
    address and feature type and its feature filter; for an ArcGIS layer, its
    service layer's address and filter; for a WMS, WMTS or XYZ layer, its
    address and the settings its link carries; for a source of another kind,
    the provider it names. The server route writes none of them, and never
    writes `raw`.
    """

    kind: str
    raw: str
    geometry_type_filter: Optional[str] = None
    # A file's name, the last segment of its path or address.
    filename: Optional[str] = None
    # A file's path as the project writes it, each backslash made `/`, or an online file's address.
    rel_path: Optional[str] = None
    # An online file's address, read through GDAL's `/vsicurl/` or given as `http` or `https`; a WFS service's; an ArcGIS service layer's;
    # a WMS service's as the source gives it; a WMTS service's less its request parameters; an XYZ layer's tile template.
    url: Optional[str] = None
    layer_name: Optional[str] = None
    # `{'expression': ..., 'dialect': ...}`, as `quac:feature_filter` writes it.
    feature_filter: Optional[dict[str, str]] = None
    # A Delimited Text source's options, as `quac:delimited_text` writes them.
    delimited_text: Optional[dict[str, Any]] = None
    type_name: Optional[str] = None
    # An ArcGIS layer's filter, sent to the service as its query's `where`.
    where: Optional[str] = None
    # A WMS layer's layer names and style names, tile or image format, CRS, version, transparency and `TIME` or `ELEVATION` dimension.
    layers: Optional[list[str]] = None
    styles: Optional[list[str]] = None
    format: Optional[str] = None
    crs: Optional[str] = None
    version: Optional[str] = None
    transparent: Optional[bool] = None
    # A WMS layer's dimensions, or a WMTS layer's `tileDimensions`, by name.
    dimensions: Optional[dict[str, str]] = None
    # A WMTS layer's layer, style (empty for the layer's default) and tile matrix set.
    layer: Optional[str] = None
    style: Optional[str] = None
    tile_matrix_set: Optional[str] = None
    # What an XYZ layer's tiles hold, `image` or `vector`, and the deepest zoom level QGIS requests (`zmax`).
    tiles: Optional[str] = None
    max_zoom: Optional[int] = None
    # For a source of kind `unsupported`, the provider it names, or one guessed from its text.
    hint: Optional[str] = None


@dataclass
class LayerEntry:
    id: str
    name: str
    short_name: Optional[str]
    server_hidden_fields: Optional[ServerHiddenFields] = None
    type: str = ''
    geometry_type: Optional[str] = None
    wkb_type: Optional[str] = None
    wgs84_extent: Optional[BoundingBox] = None
    # The layer's coordinate system as QGIS holds it (`<srs><spatialrefsys><authid>`).
    crs: Optional[str] = None
    data_source: DataSource = field(default_factory=lambda: DataSource(kind='unsupported', raw=''))
    display_field: Optional[str] = None
    is_visible: bool = True
    queryable: bool = True
    opacity: float = 1
    editable: bool = True
    field_names: list[str] = field(default_factory=list)
    field_aliases: dict[str, str] = field(default_factory=dict)
    field_value_maps: dict[str, list[FieldValueMapEntry]] = field(default_factory=dict)
    field_value_relations: dict[str, FieldValueRelation] = field(default_factory=dict)
    resource_metadata: LayerResourceMetadata = field(default_factory=LayerResourceMetadata)
    scale_range: Optional[LayerScaleRange] = None
    locks: dict[str, EditLock] = field(default_factory=dict)


@dataclass
class LayerTreeLeaf:
    layer_id: str
    name: str
    checked: bool
    kind: str = 'layer'


@dataclass
class LayerGroup:
    name: str
    checked: bool
    children: list['LayerTreeNode']
    mutually_exclusive: bool = False
    kind: str = 'group'


LayerTreeNode = Union[LayerGroup, LayerTreeLeaf]


@dataclass
class WmsPublishing:
    """From Project Properties → QGIS Server → WMS capabilities."""

    use_layer_ids: bool
    restricted_layers: list[str]


@dataclass
class WfsTransactionLayers:
    """Layer ids, from Project Properties → QGIS Server → WFS capabilities."""

    published: list[str]
    insert: list[str]
    update: list[str]
    delete: list[str]


@dataclass
class ProjectMetadata:
    """The parts of `<projectMetadata>` the first-release fields read."""

    abstract: Optional[str] = None


@dataclass
class PrintLayoutTemplate:
    """A print layout as its name and its `<Layout>` element, which is a QGIS layout template."""

    name: str
    template: str


@dataclass
class QgsProject:
    layers: list[LayerEntry]
    layer_tree: LayerGroup
    wfs_transaction_layers: Optional[WfsTransactionLayers] = None
    wms_publishing: Optional[WmsPublishing] = None
    qgis_version: Optional[str] = None
    title: str = ''
    project_crs: Optional[str] = None
    metadata: ProjectMetadata = field(default_factory=ProjectMetadata)
    wms_crs_list: list[str] = field(default_factory=list)
    print_layouts: list[PrintLayoutTemplate] = field(default_factory=list)
