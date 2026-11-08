"""Mirrors `packages/quac/src/generate/stacCatalogue.ts`, as far as the plugin's first-release fields need.

`generate_stac_catalogue` is the project file's catalogue, which the server
route starts from, written with the first-release fields only. It writes no
data asset, style asset, link or field naming where a layer's own data comes
from: the server route replaces or drops each of them.
"""

from __future__ import annotations

from typing import Any, Optional

from ..model.qgs_project import BoundingBox, EditLock, LayerEntry, LayerGroup, QgsProject, WfsTransactionLayers, WmsPublishing
from ..parse.geometry_siblings import find_geometry_siblings
from .normalized_project import (
    NormalizedGroup,
    NormalizedLayer,
    NormalizedNode,
    NormalizedProject,
    QgisServerNames,
    generate_stac_from_normalized,
    slugify,
    union_bboxes,
)

# The source kinds that are images: a layer of one has no features to edit. `image` is how
# `parse_data_source` reads every source of the providers that read images.
_IMAGE_KINDS = ('wms', 'wmts', 'xyz', 'image')


def generate_stac_catalogue(project: QgsProject, layer_wgs84_extents: Optional[dict[str, BoundingBox]] = None) -> dict[str, Any]:
    """
    The catalogue a project file gives, as far as the first-release fields go.
    `layer_wgs84_extents` is the WGS84 box of a layer whose project saves no
    `<wgs84extent>`, by layer id, as the JavaScript's `layerWgs84Extents` is.
    """
    return generate_stac_from_normalized(_qgs_project_to_normalized(project, layer_wgs84_extents or {}))


class _LayerContext:
    def __init__(self, project: QgsProject, siblings_by_id: dict[str, list[LayerEntry]], layer_wgs84_extents: dict[str, BoundingBox]) -> None:
        self.siblings_by_id = siblings_by_id
        self.layer_wgs84_extents = layer_wgs84_extents
        self.wfs_transaction_layers = project.wfs_transaction_layers
        self.wms_publishing = project.wms_publishing


def _qgs_project_to_normalized(project: QgsProject, layer_wgs84_extents: dict[str, BoundingBox]) -> NormalizedProject:
    layers_by_id = {layer.id: layer for layer in project.layers}
    context = _LayerContext(project, find_geometry_siblings(project), layer_wgs84_extents)
    nodes = _walk_qgs_group(project.layer_tree, layers_by_id, context)

    # A layer the layers panel does not list comes after every listed one, in the order the project file holds it.
    listed: set[str] = set()

    def collect_listed(group: LayerGroup) -> None:
        for child in group.children:
            if isinstance(child, LayerGroup):
                collect_listed(child)
            else:
                listed.add(child.layer_id)

    collect_listed(project.layer_tree)
    for layer in project.layers:
        if layer.id in listed:
            continue
        node = _layer_to_normalized(layer, context)
        if node is not None:
            nodes.append(node)

    title = project.title
    return NormalizedProject(
        id=slugify(title or 'qgs-project') or 'qgs-project',
        title=title,
        description=project.metadata.abstract
        if project.metadata.abstract is not None
        else (f'STAC catalogue generated from QGIS project "{title}".' if title else 'STAC catalogue generated from a QGIS project.'),
        bbox=union_bboxes([effective_wgs84_bbox(layer, layer_wgs84_extents) for layer in project.layers]),
        nodes=nodes,
    )


def _walk_qgs_group(group: LayerGroup, layers_by_id: dict[str, LayerEntry], context: _LayerContext) -> list[NormalizedNode]:
    nodes: list[NormalizedNode] = []
    for node in group.children:
        if not isinstance(node, LayerGroup):
            layer = layers_by_id.get(node.layer_id)
            if layer is None:
                continue
            normalized = _layer_to_normalized(layer, context)
            if normalized is not None:
                nodes.append(normalized)
            continue
        siblings = _whole_group_siblings(node, context.siblings_by_id)
        if siblings is not None:
            nodes.append(_siblings_to_normalized(siblings, node.name, context))
            continue
        nodes.append(NormalizedGroup(
            id=slugify(node.name) or 'group',
            title=node.name,
            description=qgis_placeholder_description('group', node.name),
            mutually_exclusive=node.mutually_exclusive,
            children=_walk_qgs_group(node, layers_by_id, context),
        ))
    return nodes


def _whole_group_siblings(group: LayerGroup, siblings_by_id: dict[str, list[LayerEntry]]) -> Optional[list[LayerEntry]]:
    """The set of geometry siblings that is the whole of `group`'s contents, or None."""
    first = group.children[0] if group.children else None
    siblings = siblings_by_id.get(first.layer_id) if first is not None and not isinstance(first, LayerGroup) else None
    if not siblings or len(group.children) != len(siblings):
        return None
    sibling_ids = {sibling.id for sibling in siblings}
    whole_group = all(not isinstance(child, LayerGroup) and child.layer_id in sibling_ids for child in group.children)
    return siblings if whole_group else None


def _layer_to_normalized(layer: LayerEntry, context: _LayerContext) -> Optional[NormalizedLayer]:
    """A layer's Collection: its own, or for a geometry sibling the set's, which its first sibling stands for."""
    siblings = context.siblings_by_id.get(layer.id)
    if not siblings:
        return _qgs_layer_to_normalized(layer, context)
    return _siblings_to_normalized(siblings, layer.name, context) if siblings[0] is layer else None


def _siblings_to_normalized(siblings: list[LayerEntry], title: str, context: _LayerContext) -> NormalizedLayer:
    """
    One Collection for layers QGIS split out of one file by shape: the first
    sibling's settings and every sibling's extent. QGIS Server names each
    sibling separately, so the one Collection has no name of its own, and the
    server route does not serve it.
    """
    first = siblings[0]
    wkb_types = [layer.wkb_type for layer in siblings if layer.wkb_type]
    normalized = _qgs_layer_to_normalized(first, context)
    normalized.title = title
    normalized.description = first.resource_metadata.abstract if first.resource_metadata.abstract is not None else qgis_placeholder_description('layer', title)
    normalized.bbox = union_bboxes([effective_wgs84_bbox(layer, context.layer_wgs84_extents) for layer in siblings])
    # A sibling that names no WKB type leaves the list unknown, so none is written.
    normalized.wkb_types = wkb_types if len(wkb_types) == len(siblings) else []
    normalized.qgis_server_names = None
    return normalized


def qgis_server_names_of(layer: LayerEntry, wms_publishing: Optional[WmsPublishing], wfs_transaction_layers: Optional[WfsTransactionLayers]) -> QgisServerNames:
    """
    The names QGIS Server would give the layer if it served the project. Its
    WMS name is its layer id where the project ticks **Use layer ids as
    names**, else its short name, else its name, and none where the project
    leaves it out of WMS. Its WFS type name, given only where the project
    publishes it for WFS, is its short name or else its name, with each space
    made `_` and each `:` and em dash made `-`.
    """
    own_name = layer.short_name or layer.name
    if wms_publishing is not None and layer.name in wms_publishing.restricted_layers:
        wms_name: Optional[str] = None
    elif wms_publishing is not None and wms_publishing.use_layer_ids:
        wms_name = layer.id
    else:
        wms_name = own_name
    wfs_published = wfs_transaction_layers is not None and layer.id in wfs_transaction_layers.published
    wfs_type_name = own_name.replace(' ', '_').replace(':', '-').replace('—', '-') if wfs_published else None
    return QgisServerNames(wms_name=wms_name or None, wfs_type_name=wfs_type_name or None)


def _qgs_layer_to_normalized(layer: LayerEntry, context: _LayerContext) -> NormalizedLayer:
    metadata = layer.resource_metadata
    return NormalizedLayer(
        id=layer.id,
        title=layer.name,
        description=metadata.abstract if metadata.abstract is not None else qgis_placeholder_description('layer', layer.name),
        bbox=effective_wgs84_bbox(layer, context.layer_wgs84_extents),
        geometry_type=layer.geometry_type,
        wkb_types=[layer.wkb_type] if layer.wkb_type else [],
        qgis_server_names=qgis_server_names_of(layer, context.wms_publishing, context.wfs_transaction_layers),
        table_columns=_derive_table_columns(layer.field_names, layer.field_aliases),
        license=metadata.license,
        temporal_interval=metadata.temporal_interval,
        display_field=layer.display_field,
        visibility_checked=layer.is_visible,
        editable=False if layer.data_source.kind in _IMAGE_KINDS else layer.editable,
        identifiable=layer.queryable,
        scale_range=layer.scale_range,
        opacity=layer.opacity,
        locks=_combine_locks(layer.locks, _wfs_transaction_locks(layer.id, context.wfs_transaction_layers)),
    )


def effective_wgs84_bbox(layer: LayerEntry, layer_wgs84_extents: dict[str, BoundingBox]) -> Optional[BoundingBox]:
    """A layer's WGS84 box: QGIS's own `<wgs84extent>` where it wrote one, otherwise the one given for it, otherwise None."""
    return layer.wgs84_extent or layer_wgs84_extents.get(layer.id)


def qgis_placeholder_description(kind: str, name: str) -> str:
    """The description a Collection takes where its QGIS layer or group has no abstract of its own, since STAC requires one."""
    return f'{"Layer group" if kind == "group" else "Layer"} "{name}" from the QGIS project.'


def _wfs_transaction_locks(layer_id: str, layers: Optional[WfsTransactionLayers]) -> dict[str, EditLock]:
    """
    The edits a layer published for WFS does not take: an unticked **Insert**
    locks adding, **Update** both attributes and geometry, and **Delete**
    deleting. A layer the project does not publish locks nothing.
    """
    if layers is None or layer_id not in layers.published:
        return {}
    locks: dict[str, EditLock] = {}
    if layer_id not in layers.insert:
        locks['add'] = True
    if layer_id not in layers.update:
        locks['attributes'] = True
        locks['geometry'] = True
    if layer_id not in layers.delete:
        locks['delete'] = True
    return locks


def _combine_locks(first: dict[str, EditLock], second: dict[str, EditLock]) -> dict[str, EditLock]:
    """Either source's locks, where `True` from either wins over the other's expression."""
    locks = dict(first)
    for edit, lock in second.items():
        if lock is True or not locks.get(edit):
            locks[edit] = lock
    return locks


def _derive_table_columns(field_names: list[str], field_aliases: dict[str, str]) -> list[dict[str, Any]]:
    """
    `table:columns` from the fields QGIS declares in `<fieldConfiguration>`,
    then any field only an alias names, each with its alias as `title`. With no
    data to read, no `type` is written.
    """
    ordered = list(dict.fromkeys([*field_names, *field_aliases]))
    columns: list[dict[str, Any]] = []
    for name in ordered:
        column: dict[str, Any] = {'name': name}
        alias = field_aliases.get(name)
        if alias:
            column['title'] = alias
        columns.append(column)
    return columns
