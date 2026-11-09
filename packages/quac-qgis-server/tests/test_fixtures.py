"""
The Python reader returns, for every whole-project fixture, the layer tree the
JavaScript saved beside it as `<name>.server.layers.json`
(`packages/quac/src/tests/catalogueGoldens.test.ts`). A `.qgz` is compared with
the tree of the `.qgs` of the same name.

Run from `packages/quac-qgis-server`: `python3 -m unittest discover -s tests`.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from quac_server import read_server_layer_tree

FIXTURES = Path(__file__).resolve().parents[2] / 'quac' / 'src' / 'tests' / 'fixtures' / 'qgis'


def projects() -> list[Path]:
    return sorted(path for pattern in ('*/*.qgs', '*/*.qgz') for path in FIXTURES.glob(pattern))


class ServerLayerTreeMatchesTheJavaScript(unittest.TestCase):
    def test_has_fixtures_to_check(self) -> None:
        self.assertTrue(any(path.suffix == '.qgs' for path in projects()))
        self.assertTrue(any(path.suffix == '.qgz' for path in projects()))

    def test_every_fixture(self) -> None:
        for path in projects():
            with self.subTest(project=str(path.relative_to(FIXTURES))):
                expected = json.loads(path.with_suffix('.server.layers.json').read_text(encoding='utf-8'))
                self.assertEqual(read_server_layer_tree(path.name, path.read_bytes()), expected)


if __name__ == '__main__':
    unittest.main()
