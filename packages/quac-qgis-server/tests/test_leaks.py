"""
The leak tests, which must fail the build if broken: every whole-project
fixture's served catalogue passes `leaks.leak_failures`, and a catalogue
doctored to hold each kind of leak fails it, so the checks are known to bite.
"""

from __future__ import annotations

import copy
import unittest

from quac_server import read_project_xml, read_server_catalogue

from .declared import FIXTURES
from .leaks import leak_failures

SERVER_ADDRESS = 'https://qgis.example.com/ows?MAP=/projects/fixture.qgs'


def projects():
    return sorted(path for pattern in ('*/*.qgs', '*/*.qgz') for path in FIXTURES.glob(pattern))


class ServedCataloguesLeakNothing(unittest.TestCase):
    def test_every_fixture(self) -> None:
        for path in projects():
            with self.subTest(project=str(path.relative_to(FIXTURES))):
                catalogue = read_server_catalogue(path.name, path.read_bytes(), SERVER_ADDRESS)
                self.assertEqual(leak_failures(catalogue, read_project_xml(path.name, path.read_bytes()), SERVER_ADDRESS), [])


class TheChecksBite(unittest.TestCase):
    def setUp(self) -> None:
        path = FIXTURES / 'server-publishing' / 'publishing.qgs'
        self.text = path.read_text(encoding='utf-8')
        self.catalogue = read_server_catalogue(path.name, path.read_bytes(), SERVER_ADDRESS)
        self.parcels = next(collection for collection in self.catalogue['collections'] if collection['id'] == 'Parcels')
        self.notes = next(collection for collection in self.catalogue['collections'] if collection['id'] == 'Survey notes')

    def fails(self, doctor) -> list[str]:
        doctored = copy.deepcopy(self.catalogue)
        doctor(doctored, next(c for c in doctored['collections'] if c['id'] == 'Parcels'), next(c for c in doctored['collections'] if c['id'] == 'Survey notes'))
        return leak_failures(doctored, self.text, SERVER_ADDRESS)

    def test_starts_clean(self) -> None:
        self.assertEqual(leak_failures(self.catalogue, self.text, SERVER_ADDRESS), [])

    def test_an_unpublished_layer(self) -> None:
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels.update({'quac:related_to': [{'parent_collection_id': 'Zones'}]})))
        self.assertTrue(self.fails(lambda cat, parcels, notes: cat['links'].append({'rel': 'child', 'href': './collections/Zones.json'})))

    def test_a_wfs_address_for_a_layer_not_published_for_wfs(self) -> None:
        self.assertTrue(self.fails(lambda cat, parcels, notes: notes.update({'quac:wfs_type_name': 'Survey_notes'})))

    def test_a_hidden_field(self) -> None:
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels['table:columns'].append({'name': 'owner_phone'})))
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels.update({'quac:display_field': 'valuation'})))
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels.update({'quac:locks': {'delete': {'expression': '"valuation" > 0'}}})))

    def test_a_connection_detail_or_password(self) -> None:
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels.update({'description': 'Pa55-in-the-project'})))
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels.update({'description': "dbname='gis' host=db.example.com"})))

    def test_a_path_or_data_file(self) -> None:
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels.update({'description': '/home/author/data/parcels.geojson'})))
        self.assertTrue(self.fails(lambda cat, parcels, notes: parcels['assets'].update({'file': {'href': './parcels.geojson'}})))


if __name__ == '__main__':
    unittest.main()
