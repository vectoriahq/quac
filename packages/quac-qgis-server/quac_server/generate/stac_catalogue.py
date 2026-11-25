"""Mirrors `packages/quac/src/generate/stacCatalogue.ts`, as far as a QGIS project's catalogue needs.

`generate_stac_catalogue` is the project file's catalogue, which the server
route starts from and the QGIS Desktop part writes (`quac/publish.py`): each
layer's settings, its data asset and its web map link, as `qgsLayerToNormalized`
writes them, with a file layer's relative path or online address, a WFS layer's
GetFeature request or an ArcGIS layer's query, as `buildAssets` writes it, and a
WMS, WMTS or XYZ layer's web-map-links link, or for an XYZ template addressed by
`{quadkey}` its data asset. It writes no style asset and no `via` link to the
project. The server route keeps only the fields it declares, replaces the
links and replaces or drops the data asset, so a served catalogue never names
a data file or another service.
"""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Any, Optional

from ..model.qgs_project import BoundingBox, EditLock, FieldEditRule, FieldValueMapEntry, FieldValueRelation, LayerEntry, LayerGroup, LayerTreeNode, PresetFilter, QgsProject, QgsRelation, WfsTransactionLayers, WmsPublishing
from ..model.stac_href import encode_asset_path
from ..model.stac_projection import PROJ_CODE
from ..model.stac_wms import WEB_MAP_LINKS_EXTENSION, build_wms_link
from ..model.stac_wmts import build_wmts_link
from ..model.stac_xyz import build_xyz_link
from ..parse.geometry_siblings import find_geometry_siblings, read_sibling_shapes, sibling_collection_id
from ..parse.project_notes import find_value_relation_lookup, is_filter_in_project, is_relation_in_project
from ..util.catalogue_file_formats import PROJECT_DATA_ROLES, declared_media_type_for_file, is_layer_file_of_format
from .arcgis_stac_catalogue import arcgis_query_asset
from .normalized_project import (
    CollectionFilter,
    CollectionRelation,
    CollectionRelationField,
    NormalizedGroup,
    NormalizedLayer,
    NormalizedNode,
    NormalizedProject,
    QgisServerNames,
    generate_stac_from_normalized,
    slugify,
    union_bboxes,
)
from .wfs_stac_catalogue import wfs_get_feature_asset

# The keys a data asset takes for the shapes its Collection holds, the GeoPackage table it reads, its Delimited Text options and its feature filter.
QUAC_GEOMETRY_FILTER = 'quac:geometry_filter'
QUAC_LAYER_NAME = 'quac:layer_name'
QUAC_DELIMITED_TEXT = 'quac:delimited_text'
QUAC_FEATURE_FILTER = 'quac:feature_filter'

# The key a style asset takes for the field its renderer classifies by, when that renderer is a categorised one.
QUAC_CATEGORISED_FIELD = 'quac:categorised_field'

# The source kinds that are images: a layer of one has no features to edit.
_IMAGE_KINDS = ('wms', 'wmts', 'xyz')


def generate_stac_catalogue(
    project: QgsProject,
    layer_wgs84_extents: Optional[dict[str, BoundingBox]] = None,
    initial_view: Optional[BoundingBox] = None,
) -> dict[str, Any]:
    """
    The catalogue a project file gives. `layer_wgs84_extents` is the WGS84 box
    of a layer whose project saves no `<wgs84extent>`, by layer id, as the
    JavaScript's `layerWgs84Extents` is, and `initial_view` the project's map
    canvas extent (`QgsProject.map_extent`) already in WGS84, as its
    `initialView` is: this package holds no reprojection, so the caller
    converts both.

    A layer or group the project leaves out of WMS (**Exclude layers**) is left
    out: the catalogue is built as if the project did not hold it, so a
    relation, Value Relation, filter or initial active layer naming it is
    dropped too (`wms_excluded_layer_ids`).
    """
    return generate_stac_from_normalized(_qgs_project_to_normalized(_without_wms_excluded_layers(project), layer_wgs84_extents or {}, initial_view))


class _LayerContext:
    def __init__(self, project: QgsProject, siblings_by_id: dict[str, list[LayerEntry]], layer_wgs84_extents: dict[str, BoundingBox]) -> None:
        layers_by_id = {layer.id: layer for layer in project.layers}
        self.siblings_by_id = siblings_by_id
        self.layer_wgs84_extents = layer_wgs84_extents
        self.wfs_transaction_layers = project.wfs_transaction_layers
        self.wms_publishing = project.wms_publishing
        self.value_relations_by_layer_id = _collect_value_relations_by_layer_id(project.layers, siblings_by_id)
        self.relations_by_child_layer_id = _collect_relations_by_child_layer_id(project.relations, layers_by_id, siblings_by_id)
        # The filters the project sets up, by the id of the Collection each goes onto.
        self.filters_by_collection_id = _collect_filters_by_collection_id(project.mergin_filters, layers_by_id, siblings_by_id)


def _qgs_project_to_normalized(project: QgsProject, layer_wgs84_extents: dict[str, BoundingBox], initial_view: Optional[BoundingBox]) -> NormalizedProject:
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
        initial_view=initial_view,
        active_collection_id=sibling_collection_id(context.siblings_by_id, project.initial_active_layer_id)
        if project.initial_active_layer_id and project.initial_active_layer_id in layers_by_id
        else None,
        nodes=nodes,
    )


def _collect_filters_by_collection_id(
    filters: list[PresetFilter],
    layers_by_id: dict[str, LayerEntry],
    siblings_by_id: dict[str, list[LayerEntry]],
) -> dict[str, list[CollectionFilter]]:
    """
    Sorts a project's filters by the Collection each goes onto: its layer's,
    the first sibling's for a layer QGIS split by shape. A filter whose layer
    is not in the project, or does not have its field, goes nowhere.
    """
    by_collection_id: dict[str, list[CollectionFilter]] = {}
    for preset in filters:
        if not is_filter_in_project(preset, layers_by_id):
            continue
        by_collection_id.setdefault(sibling_collection_id(siblings_by_id, preset.layer_id), []).append(CollectionFilter(field=preset.field, name=preset.name))
    return by_collection_id


def _collect_relations_by_child_layer_id(
    relations: list[QgsRelation],
    layers_by_id: dict[str, LayerEntry],
    siblings_by_id: dict[str, list[LayerEntry]],
) -> dict[str, list[CollectionRelation]]:
    """
    Groups the project's relations under the child layer each one hangs off a
    parent, which is the layer whose Collection has them. A relation naming a
    layer the project does not hold is dropped: it would point at a Collection
    this catalogue has no entry for.
    """
    by_child_layer_id: dict[str, list[CollectionRelation]] = {}
    for relation in relations:
        if not is_relation_in_project(relation, layers_by_id):
            continue
        by_child_layer_id.setdefault(sibling_collection_id(siblings_by_id, relation.child_layer_id), []).append(CollectionRelation(
            id=relation.id,
            name=relation.name,
            parent_collection_id=sibling_collection_id(siblings_by_id, relation.parent_layer_id),
            fields=[CollectionRelationField(parent=pair.parent_field, child=pair.child_field) for pair in relation.field_pairs],
        ))
    return by_child_layer_id


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
        return _qgs_layer_to_normalized(layer, context, _geometry_filter_of(layer))
    return _siblings_to_normalized(siblings, layer.name, context) if siblings[0] is layer else None


def _siblings_to_normalized(siblings: list[LayerEntry], title: str, context: _LayerContext) -> NormalizedLayer:
    """
    One Collection for layers QGIS split out of one file by shape: the first
    sibling's settings, every sibling's extent, and a data asset keeping the
    siblings' shapes. With all three shapes it keeps none, so the layer reads
    the whole file. QGIS Server names each sibling separately, so the one
    Collection has no name of its own, and the server route does not serve it.
    """
    first = siblings[0]
    shapes = read_sibling_shapes(siblings)
    wkb_types = [layer.wkb_type for layer in siblings if layer.wkb_type]
    normalized = _qgs_layer_to_normalized(first, context, None if len(shapes) == 3 else shapes)
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


def wms_excluded_layer_ids(project: QgsProject) -> set[str]:
    """
    The layers a project leaves out of WMS under **Exclude layers**
    (`WMSRestrictedLayers`): each layer whose name it lists, wherever the layer
    sits, and every layer inside a group whose name it lists. Neither route's
    catalogue holds them.
    """
    restricted = set(project.wms_publishing.restricted_layers if project.wms_publishing else [])
    excluded: set[str] = set()
    if not restricted:
        return excluded
    for layer in project.layers:
        if layer.name in restricted:
            excluded.add(layer.id)

    def walk(group: LayerGroup, in_excluded_group: bool) -> None:
        for node in group.children:
            if isinstance(node, LayerGroup):
                walk(node, in_excluded_group or node.name in restricted)
            elif in_excluded_group:
                excluded.add(node.layer_id)

    walk(project.layer_tree, False)
    return excluded


def _without_wms_excluded_layers(project: QgsProject) -> QgsProject:
    """The project less the layers and groups it leaves out of WMS (`wms_excluded_layer_ids`)."""
    excluded = wms_excluded_layer_ids(project)
    if not excluded:
        return project
    restricted = set(project.wms_publishing.restricted_layers if project.wms_publishing else [])

    def prune(group: LayerGroup) -> LayerGroup:
        children: list[LayerTreeNode] = []
        for node in group.children:
            if isinstance(node, LayerGroup):
                if node.name not in restricted:
                    children.append(prune(node))
            elif node.layer_id not in excluded:
                children.append(node)
        return replace(group, children=children)

    return replace(project, layers=[layer for layer in project.layers if layer.id not in excluded], layer_tree=prune(project.layer_tree))


def _geometry_filter_of(layer: LayerEntry) -> Optional[list[str]]:
    shapes = read_sibling_shapes([layer])
    return shapes or None


def _qgs_layer_to_normalized(layer: LayerEntry, context: _LayerContext, geometry_filter: Optional[list[str]]) -> NormalizedLayer:
    """A layer's Collection. `geometry_filter` is the shapes its data asset keeps: its own `|geometrytype=` (`_geometry_filter_of`), or a set of siblings'."""
    metadata = layer.resource_metadata
    source = layer.data_source
    web_map_link = (
        build_wms_link(source) if source.kind == 'wms'
        else build_wmts_link(source) if source.kind == 'wmts'
        else build_xyz_link(source.url or '', source.tiles or 'image') if source.kind == 'xyz'
        else None
    )
    return NormalizedLayer(
        id=layer.id,
        title=layer.name,
        description=metadata.abstract if metadata.abstract is not None else qgis_placeholder_description('layer', layer.name),
        bbox=effective_wgs84_bbox(layer, context.layer_wgs84_extents),
        geometry_type=layer.geometry_type,
        wkb_types=[layer.wkb_type] if layer.wkb_type else [],
        qgis_server_names=qgis_server_names_of(layer, context.wms_publishing, context.wfs_transaction_layers),
        table_columns=_derive_table_columns(
            layer.field_names,
            layer.field_aliases,
            layer.field_value_maps,
            layer.field_edit_rules,
            context.value_relations_by_layer_id.get(layer.id, {}),
            layer.field_icons,
        ),
        license=metadata.license,
        temporal_interval=metadata.temporal_interval,
        display_field=layer.display_field,
        visibility_checked=layer.is_visible,
        editable=False if layer.data_source.kind in _IMAGE_KINDS else layer.editable,
        identifiable=layer.queryable,
        scale_range=layer.scale_range,
        opacity=layer.opacity,
        related_to=context.relations_by_child_layer_id.get(layer.id, []),
        is_private=layer.is_private,
        legend_image=layer.legend_image,
        icon=layer.icon,
        added_message=layer.added_message,
        locks=_combine_locks(layer.locks, _wfs_transaction_locks(layer.id, context.wfs_transaction_layers)),
        filters=context.filters_by_collection_id.get(layer.id, []),
        vendor_fields=_build_vendor_fields(layer),
        assets=_build_assets(layer, geometry_filter),
        links=[web_map_link] if web_map_link else [],
        extensions=[WEB_MAP_LINKS_EXTENSION] if web_map_link else [],
    )


def _build_vendor_fields(layer: LayerEntry) -> dict[str, Any]:
    """
    An XYZ layer's deepest zoom level as `quac:max_zoom`, a WFS layer's service,
    feature type and coordinate system as `quac:wfs_*` fields, and an ArcGIS
    layer's address and filter as `quac:arcgis_*` fields, so a reader reads them
    directly instead of taking them back apart out of the asset href.
    """
    source = layer.data_source
    if source.kind == 'xyz':
        return {} if source.max_zoom is None else {'quac:max_zoom': source.max_zoom}
    # The same fields an ArcGIS Online layer's Collection carries, so one reader loads both.
    if source.kind == 'arcgis':
        return {'quac:arcgis_layer_url': source.url, **({'quac:arcgis_where': source.where} if source.where else {})}
    if source.kind != 'wfs':
        return {}
    fields: dict[str, Any] = {'quac:wfs_endpoint': source.url, 'quac:wfs_type_name': source.type_name}
    if source.srs_name:
        fields['quac:wfs_srs_name'] = source.srs_name
    return fields


def _layer_crs_field(layer: LayerEntry) -> dict[str, str]:
    """
    The layer's coordinate system as QGIS holds it, as `proj:code`. Nothing
    where the project names none, or names one with no authority code, such as
    a user-defined system.
    """
    return {PROJ_CODE: layer.crs} if layer.crs and re.match(r'^[A-Za-z]+:\S+\Z', layer.crs) else {}


def _build_assets(layer: LayerEntry, geometry_filter: Optional[list[str]]) -> dict[str, Any]:
    """
    The layer's data asset, as the JavaScript's `buildAssets` writes it: for a
    file, the path the project gives, not just the file's name, or an online
    file's own address; for a WFS layer, its GetFeature request; for an ArcGIS
    layer, its query; for an XYZ template addressed by `{quadkey}`, which no
    `rel: "xyz"` link can hold, the template. A WMS or WMTS layer, and an XYZ
    layer its link holds, has none, and neither has a source the catalogue
    cannot address, such as a database.
    """
    source = layer.data_source
    if source.kind in ('wms', 'wmts'):
        return {}
    if source.kind == 'xyz':
        if build_xyz_link(source.url or ''):
            return {}
        return {'data': {'href': source.url, 'title': 'XYZ tile template', 'roles': ['data']}}
    if source.kind == 'file':
        filename = source.filename or ''
        asset: dict[str, Any] = {
            'href': source.url if source.url is not None else f'./{encode_asset_path(source.rel_path or "")}',
            'type': declared_media_type_for_file(filename, PROJECT_DATA_ROLES),
            'title': filename,
            'roles': ['data'],
        }
        if geometry_filter:
            asset[QUAC_GEOMETRY_FILTER] = geometry_filter
        # Only a GeoPackage's: QGIS also writes `|layername=` for a GeoJSON file, which holds one layer.
        if source.layer_name and is_layer_file_of_format(filename, 'geopackage'):
            asset[QUAC_LAYER_NAME] = source.layer_name
        if source.delimited_text:
            asset[QUAC_DELIMITED_TEXT] = dict(source.delimited_text)
        if source.feature_filter:
            asset[QUAC_FEATURE_FILTER] = dict(source.feature_filter)
        return {'data': {**asset, **_layer_crs_field(layer)}}
    if source.kind == 'arcgis' and source.url:
        return {'data': {**arcgis_query_asset(source.url, source.where, layer.name), **_layer_crs_field(layer)}}
    if source.kind == 'wfs' and source.url and source.type_name:
        asset = wfs_get_feature_asset(source.url, source.type_name, source.type_name)
        if source.feature_filter:
            asset[QUAC_FEATURE_FILTER] = dict(source.feature_filter)
        return {'data': {**asset, **_layer_crs_field(layer)}}
    return {}


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


def _collect_value_relations_by_layer_id(
    layers: list[LayerEntry],
    siblings_by_id: dict[str, list[LayerEntry]],
) -> dict[str, dict[str, dict[str, Any]]]:
    """
    Each layer's Value Relation widgets as `quac:value_relation` writes them,
    keyed by layer id and then field name, naming the lookup by its
    Collection's id. A widget whose lookup is in no layer of the project writes
    nothing.
    """
    layers_by_id = {layer.id: layer for layer in layers}
    by_layer_id: dict[str, dict[str, dict[str, Any]]] = {}
    for layer in layers:
        relations: dict[str, dict[str, Any]] = {}
        for field, widget in layer.field_value_relations.items():
            lookup = find_value_relation_lookup(widget, layers, layers_by_id)
            if lookup is not None:
                relations[field] = _value_relation_to_json(sibling_collection_id(siblings_by_id, lookup.id), widget)
        if relations:
            by_layer_id[layer.id] = relations
    return by_layer_id


def _value_relation_to_json(collection_id: str, widget: FieldValueRelation) -> dict[str, Any]:
    """A Value Relation widget as `quac:value_relation` stores it: a member at its default is left off."""
    relation: dict[str, Any] = {'collection': collection_id, 'key': widget.key_field, 'value': widget.value_field}
    if widget.filter_expression:
        relation['filter'] = widget.filter_expression
    if widget.allow_null:
        relation['allow_null'] = True
    if widget.allow_multi:
        relation['allow_multi'] = True
    if widget.order_by != 'key':
        relation['order_by'] = widget.order_by
    if widget.order_by == 'field' and widget.order_field:
        relation['order_field'] = widget.order_field
    if widget.descending:
        relation['descending'] = True
    return relation


def _derive_table_columns(
    field_names: list[str],
    field_aliases: dict[str, str],
    field_value_maps: dict[str, list[FieldValueMapEntry]],
    field_edit_rules: dict[str, FieldEditRule],
    field_value_relations: dict[str, dict[str, Any]],
    field_icons: dict[str, str],
) -> list[dict[str, Any]]:
    """
    `table:columns` from the fields QGIS declares in `<fieldConfiguration>`,
    then any field only an alias names, each with its alias as `title`, its
    Value Map's list as `quac:values`, its Value Relation as
    `quac:value_relation`, `quac:color` where its widget is QGIS's Color
    widget, and the address of the icon its `quac_icon_<field>` variable names
    as `quac:icon`. With no data to read, no `type` is written.
    """
    ordered = list(dict.fromkeys([*field_names, *field_aliases]))
    columns: list[dict[str, Any]] = []
    for name in ordered:
        column: dict[str, Any] = {'name': name}
        alias = field_aliases.get(name)
        if alias:
            column['title'] = alias
        values = field_value_maps.get(name)
        if values:
            column['quac:values'] = [{'value': entry.value, 'label': entry.label} for entry in values]
        value_relation = field_value_relations.get(name)
        if value_relation:
            column['quac:value_relation'] = value_relation
        edit_rule = field_edit_rules.get(name)
        if edit_rule is not None and edit_rule.colour:
            column['quac:color'] = True
        icon = field_icons.get(name)
        if icon:
            column['quac:icon'] = icon
        columns.append(column)
    return columns
