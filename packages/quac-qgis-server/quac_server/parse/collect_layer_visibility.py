"""Mirrors `packages/quac/src/parse/collectLayerVisibility.ts`."""

from __future__ import annotations

from ..model.qgs_project import LayerGroup, LayerTreeNode


def collect_layer_visibility(group: LayerGroup) -> dict[str, bool]:
    """
    Walks the QGIS layer tree and records each layer leaf's effective `checked`
    state, intersected with the checked state of every group above it. A layer
    id absent from the result was not found in the tree; `parse_qgs_xml` reads
    such a layer as visible.
    """
    out: dict[str, bool] = {}

    def walk(node: LayerTreeNode, parent_checked: bool) -> None:
        if not isinstance(node, LayerGroup):
            out[node.layer_id] = parent_checked and node.checked
            return
        for child in node.children:
            walk(child, parent_checked and node.checked)

    walk(group, True)
    return out
