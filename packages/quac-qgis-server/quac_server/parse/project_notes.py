"""Mirrors `packages/quac/src/parse/projectNotes.ts`, as far as the catalogue needs: the rules that decide whether a setting naming another layer reaches it.

`crossLayerNotes`, the notes on the settings that do not reach it, is not
ported: the plugin writes no notes.
"""

from __future__ import annotations

from typing import Optional

from ..model.qgs_project import FieldValueRelation, LayerEntry, PresetFilter, QgsRelation


def find_value_relation_lookup(widget: FieldValueRelation, layers: list[LayerEntry], layers_by_id: dict[str, LayerEntry]) -> Optional[LayerEntry]:
    """
    The layer a Value Relation widget reads its choices from: the layer whose
    id the widget names, and where none has it the first layer with the name it
    names, as QGIS finds it (`QgsVectorLayerRef::resolveByIdOrNameOnly`). None
    where the project holds neither.
    """
    found = layers_by_id.get(widget.layer_id)
    if found is not None:
        return found
    return next((candidate for candidate in layers if candidate.name == widget.layer_name), None)


def is_relation_in_project(relation: QgsRelation, layers_by_id: dict[str, LayerEntry]) -> bool:
    """Whether the project holds both of a relation's layers."""
    return relation.parent_layer_id in layers_by_id and relation.child_layer_id in layers_by_id


def is_filter_in_project(preset: PresetFilter, layers_by_id: dict[str, LayerEntry]) -> bool:
    """Whether the project holds a filter's layer and that layer has its field."""
    layer = layers_by_id.get(preset.layer_id)
    return layer is not None and preset.field in layer.field_names
