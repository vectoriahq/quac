"""Mirrors `packages/quac/src/model/QgsProject.ts`, as far as the plugin's catalogues read a project."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Union

# An edit's lock: `True`, or `{'expression': ...}`, the expression locking the feature it is true for.
EditLock = Union[bool, dict[str, str]]


@dataclass
class ProjectMeasurement:
    """The unit names QGIS saves under `<Measurement>` (`QgsUnitTypes::encodeUnit`), such as `ha` and `meters`."""

    area_unit: str
    distance_unit: str


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
    """The parts of a layer's `<resourceMetadata>` the catalogues read."""

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


# A fixed default, typed as QGIS's expression parser reads the literal: text, a number, true or false, or None for NULL.
FieldFixedValue = Union[str, int, float, bool, None]


@dataclass
class FieldDefaultValue:
    """
    A default value: `now` is the moment the feature is created, or saved where
    `on_update` is set; `uuid` is a new random identifier written in `format`,
    `with_braces`, `without_braces` or `id128`; `fixed` is `value` as the
    source wrote it.
    """

    kind: str
    on_update: bool
    format: Optional[str] = None
    value: FieldFixedValue = None


@dataclass
class FieldDefaultExpression:
    """A default worked out from the feature's other values; `on_update` fills it on every save rather than only the one creating the feature."""

    expression: str
    on_update: bool


@dataclass
class FieldConstraintExpression:
    """A QGIS constraint expression, its strength, `enforced` or `warn`, and the message the source gives for it, None where it gives none."""

    expression: str
    strength: str
    description: Optional[str] = None


@dataclass
class FieldCheckbox:
    """A Checkbox widget: the values a ticked and an unticked box write to a text field, None where unset, and its two display settings."""

    checked_value: Optional[str]
    unchecked_value: Optional[str]
    show_stored_value: bool
    allow_null: bool


@dataclass
class FieldAttachment:
    """
    A field's Attachment widget, which QGIS calls `ExternalResource`: what its
    document viewer shows (`image`, `web`, `audio` or `video`, None for none),
    its file filter and default root folder as written (None where unset), and
    what a stored path is relative to (`absolute`, `project` or `default-root`).
    """

    viewer: Optional[str]
    filter: Optional[str]
    default_root: Optional[str]
    relative_storage: str


@dataclass
class FormLayoutField:
    """
    A field the Drag and Drop Designer form places: the visibility expressions
    of the containers around it, outermost first, and the expression behind its
    data-defined Editable property, None where it has none.
    """

    name: str
    visible_when: list[str]
    editable_when: Optional[str] = None


@dataclass
class LayerFormLayout:
    """A layer's Drag and Drop Designer form: the fields it places, in its order."""

    fields: list[FormLayoutField]


@dataclass
class FieldEditRule:
    """
    What a field's form settings say about changing it, as `parseLayers.ts`'s
    `FieldEditRule` holds it. `range` holds only the members the source sets,
    of `min`, `max`, `step`, `precision` and `suffix`.
    """

    read_only: bool = False
    default_value: Optional[FieldDefaultValue] = None
    # `enforced` or `warn`, None where the source sets none.
    not_null: Optional[str] = None
    unique: Optional[str] = None
    # `default` or `unset`, None for QGIS's `Duplicate`.
    duplicate_policy: Optional[str] = None
    constraint_expression: Optional[FieldConstraintExpression] = None
    default_expression: Optional[FieldDefaultExpression] = None
    hidden: bool = False
    reuse_last_value: bool = False
    checkbox: Optional[FieldCheckbox] = None
    range: Optional[dict[str, Any]] = None
    date_format: Optional[str] = None
    colour: bool = False
    not_searchable: bool = False
    label_on_top: bool = False


@dataclass
class LayerStyle:
    """
    One of a layer's named styles, as far as `quac:categorised_field` reads
    it: its name in QGIS's style manager, whether it is the one applied, and
    the field a categorised or graduated renderer classifies by. The
    renderer's own XML is not kept.
    """

    name: str
    is_active: bool
    categorised_field: Optional[str] = None


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
    # A WFS layer's `srsname`, the coordinate system it asks the service for.
    srs_name: Optional[str] = None
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
    # The layer's named styles, and the index of the one applied, -1 where there is none.
    styles: list[LayerStyle] = field(default_factory=list)
    active_style_index: int = -1
    # **Private** in Project Properties → Data Sources: the layer is kept out of the legend.
    is_private: bool = False
    # The legend placeholder image the project embeds, as a `data:` URL.
    legend_image: Optional[str] = None
    # The address of the icon the layer's `quac_icon` variable names, and its `quac_added_message`.
    icon: Optional[str] = None
    added_message: Optional[str] = None
    # The address of the icon each field's `quac_icon_<field>` variable names, by field name.
    field_icons: dict[str, str] = field(default_factory=dict)
    field_edit_rules: dict[str, FieldEditRule] = field(default_factory=dict)
    # Each field's Attachment widget, the control its `quac_control_<field>` variable asks for, and its custom comment, by field name.
    field_attachments: dict[str, FieldAttachment] = field(default_factory=dict)
    field_controls: dict[str, str] = field(default_factory=dict)
    field_comments: dict[str, str] = field(default_factory=dict)
    # The layer's Drag and Drop Designer form, None where its form is not one or places nothing.
    form_layout: Optional[LayerFormLayout] = None


@dataclass
class MapExtent:
    """The map canvas extent the project saves, in the canvas's coordinate system, or the project's where the canvas names none."""

    xmin: float
    ymin: float
    xmax: float
    ymax: float
    crs: Optional[str]


@dataclass
class QgsRelationFieldPair:
    """One `<fieldRef>` of a relation: the field on the parent layer (`referencedField`) and on the child (`referencingField`)."""

    parent_field: str
    child_field: str


@dataclass
class QgsRelation:
    """
    One of the project's relations: its id and name (empty where the project
    gives none), the parent layer's id (`referencedLayer`), the child's
    (`referencingLayer`), the field pairs joining them in file order, and
    QGIS's `strength` as written, None where the project gives none.
    """

    id: str
    name: str
    parent_layer_id: str
    child_layer_id: str
    field_pairs: list[QgsRelationFieldPair]
    strength: Optional[str]


@dataclass
class PresetFilter:
    """A filter the project sets up on a layer's field, and the name it is shown under, None where it has none."""

    layer_id: str
    field: str
    name: Optional[str]


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
    """The parts of `<projectMetadata>` the catalogues read."""

    abstract: Optional[str] = None


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
    map_extent: Optional[MapExtent] = None
    relations: list[QgsRelation] = field(default_factory=list)
    # The layer the QFieldSync plugin names as the one the project opens with as the active layer.
    initial_active_layer_id: Optional[str] = None
    mergin_filters: list[PresetFilter] = field(default_factory=list)
    # The project's area and distance units, None where it saves neither.
    measurement: Optional[ProjectMeasurement] = None
