"""
The project- and layer-level settings in the project file's catalogue
(`generate_stac_catalogue`) are the ones the JavaScript wrote: for every
whole-project fixture, those of the `<name>.catalogue.json` saved beside it
(`packages/quac/src/tests/catalogueGoldens.test.ts`), and for every QGIS
project among the per-field examples, those of its `expected.json`
(`packages/quac/src/tests/firstTier.test.ts`), given the initial view that test
gives. A style's `quac:categorised_field`, which the JavaScript writes on a
style asset pointing into the project file, is compared with the style of the
same name the Python reads (`parse_layer_styles`), which the QGIS Desktop part
writes on its QML style asset (`test_publish.py`). The served catalogue gives
none of these fields (`test_catalogues.py`).
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any, Iterator, Optional

from quac_server import parse_qgs_xml, read_project_xml
from quac_server.generate.stac_catalogue import QUAC_CATEGORISED_FIELD, generate_stac_catalogue
from quac_server.model.qgs_project import BoundingBox, QgsProject

from .declared import FIXTURES, QUAC_PACKAGE

EXAMPLES = QUAC_PACKAGE / 'spec' / 'examples'

CATALOG_FIELDS = ('quac:initial_view', 'quac:active_collection')
COLLECTION_FIELDS = (
    'quac:related_to',
    'quac:private',
    'quac:filters',
    'quac:legend_image',
    'quac:icon',
    'quac:added_message',
    'quac:max_zoom',
    'quac:wfs_endpoint',
    'quac:wfs_type_name',
    'quac:wfs_srs_name',
    'quac:arcgis_layer_url',
    'quac:arcgis_where',
)
COLUMN_FIELDS = ('quac:icon', 'quac:color')


def _collections(catalog: dict[str, Any]) -> Iterator[dict[str, Any]]:
    yield from catalog.get('collections', [])
    for child in catalog.get('catalogs', []):
        yield from _collections(child)


def _pick(value: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {name: value[name] for name in fields if name in value}


def settings(catalog: dict[str, Any]) -> dict[str, Any]:
    """
    The catalogue's settings this test compares: the Catalog's, and each
    Collection's and its columns', by Collection id. A column is listed only
    where it has one, as an example shows only a column with a `quac:` field.
    """
    return {
        'catalog': _pick(catalog, CATALOG_FIELDS),
        'collections': {
            collection['id']: {
                **_pick(collection, COLLECTION_FIELDS),
                'columns': [{'name': column['name'], **_pick(column, COLUMN_FIELDS)} for column in collection.get('table:columns') or [] if _pick(column, COLUMN_FIELDS)],
            }
            for collection in _collections(catalog)
        },
    }


def _style_fields(catalog: dict[str, Any]) -> dict[str, dict[str, Optional[str]]]:
    """Each Collection's style assets' `quac:categorised_field`, by Collection id and style title."""
    return {
        collection['id']: {asset['title']: asset.get(QUAC_CATEGORISED_FIELD) for asset in (collection.get('assets') or {}).values() if 'style' in (asset.get('roles') or [])}
        for collection in _collections(catalog)
    }


def _parsed_style_fields(project: QgsProject, expected: dict[str, dict[str, Optional[str]]]) -> dict[str, dict[str, Optional[str]]]:
    """The categorised field of the Python's style of each title `expected` lists, by Collection id."""
    layers = {layer.id: layer for layer in project.layers}
    return {
        collection_id: {title: next((style.categorised_field for style in layers[collection_id].styles if style.name == title), 'no such style') for title in titles}
        for collection_id, titles in expected.items()
    }


def _project_of(path: Path) -> QgsProject:
    return parse_qgs_xml(read_project_xml(path.name, path.read_bytes()))


def _initial_view(project: QgsProject, manifest: dict[str, Any]) -> Optional[BoundingBox]:
    """The initial view `firstTier.test.ts` gives: the canvas extent where the example asks and the canvas is in WGS84, the conversion being none."""
    extent = project.map_extent
    if not manifest.get('canvasAsInitialView') or extent is None or extent.crs != 'EPSG:4326':
        return None
    return BoundingBox(extent.xmin, extent.ymin, extent.xmax, extent.ymax)


class ProjectSettingsMatchTheJavaScript(unittest.TestCase):
    def test_every_fixture(self) -> None:
        projects = sorted(FIXTURES.glob('*/*.qgs'))
        self.assertTrue(projects)
        for path in projects:
            with self.subTest(project=str(path.relative_to(FIXTURES))):
                saved = json.loads(path.with_suffix('.catalogue.json').read_text(encoding='utf-8'))
                project = _project_of(path)
                self.assertEqual(settings(generate_stac_catalogue(project)), settings(saved))
                styles = _style_fields(saved)
                self.assertEqual(_parsed_style_fields(project, styles), styles)

    def test_every_qgis_example(self) -> None:
        checked = 0
        for manifest_path in sorted(EXAMPLES.glob('*/example.json')):
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            if manifest['source'] != 'qgis-project':
                continue
            with self.subTest(example=manifest_path.parent.name):
                expected = json.loads((manifest_path.parent / 'expected.json').read_text(encoding='utf-8'))
                project = _project_of(manifest_path.parent / manifest['input'])
                self.assertEqual(settings(generate_stac_catalogue(project, initial_view=_initial_view(project, manifest))), settings(expected))
                styles = _style_fields_of_example(expected)
                self.assertEqual(_parsed_style_fields(project, styles), styles)
                checked += 1
        self.assertGreater(checked, 0)

    def test_the_comparisons_cover_every_field(self) -> None:
        """Each field compared is written somewhere among the fixtures and examples, so one the Python stopped writing fails above."""
        saved = [json.loads(path.with_suffix('.catalogue.json').read_text(encoding='utf-8')) for path in FIXTURES.glob('*/*.qgs')]
        examples = [
            json.loads((path.parent / 'expected.json').read_text(encoding='utf-8'))
            for path in EXAMPLES.glob('*/example.json')
            if json.loads(path.read_text(encoding='utf-8'))['source'] == 'qgis-project'
        ]
        seen: set[str] = set()
        for catalog in [*saved, *examples]:
            found = settings(catalog)
            seen.update(found['catalog'])
            for collection in found['collections'].values():
                seen.update(name for name in collection if name != 'columns')
                seen.update(f'column {name}' for column in collection['columns'] for name in column if name != 'name')
        styles = [*(_style_fields(catalog) for catalog in saved), *(_style_fields_of_example(catalog) for catalog in examples)]
        if any(field for by_title in styles for fields in by_title.values() for field in fields.values()):
            seen.add(QUAC_CATEGORISED_FIELD)
        self.assertEqual(seen, {*CATALOG_FIELDS, *COLLECTION_FIELDS, *(f'column {name}' for name in COLUMN_FIELDS), QUAC_CATEGORISED_FIELD})


def _style_fields_of_example(expected: dict[str, Any]) -> dict[str, dict[str, Optional[str]]]:
    """
    An example's style assets' `quac:categorised_field`, by Collection id and
    asset key: an example shows only an asset with a `quac:` field, by its key,
    which for a style is its title.
    """
    return {
        collection['id']: {key: asset[QUAC_CATEGORISED_FIELD] for key, asset in (collection.get('assets') or {}).items() if QUAC_CATEGORISED_FIELD in asset}
        for collection in _collections(expected)
        if any(QUAC_CATEGORISED_FIELD in asset for asset in (collection.get('assets') or {}).values())
    }


if __name__ == '__main__':
    unittest.main()
