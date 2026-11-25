"""What the server route refuses, and the rules the saved catalogues cannot show."""

from __future__ import annotations

import json
import unittest

from quac_server import generate_server_stac_catalogue, parse_qgs_xml
from quac_server.generate.server_stac_catalogue import server_wms_endpoint
from quac_server.generate.stac_catalogue import generate_stac_catalogue, wms_excluded_layer_ids
from quac_server.parse.parse_data_source import parse_data_source

from .declared import FIXTURES

# The cases `serverStacCatalogue.test.ts` checks the JavaScript against.
SERVER_ADDRESSES = json.loads((FIXTURES.parent / 'server-addresses.json').read_text(encoding='utf-8'))['cases']


class ServerAddress(unittest.TestCase):
    def test_names_each_address_in_a_wms_link_as_the_javascript_does(self) -> None:
        self.assertGreater(len(SERVER_ADDRESSES), 0)
        for case in SERVER_ADDRESSES:
            with self.subTest(address=case['address']):
                self.assertEqual(server_wms_endpoint(case['address']), case['wms'])

    def test_refuses_an_address_holding_a_password_or_not_on_the_web(self) -> None:
        project = parse_qgs_xml((FIXTURES / 'related-datasets' / 'street-trees.qgs').read_text(encoding='utf-8'))
        for address in ('https://user:secret@qgis.example.com/ows', 'file:///projects/ows', 'https://qgis.example.com/ows?MAP=postgresql://user:secret@db/qgis'):
            with self.subTest(address=address), self.assertRaisesRegex(ValueError, 'no user name, password'):
                generate_server_stac_catalogue(project, address)


TREES_ID = 'street_trees_5b1d0a72_4e33_4c1a_9f6d_2c8b7a1e4d90'
INSPECTIONS_ID = 'tree_inspections_0a4f9c81_7b26_4f55_8ad3_16e0f9b25c47'
SERVER = 'https://qgis.example.com/ows'


def _published(xml: str, restricted: tuple[str, ...] = ()) -> str:
    """The street trees fixture with both layers published for WFS, and those named left out of WMS, as `serverStacCatalogue.test.ts` sets it up."""
    def values(name: str, items: tuple[str, ...]) -> str:
        return f'<{name} type="QStringList">' + ''.join(f'<value>{item}</value>' for item in items) + f'</{name}>'
    ids = (TREES_ID, INSPECTIONS_ID)
    transactions = f'<WFSTLayers>{values("Insert", ids)}{values("Update", ids)}{values("Delete", ids)}</WFSTLayers>'
    return xml.replace('</qgis>', f'<properties>{values("WFSLayers", ids)}{transactions}{values("WMSRestrictedLayers", restricted)}</properties></qgis>')


def _collections(catalog: dict) -> dict:
    found = {collection['id']: collection for collection in catalog.get('collections', [])}
    for child in catalog.get('catalogs', []):
        found.update(_collections(child))
    return found


class InputsFromQgisServer(unittest.TestCase):
    def setUp(self) -> None:
        self.xml = (FIXTURES / 'related-datasets' / 'street-trees.qgs').read_text(encoding='utf-8')

    def test_gives_each_column_the_type_qgis_server_reports(self) -> None:
        field_types = {TREES_ID: {'tree_id': {'type': 'qlonglong', 'typeName': 'Integer64'}, 'species': {'type': 'QString', 'typeName': 'String'}}}
        trees = _collections(generate_server_stac_catalogue(parse_qgs_xml(_published(self.xml)), SERVER, field_types=field_types))['Street trees']
        columns = {column['name']: column for column in trees['table:columns']}
        self.assertEqual((columns['tree_id']['type'], columns['tree_id']['data_type']), ('long', 'int64'))
        self.assertEqual((columns['species']['type'], columns['species']['data_type']), ('string', 'other'))
        self.assertEqual(sorted(name for name, column in columns.items() if 'type' in column), ['species', 'tree_id'])

    def test_takes_a_missing_box_from_qgis_server_and_covers_only_served_layers(self) -> None:
        from quac_server.model.qgs_project import BoundingBox
        project = parse_qgs_xml(_published(self.xml, restricted=('Inspections',)))
        layers = {layer.id: layer for layer in project.layers}
        layers[TREES_ID].wgs84_extent = None
        layers[INSPECTIONS_ID].wgs84_extent = BoundingBox(0, 0, 1, 1)
        served = generate_server_stac_catalogue(project, SERVER, layer_wgs84_extents={TREES_ID: BoundingBox(115.8, -32.0, 115.9, -31.9)})
        self.assertEqual(_collections(served)['Street trees']['extent']['spatial']['bbox'], [[115.8, -32.0, 115.9, -31.9]])
        self.assertEqual(served['extent']['spatial']['bbox'], [[115.8, -32.0, 115.9, -31.9]])


class DataSourceKinds(unittest.TestCase):
    def test_reads_each_source_of_an_image_provider_as_the_javascript_does(self) -> None:
        for source, provider, kind in (
            ('url=https://maps.example.com/wms&layers=roads', 'wms', 'wms'),
            ('layers=roads&tileMatrixSet=WebMercatorQuad&url=https://tiles.example.com/wmts', 'wms', 'wmts'),
            ('type=xyz&url=https://tiles.example.com/%7Bz%7D/%7Bx%7D/%7By%7D.png', 'wms', 'xyz'),
            ('type=xyz&url=https://tiles.example.com/%7Bz%7D/%7Bx%7D/%7By%7D.pbf', 'xyzvectortiles', 'xyz'),
            ('url=not an address&layers=roads', 'wms', 'unsupported'),
            ('authcfg=ab12cd3&url=https://maps.example.com/wms&layers=roads', 'wms', 'unsupported'),
            ('password=secret&username=editor&url=https://maps.example.com/wms&layers=roads', 'wms', 'unsupported'),
            ('url=https://editor:secret@maps.example.com/wms&layers=roads', 'wms', 'unsupported'),
            ('type=mbtiles&url=file:///tiles.mbtiles', 'wms', 'unsupported'),
            ('type=xyz&url=https://tiles.example.com/%7Bz%7D/%7Bx%7D.pbf', 'xyzvectortiles', 'unsupported'),
        ):
            with self.subTest(source=source):
                parsed = parse_data_source(source, provider)
                self.assertEqual(parsed.kind, kind)
                if kind == 'unsupported':
                    self.assertEqual(parsed.hint, provider)

    def test_reads_a_file_and_its_shape(self) -> None:
        source = parse_data_source('./notes.geojson|geometrytype=Point', 'ogr')
        self.assertEqual((source.kind, source.geometry_type_filter), ('file', 'Point'))


if __name__ == '__main__':
    unittest.main()


class LeftOutOfWms(unittest.TestCase):
    """The project file's catalogue leaves out what Exclude layers lists, as `stacCatalogue.test.ts` checks the JavaScript."""

    def _collection_ids(self, catalogue: dict) -> list[str]:
        ids = [collection['id'] for collection in catalogue.get('collections') or []]
        for child in catalogue.get('catalogs') or []:
            ids.extend(self._collection_ids(child))
        return ids

    def test_leaves_out_a_listed_group_with_every_layer_inside_it(self) -> None:
        project = parse_qgs_xml((FIXTURES / 'server-groups' / 'groups.qgs').read_text(encoding='utf-8'))
        staff_notes = next(layer for layer in project.layers if layer.name == 'Staff notes')
        catalogue = generate_stac_catalogue(project)
        self.assertEqual(wms_excluded_layer_ids(project), {staff_notes.id})
        self.assertNotIn(staff_notes.id, self._collection_ids(catalogue))
        self.assertNotIn('Internal', [child.get('title') for child in catalogue.get('catalogs') or []])

    def test_drops_a_value_relation_to_a_layer_it_leaves_out(self) -> None:
        project = parse_qgs_xml((FIXTURES / 'server-publishing' / 'publishing.qgs').read_text(encoding='utf-8'))
        zones = next(layer for layer in project.layers if layer.name == 'Zones')
        parcels = next(layer for layer in project.layers if layer.name == 'Parcels')
        catalogue = generate_stac_catalogue(project)
        self.assertNotIn(zones.id, self._collection_ids(catalogue))
        collection = next(c for c in catalogue.get('collections') or [] if c['id'] == parcels.id)
        self.assertNotIn(zones.id, json.dumps(collection))
