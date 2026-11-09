"""
A person's catalogue (`quac_catalogue/access.py`): QGIS's access answers
applied to a served catalogue, checked on the fixtures with no QGIS, and run
through the leak checks with the same answers.
"""

from __future__ import annotations

import unittest

from quac_catalogue.access import LayerAnswer, apply_access
from quac_server import read_server_catalogue

from .declared import FIXTURES
from .leaks import leak_failures

SERVER_ADDRESS = 'https://qgis.example.com/ows?MAP=/projects/fixture.qgs'


def served(folder: str, name: str) -> tuple[dict, str]:
    path = FIXTURES / folder / name
    return read_server_catalogue(path.name, path.read_bytes(), SERVER_ADDRESS), path.read_text(encoding='utf-8')


def collections(catalog: dict):
    yield from catalog.get('collections', [])
    for child in catalog.get('catalogs', []):
        yield from collections(child)


def by_id(catalog: dict) -> dict:
    return {collection['id']: collection for collection in collections(catalog)}


def allow_all(catalog: dict, **answers: LayerAnswer) -> dict[str, LayerAnswer]:
    found = {collection['id']: LayerAnswer() for collection in collections(catalog)}
    found.update({name.replace('_', ' '): answer for name, answer in answers.items()})
    return found


class AnswersAllowingEverything(unittest.TestCase):
    def test_leave_every_fixture_as_it_is(self) -> None:
        for path in sorted(FIXTURES.glob('*/*.qgs')):
            with self.subTest(project=str(path.relative_to(FIXTURES))):
                catalogue = read_server_catalogue(path.name, path.read_bytes(), SERVER_ADDRESS)
                self.assertEqual(apply_access(catalogue, allow_all(catalogue)), catalogue)

    def test_a_layer_with_no_answer_is_left_out(self) -> None:
        catalogue, _ = served('server-publishing', 'publishing.qgs')
        answers = allow_all(catalogue)
        del answers['Parcels']
        self.assertNotIn('Parcels', by_id(apply_access(catalogue, answers)))


class APersonsCatalogue(unittest.TestCase):
    def setUp(self) -> None:
        self.catalogue, self.text = served('server-publishing', 'publishing.qgs')

    def person(self, **answers: LayerAnswer) -> tuple[dict, dict[str, LayerAnswer]]:
        answers_by_name = allow_all(self.catalogue, **answers)
        return apply_access(self.catalogue, answers_by_name), answers_by_name

    def test_leaves_out_a_layer_they_may_not_read(self) -> None:
        theirs, answers = self.person(Survey_notes=LayerAnswer(read=False))
        self.assertNotIn('Survey notes', by_id(theirs))
        self.assertNotIn('./collections/Survey%20notes.json', [link['href'] for link in theirs['links']])
        self.assertEqual(leak_failures(theirs, self.text, SERVER_ADDRESS, answers), [])

    def test_leaves_out_a_field_they_may_not_see(self) -> None:
        fields = {column['name'] for column in by_id(self.catalogue)['Parcels']['table:columns']} - {'zone_code'}
        theirs, answers = self.person(Parcels=LayerAnswer(fields=frozenset(fields)))
        parcels = by_id(theirs)['Parcels']
        self.assertNotIn('zone_code', [column['name'] for column in parcels['table:columns']])
        self.assertEqual(leak_failures(theirs, self.text, SERVER_ADDRESS, answers), [])

    def test_drops_the_display_field_and_locks_where_an_expression_names_a_hidden_field(self) -> None:
        catalogue = by_id(self.catalogue)
        catalogue['Parcels']['quac:display_field'] = 'zone_code'
        catalogue['Parcels']['quac:locks'] = {'delete': {'expression': '"zone_code" = \'R1\''}}
        fields = {column['name'] for column in catalogue['Parcels']['table:columns']} - {'zone_code'}
        parcels = by_id(apply_access(self.catalogue, allow_all(self.catalogue, Parcels=LayerAnswer(fields=frozenset(fields)))))['Parcels']
        self.assertNotIn('quac:display_field', parcels)
        self.assertEqual(parcels['quac:locks']['delete'], True)

    def test_locks_each_edit_they_may_not_make(self) -> None:
        theirs, answers = self.person(Parcels=LayerAnswer(insert=False, delete=False))
        parcels = by_id(theirs)['Parcels']
        self.assertEqual((parcels['quac:locks']['add'], parcels['quac:locks']['delete']), (True, True))
        self.assertTrue(parcels['quac:editable'])
        self.assertEqual(leak_failures(theirs, self.text, SERVER_ADDRESS, answers), [])

    def test_a_layer_they_may_not_edit_at_all_is_not_editable(self) -> None:
        theirs, _ = self.person(Parcels=LayerAnswer(insert=False, update=False, delete=False))
        parcels = by_id(theirs)['Parcels']
        self.assertEqual(parcels['quac:locks'], {'add': True, 'attributes': True, 'geometry': True, 'delete': True})
        self.assertFalse(parcels['quac:editable'])

    def test_works_the_extent_out_again_from_the_layers_left(self) -> None:
        catalogue = by_id(self.catalogue)
        catalogue['Parcels']['extent']['spatial']['bbox'] = [[115.8, -32.0, 115.9, -31.9]]
        catalogue['Survey notes']['extent']['spatial']['bbox'] = [[0, 0, 1, 1]]
        self.catalogue['extent'] = {'spatial': {'bbox': [[0, -32.0, 115.9, 1]]}, 'temporal': {'interval': [[None, None]]}}
        theirs, _ = self.person(Survey_notes=LayerAnswer(read=False))
        self.assertEqual(theirs['extent']['spatial']['bbox'], [[115.8, -32.0, 115.9, -31.9]])


class Groups(unittest.TestCase):
    def test_leaves_out_a_group_left_with_no_layer_they_may_read(self) -> None:
        catalogue, text = served('server-groups', 'groups.qgs')
        answers = allow_all(catalogue)
        answers['monitoring_sites'] = LayerAnswer(read=False)
        theirs = apply_access(catalogue, answers)
        water = theirs['catalogs'][0]
        self.assertNotIn('catalogs', water)
        self.assertNotIn('monitoring', [link['href'].split('/')[2] for link in water['links'] if link['rel'] == 'child' and '/catalogs/' in link['href']])
        self.assertEqual(leak_failures(theirs, text, SERVER_ADDRESS, answers), [])


class Combining(unittest.TestCase):
    def test_two_layers_under_one_name_allow_only_what_both_allow(self) -> None:
        combined = LayerAnswer(insert=False, fields=frozenset({'a', 'b'})).combine(LayerAnswer(delete=False, fields=frozenset({'b', 'c'})))
        self.assertEqual(combined, LayerAnswer(insert=False, delete=False, fields=frozenset({'b'})))
        self.assertEqual(LayerAnswer().combine(LayerAnswer(fields=frozenset({'a'}))).fields, frozenset({'a'}))


class TheAccessChecksBite(unittest.TestCase):
    def test_finds_what_the_person_may_not_see_or_do(self) -> None:
        catalogue, text = served('server-publishing', 'publishing.qgs')
        answers = allow_all(catalogue, Survey_notes=LayerAnswer(read=False), Parcels=LayerAnswer(insert=False, fields=frozenset({'parcel_id'})))
        failures = leak_failures(catalogue, text, SERVER_ADDRESS, answers)
        self.assertTrue(any('may not read' in failure for failure in failures))
        self.assertTrue(any('may not see' in failure for failure in failures))
        self.assertTrue(any('leaves add unlocked' in failure for failure in failures))


if __name__ == '__main__':
    unittest.main()
