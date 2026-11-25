"""Mirrors `packages/quac/src/parse/parseLayers.ts`, as far as the plugin's first-release fields read a layer.

It reads a layer's id, names, geometry, WGS84 extent, coordinate system, data source, display
field, identifiable and read-only flags, opacity, scale range, field names and
aliases, Value Map lists and Value Relations, abstract, licence and temporal extent, QFieldSync
locks, and the fields it hides from QGIS Server. Styles, forms, other widgets
and the rest are not read; `port-exemptions.json` lists them.
"""

from __future__ import annotations

import re
from typing import Optional
from xml.etree.ElementTree import Element  # nosec B405

from ..js_compat import is_finite, js_number, js_trim, whole
from ..model.qgs_project import BoundingBox, FieldValueMapEntry, FieldValueRelation, LayerEntry, LayerResourceMetadata, LayerScaleRange, ServerHiddenFields
from .parse_data_source import parse_data_source
from .parse_qfield_sync import parse_qfield_sync_locks
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
        field_value_relations=_parse_field_value_relations(maplayer),
        resource_metadata=_parse_layer_resource_metadata(maplayer),
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


def _read_flag(options: dict[str, str], key: str) -> bool:
    return options.get(key) in ('true', '1')


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
