"""
The first tier: for every QGIS project among the per-field examples
(`packages/quac/spec/examples/`), the plugin's catalogue, cut down as the
examples are to its tree and its `quac:` fields, is the one the JavaScript's
server route saved in `packages/quac/src/tests/firstTierServer.catalogues.json`,
less the fields the plugin does not declare.
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from quac_server import read_server_catalogue

from .declared import DECLARED, QUAC_PACKAGE

EXAMPLES = QUAC_PACKAGE / 'spec' / 'examples'
SERVED = json.loads((QUAC_PACKAGE / 'src' / 'tests' / 'firstTierServer.catalogues.json').read_text(encoding='utf-8'))

# The address `firstTier.test.ts` gives the server route where an example names none.
SERVER_ADDRESS = 'https://qgis.example.com/ows'


def _quac(value: dict[str, Any], place: str) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key.startswith('quac:') and key in DECLARED[place]}


def _collection_essentials(collection: dict[str, Any]) -> dict[str, Any]:
    """A Collection cut down to its id and its declared `quac:` fields, wherever they sit."""
    out: dict[str, Any] = {'type': 'Collection', 'id': collection['id'], **_quac(collection, 'collection')}
    summaries = _quac(collection.get('summaries') or {}, 'summaries')
    if summaries:
        out['summaries'] = summaries
    assets = {name: _quac(asset, 'asset') for name, asset in (collection.get('assets') or {}).items()}
    assets = {name: fields for name, fields in assets.items() if fields}
    if assets:
        out['assets'] = assets
    links = [{'rel': link['rel'], **_quac(link, 'link')} for link in collection.get('links') or [] if _quac(link, 'link')]
    if links:
        out['links'] = links
    columns = [{'name': column['name'], **_quac(column, 'column')} for column in collection.get('table:columns') or [] if _quac(column, 'column')]
    if columns:
        out['table:columns'] = columns
    return out


def essentials(catalog: dict[str, Any]) -> dict[str, Any]:
    """A Catalog cut down to its tree and its declared `quac:` fields, as `firstTier.test.ts` cuts one down."""
    out: dict[str, Any] = {'type': 'Catalog', 'id': catalog['id'], **_quac(catalog, 'catalog')}
    if catalog.get('collections'):
        out['collections'] = [_collection_essentials(collection) for collection in catalog['collections']]
    if catalog.get('catalogs'):
        out['catalogs'] = [essentials(child) for child in catalog['catalogs']]
    return out


class FirstTierMatchesTheJavaScript(unittest.TestCase):
    def test_has_examples_to_check(self) -> None:
        self.assertGreater(len(SERVED), 0)

    def test_every_qgis_example(self) -> None:
        for name, saved in SERVED.items():
            with self.subTest(example=name):
                manifest = json.loads((EXAMPLES / name / 'example.json').read_text(encoding='utf-8'))
                path = EXAMPLES / name / manifest['input']
                catalogue = read_server_catalogue(path.name, path.read_bytes(), manifest.get('endpoint', SERVER_ADDRESS))
                self.assertEqual(essentials(catalogue), essentials(saved))


if __name__ == '__main__':
    unittest.main()
