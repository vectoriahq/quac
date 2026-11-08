"""Mirrors `packages/quac/src/generate/serverLayerTree.ts`."""

from __future__ import annotations

from typing import Any

from ..model.qgs_project import LayerEntry, LayerGroup, QgsProject
from .stac_catalogue import qgis_server_names_of


def server_layer_tree(project: QgsProject) -> dict[str, Any]:
    """
    The layer tree QGIS Server reads from a project: each layer's WMS name and
    WFS type name, and the fields the project hides from each service, as the
    JSON the JavaScript's `serverLayerTree` gives.

    A layer inside a group the project leaves out of WMS has no WMS name. A
    tree entry whose layer the project does not hold is left out.
    """
    layers_by_id = {layer.id: layer for layer in project.layers}
    restricted = set(project.wms_publishing.restricted_layers if project.wms_publishing else [])

    def read_group(group: LayerGroup, wms_published: bool) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        for node in group.children:
            if isinstance(node, LayerGroup):
                published = wms_published and node.name not in restricted
                nodes.append({'kind': 'group', 'name': node.name, 'wmsPublished': published, 'children': read_group(node, published)})
                continue
            layer = layers_by_id.get(node.layer_id)
            if layer is not None:
                nodes.append(_server_layer(layer, wms_published, project))
        return nodes

    return {
        'useLayerIds': project.wms_publishing.use_layer_ids if project.wms_publishing else False,
        'children': read_group(project.layer_tree, True),
    }


def _server_layer(layer: LayerEntry, in_published_group: bool, project: QgsProject) -> dict[str, Any]:
    names = qgis_server_names_of(layer, project.wms_publishing, project.wfs_transaction_layers)
    hidden = layer.server_hidden_fields
    return {
        'kind': 'layer',
        'id': layer.id,
        'name': layer.name,
        'wmsName': names.wms_name if in_published_group else None,
        'wfsTypeName': names.wfs_type_name,
        'hiddenFields': {'wms': list(hidden.wms) if hidden else [], 'wfs': list(hidden.wfs) if hidden else []},
    }


def wms_published_layer_ids(tree: dict[str, Any]) -> set[str]:
    """The ids of the layers the project publishes over WMS."""
    ids: set[str] = set()

    def walk(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            if node['kind'] == 'group':
                walk(node['children'])
            elif node['wmsName'] is not None:
                ids.add(node['id'])

    walk(tree['children'])
    return ids
