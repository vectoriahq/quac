"""
A catalogue written as separate documents is the one the JavaScript's
`splitCatalogue` wrote: for every whole-project fixture's saved catalogue,
`<name>.catalogue.json`, and for the made-up catalogue of awkward ids in
`fixtures/split/`, the JavaScript saved its documents beside it as
`<name>.split.json`, each form with the options it was split with
(`packages/quac/src/tests/savedSplit.ts`).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from quac_server.generate.split_catalogue import split_catalogue

from .declared import FIXTURES, QUAC_PACKAGE

SPLIT_FIXTURES = QUAC_PACKAGE / 'src' / 'tests' / 'fixtures' / 'split'


def saved_splits() -> list[Path]:
    return sorted([*FIXTURES.glob('*/*.split.json'), *SPLIT_FIXTURES.glob('*.split.json')])


class SplitMatchesTheJavaScript(unittest.TestCase):
    def test_has_fixtures_to_check(self) -> None:
        self.assertIn(SPLIT_FIXTURES / 'awkward-ids.split.json', saved_splits())
        self.assertIn(FIXTURES / 'server-groups' / 'groups.split.json', saved_splits())

    def test_every_saved_split(self) -> None:
        for path in saved_splits():
            catalogue = json.loads(path.with_name(path.name.replace('.split.json', '.catalogue.json')).read_text(encoding='utf-8'))
            for form in json.loads(path.read_text(encoding='utf-8')):
                options = form['options']
                with self.subTest(fixture=path.name, options=options):
                    documents = split_catalogue(catalogue, options.get('rootFileName', 'catalog.json'), options.get('childrenFolder', ''))
                    self.assertEqual(documents, form['documents'])

    def test_refuses_an_unsafe_path(self) -> None:
        catalogue = json.loads((SPLIT_FIXTURES / 'awkward-ids.catalogue.json').read_text(encoding='utf-8'))
        for root_file_name, children_folder in (('out/catalog.json', ''), ('catalog', ''), ('', ''), ('catalog.json', '/srv'), ('catalog.json', '../elsewhere'), ('catalog.json', 'a/../../b'), ('catalog.json', './a'), ('catalog.json', 'a//b'), ('catalog.json', 'a\\b'), ('catalog.json', 'C:'), ('catalog.json', 'Catalog.JSON/x')):
            with self.subTest(root_file_name=root_file_name, children_folder=children_folder):
                with self.assertRaises(ValueError):
                    split_catalogue(catalogue, root_file_name, children_folder)


if __name__ == '__main__':
    unittest.main()
