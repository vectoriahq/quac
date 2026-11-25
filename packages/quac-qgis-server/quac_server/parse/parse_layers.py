"""Mirrors `packages/quac/src/parse/parseLayers.ts`, as far as the plugin's catalogues read a layer.

It reads a layer's id, names, geometry, WGS84 extent, coordinate system, data source, display
field, identifiable, read-only and Private flags, opacity, scale range, field names, aliases and
comments, Value Map lists, Value Relations, Attachment widgets and the rest of each field's form
settings (`FieldEditRule`), its Drag and Drop Designer form (`parse_form_layout.py`), abstract,
licence and temporal extent, styles (`parse_style.py`), legend placeholder image, the icons,
field controls and added message its variables set, QFieldSync locks, and the fields it hides
from QGIS Server. It writes none of the notes the JavaScript gives on what a Collection does
not carry, and reads none of the layer's other metadata.
"""

from __future__ import annotations

import re
from typing import Any, Iterator, Optional
from xml.etree.ElementTree import Element  # nosec B405

import base64
import binascii

from ..js_compat import JS_SPACE, is_finite, js_number, js_trim, whole
from ..model.field_icon_address import resolve_field_icon_address
from ..model.qgs_project import (
    BoundingBox,
    FieldAttachment,
    FieldCheckbox,
    FieldConstraintExpression,
    FieldDefaultExpression,
    FieldDefaultValue,
    FieldEditRule,
    FieldFixedValue,
    FieldValueMapEntry,
    FieldValueRelation,
    LayerEntry,
    LayerResourceMetadata,
    LayerScaleRange,
    ServerHiddenFields,
)
from .custom_properties import read_custom_property_list
from .parse_data_source import parse_data_source
from .parse_form_layout import parse_form_layout
from .parse_qfield_sync import parse_qfield_sync_locks
from .parse_style import parse_layer_styles
from .qgis_expression import read_qgis_expression, unescape_string_literal
from .xml_text import children_of_kind, direct_child, direct_child_text, first_descendant, text_content


def parse_project_layers(qgis_root: Element) -> list[LayerEntry]:
    """Parses the `<projectlayers>` block into a list of layers, skipping a `<maplayer>` with no id, or one that fails to read."""
    project_layers = first_descendant(qgis_root, 'projectlayers')
    if project_layers is None:
        return []
    layers: list[LayerEntry] = []
    for node in project_layers:
        if node.tag != 'maplayer':
            continue
        try:
            layer = _parse_map_layer(node)
        except Exception:  # noqa: BLE001 - as the JavaScript, one bad layer does not take down the project
            layer = None
        if layer is not None:
            layers.append(layer)
    return layers


def _parse_map_layer(maplayer: Element) -> Optional[LayerEntry]:
    id_element = first_descendant(maplayer, 'id')
    layer_id = js_trim(text_content(id_element)) if id_element is not None else ''
    name_element = first_descendant(maplayer, 'layername')
    name = js_trim(text_content(name_element)) if name_element is not None else ''
    if not layer_id:
        return None
    datasource_text = direct_child_text(maplayer, 'datasource') or ''
    provider_hint = direct_child_text(maplayer, 'provider')
    styles, active_style_index = parse_layer_styles(maplayer)
    return LayerEntry(
        id=layer_id,
        name=name,
        short_name=direct_child_text(maplayer, 'shortname') or None,
        server_hidden_fields=_server_hidden_fields_of(maplayer),
        type=maplayer.get('type') or '',
        geometry_type=maplayer.get('geometry') or None,
        wkb_type=maplayer.get('wkbType') or None,
        wgs84_extent=_parse_bounding_box(maplayer, 'wgs84extent'),
        crs=_parse_crs(maplayer),
        data_source=parse_data_source(datasource_text, provider_hint),
        display_field=_parse_display_field(maplayer),
        queryable=_parse_queryable(maplayer),
        opacity=_parse_opacity(maplayer),
        editable=maplayer.get('readOnly') != '1',
        field_names=_parse_field_names(maplayer),
        field_aliases=_parse_field_aliases(maplayer),
        field_value_maps=_parse_field_value_maps(maplayer),
        styles=styles,
        active_style_index=active_style_index,
        resource_metadata=_parse_layer_resource_metadata(maplayer),
        is_private=_parse_private(maplayer),
        legend_image=_parse_legend_image(maplayer),
        field_value_relations=_parse_field_value_relations(maplayer),
        field_attachments=_parse_field_attachments(maplayer),
        field_edit_rules=_parse_field_edit_rules(maplayer),
        field_comments=_parse_field_comments(maplayer),
        icon=_parse_layer_icon(maplayer),
        added_message=_parse_added_message(maplayer),
        field_icons=_parse_field_icons(maplayer),
        field_controls=_parse_field_controls(maplayer),
        form_layout=parse_form_layout(maplayer),
        scale_range=_parse_scale_range(maplayer),
        locks=parse_qfield_sync_locks(maplayer),
    )


def _parse_crs(maplayer: Element) -> Optional[str]:
    """The layer's coordinate system, the first `<authid>` inside a `<spatialrefsys>` inside an `<srs>`, as `querySelector('srs spatialrefsys authid')` finds it."""
    for srs in maplayer.iter('srs'):
        for spatial_ref_sys in srs.iter('spatialrefsys'):
            for authid in spatial_ref_sys.iter('authid'):
                return js_trim(text_content(authid)) or None
    return None


def _server_hidden_fields_of(maplayer: Element) -> Optional[ServerHiddenFields]:
    """
    The fields QGIS Server hides from WMS and from WFS: `configurationFlags` on
    each `<fieldConfiguration><field>`, holding `HideFromWms` and `HideFromWfs`
    joined by `|`, and the lists `<excludeAttributesWMS>` and
    `<excludeAttributesWFS>` of `<attribute>` names that QGIS 3.14 and older
    saved. Only the layer's own blocks are read, never a saved style's.
    """
    wms: dict[str, None] = {}
    wfs: dict[str, None] = {}
    field_config = direct_child(maplayer, 'fieldConfiguration')
    if field_config is not None:
        for field in field_config:
            if field.tag != 'field':
                continue
            name = field.get('name')
            if not name:
                continue
            flags = [flag.strip() for flag in (field.get('configurationFlags') or '').split('|')]
            if 'HideFromWms' in flags:
                wms[name] = None
            if 'HideFromWfs' in flags:
                wfs[name] = None
    for element, into in (('excludeAttributesWMS', wms), ('excludeAttributesWFS', wfs)):
        block = direct_child(maplayer, element)
        if block is None:
            continue
        for attribute in block:
            if attribute.tag != 'attribute':
                continue
            name = js_trim(text_content(attribute))
            if name:
                into[name] = None
    if not wms and not wfs:
        return None
    return ServerHiddenFields(wms=list(wms), wfs=list(wfs))


def _parse_layer_resource_metadata(maplayer: Element) -> LayerResourceMetadata:
    """A layer's `<resourceMetadata>`: its abstract, its first licence that is not blank, and its temporal extent."""
    block = direct_child(maplayer, 'resourceMetadata')
    if block is None:
        return LayerResourceMetadata()
    abstract = direct_child_text(block, 'abstract')
    license_text = next((text for text in (js_trim(text_content(node)) for node in block if node.tag == 'license') if text), None)
    return LayerResourceMetadata(abstract=abstract or None, license=license_text, temporal_interval=_parse_resource_metadata_temporal(block))


def _parse_resource_metadata_temporal(block: Element) -> Optional[list[Optional[str]]]:
    """`<resourceMetadata><extent><temporal>`'s range: a `<period><start>`/`<end>`, or an `<instant>` read as both ends. None where it declares neither."""
    temporal = next((node for extent in block if extent.tag == 'extent' for node in extent if node.tag == 'temporal'), None)
    if temporal is None:
        return None
    period = direct_child(temporal, 'period')
    if period is not None:
        start = direct_child_text(period, 'start')
        end = direct_child_text(period, 'end')
        if not start and not end:
            return None
        return [start or None, end or None]
    instant = direct_child_text(temporal, 'instant')
    return [instant, instant] if instant else None


def _parse_bounding_box(maplayer: Element, tag: str) -> Optional[BoundingBox]:
    node = direct_child(maplayer, tag)
    if node is None:
        return None
    values = [_read_number(node, side) for side in ('xmin', 'ymin', 'xmax', 'ymax')]
    if any(value is None for value in values):
        return None
    xmin, ymin, xmax, ymax = values
    return BoundingBox(xmin=xmin, ymin=ymin, xmax=xmax, ymax=ymax)  # type: ignore[arg-type]


def _parse_field_names(maplayer: Element) -> list[str]:
    """Every `<fieldConfiguration><field>` name anywhere inside the layer, once each, in the order first seen."""
    ordered: dict[str, None] = {}
    for node in children_of_kind(maplayer, 'fieldConfiguration', 'field'):
        name = node.get('name')
        if name:
            ordered.setdefault(name, None)
    return list(ordered)


def _parse_field_aliases(maplayer: Element) -> dict[str, str]:
    """Every `<aliases><alias>` anywhere inside the layer, the last that is not blank winning for each field."""
    out: dict[str, str] = {}
    for node in children_of_kind(maplayer, 'aliases', 'alias'):
        field = node.get('field')
        name = node.get('name')
        if field and name:
            out[field] = name
    return out


# `QgsValueMapFieldFormatter::NULL_VALUE`: the stored value of a value map's blank entry.
_VALUE_MAP_NULL_CODE = '{2839923C-8B7D-419E-B84B-CA2FE9B80EC7}'


def _parse_field_value_maps(maplayer: Element) -> dict[str, list[FieldValueMapEntry]]:
    """
    Each field's Value Map widget as its list, keyed by field name, from the
    layer's own `<fieldConfiguration><field><editWidget type="ValueMap">`. The
    list is the widget's `map`: in the form QGIS saves now, a `List` of
    one-entry `Map`s, and in older projects one flat `Map`. Each entry's `name`
    is the label and its `value` the stored value, QGIS's blank code read as
    `''`. An entry with no label is left out, and so is a field whose widget
    leaves no entry. Where `<field>`s share a name, the first that gives a
    list decides it.
    """
    result: dict[str, list[FieldValueMapEntry]] = {}
    field_config = direct_child(maplayer, 'fieldConfiguration')
    if field_config is None:
        return result
    for node in field_config:
        name = node.get('name') if node.tag == 'field' else None
        if not name or name in result:
            continue
        edit_widget = direct_child(node, 'editWidget')
        if edit_widget is None or edit_widget.get('type') != 'ValueMap':
            continue
        entries = [
            FieldValueMapEntry(value='' if value == _VALUE_MAP_NULL_CODE else value, label=label)
            for label, value in ((entry.get('name'), entry.get('value')) for entry in _value_map_options(edit_widget))
            if label and value is not None
        ]
        if entries:
            result[name] = entries
    return result


def _value_map_options(edit_widget: Element) -> list[Element]:
    """The `<Option>` entries of a Value Map widget's `map`, the `List` form found first and the flat `Map` form otherwise."""
    maps = [
        option
        for config in edit_widget if config.tag == 'config'
        for option in config if option.tag == 'Option' and option.get('type') == 'Map'
    ]
    for wrapper in maps:
        for map_list in wrapper:
            if map_list.tag == 'Option' and map_list.get('type') == 'List' and map_list.get('name') == 'map':
                return [entry for item in map_list if item.tag == 'Option' and item.get('type') == 'Map' for entry in item if entry.tag == 'Option']
    for wrapper in maps:
        for flat_map in wrapper:
            if flat_map.tag == 'Option' and flat_map.get('type') == 'Map' and flat_map.get('name') == 'map':
                return [entry for entry in flat_map if entry.tag == 'Option']
    return []


def _parse_field_value_relations(maplayer: Element) -> dict[str, FieldValueRelation]:
    """
    Each field's Value Relation widget, keyed by field name, from the layer's
    own `<fieldConfiguration><field><editWidget type="ValueRelation">`, whose
    config is a flat map of `<Option name value>`. The lookup is named by
    `Layer`, its id, and `LayerName`; a widget naming neither, or with no
    `Key` or no `Value`, is left out. The order is `OrderByValue` first, then
    `OrderByField` where it names a field, and the key otherwise. Where
    `<field>`s share a name, the first that gives a widget decides it.
    """
    result: dict[str, FieldValueRelation] = {}
    field_config = direct_child(maplayer, 'fieldConfiguration')
    if field_config is None:
        return result
    for node in field_config:
        name = node.get('name') if node.tag == 'field' else None
        if not name or name in result:
            continue
        edit_widget = direct_child(node, 'editWidget')
        if edit_widget is None or edit_widget.get('type') != 'ValueRelation':
            continue
        options = _read_option_map(edit_widget)
        layer_id = _read_trimmed_option(options, 'Layer') or ''
        layer_name = _read_trimmed_option(options, 'LayerName') or ''
        key_field = _read_trimmed_option(options, 'Key')
        value_field = _read_trimmed_option(options, 'Value')
        if (not layer_id and not layer_name) or not key_field or not value_field:
            continue
        by_value = _read_flag(options, 'OrderByValue')
        order_field = _read_trimmed_option(options, 'OrderByFieldName') if _read_flag(options, 'OrderByField') else None
        result[name] = FieldValueRelation(
            layer_id=layer_id,
            layer_name=layer_name,
            key_field=key_field,
            value_field=value_field,
            filter_expression=_read_trimmed_option(options, 'FilterExpression') or '',
            allow_null=_read_flag(options, 'AllowNull'),
            allow_multi=_read_flag(options, 'AllowMulti'),
            order_by='value' if by_value else 'field' if order_field else 'key',
            order_field=None if by_value else order_field,
            descending=_read_flag(options, 'OrderByDescending'),
        )
    return result


def _read_option_map(edit_widget: Element) -> dict[str, str]:
    """A flat widget config as key and value: the members of the widget's `<Option type="Map">` that have a name and a `value`, a later one of a name winning."""
    options: dict[str, str] = {}
    for config in edit_widget:
        if config.tag != 'config':
            continue
        for wrapper in config:
            if wrapper.tag != 'Option' or wrapper.get('type') != 'Map':
                continue
            for option in wrapper:
                key = option.get('name') if option.tag == 'Option' else None
                value = option.get('value')
                if key and value is not None:
                    options[key] = value
    return options


def _read_trimmed_option(options: dict[str, str], key: str) -> Optional[str]:
    value = js_trim(options.get(key) or '')
    return value or None


def _read_flag(options: dict[str, str], key: str, fallback: bool = False) -> bool:
    """A Boolean widget option: `true` or `1` is on, any other value off, and an absent key `fallback`."""
    value = options.get(key)
    return fallback if value is None else value in ('true', '1')


def _layer_fields(maplayer: Element) -> Iterator[tuple[str, Element]]:
    """
    The layer's own `<fieldConfiguration>` fields that have a name, as
    `(name, <field>)`, in document order. A saved alternate style embeds its
    own `<fieldConfiguration>`, which can disagree with the layer's own, so
    only the direct child of `<maplayer>` is read.
    """
    field_config = direct_child(maplayer, 'fieldConfiguration')
    for field in field_config if field_config is not None else []:
        name = field.get('name') if field.tag == 'field' else None
        if name:
            yield name, field


def _configuration_flags_of(field: Element) -> list[str]:
    """A `<fieldConfiguration><field>`'s `configurationFlags`, the Fields tab's Configuration column, as `Qgis::FieldConfigurationFlag` names."""
    return [js_trim(flag) for flag in (field.get('configurationFlags') or '').split('|')]


def _children(parent: Optional[Element], tag: str) -> list[Element]:
    """The children of `parent` named `tag`, as `:scope > tag` selects them; none where there is no parent."""
    return [child for child in parent if child.tag == tag] if parent is not None else []


def _js_index(values: list[Any], text: Optional[str]) -> Any:
    """`values[Number(text)]`, None where JavaScript's index finds no entry, an absent option reading as `Number(undefined)`, NaN."""
    if text is None:
        return None
    number = js_number(text)
    return values[number] if isinstance(number, int) and 0 <= number < len(values) else None


# QGIS's `DocumentViewerContent`, by its own order from zero (`src/gui/qgsexternalresourcewidget.h`). `NoContent` is index 0 and reads as None.
_DOCUMENT_VIEWERS: list[Optional[str]] = [None, 'image', 'web', 'audio', 'video']

# QGIS's `QgsFileWidget::RelativeStorage`, by its own order from zero (`src/gui/qgsfilewidget.h`).
_RELATIVE_STORAGE = ['absolute', 'project', 'default-root']

# The `QgsFileWidget::StorageMode` values that pick one file, `GetFile` and `SaveFile`.
_SINGLE_FILE_STORAGE_MODES = (0, 3)


def _parse_field_attachments(maplayer: Element) -> dict[str, FieldAttachment]:
    """
    Each field's Attachment widget, which QGIS registers as `ExternalResource`,
    keyed by field name: its `DocumentViewer`, `FileWidgetFilter`,
    `DefaultRoot`, written as it is, and `RelativeStorage`. A widget whose
    `StorageMode` picks a directory or several files is not an attachment.
    Where `<field>`s share a name, the first that gives a widget decides it.
    """
    result: dict[str, FieldAttachment] = {}
    for name, field in _layer_fields(maplayer):
        if name in result:
            continue
        edit_widget = direct_child(field, 'editWidget')
        if edit_widget is None or edit_widget.get('type') != 'ExternalResource':
            continue
        options = _read_option_map(edit_widget)
        storage_mode = options.get('StorageMode')
        if storage_mode is not None and js_number(storage_mode) not in _SINGLE_FILE_STORAGE_MODES:
            continue
        relative_storage = _js_index(_RELATIVE_STORAGE, options.get('RelativeStorage'))
        result[name] = FieldAttachment(
            viewer=_js_index(_DOCUMENT_VIEWERS, options.get('DocumentViewer')),
            filter=_read_trimmed_option(options, 'FileWidgetFilter'),
            default_root=_read_trimmed_option(options, 'DefaultRoot'),
            relative_storage=relative_storage or 'absolute',
        )
    return result


# The default-value expressions read as `now`, compared with spaces removed and in lower case. `$now` is QGIS's older spelling of `now()`.
_NOW_EXPRESSIONS = ('now()', '$now', 'to_date(now())', 'to_datetime(now())')
_SPACES = re.compile(f'[{JS_SPACE}]+')


def _parse_field_edit_rules(maplayer: Element) -> dict[str, FieldEditRule]:
    """
    The Attributes Form settings the catalogue records for every field, keyed
    by field name, from the layer's own `<fieldConfiguration>`, `<defaults>`,
    `<constraints>`, `<constraintExpressions>`, `<editable>`,
    `<reuseLastValue>`, `<reuseLastValuePolicy>`, `<duplicatePolicies>` and
    `<labelOnTop>`. A default is kept as a `default_value` where
    `_parse_default_expression` reads it, as a `default_expression` where only
    `read_qgis_expression` does, and otherwise left out; a constraint
    expression is kept only where `read_qgis_expression` reads it. A field the
    `<editable>` block does not list is editable. A field with none of these
    settings is absent.
    """
    result: dict[str, FieldEditRule] = {}

    def rule_for(name: str) -> FieldEditRule:
        return result.setdefault(name, FieldEditRule())

    fields_with_expression: set[str] = set()
    for node in _children(direct_child(maplayer, 'defaults'), 'default'):
        name = node.get('field')
        expression = node.get('expression') or ''
        if not name or not js_trim(expression):
            continue
        fields_with_expression.add(name)
        on_update = node.get('applyOnUpdate') == '1'
        default_value = _parse_default_expression(expression, on_update)
        if default_value:
            rule_for(name).default_value = default_value
        elif read_qgis_expression(expression, geometry=True, aggregates=True, lookups=True, variables=True, coordinates=True):
            rule_for(name).default_expression = FieldDefaultExpression(expression=js_trim(expression), on_update=on_update)

    # The UUID Generator widget fills a null field with an identifier in braces; a default expression fills the field first.
    seen_widgets: set[str] = set()
    allow_null_off: set[str] = set()
    for name, field in _layer_fields(maplayer):
        if name in seen_widgets:
            continue
        seen_widgets.add(name)
        edit_widget = direct_child(field, 'editWidget')
        widget_type = edit_widget.get('type') if edit_widget is not None else None
        if widget_type == 'Hidden':
            rule_for(name).hidden = True
        # The Fields tab's Not searchable, which QGIS's search of the active layer's features skips.
        if 'NotSearchable' in _configuration_flags_of(field):
            rule_for(name).not_searchable = True
        if widget_type == 'Color':
            rule_for(name).colour = True
        if widget_type in ('CheckBox', 'Range', 'DateTime'):
            _read_widget_options(edit_widget, name, widget_type, rule_for, allow_null_off)
        if widget_type == 'UuidGenerator':
            rule = rule_for(name)
            rule.read_only = True
            if name not in fields_with_expression:
                rule.default_value = FieldDefaultValue(kind='uuid', format='with_braces', on_update=False)

    # `constraints` is a bit mask with Not null as 1, Unique as 2 and Expression as 4; a missing strength reads as 1, hard, 2 is soft and 0 not set.
    constraint_expressions: dict[str, tuple[str, str]] = {}
    for node in _children(direct_child(maplayer, 'constraintExpressions'), 'constraint'):
        name = node.get('field')
        expression = js_trim(node.get('exp') or '')
        if name and expression:
            constraint_expressions[name] = (expression, js_trim(node.get('desc') or ''))
    for node in _children(direct_child(maplayer, 'constraints'), 'constraint'):
        name = node.get('field')
        constraints = js_number(node.get('constraints') if node.get('constraints') is not None else '0')
        if not name or not _is_integer(constraints):
            continue
        mask = int(constraints)
        if mask & 1:
            not_null = _constraint_strength(node.get('notnull_strength'))
            if not_null:
                rule_for(name).not_null = not_null
        if mask & 2:
            unique = _constraint_strength(node.get('unique_strength'))
            if unique:
                rule_for(name).unique = unique
        written = constraint_expressions.get(name)
        strength = _constraint_strength(node.get('exp_strength'))
        if mask & 4 and written and strength and read_qgis_expression(written[0], geometry=True):
            rule_for(name).constraint_expression = FieldConstraintExpression(expression=written[0], strength=strength, description=written[1] or None)

    # A Range or a Date/Time with Allow NULL off is a required field, which also raises a Not null that only warns.
    for name in allow_null_off:
        rule_for(name).not_null = 'enforced'

    # A field absent from `<duplicatePolicies>`, or holding a key QGIS does not know, reads as `Duplicate`.
    for node in _children(direct_child(maplayer, 'duplicatePolicies'), 'policy'):
        name = node.get('field')
        policy = node.get('policy')
        if name and policy in ('DefaultValue', 'UnsetField'):
            rule_for(name).duplicate_policy = 'default' if policy == 'DefaultValue' else 'unset'

    for node in _children(direct_child(maplayer, 'editable'), 'field'):
        name = node.get('name')
        if name and node.get('editable') == '0':
            rule_for(name).read_only = True

    for name, reuse in _parse_reuse_last_value(maplayer).items():
        if reuse:
            rule_for(name).reuse_last_value = True

    # QGIS reads the flag as a number, any but zero setting it.
    for node in _children(direct_child(maplayer, 'labelOnTop'), 'field'):
        name = node.get('name')
        flag = js_number(node.get('labelOnTop'))
        if name and _is_integer(flag) and flag != 0:
            rule_for(name).label_on_top = True

    return result


def _is_integer(value: float) -> bool:
    """`Number.isInteger`."""
    return is_finite(value) and value == int(value)


def _read_widget_options(
    edit_widget: Optional[Element],
    name: str,
    widget_type: str,
    rule_for: Any,
    allow_null_off: set[str],
) -> None:
    """
    A Checkbox, Range or Date/Time widget's config, read into the field's rule.
    An untouched widget writes an empty `<Option/>`, which reads as every
    default. Range's `AllowNull` and Date/Time's `allow_null` both default to
    true; a field with either off goes in `allow_null_off`.
    """
    options = _read_option_map(edit_widget) if edit_widget is not None else {}

    def number(key: str) -> Optional[float]:
        text = js_trim(options[key]) if key in options else ''
        if not text:
            return None
        value = js_number(text)
        return value if is_finite(value) else None

    if widget_type == 'CheckBox':
        rule_for(name).checkbox = FieldCheckbox(
            checked_value=_read_trimmed_option(options, 'CheckedState'),
            unchecked_value=_read_trimmed_option(options, 'UncheckedState'),
            show_stored_value=options.get('TextDisplayMethod') == '1',
            allow_null=_read_flag(options, 'AllowNullState', False),
        )
        return
    if widget_type == 'Range':
        field_range: dict[str, Any] = {}
        for key, member in (('Min', 'min'), ('Max', 'max'), ('Step', 'step')):
            value = number(key)
            if value is not None:
                field_range[member] = value
        precision = number('Precision')
        if precision is not None and _is_integer(precision) and precision >= 0:
            field_range['precision'] = precision
        suffix = options.get('Suffix')
        if suffix:
            field_range['suffix'] = suffix
        if field_range:
            rule_for(name).range = field_range
        if not _read_flag(options, 'AllowNull', True):
            allow_null_off.add(name)
        return
    # A date or date-time field ignores `field_format`, which this reader cannot tell here. ISO 8601 and the default for a date write nothing.
    date_format = js_trim(options['field_format']) if 'field_format' in options else ''
    if date_format and date_format != 'yyyy-MM-dd' and not _read_flag(options, 'field_iso_format', False):
        rule_for(name).date_format = date_format
    if not _read_flag(options, 'allow_null', True):
        allow_null_off.add(name)


def _constraint_strength(strength: Optional[str]) -> Optional[str]:
    """A constraint's strength: 1, or absent, is hard; 2 is soft; 0 or anything else is not set."""
    value = '1' if strength is None else strength
    return 'enforced' if value == '1' else 'warn' if value == '2' else None


def _parse_reuse_last_value(maplayer: Element) -> dict[str, bool]:
    """
    Which fields offer a new feature the value last entered, from either of
    QGIS's two forms: an older project's `<reuseLastValue>`, read first, and
    `<reuseLastValuePolicy>`, which wins. `AllowedDefaultOff` reads as not
    reused.
    """
    reuse: dict[str, bool] = {}
    for node in _children(direct_child(maplayer, 'reuseLastValue'), 'field'):
        name = node.get('name')
        flag = js_number(node.get('reuseLastValue'))
        if name:
            reuse[name] = _is_integer(flag) and flag != 0
    for node in _children(direct_child(maplayer, 'reuseLastValuePolicy'), 'field'):
        name = node.get('name')
        if name:
            reuse[name] = node.get('reuseLastValuePolicy') == 'AllowedDefaultOn'
    return reuse


def _parse_default_expression(expression: str, on_update: bool) -> Optional[FieldDefaultValue]:
    """
    A default-value expression an application can fill: one of
    `_NOW_EXPRESSIONS`, `uuid()` or `$uuid` with an optional format, or a lone
    literal. Anything else, such as a field reference, a variable or a
    calculation, is None. `uuid()` takes `format` and `version` by position or
    by name; a version other than 4 is None.
    """
    if _SPACES.sub('', expression).lower() in _NOW_EXPRESSIONS:
        return FieldDefaultValue(kind='now', on_update=on_update)
    tokens = _tokenize_expression(expression)
    if tokens is None:
        return None
    literal = _read_literal(tokens, 0)
    if literal is not None and literal[1] == len(tokens):
        return FieldDefaultValue(kind='fixed', value=literal[0], on_update=on_update)
    uuid_format = _read_uuid_call(tokens)
    return FieldDefaultValue(kind='uuid', format=uuid_format, on_update=on_update) if uuid_format else None


# One token of a literal or a `uuid()` call: its type, `string`, `number`, `name`, `named` (a name followed by `:=`) or `punct`, and its value.
_Token = tuple[str, Any]

# JavaScript's `.` outside Unicode mode: anything but a line terminator.
_NOT_LINE_TERMINATOR = '[^\\n\\r\\u2028\\u2029]'

# The tokens `parseLayers.ts`'s own `tokenizeExpression` reads, apart from `qgisExpression.ts`'s: spaces, a string, a number, a name with
# an optional `:=` after it, and `(`, `)`, `,` and `-`.
_DEFAULT_TOKEN = re.compile(
    f'[{JS_SPACE}]+'
    f"|'((?:''|\\\\{_NOT_LINE_TERMINATOR}|[^'\\\\])*)'"
    '|([0-9]*(?:\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[eE][-+]?[0-9]+)|[0-9]+)'
    f'|([A-Za-z_\\x80-\\U0010FFFF$][A-Za-z0-9_\\x80-\\U0010FFFF]*)([{JS_SPACE}]*:=[{JS_SPACE}]*)?'
    '|([(),-])'
)


def _tokenize_expression(expression: str) -> Optional[list[_Token]]:
    """
    Splits an expression into the tokens a literal or a `uuid()` call is made
    of, following QGIS's lexer, which ignores case. None where the expression
    holds anything else, such as an operator, a quoted field name or a comment.
    This is `parseLayers.ts`'s own small tokenizer, not `qgis_expression.py`'s.
    """
    tokens: list[_Token] = []
    position = 0
    while position < len(expression):
        match = _DEFAULT_TOKEN.match(expression, position)
        if match is None:
            return None
        position = match.end()
        text, number, name, named, punct = match.groups()
        if text is not None:
            tokens.append(('string', unescape_string_literal(text)))
        elif number is not None:
            tokens.append(('number', js_number(number)))
        elif name is not None:
            tokens.append(('named' if named else 'name', name.lower()))
        elif punct is not None:
            tokens.append(('punct', punct))
    return tokens


def _read_literal(tokens: list[_Token], index: int) -> Optional[tuple[FieldFixedValue, int]]:
    """The literal starting at `index`, a string, a number with or without a minus, `TRUE`, `FALSE` or `NULL`, and the index after it."""
    token = tokens[index] if index < len(tokens) else None
    after = tokens[index + 1] if index + 1 < len(tokens) else None
    if token == ('punct', '-') and after is not None and after[0] == 'number':
        return -after[1], index + 2
    if token is not None and token[0] in ('string', 'number'):
        return token[1], index + 1
    if token is None or token[0] != 'name':
        return None
    literals: dict[str, FieldFixedValue] = {'true': True, 'false': False, 'null': None}
    return (literals[token[1]], index + 1) if token[1] in literals else None


def _read_uuid_call(tokens: list[_Token]) -> Optional[str]:
    """The format of a whole-expression `uuid()` or `$uuid`, or None where the expression is not one."""
    if not tokens or tokens[0][0] != 'name':
        return None
    head = tokens[0][1]
    if head == '$uuid':
        return 'with_braces' if len(tokens) == 1 else None
    if head != 'uuid' or len(tokens) < 2 or tokens[1] != ('punct', '('):
        return None
    if tokens[-1] != ('punct', ')'):
        return None

    args: dict[str, FieldFixedValue] = {}
    positions = ('format', 'version')
    index = 2
    position = 0
    while index < len(tokens) - 1:
        if position > 0:
            if tokens[index] != ('punct', ','):
                return None
            index += 1
        token = tokens[index] if index < len(tokens) else None
        parameter = positions[position] if position < len(positions) else None
        if token is not None and token[0] == 'named':
            if token[1] not in positions:
                return None
            parameter = token[1]
            index += 1
        literal = _read_literal(tokens, index)
        if parameter is None or literal is None or parameter in args:
            return None
        args[parameter] = literal[0]
        index = literal[1]
        position += 1

    if 'version' in args and not _is_number(args['version'], 4):
        return None
    if 'format' not in args:
        return 'with_braces'
    if not isinstance(args['format'], str):
        return None
    chosen = args['format'].lower()
    return 'without_braces' if chosen == 'withoutbraces' else 'id128' if chosen == 'id128' else 'with_braces'


def _is_number(value: FieldFixedValue, number: int) -> bool:
    """`value === number`, where Python would also take `True` as 1."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == number


def _parse_field_comments(maplayer: Element) -> dict[str, str]:
    """
    Each field's custom comment, from the Attributes Form's Comment, which QGIS
    4.2 and later saves as `<customComments><customComment field value/>`, a
    direct child of `<maplayer>`. A blank comment, which hides the comment the
    field's data gives, is kept as an empty string, and where two entries name
    a field, the later stands.
    """
    out: dict[str, str] = {}
    for node in _children(direct_child(maplayer, 'customComments'), 'customComment'):
        field = node.get('field')
        if not field:
            continue
        out[field] = js_trim(node.get('value') or '')
    return out


# The start of the name of a layer variable that sets a field's icon, `quac_icon_species`, and the names of the variables that set the
# layer's own icon and hold the message shown once a feature is added.
_FIELD_ICON_VARIABLE_PREFIX = 'quac_icon_'
_LAYER_ICON_VARIABLE = 'quac_icon'
_ADDED_MESSAGE_VARIABLE = 'quac_added_message'


def _parse_field_icons(maplayer: Element) -> dict[str, str]:
    """
    The icon each field's `quac_icon_<field>` variable names, as an address
    (`resolve_field_icon_address`). QGIS keeps a layer's variables as two lists
    of the same length in its custom properties, `variableNames` and
    `variableValues`. A variable whose value names no icon is left out.
    """
    icons: dict[str, str] = {}
    for field, value in _read_field_variables(maplayer, _FIELD_ICON_VARIABLE_PREFIX):
        address = resolve_field_icon_address(value)
        if address:
            icons[field] = address
    return icons


# The start of the name of a layer variable that chooses a field's control: `quac_control_condition`.
_FIELD_CONTROL_VARIABLE_PREFIX = 'quac_control_'


def _parse_field_controls(maplayer: Element) -> dict[str, str]:
    """
    The control each field's `quac_control_<field>` variable asks for,
    `buttons` or `dropdown`, compared without regard to case or surrounding
    spaces. A value that names no control is left out.
    """
    controls: dict[str, str] = {}
    for field, value in _read_field_variables(maplayer, _FIELD_CONTROL_VARIABLE_PREFIX):
        control = js_trim(value).lower()
        if control in ('buttons', 'dropdown'):
            controls[field] = control
    return controls


def _read_layer_variable(maplayer: Element, variable: str) -> Optional[str]:
    """The value of the layer variable of this name; None where the layer has none."""
    properties = direct_child(maplayer, 'customproperties')
    if properties is None:
        return None
    names = read_custom_property_list(properties, 'variableNames')
    values = read_custom_property_list(properties, 'variableValues')
    index = names.index(variable) if variable in names else -1
    return None if index == -1 or index >= len(values) else values[index]


def _parse_layer_icon(maplayer: Element) -> Optional[str]:
    """The icon the layer's `quac_icon` variable names, as an address; None where it has none or it names no icon."""
    value = _read_layer_variable(maplayer, _LAYER_ICON_VARIABLE)
    return None if value is None else resolve_field_icon_address(value)


def _parse_added_message(maplayer: Element) -> Optional[str]:
    """The message the layer's `quac_added_message` variable holds, as written; None where it has none or it is blank."""
    value = _read_layer_variable(maplayer, _ADDED_MESSAGE_VARIABLE)
    return None if value is None or js_trim(value) == '' else value


def _read_field_variables(maplayer: Element, prefix: str) -> list[tuple[str, str]]:
    """Each of the layer's variables named `prefix` and a field's name, as that field's name and the variable's value."""
    properties = direct_child(maplayer, 'customproperties')
    if properties is None:
        return []
    names = read_custom_property_list(properties, 'variableNames')
    values = read_custom_property_list(properties, 'variableValues')
    return [
        (variable[len(prefix):], values[index])
        for index, variable in enumerate(names)
        if variable.startswith(prefix) and index < len(values) and variable[len(prefix):]
    ]


# The whitespace JavaScript's `\s` matches, as far as a project's text and a decoded image's opening bytes hold it.
_JS_SPACE = '\t\n\v\f\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
_DATA_URL = re.compile(rf'^data:image/[A-Za-z0-9_+.-]+;base64,[A-Za-z0-9+/={_JS_SPACE}]+\Z')
_EMBEDDED = re.compile(rf'^base64:([A-Za-z0-9+/={_JS_SPACE}]+)\Z', re.IGNORECASE)
_SVG_OPENING = re.compile(rf'^[{_JS_SPACE}]*(?:<\?xml|<svg)')

# The image types an embedded legend image is read as, by the bytes it opens with.
_IMAGE_SIGNATURES = (
    ('image/png', lambda opening: opening.startswith('\x89PNG')),
    ('image/jpeg', lambda opening: opening.startswith('\xff\xd8\xff')),
    ('image/gif', lambda opening: opening.startswith('GIF8')),
    ('image/webp', lambda opening: opening.startswith('RIFF') and opening[8:12] == 'WEBP'),
    ('image/svg+xml', lambda opening: _SVG_OPENING.match(opening) is not None),
)


def _parse_legend_image(maplayer: Element) -> Optional[str]:
    """
    The layer's legend placeholder image where QGIS embeds it. **Embed File…**
    saves the file as `base64:` and its contents, with no type, so the type is
    read from the bytes the image opens with; a `data:` URL is kept as
    written. A file path or web address is not read: it names a file rather
    than holding one.
    """
    source = js_trim(maplayer.get('legendPlaceholderImage') or '')
    if _DATA_URL.match(source):
        return source
    match = _EMBEDDED.match(source)
    if match is None:
        return None
    data = re.sub(f'[{_JS_SPACE}]', '', match.group(1))
    opening = _atob(data[:24])
    if opening is None:
        return None
    image_type = next((name for name, matches in _IMAGE_SIGNATURES if matches(opening)), None)
    return f'data:{image_type};base64,{data}' if image_type else None


def _atob(text: str) -> Optional[str]:
    """`atob`: the forgiving base64 decoder's bytes, one character each, or None where it throws."""
    if len(text) % 4 == 0:
        text = text[:-2] if text.endswith('==') else text[:-1] if text.endswith('=') else text
    if len(text) % 4 == 1 or not re.fullmatch(r'[A-Za-z0-9+/]*', text):
        return None
    try:
        return base64.b64decode(text + '=' * (-len(text) % 4)).decode('latin-1')
    except (binascii.Error, ValueError):
        return None


def _parse_private(maplayer: Element) -> bool:
    """`<flags><Private>1</Private></flags>`, the **Private** column of Project Properties → Data Sources; false where absent."""
    flags = direct_child(maplayer, 'flags')
    if flags is None:
        return False
    private = direct_child(flags, 'Private')
    return private is not None and js_trim(text_content(private)) == '1'


_SINGLE_FIELD = re.compile(r'^"([^"]+)"$')


def _parse_display_field(maplayer: Element) -> Optional[str]:
    """The layer's Display Name, where it is a single field in double quotes."""
    text = direct_child_text(maplayer, 'previewExpression')
    if not text:
        return None
    match = _SINGLE_FIELD.match(text)
    return match.group(1) if match else None


def _parse_queryable(maplayer: Element) -> bool:
    """`<flags><Identifiable>1</Identifiable></flags>`; true where the flags are absent."""
    flags = direct_child(maplayer, 'flags')
    if flags is None:
        return True
    identifiable = direct_child(flags, 'Identifiable')
    if identifiable is None:
        return True
    return js_trim(text_content(identifiable)) == '1'


def _parse_scale_range(maplayer: Element) -> Optional[LayerScaleRange]:
    """The scales the layer is drawn between, where `hasScaleBasedVisibilityFlag` is on. A value of 0 means no limit on that side."""
    if maplayer.get('hasScaleBasedVisibilityFlag') != '1':
        return None
    min_scale = _parse_scale_denominator(maplayer.get('minScale'))
    max_scale = _parse_scale_denominator(maplayer.get('maxScale'))
    if min_scale is None and max_scale is None:
        return None
    return LayerScaleRange(min_scale=min_scale, max_scale=max_scale)


def _parse_scale_denominator(text: Optional[str]) -> Optional[float]:
    value = js_number(text)
    return value if text and is_finite(value) and value > 0 else None


def _parse_opacity(maplayer: Element) -> float:
    """`<layerOpacity>`, or a raster renderer's `opacity`; 1 where absent or unreadable."""
    text = direct_child_text(maplayer, 'layerOpacity')
    if text is None:
        renderer = next(iter(children_of_kind(maplayer, 'pipe', 'rasterrenderer')), None)
        text = renderer.get('opacity') if renderer is not None else None
    if not text:
        return 1
    value = js_number(text)
    return whole(max(0, min(1, value))) if is_finite(value) else 1


def _read_number(parent: Element, tag: str) -> Optional[float]:
    node = first_descendant(parent, tag)
    text = js_trim(text_content(node)) if node is not None else ''
    if not text:
        return None
    value = js_number(text)
    return value if is_finite(value) else None
