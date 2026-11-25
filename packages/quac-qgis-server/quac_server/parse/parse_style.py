"""Mirrors `packages/quac/src/parse/parseStyle.ts`, as far as `quac:categorised_field` reads a layer's styles.

Each style keeps its name, whether it is the one applied, and the field a
categorised or graduated renderer classifies by, not the renderer's XML: the
QGIS Desktop part writes each layer's current style as a QML file of its own
(`quac/publish.py`), a departure recorded in `port-exemptions.json`.
"""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element  # nosec B405

from ..js_compat import js_trim
from ..model.qgs_project import LayerStyle
from .xml_text import direct_child, first_descendant


def parse_layer_styles(maplayer: Element) -> tuple[list[LayerStyle], int]:
    """
    A layer's named styles from its `<map-layer-style-manager>`, and the index
    of the active one: the manager's `current`. The active style's renderer
    is the one directly inside `<maplayer>`, another style's the one inside its
    `<map-layer-style>`. With no manager, one style named `default` from the
    renderer directly inside `<maplayer>`. A vector tile layer's renderer is
    `<renderer>`, which has no categorised field. `([], -1)` where nothing is
    found.
    """
    try:
        manager = direct_child(maplayer, 'map-layer-style-manager')
        tag = 'renderer' if maplayer.get('type') == 'vector-tile' else 'renderer-v2'

        if manager is None:
            direct = _capture_maplayer_renderer(maplayer, tag)
            if direct is None:
                return [], -1
            return [LayerStyle(name='default', is_active=True, categorised_field=_categorised_field_of(direct, tag))], 0

        current_name = manager.get('current') or ''
        styles: list[LayerStyle] = []
        active_index = -1
        for node in manager:
            if node.tag != 'map-layer-style':
                continue
            name = node.get('name') or ''
            is_active = name == current_name
            renderer = _capture_maplayer_renderer(maplayer, tag) if is_active else first_descendant(node, tag)
            if is_active:
                active_index = len(styles)
            styles.append(LayerStyle(name=name, is_active=is_active, categorised_field=_categorised_field_of(renderer, tag)))
        return styles, active_index
    except Exception:  # noqa: BLE001 - as the JavaScript, unreadable styles are no styles
        return [], -1


def _capture_maplayer_renderer(maplayer: Element, tag: str) -> Optional[Element]:
    """The renderer directly inside `<maplayer>`, or else the first inside its style manager."""
    direct = direct_child(maplayer, tag)
    if direct is not None:
        return direct
    manager = direct_child(maplayer, 'map-layer-style-manager')
    return first_descendant(manager, tag) if manager is not None else None


def _categorised_field_of(renderer: Optional[Element], tag: str) -> Optional[str]:
    """
    The field a categorised or graduated renderer classifies by, its `attr`.
    Read only from those two renderer types: another type's `attr` would not
    mean the same.
    """
    if renderer is None or tag == 'renderer':
        return None
    if renderer.get('type') not in ('categorizedSymbol', 'graduatedSymbol'):
        return None
    return js_trim(renderer.get('attr') or '') or None
