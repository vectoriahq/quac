"""Mirrors `packages/quac/src/parse/parseMergin.ts`."""

from __future__ import annotations

import json
from typing import Any, Optional
from xml.etree.ElementTree import Element  # nosec B405

from ..js_compat import js_trim
from ..model.qgs_project import PresetFilter
from .custom_properties import is_true_value
from .project_properties import property_child, property_text, read_property_block

# The Mergin Maps filter types the filter row has a control for; `Text`, a "contains" search, is not one.
READ_FILTER_TYPES = ('Number', 'Date', 'Checkbox', 'Single select', 'Multi select')


def parse_mergin_filters(qgis_root: Element, text_filters: Optional[list[PresetFilter]] = None) -> list[PresetFilter]:
    """
    The filters the Mergin Maps plugin sets up on its **Mergin Maps** tab of
    Project Properties: the project entries `Mergin/Filtering/Enabled` and
    `Mergin/Filtering/Filters`, the second a JSON list of filters, each with
    `filter_name`, `layer_id`, `field_name`, `filter_type` and
    `sql_expression`. They are read only while `Enabled` is true, and a filter
    lacking `layer_id`, `field_name`, `sql_expression` or `filter_type` is
    skipped. A `Text` filter is left out, and added to `text_filters`. Empty
    where the project sets none, or the list does not read as JSON.
    """
    block = read_property_block(qgis_root, 'Mergin')
    filtering = property_child(block, 'Filtering') if block is not None else None
    if filtering is None or not is_true_value(property_text(filtering, 'Enabled')):
        return []
    try:
        entries = _json_parse(property_text(filtering, 'Filters') or '[]')
    except ValueError:
        return []
    if not isinstance(entries, list):
        return []

    filters: list[PresetFilter] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        layer_id = _text(entry, 'layer_id')
        field = _text(entry, 'field_name')
        filter_type = _text(entry, 'filter_type')
        if not layer_id or not field or not _text(entry, 'sql_expression') or not filter_type:
            continue
        name = _text(entry, 'filter_name')
        preset = PresetFilter(layer_id=layer_id, field=field, name=js_trim(name) if name is not None else None)
        if filter_type == 'Text' and text_filters is not None:
            text_filters.append(preset)
        if filter_type in READ_FILTER_TYPES:
            filters.append(preset)
    return filters


def _text(entry: dict[str, Any], key: str) -> Optional[str]:
    value = entry.get(key)
    return value if isinstance(value, str) and js_trim(value) != '' else None


def _refuse_constant(name: str) -> Any:
    raise ValueError(f'{name} is not JSON')


def _json_parse(text: str) -> Any:
    """`JSON.parse`: Python's reader, less the `NaN` and `Infinity` it accepts and JSON does not."""
    return json.loads(text, parse_constant=_refuse_constant)
