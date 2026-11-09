"""The endpoint's answer, cache and version warning, which need no QGIS module (`quac_catalogue/catalogue.py`)."""

from __future__ import annotations

import json
import unittest

from quac_catalogue.catalogue import FAILURE_MESSAGE, CatalogueCache, answer, version_warning


class Builds:
    def __init__(self) -> None:
        self.count = 0

    def __call__(self) -> dict:
        self.count += 1
        return {'type': 'Catalog', 'id': f'build-{self.count}'}


class SharedCopy(unittest.TestCase):
    def test_a_second_request_is_served_from_the_cache(self) -> None:
        cache, build = CatalogueCache(), Builds()
        first = answer(('project.qgs', 't1'), True, build, cache)
        second = answer(('project.qgs', 't1'), True, build, cache)
        self.assertEqual((first.cache, second.cache, build.count), ('miss', 'hit', 1))
        self.assertEqual(first.body, second.body)

    def test_an_edited_project_is_built_again(self) -> None:
        cache, build = CatalogueCache(), Builds()
        answer(('project.qgs', 't1'), True, build, cache)
        edited = answer(('project.qgs', 't2'), True, build, cache)
        self.assertEqual((edited.cache, json.loads(edited.body)['id']), ('miss', 'build-2'))

    def test_with_an_access_plugin_giving_a_key_every_request_is_built_and_none_kept(self) -> None:
        cache, build = CatalogueCache(), Builds()
        answer(('project.qgs', 't1'), True, build, cache)
        first = answer(('project.qgs', 't1'), False, build, cache)
        second = answer(('project.qgs', 't1'), False, build, cache)
        self.assertEqual((first.cache, second.cache, build.count), ('off', 'off', 3))
        self.assertNotEqual(first.body, second.body)
        self.assertEqual(len(cache), 1)

    def test_keeps_the_most_recently_served(self) -> None:
        cache, build = CatalogueCache(size=2), Builds()
        for key in ('a', 'b', 'a', 'c'):
            answer(key, True, build, cache)
        self.assertEqual([answer(key, True, build, cache).cache for key in ('a', 'c', 'b')], ['hit', 'hit', 'miss'])


class FailsClosed(unittest.TestCase):
    def test_answers_a_message_and_no_catalogue(self) -> None:
        def broken() -> dict:
            raise ValueError('The server address must be an http or https address')

        cache = CatalogueCache()
        result = answer('project.qgs', True, broken, cache)
        self.assertEqual((result.status, result.body.decode(), result.cache), (500, FAILURE_MESSAGE, 'failed'))
        self.assertIn('ValueError', result.error)
        self.assertEqual(len(cache), 0)


class VersionWarning(unittest.TestCase):
    def test_warns_only_for_a_project_saved_by_a_newer_major_version(self) -> None:
        warning = version_warning('4.2.3', '3.44.15-Solothurn')
        self.assertIn('QGIS 4.2.3', warning)
        self.assertIn('Save the project with QGIS 3, or upgrade the server.', warning)
        self.assertIsNone(version_warning('3.40.1', '3.44.15-Solothurn'))
        self.assertIsNone(version_warning('3.44.15-Solothurn', '4.2.3'))
        self.assertIsNone(version_warning(None, '3.44.15-Solothurn'))


if __name__ == '__main__':
    unittest.main()
