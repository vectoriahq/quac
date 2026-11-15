"""Mirrors `packages/quac/src/model/stacTreeWalk.ts`, as far as the server route needs."""

from __future__ import annotations

from typing import Any, Optional


def catalogue_folder(catalog: dict[str, Any]) -> Optional[str]:
    """
    Where a Catalog would sit as a file of its own, relative to the top-level
    document, read from its `self` link: `./` for `./catalog.json`, and
    `./catalogs/roads/` for `./catalogs/roads/catalog.json`. None where the
    `self` link is absent or names some other file.
    """
    self_href = next((link.get('href') for link in catalog.get('links') or [] if link.get('rel') == 'self'), None)
    if not isinstance(self_href, str) or (self_href != 'catalog.json' and not self_href.endswith('/catalog.json')):
        return None
    return self_href[:len(self_href) - len('catalog.json')]
