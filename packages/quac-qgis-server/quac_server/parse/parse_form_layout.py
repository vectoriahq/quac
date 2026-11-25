"""Mirrors `packages/quac/src/parse/parseFormLayout.ts`."""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element  # nosec B405

from ..js_compat import is_finite, js_parse_int, js_trim
from ..model.qgs_project import FormLayoutField, LayerFormLayout
from .parse_data_defined_editable import parse_data_defined_editable
from .xml_text import direct_child, text_content


def parse_form_layout(maplayer: Element) -> Optional[LayerFormLayout]:
    """
    A layer's Drag and Drop Designer form: the fields its `<attributeEditorForm>`
    tree places, in the tree's order, each with the visibility expressions of
    the containers around it.

    QGIS uses the tree only where `<editorlayout>` is `tablayout`, so any other
    layout reads as none, and so does a `tablayout` whose tree is empty, which
    QGIS fills with every field. Only `<attributeEditorContainer>` (tab, group
    box and row alike) and `<attributeEditorField>` are read. A container's
    expression counts only where its `visibilityExpressionEnabled` is a number
    other than zero and its `visibilityExpression` is not blank; it is kept as
    written, readable or not. A field placed twice keeps its first place.

    A placed field also carries its active data-defined Editable property as
    `editable_when` (`parse_data_defined_editable`). QGIS registers it only for
    a field in this form, so a field the tree does not place has none.
    """
    layout = direct_child(maplayer, 'editorlayout')
    if layout is None or js_trim(text_content(layout)) != 'tablayout':
        return None
    form = direct_child(maplayer, 'attributeEditorForm')
    if form is None or len(form) == 0:
        return None

    fields: list[FormLayoutField] = []
    _collect_fields(form, [], fields, set())
    editable = parse_data_defined_editable(maplayer)
    for field in fields:
        field.editable_when = editable.get(field.name)
    return LayerFormLayout(fields=fields)


def _collect_fields(parent: Element, visible_when: list[str], fields: list[FormLayoutField], placed: set[str]) -> None:
    for child in parent:
        if child.tag == 'attributeEditorField':
            name = js_trim(child.get('name') or '')
            if not name or name in placed:
                continue
            placed.add(name)
            fields.append(FormLayoutField(name=name, visible_when=visible_when))
        elif child.tag == 'attributeEditorContainer':
            expression = js_trim(child.get('visibilityExpression') or '')
            enabled = js_parse_int(child.get('visibilityExpressionEnabled') or '')
            inside = [*visible_when, expression] if expression and is_finite(enabled) and enabled != 0 else visible_when
            _collect_fields(child, inside, fields, placed)
