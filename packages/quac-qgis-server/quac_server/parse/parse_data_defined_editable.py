"""Mirrors `packages/quac/src/parse/parseDataDefinedEditable.ts`."""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element  # nosec B405

from ..js_compat import js_parse_int, js_trim
from .custom_properties import is_true_value
from .xml_text import direct_child


def parse_data_defined_editable(maplayer: Element) -> dict[str, str]:
    """
    Each field's active data-defined **Editable** property, the button beside a
    field's Editable box in QGIS's Attributes Form, as one QGIS expression per
    field name, from the layer's `<dataDefinedFieldProperties>`: one
    `<field name>` per field holding a property collection, whose
    `dataDefinedEditable` property is read.

    The property's `type` is `Qgis::PropertyType`: 1 static (`val`), 2 field
    (`field`), 3 expression (`expression`). A field-type property becomes the
    field named in double quotes, and a static one `true` or `false`, read as
    Qt reads a string as a Boolean. A property that is not active, of an
    unknown type, or with no field or expression is left out. Where two
    `<field>`s name a field, the first decides it.
    """
    result: dict[str, str] = {}
    block = direct_child(maplayer, 'dataDefinedFieldProperties')
    for field in block if block is not None else []:
        name = js_trim(field.get('name') or '')
        if field.tag != 'field' or not name or name in result:
            continue
        prop = _editable_property(field)
        expression = _read_property(prop) if prop is not None else None
        if expression:
            result[name] = expression
    return result


def _editable_property(field: Element) -> Optional[Element]:
    """The first `:scope > Option[type="Map"] > Option[name="properties"] > Option[name="dataDefinedEditable"]` of a `<field>`."""
    for collection in field:
        if collection.tag != 'Option' or collection.get('type') != 'Map':
            continue
        for properties in collection:
            if properties.tag != 'Option' or properties.get('name') != 'properties':
                continue
            for prop in properties:
                if prop.tag == 'Option' and prop.get('name') == 'dataDefinedEditable':
                    return prop
    return None


def _read_property(prop: Element) -> Optional[str]:
    values: dict[str, str] = {}
    for option in prop:
        key = option.get('name')
        if key and option.tag == 'Option':
            values[key] = option.get('value') or ''
    active = js_trim(values['active']).lower() if 'active' in values else None
    if active not in ('true', '1'):
        return None
    kind = js_parse_int(values.get('type', ''))
    if kind == 1:
        return 'true' if is_true_value(js_trim(values.get('val', ''))) else 'false'
    if kind == 2:
        field = js_trim(values['field']) if 'field' in values else ''
        return '"' + field.replace('"', '""') + '"' if field else None
    if kind == 3:
        return (js_trim(values['expression']) if 'expression' in values else '') or None
    return None
