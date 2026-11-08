"""
The second tier: for every whole-project fixture, the plugin's catalogue is
the one the JavaScript's server route saved beside it as
`<name>.server.catalogue.json` (`packages/quac/src/tests/catalogueGoldens.test.ts`),
cut down to the fields the plugin declares. A `.qgz` is compared with the
catalogue of the `.qgs` of the same name.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from quac_server import read_server_catalogue

from .declared import DECLARED, FIXTURES, declared_catalog

# The address `catalogueGoldens.test.ts` gives the server route.
SERVER_ADDRESS = 'https://qgis.example.com/ows?MAP=/projects/fixture.qgs'


def projects() -> list[Path]:
    return sorted(path for pattern in ('*/*.qgs', '*/*.qgz') for path in FIXTURES.glob(pattern))


class ServerCatalogueMatchesTheJavaScript(unittest.TestCase):
    def test_has_fixtures_to_check(self) -> None:
        self.assertTrue(any(path.suffix == '.qgs' for path in projects()))
        self.assertTrue(any(path.suffix == '.qgz' for path in projects()))

    def test_every_fixture(self) -> None:
        for path in projects():
            with self.subTest(project=str(path.relative_to(FIXTURES))):
                saved = json.loads(path.with_suffix('.server.catalogue.json').read_text(encoding='utf-8'))
                self.assertEqual(read_server_catalogue(path.name, path.read_bytes(), SERVER_ADDRESS), declared_catalog(saved))

    def test_writes_only_declared_fields(self) -> None:
        def check(catalog: dict, where: str) -> None:
            self.assertEqual(set(catalog) - set(DECLARED['catalog']), set(), where)
            for collection in catalog.get('collections', []):
                self.assertEqual(set(collection) - set(DECLARED['collection']), set(), f'{where} {collection["id"]}')
                for column in collection.get('table:columns', []):
                    self.assertEqual(set(column) - set(DECLARED['column']), set(), f'{where} {collection["id"]}')
            for child in catalog.get('catalogs', []):
                check(child, where)

        for path in projects():
            check(read_server_catalogue(path.name, path.read_bytes(), SERVER_ADDRESS), path.name)


if __name__ == '__main__':
    unittest.main()
