"""Mirrors `packages/quac/src/model/QgsProject.ts`, as far as the plugin's first-release fields read a project."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Union

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
class DataSource:
    """
    Where a layer's data comes from, as far as the server route reads it: its
    kind, the source as the project holds it, and for a file the shape its
    `|geometrytype=` keeps. No address, path or connection detail is kept apart
    from `raw`, which the server route never writes.
    """

    kind: str
    raw: str
    geometry_type_filter: Optional[str] = None


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
    data_source: DataSource = field(default_factory=lambda: DataSource(kind='unsupported', raw=''))
    display_field: Optional[str] = None
    is_visible: bool = True
    queryable: bool = True
    opacity: float = 1
    editable: bool = True
    field_names: list[str] = field(default_factory=list)
    field_aliases: dict[str, str] = field(default_factory=dict)
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
