"""Mirrors `packages/quac/src/parse/projectProperties.ts`.

Reads `<qgis><properties>`, which QGIS writes in two shapes. QGIS 3 names each
element after its key (`<Measurement><AreaUnits>`); QGIS 4 writes every key as
a `<properties name="...">` element.
"""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element

from .xml_text import direct_child, text_content


def property_child(parent: Element, name: str) -> Optional[Element]:
    """The child of `parent` holding `name`, in either shape."""
    named = direct_child(parent, name)
    if named is not None:
        return named
    for child in parent:
        if child.tag == 'properties' and child.get('name') == name:
            return child
    return None


def read_property_block(qgis_root: Element, name: str) -> Optional[Element]:
    """A top-level block of `<qgis><properties>`, such as `Measurement` or `Palette`."""
    properties = direct_child(qgis_root, 'properties')
    return property_child(properties, name) if properties is not None else None


def property_text(parent: Element, name: str) -> Optional[str]:
    """A key's text, trimmed; None where the key is absent or blank."""
    key = property_child(parent, name)
    if key is None:
        return None
    return text_content(key).strip() or None


def property_list(parent: Element, name: str) -> list[str]:
    """A string-list key's members, one per `<value>` element."""
    key = property_child(parent, name)
    if key is None:
        return []
    return [text_content(value) for value in key if value.tag == 'value']
