"""Mirrors `packages/quac/src/parse/parseRelations.ts`."""

from __future__ import annotations

from xml.etree.ElementTree import Element  # nosec B405

from ..js_compat import js_trim
from ..model.qgs_project import QgsRelation, QgsRelationFieldPair
from .xml_text import direct_child


def parse_project_relations(qgis_root: Element) -> list[QgsRelation]:
    """
    The project's relations, `<qgis><relations><relation>`, where the
    `referencedLayer` is the parent and the `referencingLayer` the child, and
    several `<fieldRef>` children make one composite key. A relation missing
    its id, either layer id, or every field pair is skipped.
    """
    block = direct_child(qgis_root, 'relations')
    if block is None:
        return []
    relations: list[QgsRelation] = []
    for node in block:
        if node.tag != 'relation':
            continue
        relation_id = _attribute(node, 'id')
        parent_layer_id = _attribute(node, 'referencedLayer')
        child_layer_id = _attribute(node, 'referencingLayer')
        field_pairs = _parse_field_refs(node)
        if not relation_id or not parent_layer_id or not child_layer_id or not field_pairs:
            continue
        relations.append(QgsRelation(
            id=relation_id,
            name=_attribute(node, 'name'),
            parent_layer_id=parent_layer_id,
            child_layer_id=child_layer_id,
            field_pairs=field_pairs,
            strength=_attribute(node, 'strength') or None,
        ))
    return relations


def _parse_field_refs(relation: Element) -> list[QgsRelationFieldPair]:
    """The `<fieldRef>` children of one `<relation>`, in file order."""
    pairs: list[QgsRelationFieldPair] = []
    for node in relation:
        if node.tag != 'fieldRef':
            continue
        parent_field = _attribute(node, 'referencedField')
        child_field = _attribute(node, 'referencingField')
        if parent_field and child_field:
            pairs.append(QgsRelationFieldPair(parent_field=parent_field, child_field=child_field))
    return pairs


def _attribute(element: Element, name: str) -> str:
    return js_trim(element.get(name) or '')
