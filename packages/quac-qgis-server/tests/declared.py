"""
Cuts a catalogue down to the fields the plugin declares
(`quac_server/declared_fields.json`), so the JavaScript's catalogue can be
compared with the plugin's, which writes those fields only.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DECLARED = json.loads((Path(__file__).resolve().parents[1] / 'quac_server' / 'declared_fields.json').read_text(encoding='utf-8'))

QUAC_PACKAGE = Path(__file__).resolve().parents[2] / 'quac'
FIXTURES = QUAC_PACKAGE / 'src' / 'tests' / 'fixtures' / 'qgis'


def _keep(value: dict[str, Any], place: str) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key in DECLARED[place]}


def declared_collection(collection: dict[str, Any]) -> dict[str, Any]:
    """A Collection cut down to the declared fields, wherever they sit."""
    out = _keep(collection, 'collection')
    if 'summaries' in out:
        summaries = _keep(out['summaries'], 'summaries')
        if summaries:
            out['summaries'] = summaries
        else:
            del out['summaries']
    if 'links' in out:
        out['links'] = [_keep(link, 'link') for link in out['links']]
    if 'assets' in out:
        out['assets'] = {name: _keep(asset, 'asset') for name, asset in out['assets'].items()}
    if 'table:columns' in out:
        out['table:columns'] = [_keep(column, 'column') for column in out['table:columns']]
    return out


def declared_catalog(catalog: dict[str, Any]) -> dict[str, Any]:
    """A Catalog tree cut down to the declared fields."""
    out = _keep(catalog, 'catalog')
    if 'links' in out:
        out['links'] = [_keep(link, 'link') for link in out['links']]
    if 'collections' in out:
        out['collections'] = [declared_collection(collection) for collection in out['collections']]
    if 'catalogs' in out:
        out['catalogs'] = [declared_catalog(child) for child in out['catalogs']]
    return out
