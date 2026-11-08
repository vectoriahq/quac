"""
A person's catalogue, from the catalogue a project serves and QGIS's access
answers for that person.
No QGIS module, so its tests run anywhere; `qgis_inputs.access_answers` asks
QGIS for the answers.

`LayerAnswer` holds what QGIS's combined access controls (`QgsAccessControl`)
answer for one served layer: whether the person may read it, add, change and
delete its features, and which of its fields they may see. `apply_access`
applies them to a finished catalogue:

- A layer they may not read is left out, with its link. A group left with no
  layer they may read, where it held one, is left out too. The top-level extent
  is worked out again from the layers left.
- A field they may not see is left out of the columns and is no longer the
  display field, and a lock whose expression names it becomes `True`.
- An edit they may not make is locked in `quac:locks`: adding, changing (both
  attributes and geometry, as QGIS answers one permission for both) and
  deleting. Where all three are refused, `quac:editable` is `false`.

A served layer with no answer is left out, so a layer QGIS was not asked about
is never shown. QGIS answers nothing finer: which fields a person may see but
not change, whether they may change attributes but not move shapes, and which
features they may edit stay with the access plugin, which refuses such a save.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import quote

# The extent a Collection takes where its source gives no box.
_WHOLE_WORLD = [-180, -90, 180, 90]


@dataclass(frozen=True)
class LayerAnswer:
    read: bool = True
    insert: bool = True
    update: bool = True
    delete: bool = True
    # The fields the person may see, or None where QGIS was not asked, which leaves every field.
    fields: Optional[frozenset[str]] = None

    def combine(self, other: 'LayerAnswer') -> 'LayerAnswer':
        """Two layers served under one name: each permission only where both allow it, and the fields both show."""
        if self.fields is None or other.fields is None:
            fields = self.fields if other.fields is None else other.fields
        else:
            fields = self.fields & other.fields
        return LayerAnswer(self.read and other.read, self.insert and other.insert, self.update and other.update, self.delete and other.delete, fields)


def apply_access(catalogue: dict[str, Any], answers: dict[str, LayerAnswer]) -> dict[str, Any]:
    """The catalogue as the person the answers are for may see it, by each Collection's id, the layer's WMS name."""
    served = copy.deepcopy(catalogue)
    _apply_to_catalog(served, answers)
    boxes = [collection['extent']['spatial']['bbox'][0] for collection in _collections(served)]
    boxes = [box for box in boxes if box != _WHOLE_WORLD]
    if 'extent' in served:
        if boxes:
            served['extent']['spatial']['bbox'] = [[min(box[0] for box in boxes), min(box[1] for box in boxes), max(box[2] for box in boxes), max(box[3] for box in boxes)]]
        else:
            del served['extent']
    return served


def _apply_to_catalog(node: dict[str, Any], answers: dict[str, LayerAnswer]) -> bool:
    """Applies the answers inside one Catalog; false where it held a layer and now holds none, so its parent leaves it out."""
    held_layer = bool(node.get('collections'))
    collections = []
    for collection in node.get('collections', []):
        answer = answers.get(collection['id'])
        if answer is None or not answer.read:
            continue
        collections.append(_apply_to_collection(collection, answer))
    catalogs = []
    for child in node.get('catalogs', []):
        held_layer = held_layer or _holds_layer(child)
        if _apply_to_catalog(child, answers):
            catalogs.append(child)
    node['links'] = [link for link in node['links'] if link.get('rel') != 'child'] + _child_links(collections, catalogs)
    for key, kept in (('collections', collections), ('catalogs', catalogs)):
        if kept:
            node[key] = kept
        else:
            node.pop(key, None)
    return bool(collections or catalogs) or not held_layer


def _holds_layer(node: dict[str, Any]) -> bool:
    return bool(node.get('collections')) or any(_holds_layer(child) for child in node.get('catalogs', []))


def _apply_to_collection(collection: dict[str, Any], answer: LayerAnswer) -> dict[str, Any]:
    if answer.fields is not None:
        hidden = {column['name'] for column in collection.get('table:columns', [])} - answer.fields
        hidden |= {collection['quac:display_field']} - answer.fields if 'quac:display_field' in collection else set()
        if hidden:
            columns = [column for column in collection.get('table:columns', []) if column['name'] not in hidden]
            if columns:
                collection['table:columns'] = columns
            else:
                collection.pop('table:columns', None)
            if collection.get('quac:display_field') in hidden:
                del collection['quac:display_field']
            locks = collection.get('quac:locks')
            if isinstance(locks, dict):
                collection['quac:locks'] = {edit: True if isinstance(lock, dict) and _mentions_any(lock.get('expression'), hidden) else lock for edit, lock in locks.items()}

    refused = {'add': not answer.insert, 'attributes': not answer.update, 'geometry': not answer.update, 'delete': not answer.delete}
    if any(refused.values()):
        locks = dict(collection.get('quac:locks') or {})
        for edit, is_refused in refused.items():
            if is_refused:
                locks[edit] = True
        collection['quac:locks'] = locks
    if not (answer.insert or answer.update or answer.delete):
        collection['quac:editable'] = False
    return collection


def _mentions_any(expression: Any, fields: set[str]) -> bool:
    """Whether an expression names one of the fields, erring towards yes, as the server route's own check does."""
    if not isinstance(expression, str):
        return False
    return any(re.search(rf'(^|[^A-Za-z0-9_]){re.escape(field)}(\Z|[^A-Za-z0-9_])', expression) for field in fields)


def _collections(catalog: dict[str, Any]):
    yield from catalog.get('collections', [])
    for child in catalog.get('catalogs', []):
        yield from _collections(child)


def _child_links(collections: list[dict[str, Any]], catalogs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The links to a Catalog's children, written as the server route writes them."""
    links = []
    for href, title in [(f'./collections/{_escape(collection["id"])}.json', collection.get('title')) for collection in collections] + \
            [(f'./catalogs/{_escape(catalog["id"])}/catalog.json', catalog.get('title')) for catalog in catalogs]:
        link: dict[str, Any] = {'rel': 'child', 'href': href, 'type': 'application/json'}
        if title is not None:
            link['title'] = title
        links.append(link)
    return links


def _escape(text: str) -> str:
    """`encodeURIComponent`, as the server route escapes an id in a link."""
    return quote(text, safe="-_.!~*'()")
