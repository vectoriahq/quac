"""
Each layer's data asset and web map link in the project file's catalogue
(`generate_stac_catalogue`) is the one the JavaScript wrote: for every
whole-project fixture, the `data` asset and the `wms`, `wmts` and `xyz` links
of each Collection in the `<name>.catalogue.json` saved beside it
(`packages/quac/src/tests/catalogueGoldens.test.ts`), with the Projection and
Web Map Links extensions where it lists them, and for every QGIS project among
the per-field examples, the `quac:` fields of each data asset and web map link
in its `expected.json` (`packages/quac/src/tests/firstTier.test.ts`). The
served catalogue gives none of them (`test_catalogues.py`, `test_leaks.py`).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any, Iterator

from quac_server import parse_qgs_xml, read_project_xml
from quac_server.generate.stac_catalogue import generate_stac_catalogue
from quac_server.model.stac_projection import PROJECTION_EXTENSION
from quac_server.model.stac_wms import WEB_MAP_LINKS_EXTENSION

from .declared import FIXTURES, QUAC_PACKAGE

EXAMPLES = QUAC_PACKAGE / 'spec' / 'examples'

# The links the Web Map Links extension defines that a QGIS layer's Collection takes.
WEB_MAP_RELS = ('wms', 'wmts', 'xyz')


def _collections(catalog: dict[str, Any]) -> Iterator[dict[str, Any]]:
    yield from catalog.get('collections', [])
    for child in catalog.get('catalogs', []):
        yield from _collections(child)


def _data_assets(collection: dict[str, Any]) -> dict[str, Any]:
    return {key: asset for key, asset in (collection.get('assets') or {}).items() if 'data' in (asset.get('roles') or [])}


def _web_map_links(collection: dict[str, Any]) -> list[dict[str, Any]]:
    return [link for link in collection.get('links') or [] if link.get('rel') in WEB_MAP_RELS]


def _quac_fields(value: dict[str, Any]) -> dict[str, Any]:
    return {name: item for name, item in value.items() if name.startswith('quac:')}


def _catalogue_of(path: Path) -> dict[str, Any]:
    return generate_stac_catalogue(parse_qgs_xml(read_project_xml(path.name, path.read_bytes())))


class DataAssetsMatchTheJavaScript(unittest.TestCase):
    def test_every_fixture(self) -> None:
        projects = sorted(FIXTURES.glob('*/*.qgs'))
        self.assertTrue(projects)
        for path in projects:
            saved = {collection['id']: collection for collection in _collections(json.loads(path.with_suffix('.catalogue.json').read_text(encoding='utf-8')))}
            written = list(_collections(_catalogue_of(path)))
            with self.subTest(project=str(path.relative_to(FIXTURES))):
                self.assertEqual([collection['id'] for collection in written], list(saved))
            for collection in written:
                with self.subTest(project=str(path.relative_to(FIXTURES)), collection=collection['id']):
                    expected = saved[collection['id']]
                    self.assertEqual(_data_assets(collection), _data_assets(expected))
                    self.assertEqual(_web_map_links(collection), _web_map_links(expected))
                    for extension in (PROJECTION_EXTENSION, WEB_MAP_LINKS_EXTENSION):
                        self.assertEqual(extension in collection.get('stac_extensions', []), extension in expected.get('stac_extensions', []), extension)

    def test_writes_data_assets_for_the_fixtures(self) -> None:
        written = [asset for path in sorted(FIXTURES.glob('*/*.qgs')) for collection in _collections(_catalogue_of(path)) for asset in _data_assets(collection).values()]
        self.assertIn('./street-trees.geojson', [asset['href'] for asset in written])
        self.assertTrue(any(asset['href'].startswith('https://') for asset in written))
        self.assertIn('XYZ tile template', [asset.get('title') for asset in written])

    def test_writes_each_kind_of_web_map_link_for_the_fixtures(self) -> None:
        links = [link for path in sorted(FIXTURES.glob('*/*.qgs')) for collection in _collections(_catalogue_of(path)) for link in _web_map_links(collection)]
        self.assertEqual({link['rel'] for link in links}, set(WEB_MAP_RELS))
        self.assertEqual({link['wmts:encoding'] for link in links if link['rel'] == 'wmts'}, {'kvp', 'rest'})

    def test_every_qgis_example(self) -> None:
        checked = 0
        for manifest_path in sorted(EXAMPLES.glob('*/example.json')):
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            if manifest['source'] != 'qgis-project':
                continue
            expected = {collection['id']: collection for collection in _collections(json.loads((manifest_path.parent / 'expected.json').read_text(encoding='utf-8')))}
            for collection in _collections(_catalogue_of(manifest_path.parent / manifest['input'])):
                with self.subTest(example=manifest_path.parent.name, collection=collection['id']):
                    data = _data_assets(collection)
                    quac_fields = {key: {name: value for name, value in asset.items() if name.startswith('quac:')} for key, asset in data.items()}
                    shown = {key: fields for key, fields in (expected[collection['id']].get('assets') or {}).items() if key in data or key == 'data'}
                    self.assertEqual({key: fields for key, fields in quac_fields.items() if fields}, shown)
                    # The example shows a link by its `rel` and its `quac:` fields, and only where it has one.
                    links = [{'rel': link['rel'], **_quac_fields(link)} for link in _web_map_links(collection) if _quac_fields(link)]
                    self.assertEqual(links, _web_map_links(expected[collection['id']]))
                    checked += 1
        self.assertGreater(checked, 0)


if __name__ == '__main__':
    unittest.main()
