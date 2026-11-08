"""Mirrors `packages/quac/src/parse/geometrySiblings.ts`, as far as the server route needs."""

from __future__ import annotations

from ..js_compat import js_trim
from ..model.qgs_project import LayerEntry, LayerGroup, QgsProject
from .parse_data_source import GEOMETRY_TYPE_OPTION


def find_geometry_siblings(project: QgsProject) -> dict[str, list[LayerEntry]]:
    """
    The project's layers that QGIS split out of one file by shape: file layers
    whose sources are the same but for `|geometrytype=`, each naming a
    different shape. Keyed by each sibling's layer id, the value lists the
    whole set in the project's layer order, so its first entry is the layer
    the set takes its settings from. A set needs two siblings or more.
    """
    by_source: dict[str, list[LayerEntry]] = {}
    for layer in _order_layers_as_listed(project):
        source = layer.data_source
        if source.kind != 'file' or source.geometry_type_filter is None:
            continue
        by_source.setdefault(_source_without_geometry_type(source.raw), []).append(layer)

    siblings_by_id: dict[str, list[LayerEntry]] = {}
    for siblings in by_source.values():
        if len(siblings) < 2:
            continue
        if len(set(read_sibling_shapes(siblings))) != len(siblings):
            continue
        for layer in siblings:
            siblings_by_id[layer.id] = siblings
    return siblings_by_id


def _source_without_geometry_type(raw: str) -> str:
    """A file source with its first `geometrytype=` option taken out, the rest spelled as written."""
    parts = js_trim(raw).split('|')
    index = next((at for at, part in enumerate(parts) if GEOMETRY_TYPE_OPTION.match(js_trim(part))), -1)
    return '|'.join(part for at, part in enumerate(parts) if at != index)


def read_sibling_shapes(siblings: list[LayerEntry]) -> list[str]:
    """The shape each sibling keeps, in their order."""
    return [layer.data_source.geometry_type_filter for layer in siblings if layer.data_source.kind == 'file' and layer.data_source.geometry_type_filter]


def sibling_collection_id(siblings_by_id: dict[str, list[LayerEntry]], layer_id: str) -> str:
    """The id of the Collection a layer is in: the first sibling's, for a geometry sibling."""
    siblings = siblings_by_id.get(layer_id)
    return siblings[0].id if siblings else layer_id


def _order_layers_as_listed(project: QgsProject) -> list[LayerEntry]:
    """The layers in the layers panel's order, then those it does not list, in the order the file holds them."""
    by_id = {layer.id: layer for layer in project.layers}
    ordered: dict[int, LayerEntry] = {}

    def walk(group: LayerGroup) -> None:
        for child in group.children:
            if isinstance(child, LayerGroup):
                walk(child)
            else:
                layer = by_id.get(child.layer_id)
                if layer is not None:
                    ordered.setdefault(id(layer), layer)

    walk(project.layer_tree)
    for layer in project.layers:
        ordered.setdefault(id(layer), layer)
    return list(ordered.values())
