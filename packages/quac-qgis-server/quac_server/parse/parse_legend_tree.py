"""Mirrors `packages/quac/src/parse/parseLegendTree.ts`."""

from __future__ import annotations

from xml.etree.ElementTree import Element

from ..model.qgs_project import LayerGroup, LayerTreeLeaf, LayerTreeNode
from .xml_text import first_descendant


def parse_legend_tree(qgis_root: Element) -> LayerGroup:
    """
    Parses the `<layer-tree-group>` root into a tree of groups and layer
    leaves. The root group has no name; it is represented with name "".
    Returns an empty root group if parsing fails, so the rest of the project
    still loads.
    """
    empty = LayerGroup(name='', checked=True, children=[])
    try:
        root = first_descendant(qgis_root, 'layer-tree-group')
        if root is None:
            return empty
        return _read_group(root, is_root=True)
    except Exception:  # noqa: BLE001 - as the JavaScript, a malformed tree gives an empty one
        return empty


def _read_group(node: Element, is_root: bool) -> LayerGroup:
    name = '' if is_root else (node.get('name') or '')
    checked = _parse_checked(node.get('checked'))
    children: list[LayerTreeNode] = []
    for child in node:
        if child.tag == 'layer-tree-group':
            children.append(_read_group(child, is_root=False))
        elif child.tag == 'layer-tree-layer':
            layer_id = child.get('id') or ''
            if not layer_id:
                continue
            children.append(LayerTreeLeaf(layer_id=layer_id, name=child.get('name') or '', checked=_parse_checked(child.get('checked'))))
    mutually_exclusive = not is_root and node.get('mutually-exclusive') == '1'
    return LayerGroup(name=name, checked=checked, children=children, mutually_exclusive=mutually_exclusive)


def _parse_checked(attr: str | None) -> bool:
    if not attr:
        return True
    return attr in ('Qt::Checked', 'Qt::PartiallyChecked')
