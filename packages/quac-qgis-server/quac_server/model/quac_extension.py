"""Mirrors `packages/quac/src/model/quacExtension.ts`."""

from __future__ import annotations

from typing import Any

# The QUAC schema's address, as its `$id` gives it.
QUAC_SCHEMA_URL = 'https://groundwork.do/schemas/quac/v0.1.0/schema.json'


def _has_quac_key(value: Any) -> bool:
    return isinstance(value, dict) and any(key.startswith('quac:') for key in value)


def _collection_carries_quac(collection: dict[str, Any]) -> bool:
    """Whether a Collection carries a `quac:` field: on itself, in its summaries, or on an asset, link or column."""
    if _has_quac_key(collection) or _has_quac_key(collection.get('summaries')):
        return True
    if any(_has_quac_key(asset) for asset in (collection.get('assets') or {}).values()):
        return True
    if any(_has_quac_key(link) for link in collection.get('links') or []):
        return True
    columns = collection.get('table:columns')
    return isinstance(columns, list) and any(_has_quac_key(column) for column in columns)


def list_quac_extension(document: dict[str, Any]) -> None:
    """Adds the QUAC schema to one document's `stac_extensions`, once."""
    extensions = document.get('stac_extensions') or []
    if QUAC_SCHEMA_URL not in extensions:
        document['stac_extensions'] = [*extensions, QUAC_SCHEMA_URL]


def declare_quac_extension(catalog: dict[str, Any]) -> dict[str, Any]:
    """
    Lists the QUAC schema in `stac_extensions` on the top-level Catalog, and on
    each nested Catalog and Collection that carries a `quac:` field of its own.
    """
    list_quac_extension(catalog)

    def walk(node: dict[str, Any]) -> None:
        for collection in node.get('collections') or []:
            if _collection_carries_quac(collection):
                list_quac_extension(collection)
        for child in node.get('catalogs') or []:
            if _has_quac_key(child):
                list_quac_extension(child)
            walk(child)

    walk(catalog)
    return catalog
