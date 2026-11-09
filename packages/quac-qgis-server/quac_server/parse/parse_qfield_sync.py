"""Mirrors `packages/quac/src/parse/parseQfieldSync.ts`, as far as the first-release fields need: `parseQfieldSyncLocks` and `parseWfsTransactionLayers`."""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element

from ..js_compat import js_trim
from ..model.qgs_project import EditLock, WfsTransactionLayers
from .custom_properties import is_true_value, read_custom_property
from .project_properties import property_child, property_list, read_property_block
from .xml_text import direct_child


# The part of each lock's three keys that names the edit, as QFieldSync spells it.
LOCK_KEY_PARTS = {
    'add': 'feature_addition',
    'attributes': 'attribute_editing',
    'geometry': 'geometry_editing',
    'delete': 'feature_deletion',
}


def parse_qfield_sync_locks(maplayer: Element) -> dict[str, EditLock]:
    """
    The edits QFieldSync locks on a layer: **Disable feature addition**,
    **Disable attribute editing**, **Disable geometry editing** and **Disable
    feature deletion**, under Permissions on the QField tab of Layer
    Properties. Each is three custom properties: the box,
    `QFieldSync/is_<edit>_locked`; the switch of its data-defined button,
    `QFieldSync/is_<edit>_locked_expression_active`; and the button's
    expression, `QFieldSync/<edit>_locked_expression`.

    With the switch on and an expression that is not blank, the expression
    decides in place of the box; otherwise the box decides. A layer QFieldSync
    saved before 4.15 holds one lock, `QFieldSync/is_geometry_locked` and its
    two companions, which QField reads as adding, geometry editing and
    deleting locked, and attributes free.
    """
    properties = next((child for child in maplayer if child.tag == 'customproperties'), None)
    if properties is None:
        return {}

    def read(key: str) -> Optional[str]:
        return read_custom_property(properties, f'QFieldSync/{key}')

    def lock_of(part: str) -> Optional[EditLock]:
        expression = None
        if is_true_value(read(f'is_{part}_locked_expression_active')):
            written = read(f'{part}_locked_expression')
            expression = js_trim(written) if written is not None else None
        if expression:
            return {'expression': expression}
        return True if is_true_value(read(f'is_{part}_locked')) else None

    locks: dict[str, EditLock] = {}
    if read('is_geometry_locked') is not None:
        lock = lock_of('geometry')
        if lock:
            for edit in ('add', 'geometry', 'delete'):
                locks[edit] = lock
        return locks
    for edit, part in LOCK_KEY_PARTS.items():
        lock = lock_of(part)
        if lock:
            locks[edit] = lock
    return locks


def parse_wfs_transaction_layers(qgis_root: Element) -> Optional[WfsTransactionLayers]:
    """
    The layers a project publishes for WFS, and the WFS-T operations each takes:
    **Published**, **Update**, **Insert** and **Delete** in Project Properties →
    QGIS Server → WFS capabilities, saved as lists of layer ids. None where the
    project saves no `WFSLayers`.
    """
    properties = direct_child(qgis_root, 'properties')
    if properties is None or property_child(properties, 'WFSLayers') is None:
        return None
    transactions = read_property_block(qgis_root, 'WFSTLayers')

    def list_of(name: str) -> list[str]:
        return property_list(transactions, name) if transactions is not None else []

    return WfsTransactionLayers(
        published=property_list(properties, 'WFSLayers'),
        insert=list_of('Insert'),
        update=list_of('Update'),
        delete=list_of('Delete'),
    )
