"""
The project file's catalogue (`generate_stac_catalogue`) is the JavaScript's in
every Catalog and Collection `quac:` field and in the whole of each
Collection's `table:columns`: for every whole-project fixture, the
`<name>.catalogue.json` saved beside it
(`packages/quac/src/tests/catalogueGoldens.test.ts`), and for every QGIS
project among the per-field examples, its `expected.json`
(`packages/quac/src/tests/firstTier.test.ts`), which shows each `quac:` field
and each column that has one, given the initial view that test gives.

`DEPARTURES` lists the fields in those places that the Python writes
differently, with the reason; it is empty. What the Python writes differently
elsewhere is compared by other tests: the data assets and web map links by
`test_data_assets.py`, and a style's `quac:categorised_field`, which the
JavaScript writes on a style asset pointing into the project file, by
`test_project_settings.py`. The style assets, the `via` link, providers and
keywords are recorded under `generate/stacCatalogue.ts` in
`port-exemptions.json`'s departures.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any, Iterator, Optional

from quac_server import parse_qgs_xml, read_project_xml
from quac_server.generate.stac_catalogue import generate_stac_catalogue
from quac_server.model.qgs_project import BoundingBox, QgsProject

from .declared import FIXTURES, QUAC_PACKAGE

EXAMPLES = QUAC_PACKAGE / 'spec' / 'examples'

# The fields of a Catalog, a Collection or a column the Python writes differently, by place, with the reason.
DEPARTURES: dict[str, dict[str, str]] = {'catalog': {}, 'collection': {}, 'column': {}}

# The field and form settings a column carries, each of which the comparisons below must see written.
FORM_FIELDS = (
    'quac:attachment',
    'quac:checkbox',
    'quac:color',
    'quac:constraints',
    'quac:control',
    'quac:date_format',
    'quac:default',
    'quac:duplicate_policy',
    'quac:editable',
    'quac:editable_when',
    'quac:hidden',
    'quac:icon',
    'quac:in_form',
    'quac:label_on_top',
    'quac:range',
    'quac:reuse_last_value',
    'quac:searchable',
    'quac:value_relation',
    'quac:values',
    'quac:visible_when',
)


def _collections(catalog: dict[str, Any]) -> Iterator[dict[str, Any]]:
    yield from catalog.get('collections', [])
    for child in catalog.get('catalogs', []):
        yield from _collections(child)


def _quac(value: dict[str, Any], place: str) -> dict[str, Any]:
    return {name: item for name, item in value.items() if name.startswith('quac:') and name not in DEPARTURES[place]}


def _columns(collection: dict[str, Any]) -> list[dict[str, Any]]:
    return [{name: item for name, item in column.items() if name not in DEPARTURES['column']} for column in collection.get('table:columns') or []]


def whole(catalog: dict[str, Any]) -> dict[str, Any]:
    """A fixture's catalogue as compared: the Catalog's `quac:` fields, and each Collection's, with its whole `table:columns`, by id."""
    return {
        'catalog': _quac(catalog, 'catalog'),
        'collections': {collection['id']: {**_quac(collection, 'collection'), 'table:columns': _columns(collection)} for collection in _collections(catalog)},
    }


def shown(catalog: dict[str, Any]) -> dict[str, Any]:
    """A catalogue as an example shows it: the `quac:` fields of the Catalog and each Collection, and each column with a `quac:` field, by its name and those fields."""
    return {
        'catalog': _quac(catalog, 'catalog'),
        'collections': {
            collection['id']: {
                **_quac(collection, 'collection'),
                'table:columns': [{'name': column['name'], **_quac(column, 'column')} for column in collection.get('table:columns') or [] if _quac(column, 'column')],
            }
            for collection in _collections(catalog)
        },
    }


def _project_of(path: Path) -> QgsProject:
    return parse_qgs_xml(read_project_xml(path.name, path.read_bytes()))


def _initial_view(project: QgsProject, manifest: dict[str, Any]) -> Optional[BoundingBox]:
    """The initial view `firstTier.test.ts` gives: the canvas extent where the example asks and the canvas is in WGS84, the conversion being none."""
    extent = project.map_extent
    if not manifest.get('canvasAsInitialView') or extent is None or extent.crs != 'EPSG:4326':
        return None
    return BoundingBox(extent.xmin, extent.ymin, extent.xmax, extent.ymax)


def _qgis_examples() -> Iterator[tuple[Path, dict[str, Any]]]:
    for manifest_path in sorted(EXAMPLES.glob('*/example.json')):
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest['source'] == 'qgis-project':
            yield manifest_path.parent, manifest


class CatalogueAgreesWithTheJavaScript(unittest.TestCase):
    maxDiff = None

    def test_every_fixture(self) -> None:
        projects = sorted(FIXTURES.glob('*/*.qgs'))
        self.assertTrue(projects)
        for path in projects:
            with self.subTest(project=str(path.relative_to(FIXTURES))):
                saved = json.loads(path.with_suffix('.catalogue.json').read_text(encoding='utf-8'))
                self.assertEqual(whole(generate_stac_catalogue(_project_of(path))), whole(saved))

    def test_every_qgis_example(self) -> None:
        checked = 0
        for folder, manifest in _qgis_examples():
            with self.subTest(example=folder.name):
                expected = json.loads((folder / 'expected.json').read_text(encoding='utf-8'))
                project = _project_of(folder / manifest['input'])
                self.assertEqual(shown(generate_stac_catalogue(project, initial_view=_initial_view(project, manifest))), shown(expected))
                checked += 1
        self.assertGreater(checked, 0)

    def test_the_comparisons_see_every_form_setting(self) -> None:
        """Each field and form setting is written somewhere among the fixtures and examples, so one the Python stopped writing fails above."""
        catalogues = [json.loads(path.with_suffix('.catalogue.json').read_text(encoding='utf-8')) for path in FIXTURES.glob('*/*.qgs')]
        catalogues += [json.loads((folder / 'expected.json').read_text(encoding='utf-8')) for folder, _manifest in _qgis_examples()]
        seen = {name for catalog in catalogues for collection in _collections(catalog) for column in collection.get('table:columns') or [] for name in column}
        self.assertEqual(sorted(set(FORM_FIELDS) - seen), [])
        collection_fields = {name for catalog in catalogues for collection in _collections(catalog) for name in collection}
        self.assertLessEqual({'quac:form_order', 'quac:measurement'}, collection_fields)


if __name__ == '__main__':
    unittest.main()
