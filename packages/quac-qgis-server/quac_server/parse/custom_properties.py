"""Mirrors `packages/quac/src/parse/customProperties.ts`.

Reads a `<maplayer>`'s `<customproperties>`, in either form QGIS reads. Since
QGIS 3.20 the block holds one `<Option type="Map">` with an `<Option name>`
per key: a `value` attribute for a single value, or a child `<Option>` per
entry of a list. Before that it held a `<property key>` per key, with a
`value` attribute or a child `<value>` per entry. Keys are flat, slashes and
all (`QFieldSync/action`).
"""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element

from .xml_text import text_content


def read_custom_property_list(properties: Element, key: str) -> list[str]:
    """A key's values, in either form: one item for a single value, none where the key is absent."""
    option_map = next((child for child in properties if child.tag == 'Option'), None)
    if option_map is not None:
        entry = next((option for option in option_map if option.tag == 'Option' and option.get('name') == key), None)
        if entry is None:
            return []
        single = entry.get('value')
        if single is not None:
            return [single]
        return [item.get('value') or '' for item in entry if item.tag == 'Option']
    legacy = next((prop for prop in properties if prop.tag == 'property' and prop.get('key') == key), None)
    if legacy is None:
        return []
    single = legacy.get('value')
    if single is not None:
        return [single]
    return [text_content(item) for item in legacy if item.tag == 'value']


def read_custom_property(properties: Element, key: str) -> Optional[str]:
    """A single-valued key's value, or None where the key is absent."""
    values = read_custom_property_list(properties, key)
    return values[0] if values else None


def is_true_value(value: Optional[str]) -> bool:
    """
    Whether a saved value reads as true, as Qt's `QVariant::toBool` reads text:
    anything but blank, `0` and `false`, ignoring case. None, an absent key, is false.
    """
    if value is None:
        return False
    text = value.lower()
    return text not in ('', '0', 'false')
