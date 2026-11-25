"""
What the plugin's QGIS Desktop part writes when a project is saved
(`quac_catalogue/publish.py`): the documents and their paths, the data hrefs
and the folder rules, the styles, the settings' paths, what an earlier
catalogue leaves to remove, and the message shown. The projects are made up,
apart from the whole-project fixtures, every one of which is checked for an
absolute path or a password in what it would write.
"""

from __future__ import annotations

import io
import json
import ntpath
import posixpath
import re
import unittest
import zipfile
from typing import Any, Iterator, Optional
from xml.sax.saxutils import escape, quoteattr

from .declared import FIXTURES
from .installed_plugin import installed_module

publish = installed_module('publish')

PROJECT_FOLDER = '/work/Parks Project'
PUBLISH_FOLDER = '/work/Parks Project/publish'
QML = b'<!DOCTYPE qgis PUBLIC \'http://mrcc.com/qgis.dtd\' \'SYSTEM\'>\n<qgis version="3.34.4"><renderer-v2 type="singleSymbol"/></qgis>\n'


def layer_xml(layer_id: str, name: str, source: str, provider: str = 'ogr', fields: tuple[str, ...] = ('id', 'name'), value_relation: Optional[tuple[str, str]] = None) -> str:
    """One `<maplayer>`; `value_relation` is the field and the lookup's layer id."""
    field_xml = []
    for field in fields:
        widget = ''
        if value_relation and value_relation[0] == field:
            widget = (
                '<editWidget type="ValueRelation"><config><Option type="Map">'
                f'<Option type="QString" value={quoteattr(value_relation[1])} name="Layer"/>'
                '<Option type="QString" value="id" name="Key"/><Option type="QString" value="name" name="Value"/>'
                '</Option></config></editWidget>'
            )
        field_xml.append(f'<field configurationFlags="NoFlag" name={quoteattr(field)}>{widget}</field>')
    return f'''
    <maplayer type="vector" geometry="Point" wkbType="Point" readOnly="0" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="100000000">
      <id>{escape(layer_id)}</id>
      <datasource>{escape(source)}</datasource>
      <layername>{escape(name)}</layername>
      <wgs84extent><xmin>115.8</xmin><ymin>-32.0</ymin><xmax>115.9</xmax><ymax>-31.9</ymax></wgs84extent>
      <srs><spatialrefsys nativeFormat="Wkt"><authid>EPSG:4326</authid></spatialrefsys></srs>
      <provider encoding="UTF-8">{escape(provider)}</provider>
      <fieldConfiguration>{''.join(field_xml)}</fieldConfiguration>
      <previewExpression>"name"</previewExpression>
    </maplayer>'''


def web_layer_xml(layer_id: str, name: str, source: str, provider: str = 'wms') -> str:
    """One raster `<maplayer>` read from a web map service."""
    return f'''
    <maplayer type="raster" hasScaleBasedVisibilityFlag="0" maxScale="0" minScale="100000000">
      <id>{escape(layer_id)}</id>
      <datasource>{escape(source)}</datasource>
      <layername>{escape(name)}</layername>
      <provider encoding="">{escape(provider)}</provider>
    </maplayer>'''


def project_xml(groups: dict[str, list[tuple[str, str]]], layers: list[str], top: tuple[tuple[str, str], ...] = ()) -> bytes:
    """A project: `groups` maps a group's name to its layers' ids and names, and `top` lists layers outside any group."""
    tree = ''.join(f'<layer-tree-layer id={quoteattr(layer_id)} name={quoteattr(name)} checked="Qt::Checked"/>' for layer_id, name in top)
    for group, members in groups.items():
        inner = ''.join(f'<layer-tree-layer id={quoteattr(layer_id)} name={quoteattr(name)} checked="Qt::Checked"/>' for layer_id, name in members)
        tree += f'<layer-tree-group name={quoteattr(group)} checked="Qt::Checked">{inner}</layer-tree-group>'
    return f'''<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="Parks" version="3.34.4-Prizren">
  <title>Parks</title>
  <layer-tree-group>{tree}</layer-tree-group>
  <projectlayers>{''.join(layers)}</projectlayers>
</qgis>
'''.encode('utf-8')


PARKS = layer_xml('parks_1', 'Parks', './publish/vector/parks.geojson', value_relation=('kind', 'kinds_4'), fields=('id', 'name', 'kind'))
PLAYGROUNDS = layer_xml('playgrounds_2', 'Playgrounds', './publish/vector/playgrounds.gpkg|layername=playgrounds')
TRAILS = layer_xml('trails_3', 'Trails', '../Shared data/trails.geojson')
KINDS = layer_xml('kinds_4', 'Kinds', './publish/lookups/kinds.geojson')


def parks_project(*, kinds: str = KINDS, trails: str = TRAILS) -> bytes:
    return project_xml(
        {'Recreation': [('parks_1', 'Parks'), ('playgrounds_2', 'Playgrounds')], 'Base maps': [('trails_3', 'Trails')]},
        [PARKS, PLAYGROUNDS, trails, kinds],
        top=(('kinds_4', 'Kinds'),),
    )


def plan(project: bytes, *, folder: str = PUBLISH_FOLDER, project_folder: str = PROJECT_FOLDER, existing: Optional[dict[str, bytes]] = None, styles: Optional[dict[str, Any]] = None, field_types: Optional[dict[str, Any]] = None, file_name: str = 'Parks.qgz', path: Any = posixpath):
    return publish.plan_publication(file_name, qgz(project) if file_name.endswith('.qgz') else project, field_types or {}, {}, project_folder, folder, styles or {}, (existing or {}).get, path)


def qgz(project: bytes) -> bytes:
    """The project as QGIS stores a `.qgz`: a zip holding the `.qgs`."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('Parks.qgs', project)
    return buffer.getvalue()


def documents(publication) -> dict[str, dict[str, Any]]:
    return {name: json.loads(data) for name, data in publication.files if name.endswith('.json')}


def collection(publication, layer_id: str) -> tuple[str, dict[str, Any]]:
    return next((name, document) for name, document in documents(publication).items() if document.get('id') == layer_id and document['type'] == 'Collection')


def resolve(document_path: str, href: str) -> str:
    return posixpath.normpath(posixpath.join(posixpath.dirname(document_path), href))


def strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from strings(item)


class Names(unittest.TestCase):
    def test_root_and_folder_are_named_after_the_project(self) -> None:
        self.assertEqual(publish.catalogue_names('Parks.qgz'), ('Parks.stac.json', 'Parks.stac'))
        self.assertEqual(publish.catalogue_names('/work/Parks Project/Parks.QGS'), ('Parks.stac.json', 'Parks.stac'))
        self.assertEqual(publish.catalogue_names('C:\\work\\Parks.qgs'), ('Parks.stac.json', 'Parks.stac'))

    def test_a_character_no_file_name_may_hold_becomes_an_underscore(self) -> None:
        self.assertEqual(publish.catalogue_names('Parks: north.qgz'), ('Parks_ north.stac.json', 'Parks_ north.stac'))


class FolderSetting(unittest.TestCase):
    def test_the_project_folder_is_saved_as_empty(self) -> None:
        self.assertEqual(publish.folder_setting(PROJECT_FOLDER, PROJECT_FOLDER, posixpath), '')
        self.assertEqual(publish.folder_setting(PROJECT_FOLDER, '', posixpath), '')
        self.assertEqual(publish.chosen_folder(PROJECT_FOLDER, '', posixpath), PROJECT_FOLDER)

    def test_a_folder_is_saved_relative_to_the_project_and_read_back(self) -> None:
        for folder in (PUBLISH_FOLDER, '/work/Shared', '/elsewhere/out'):
            setting = publish.folder_setting(PROJECT_FOLDER, folder, posixpath)
            self.assertFalse(setting.startswith('/'))
            self.assertEqual(publish.chosen_folder(PROJECT_FOLDER, setting, posixpath), folder)

    def test_windows_folders_are_saved_with_forward_slashes(self) -> None:
        self.assertEqual(publish.folder_setting('C:\\Users\\a\\Parks', 'C:\\Users\\a\\Parks\\publish\\web', ntpath), 'publish/web')
        self.assertEqual(publish.chosen_folder('C:\\Users\\a\\Parks', 'publish/web', ntpath), 'C:\\Users\\a\\Parks\\publish\\web')

    def test_a_folder_on_another_drive_is_saved_as_it_is(self) -> None:
        self.assertEqual(publish.folder_setting('C:\\Users\\a\\Parks', 'D:\\Shared\\out', ntpath), 'D:\\Shared\\out')
        self.assertEqual(publish.chosen_folder('C:\\Users\\a\\Parks', 'D:\\Shared\\out', ntpath), 'D:\\Shared\\out')


class Layout(unittest.TestCase):
    def setUp(self) -> None:
        self.publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', './publish/vector/trails.geojson')))

    def test_writes_the_documents_in_the_layer_tree(self) -> None:
        self.assertEqual(sorted(documents(self.publication)), [
            'Parks.stac.json',
            'Parks.stac/catalogs/base-maps/catalog.json',
            'Parks.stac/catalogs/base-maps/collections/trails_3.json',
            'Parks.stac/catalogs/recreation/catalog.json',
            'Parks.stac/catalogs/recreation/collections/parks_1.json',
            'Parks.stac/catalogs/recreation/collections/playgrounds_2.json',
            'Parks.stac/collections/kinds_4.json',
        ])
        self.assertIsNone(self.publication.refusal)
        self.assertEqual(self.publication.left_out, [])

    def test_writes_the_root_last(self) -> None:
        self.assertEqual(self.publication.files[-1][0], 'Parks.stac.json')

    def test_links_each_data_file_from_the_document_it_sits_in(self) -> None:
        name, parks = collection(self.publication, 'parks_1')
        self.assertEqual(parks['assets']['data']['href'], '../../../../vector/parks.geojson')
        self.assertEqual(resolve(name, parks['assets']['data']['href']), 'vector/parks.geojson')
        name, playgrounds = collection(self.publication, 'playgrounds_2')
        self.assertEqual(resolve(name, playgrounds['assets']['data']['href']), 'vector/playgrounds.gpkg')
        self.assertEqual(playgrounds['assets']['data']['quac:layer_name'], 'playgrounds')
        name, kinds = collection(self.publication, 'kinds_4')
        self.assertEqual(kinds['assets']['data']['href'], '../../lookups/kinds.geojson')

    def test_every_child_link_finds_its_document(self) -> None:
        written = documents(self.publication)
        for name, document in written.items():
            for link in document['links']:
                if link['rel'] in ('child', 'parent', 'root', 'self'):
                    self.assertIn(resolve(name, link['href']), written, f'{name} {link}')

    def test_keeps_the_value_relation_whose_lookup_is_written(self) -> None:
        _name, parks = collection(self.publication, 'parks_1')
        kind = next(column for column in parks['table:columns'] if column['name'] == 'kind')
        self.assertEqual(kind['quac:value_relation']['collection'], 'kinds_4')

    def test_writes_no_names_qgis_server_gives(self) -> None:
        for document in documents(self.publication).values():
            self.assertFalse([key for key in document if key.startswith('quac:qgis_server_')])

    def test_lists_the_quac_schema_where_a_document_carries_a_quac_field(self) -> None:
        for name, document in documents(self.publication).items():
            carries = any(key.startswith('quac:') for key in strings({key: value for key, value in document.items() if key != 'stac_extensions'}))
            listed = publish.QUAC_SCHEMA_URL in document.get('stac_extensions', [])
            self.assertEqual(listed, carries or name == 'Parks.stac.json', name)


class FieldTypes(unittest.TestCase):
    def test_gives_each_column_the_type_qgis_reports(self) -> None:
        publication = plan(parks_project(), field_types={'parks_1': {'id': {'type': 'qlonglong', 'typeName': 'Integer64'}, 'name': {'type': 'QString', 'typeName': 'String'}}})
        _name, parks = collection(publication, 'parks_1')
        columns = {column['name']: column for column in parks['table:columns']}
        self.assertEqual((columns['id']['type'], columns['id']['data_type']), ('long', 'int64'))
        self.assertEqual(columns['name']['type'], 'string')
        self.assertNotIn('type', columns['kind'])


class FolderRules(unittest.TestCase):
    def test_leaves_out_a_layer_whose_data_is_outside_the_chosen_folder(self) -> None:
        publication = plan(parks_project())
        self.assertEqual(publication.left_out, [publish.LeftOutLayer('Trails', publish.OUTSIDE_FOLDER)])
        self.assertFalse(any('trails' in name for name in documents(publication)))
        root = documents(publication)['Parks.stac.json']
        self.assertNotIn('Trails', json.dumps(documents(publication)))
        # The group it was alone in goes with it.
        self.assertEqual([link['title'] for link in root['links'] if link['rel'] == 'child'], ['Kinds', 'Recreation'])

    def test_drops_a_value_relation_whose_lookup_is_left_out_and_says_so(self) -> None:
        publication = plan(parks_project(kinds=layer_xml('kinds_4', 'Kinds', '../lookups/kinds.geojson')))
        _name, parks = collection(publication, 'parks_1')
        self.assertNotIn('quac:value_relation', next(column for column in parks['table:columns'] if column['name'] == 'kind'))
        self.assertEqual(publication.dropped_choices, [publish.DroppedChoices('Parks', 'kind', 'Kinds')])
        self.assertNotIn('kinds_4', json.dumps(documents(publication)))
        self.assertIn("Move Kinds's data into the chosen folder", ' '.join(publication.warnings()))

    def test_links_an_absolute_path_inside_the_chosen_folder_by_a_relative_one(self) -> None:
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', '/work/Parks Project/publish/vector/trails.geojson')))
        name, trails = collection(publication, 'trails_3')
        self.assertEqual(resolve(name, trails['assets']['data']['href']), 'vector/trails.geojson')

    def test_leaves_out_an_absolute_path_outside_the_chosen_folder(self) -> None:
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', '/work/Parks Project/trails.geojson')))
        self.assertIn(publish.LeftOutLayer('Trails', publish.OUTSIDE_FOLDER), publication.left_out)

    def test_leaves_out_a_path_that_climbs_out_and_back_in_only_where_it_ends_outside(self) -> None:
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', './publish/../publish/vector/trails.geojson')))
        self.assertEqual(publication.left_out, [])
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', './publish/../publish-old/trails.geojson')))
        self.assertEqual(publication.left_out, [publish.LeftOutLayer('Trails', publish.OUTSIDE_FOLDER)])

    def test_leaves_out_a_windows_path_on_a_system_with_no_drives(self) -> None:
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', 'C:/Users/a/Parks Project/publish/trails.geojson')))
        self.assertIn(publish.LeftOutLayer('Trails', publish.OUTSIDE_FOLDER), publication.left_out)

    def test_works_out_windows_paths_with_their_drives_and_either_slash(self) -> None:
        project = project_xml({}, [
            layer_xml('a_1', 'Absolute', 'C:/Users/a/Parks Project/publish/vector/a.geojson'),
            layer_xml('b_2', 'Backslashes', 'publish\\vector\\b.geojson'),
            layer_xml('c_3', 'Other case', 'c:/users/A/parks project/PUBLISH/vector/c.geojson'),
            layer_xml('d_4', 'Other drive', 'D:/Shared/d.geojson'),
            layer_xml('e_5', 'Network share', '//server/share/e.geojson'),
        ], top=(('a_1', 'Absolute'), ('b_2', 'Backslashes'), ('c_3', 'Other case'), ('d_4', 'Other drive'), ('e_5', 'Network share')))
        publication = plan(project, project_folder='C:\\Users\\a\\Parks Project', folder='C:\\Users\\a\\Parks Project\\publish', path=ntpath)
        self.assertEqual(publication.left_out, [publish.LeftOutLayer('Other drive', publish.OUTSIDE_FOLDER), publish.LeftOutLayer('Network share', publish.OUTSIDE_FOLDER)])
        for layer_id, file_name in (('a_1', 'vector/a.geojson'), ('b_2', 'vector/b.geojson'), ('c_3', 'vector/c.geojson')):
            name, written = collection(publication, layer_id)
            href = written['assets']['data']['href']
            self.assertNotRegex(href, r'[:\\]')
            self.assertEqual(resolve(name, href), file_name)

    def test_leaves_out_a_layer_held_in_a_database(self) -> None:
        source = "dbname='parks' host=db.example.test port=5432 user='editor' password='secret' table=\"public\".\"trails\" (geom)"
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', source, provider='postgres')))
        self.assertIn(publish.LeftOutLayer('Trails', publish.NOT_A_FILE), publication.left_out)

    def test_keeps_a_web_layer_without_a_password_and_leaves_out_one_with(self) -> None:
        open_wfs = "typename='parks:trails' url='https://maps.example.test/wfs' version='auto'"
        locked_wfs = "typename='parks:trails' url='https://editor:secret@maps.example.test/wfs' version='auto'"
        query_wfs = "typename='parks:trails' url='https://maps.example.test/wfs?password=secret' version='auto'"
        online = 'https://editor:secret@data.example.test/trails.geojson'
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', open_wfs, provider='WFS')))
        self.assertEqual(publication.left_out, [])
        self.assertTrue(collection(publication, 'trails_3')[1]['assets']['data']['href'].startswith('https://maps.example.test/wfs?'))
        for source, provider in ((locked_wfs, 'WFS'), (query_wfs, 'WFS'), (online, 'ogr')):
            with self.subTest(source=source):
                publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', source, provider=provider)))
                self.assertEqual(publication.left_out, [publish.LeftOutLayer('Trails', publish.HOLDS_CREDENTIALS)])
                self.assertNotIn('secret', json.dumps(documents(publication)))

    def test_keeps_each_web_map_layer_by_its_address(self) -> None:
        layers = {
            'wms_5': ('crs=EPSG:3857&format=image/png&layers=parcels&styles&url=https://maps.example.test/wms?SERVICE%3DWMS&version=1.3.0', 'wms', {'rel': 'wms', 'href': 'https://maps.example.test/wms', 'type': 'image/png', 'wms:layers': ['parcels'], 'wms:styles': [''], 'wms:transparent': True, 'wms:dimensions': {}, 'quac:wms_crs': 'EPSG:3857', 'quac:wms_version': '1.3.0'}),
            'wmts_6': ('format=image/jpeg&layers=imagery&styles=natural&tileMatrixSet=WebMercatorQuad&url=https://tiles.example.test/wmts/1.0.0/WMTSCapabilities.xml', 'wms', {'rel': 'wmts', 'href': 'https://tiles.example.test/wmts/1.0.0/WMTSCapabilities.xml', 'type': 'application/xml', 'wmts:layer': 'imagery', 'wmts:encoding': 'rest', 'quac:wmts_tile_matrix_set': 'WebMercatorQuad', 'quac:wmts_style': 'natural'}),
            'xyz_7': ('type=xyz&url=https://tiles.example.test/%7Bz%7D/%7Bx%7D/%7By%7D.png&zmax=19&zmin=0', 'wms', {'rel': 'xyz', 'href': 'https://tiles.example.test/{z}/{x}/{y}.png'}),
            'vector_8': ('type=xyz&url=https://tiles.example.test/%7Bz%7D/%7Bx%7D/%7By%7D.pbf&zmax=14&zmin=0', 'xyzvectortiles', {'rel': 'xyz', 'href': 'https://tiles.example.test/{z}/{x}/{y}.pbf', 'type': 'application/vnd.mapbox-vector-tile'}),
        }
        project = project_xml({}, [web_layer_xml(layer_id, layer_id, source, provider) for layer_id, (source, provider, _link) in layers.items()], top=tuple((layer_id, layer_id) for layer_id in layers))
        publication = publish.plan_publication('Parks.qgs', project, {}, {}, PROJECT_FOLDER, PROJECT_FOLDER, {}, {}.get, posixpath)
        self.assertEqual(publication.left_out, [])
        for layer_id, (_source, _provider, link) in layers.items():
            with self.subTest(layer=layer_id):
                written = collection(publication, layer_id)[1]
                self.assertEqual([item for item in written['links'] if item['rel'] not in ('self', 'parent', 'root')], [link, {'rel': 'via', 'href': '../../Parks.qgs', 'title': 'QGIS project'}])
                self.assertIn('https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json', written['stac_extensions'])
                self.assertEqual(written['assets'], {})
                self.assertFalse(written['quac:editable'])

    def test_keeps_an_xyz_template_addressed_by_quadkey_as_its_data_asset(self) -> None:
        project = project_xml({}, [web_layer_xml('aerial_5', 'Aerial', 'type=xyz&url=https://tiles.example.test/a%7Bq%7D.jpeg&zmax=19&zmin=1')], top=(('aerial_5', 'Aerial'),))
        written = collection(publish.plan_publication('Parks.qgs', project, {}, {}, PROJECT_FOLDER, PROJECT_FOLDER, {}, {}.get, posixpath), 'aerial_5')[1]
        self.assertEqual(written['assets']['data'], {'href': 'https://tiles.example.test/a{quadkey}.jpeg', 'title': 'XYZ tile template', 'roles': ['data']})
        self.assertEqual([item['rel'] for item in written['links']], ['self', 'parent', 'root', 'via'])

    def test_leaves_out_a_web_map_layer_whose_source_holds_credentials(self) -> None:
        for source, provider in (
            ('layers=parcels&styles&url=https://editor:secret@maps.example.test/wms', 'wms'),
            ('layers=parcels&password=secret&styles&url=https://maps.example.test/wms&username=editor', 'wms'),
            ('authcfg=ab12cd3&layers=parcels&styles&url=https://maps.example.test/wms', 'wms'),
            ('layers=parcels&styles&url=https://maps.example.test/wms?password%3Dsecret', 'wms'),
            ('layers=imagery&tileMatrixSet=WebMercatorQuad&url=https://editor:secret@tiles.example.test/wmts', 'wms'),
            ('authcfg=ab12cd3&type=xyz&url=https://tiles.example.test/%7Bz%7D/%7Bx%7D/%7By%7D.png', 'wms'),
            ('type=xyz&url=https://editor:secret@tiles.example.test/%7Bz%7D/%7Bx%7D/%7By%7D.pbf', 'xyzvectortiles'),
        ):
            with self.subTest(source=source):
                publication = plan(parks_project(trails=web_layer_xml('trails_3', 'Trails', source, provider)))
                self.assertEqual(publication.left_out, [publish.LeftOutLayer('Trails', publish.HOLDS_CREDENTIALS)])
                text = json.dumps(documents(publication))
                for word in ('secret', 'editor', 'ab12cd3', 'maps.example.test', 'tiles.example.test'):
                    self.assertNotIn(word, text)

    def test_keeps_an_online_file_by_its_address(self) -> None:
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', '/vsicurl/https://data.example.test/trails.geojson')))
        self.assertEqual(collection(publication, 'trails_3')[1]['assets']['data']['href'], 'https://data.example.test/trails.geojson')

    def test_leaves_out_a_layer_qgis_could_not_open(self) -> None:
        publication = publish.plan_publication('Parks.qgs', parks_project(trails=layer_xml('trails_3', 'Trails', './publish/vector/trails.geojson')), {}, {}, PROJECT_FOLDER, PUBLISH_FOLDER, {}, {}.get, posixpath, {'parks_1', 'playgrounds_2', 'trails_3'})
        self.assertEqual(publication.left_out, [publish.LeftOutLayer('Kinds', publish.NOT_OPENED)])
        self.assertNotIn('kinds_4', json.dumps(documents(publication)))
        self.assertEqual(publication.dropped_choices, [publish.DroppedChoices('Parks', 'kind', 'Kinds')])
        self.assertEqual(publish.message(publication), ('warning', (
            'Wrote the STAC catalogue Parks.stac.json. '
            'One layer was left out: Kinds (QGIS could not open its data). '
            'Choices that come from a layer left out were left out too: Parks (kind, from Kinds). '
            'To include a layer QGIS could not open, fix its data source in QGIS and save again.'
        )))
        self.assertIn('Kinds was left out: QGIS could not open its data.', publication.warnings())

    def test_keeps_a_web_map_layer_qgis_could_not_open_by_its_address(self) -> None:
        wms = 'crs=EPSG:3857&format=image/png&layers=parcels&styles&url=https://maps.example.test/wms'
        project = parks_project(trails=web_layer_xml('trails_3', 'Trails', wms))
        publication = publish.plan_publication('Parks.qgs', project, {}, {}, PROJECT_FOLDER, PUBLISH_FOLDER, {}, {}.get, posixpath, {'parks_1', 'playgrounds_2', 'kinds_4'})
        self.assertEqual(publication.left_out, [])
        links = [link for link in collection(publication, 'trails_3')[1]['links'] if link['rel'] == 'wms']
        self.assertEqual([link['href'] for link in links], ['https://maps.example.test/wms'])
        self.assertEqual(publish.message(publication), ('info', 'Wrote the STAC catalogue Parks.stac.json.'))

    def test_leaves_out_a_web_map_layer_qgis_could_not_open_whose_source_holds_credentials(self) -> None:
        wms = 'layers=parcels&styles&url=https://editor:secret@maps.example.test/wms'
        project = parks_project(trails=web_layer_xml('trails_3', 'Trails', wms))
        publication = publish.plan_publication('Parks.qgs', project, {}, {}, PROJECT_FOLDER, PUBLISH_FOLDER, {}, {}.get, posixpath, {'parks_1', 'playgrounds_2', 'kinds_4'})
        self.assertEqual(publication.left_out, [publish.LeftOutLayer('Trails', publish.HOLDS_CREDENTIALS)])
        self.assertNotIn('secret', json.dumps(documents(publication)))

    def test_counts_the_layers_written(self) -> None:
        publication = plan(parks_project())
        self.assertEqual((publication.layer_count, len(publication.left_out)), (3, 1))
        self.assertEqual(plan(parks_project(), project_folder='/work/Parks Project/a', folder='/work').layer_count, 4)

    def test_writes_the_project_link_only_where_the_project_is_in_the_chosen_folder(self) -> None:
        inside = plan(parks_project(), folder=PROJECT_FOLDER)
        name, parks = collection(inside, 'parks_1')
        via = [link for link in parks['links'] if link['rel'] == 'via']
        self.assertEqual(len(via), 1)
        self.assertEqual(resolve(name, via[0]['href']), 'Parks.qgz')
        self.assertEqual(via[0]['title'], 'QGIS project')
        outside = plan(parks_project())
        for document in documents(outside).values():
            self.assertFalse([link for link in document['links'] if link['rel'] == 'via'])
            self.assertNotIn('qgz', json.dumps(document))


class Styles(unittest.TestCase):
    def test_links_each_layers_style_beside_its_document(self) -> None:
        publication = plan(parks_project(), styles={'parks_1': publish.LayerStyle('default', QML), 'kinds_4': publish.LayerStyle('default', QML), 'trails_3': publish.LayerStyle('default', QML)})
        files = dict(publication.files)
        name, parks = collection(publication, 'parks_1')
        style = parks['assets']['default']
        self.assertEqual(style, {'href': '../../../styles/parks_1.qml', 'type': 'application/x-qgis-qml+xml', 'title': 'default', 'roles': ['style', 'default']})
        self.assertEqual(files[resolve(name, style['href'])], QML)
        name, kinds = collection(publication, 'kinds_4')
        self.assertEqual(resolve(name, kinds['assets']['default']['href']), 'Parks.stac/styles/kinds_4.qml')
        # A layer left out has no style written.
        self.assertNotIn('Parks.stac/styles/trails_3.qml', files)

    def test_a_style_named_after_the_data_asset_takes_another_key(self) -> None:
        publication = plan(parks_project(), styles={'parks_1': publish.LayerStyle('data', QML)})
        _name, parks = collection(publication, 'parks_1')
        self.assertEqual(parks['assets']['data']['roles'], ['data'])
        self.assertEqual(parks['assets']['data (2)']['title'], 'data')

    def test_two_collections_with_one_file_name_get_two_style_files(self) -> None:
        project = project_xml({'A': [('same', 'One')], 'B': [('SAME', 'Two')]}, [
            layer_xml('same', 'One', './publish/one.geojson'),
            layer_xml('SAME', 'Two', './publish/two.geojson'),
        ])
        publication = plan(project, styles={'same': publish.LayerStyle('default', QML), 'SAME': publish.LayerStyle('default', QML)})
        styles = sorted(name for name, _data in publication.files if name.endswith('.qml'))
        self.assertEqual(len({name.lower() for name in styles}), 2)

    def test_leaves_out_a_style_that_names_a_folder_on_this_computer(self) -> None:
        qml = b'<qgis><prop k="name" v="/work/Parks Project/symbols/tree.svg"/></qgis>'
        publication = plan(parks_project(), styles={'parks_1': publish.LayerStyle('default', qml)})
        self.assertEqual(publication.skipped_styles, ['Parks'])
        self.assertFalse([name for name, _data in publication.files if name.endswith('.qml')])
        self.assertNotIn('default', collection(publication, 'parks_1')[1]['assets'])


class AnEarlierCatalogue(unittest.TestCase):
    def test_leaves_a_root_that_is_not_a_quac_catalogue_alone(self) -> None:
        for existing in (b'not json', b'[]', json.dumps({'type': 'Collection'}).encode(), json.dumps({'type': 'Catalog', 'stac_extensions': []}).encode()):
            with self.subTest(existing=existing):
                publication = plan(parks_project(), existing={'Parks.stac.json': existing})
                self.assertEqual(publication.files, [])
                self.assertEqual(publication.removals, [])
                self.assertIn('Parks.stac.json in the chosen folder is not a QUAC catalogue', publication.refusal)

    def test_writes_over_a_quac_catalogue_of_an_earlier_schema_version(self) -> None:
        existing = json.dumps({'type': 'Catalog', 'stac_extensions': ['https://vectoriahq.github.io/quac/v0.1.0/schema.json'], 'links': []}).encode()
        self.assertIsNone(plan(parks_project(), existing={'Parks.stac.json': existing}).refusal)

    def test_removes_only_what_the_earlier_catalogue_linked_and_this_one_does_not(self) -> None:
        styles = {layer_id: publish.LayerStyle('default', QML) for layer_id in ('parks_1', 'playgrounds_2', 'trails_3', 'kinds_4')}
        first = plan(parks_project(trails=layer_xml('trails_3', 'Trails', './publish/vector/trails.geojson')), styles=styles)
        on_disk = dict(first.files)
        on_disk['Parks.stac/notes.txt'] = b'kept'
        on_disk['vector/trails.geojson'] = b'{}'
        second = plan(project_xml({'Recreation': [('parks_1', 'Parks'), ('playgrounds_2', 'Playgrounds')]}, [PARKS, PLAYGROUNDS, KINDS], top=(('kinds_4', 'Kinds'),)), existing=on_disk, styles=styles)
        self.assertEqual(second.removals, [
            'Parks.stac/catalogs/base-maps/catalog.json',
            'Parks.stac/catalogs/base-maps/collections/trails_3.json',
            'Parks.stac/styles/trails_3.qml',
        ])
        self.assertEqual(publish.emptied_folders(second.removals, 'Parks.stac'), ['Parks.stac/catalogs/base-maps/collections', 'Parks.stac/catalogs/base-maps', 'Parks.stac/catalogs', 'Parks.stac/styles'])

    def test_never_removes_outside_its_own_folder(self) -> None:
        root = {
            'type': 'Catalog', 'stac_extensions': [publish.QUAC_SCHEMA_URL],
            'links': [
                {'rel': 'child', 'href': './vector/parks.json'},
                {'rel': 'child', 'href': './Parks.stac/../other.json'},
                {'rel': 'child', 'href': '/etc/passwd.json'},
                {'rel': 'child', 'href': 'https://example.test/catalog.json'},
                {'rel': 'child', 'href': './Parks.stac/old%20layer.json'},
            ],
        }
        old_layer = {'type': 'Collection', 'links': [], 'assets': {'s': {'href': '../vector/parks.qml', 'roles': ['style']}, 't': {'href': './styles/old.qml', 'roles': ['style']}}}
        publication = plan(parks_project(), existing={'Parks.stac.json': json.dumps(root).encode(), 'Parks.stac/old layer.json': json.dumps(old_layer).encode()})
        self.assertEqual(publication.removals, ['Parks.stac/old layer.json', 'Parks.stac/styles/old.qml'])

    def test_does_not_remove_a_document_written_again_in_another_case(self) -> None:
        root = {'type': 'Catalog', 'stac_extensions': [publish.QUAC_SCHEMA_URL], 'links': [{'rel': 'child', 'href': './Parks.stac/collections/KINDS_4.json'}]}
        publication = plan(parks_project(), existing={'Parks.stac.json': json.dumps(root).encode()})
        self.assertEqual(publication.removals, [])


class Message(unittest.TestCase):
    def test_names_the_root_file_when_everything_was_written(self) -> None:
        publication = plan(parks_project(trails=layer_xml('trails_3', 'Trails', './publish/vector/trails.geojson')))
        self.assertEqual(publish.message(publication), ('info', 'Wrote the STAC catalogue Parks.stac.json.'))

    def test_lists_the_layers_left_out_in_one_warning(self) -> None:
        publication = plan(parks_project(kinds=layer_xml('kinds_4', 'Kinds', '../lookups/kinds.geojson')))
        level, text = publish.message(publication)
        self.assertEqual(level, 'warning')
        self.assertEqual(text, (
            'Wrote the STAC catalogue Parks.stac.json. '
            '2 layers were left out: Kinds (its data file is outside the chosen folder), Trails (its data file is outside the chosen folder). '
            'Choices that come from a layer left out were left out too: Parks (kind, from Kinds). '
            'To include a layer, move its data file into the chosen folder, or choose a folder that holds it.'
        ))

    def test_gives_the_refusal(self) -> None:
        level, text = publish.message(plan(parks_project(), existing={'Parks.stac.json': b'{}'}))
        self.assertEqual(level, 'warning')
        self.assertTrue(text.startswith('The STAC catalogue was not written'))


_ABSOLUTE = re.compile(r'(^|[\s"\'(=])(/(?!/)[^\s]|[A-Za-z]:[\\/]|\\\\|file:)')
_CREDENTIALS = re.compile(r'://[^/\s]*@|password|passwd|\bpwd\s*=|\buser(name)?\s*=|authcfg', re.IGNORECASE)


class NoPathOrPasswordIsWritten(unittest.TestCase):
    """No written document holds an absolute path, a folder of this computer, a user name or a password."""

    def check(self, publication, folders: tuple[str, ...]) -> None:
        for name, data in publication.files:
            text = data.decode('utf-8')
            for folder in folders:
                self.assertNotIn(folder, text, name)
            for value in strings(json.loads(text)) if name.endswith('.json') else [text]:
                self.assertIsNone(_ABSOLUTE.search(value), f'{name}: {value}')
                self.assertIsNone(_CREDENTIALS.search(value), f'{name}: {value}')

    def test_every_fixture(self) -> None:
        projects = sorted(path for pattern in ('*/*.qgs', '*/*.qgz') for path in FIXTURES.glob(pattern))
        self.assertTrue(projects)
        for path in projects:
            for project_folder, folder, module in (
                ('/home/someone/maps', '/home/someone/maps', posixpath),
                ('/home/someone/maps', '/home/someone/maps/publish', posixpath),
                ('C:\\Users\\someone\\maps', 'C:\\Users\\someone\\maps', ntpath),
            ):
                with self.subTest(project=str(path.relative_to(FIXTURES)), folder=folder):
                    publication = publish.plan_publication(path.name, path.read_bytes(), {}, {}, project_folder, folder, {}, {}.get, module)
                    self.assertTrue(publication.files)
                    self.check(publication, ('someone', 'Users'))

    def test_a_project_holding_passwords_and_absolute_paths(self) -> None:
        project = project_xml({}, [
            layer_xml('a_1', 'Database', "dbname='parks' host=db.example.test user='editor' password='secret' table=\"public\".\"a\" (geom)", provider='postgres'),
            layer_xml('b_2', 'Web', "typename='b' url='https://editor:secret@maps.example.test/wfs'", provider='WFS'),
            layer_xml('c_3', 'Online', 'https://editor:secret@data.example.test/c.geojson'),
            layer_xml('d_4', 'Elsewhere', '/home/someone/elsewhere/d.geojson'),
            layer_xml('e_5', 'Here', '/home/someone/maps/e.geojson'),
            layer_xml('f_6', 'Windows', 'C:/Users/someone/f.geojson'),
            layer_xml('g_7', 'Lookup user', './g.geojson', value_relation=('name', 'a_1')),
            web_layer_xml('h_8', 'WMS user', 'layers=a&styles&url=https://editor:secret@maps.example.test/wms'),
            web_layer_xml('i_9', 'WMS keys', 'layers=a&password=secret&styles&url=https://maps.example.test/wms&username=editor'),
            web_layer_xml('j_10', 'WMS sign-in', 'authcfg=ab12cd3&layers=a&styles&url=https://maps.example.test/wms'),
            web_layer_xml('k_11', 'WMS open', 'layers=a&styles&url=https://maps.example.test/wms'),
        ], top=(('a_1', 'Database'), ('b_2', 'Web'), ('c_3', 'Online'), ('d_4', 'Elsewhere'), ('e_5', 'Here'), ('f_6', 'Windows'), ('g_7', 'Lookup user'), ('h_8', 'WMS user'), ('i_9', 'WMS keys'), ('j_10', 'WMS sign-in'), ('k_11', 'WMS open')))
        publication = publish.plan_publication('Parks.qgs', project, {}, {}, '/home/someone/maps', '/home/someone/maps', {}, {}.get, posixpath)
        self.assertEqual([layer.name for layer in publication.left_out], ['Database', 'Web', 'Online', 'Elsewhere', 'Windows', 'WMS user', 'WMS keys', 'WMS sign-in'])
        self.assertIn('https://maps.example.test/wms', json.dumps(documents(publication)))
        self.check(publication, ('someone', 'secret', 'editor', 'ab12cd3'))


if __name__ == '__main__':
    unittest.main()
