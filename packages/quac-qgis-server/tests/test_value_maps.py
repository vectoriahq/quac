"""
A Value Map widget through to `quac:values` on the served column, for the
forms of the widget the per-field example does not hold: the cases
`fieldValueMaps.test.ts` checks the JavaScript against, and a field the
project hides from QGIS Server.
"""

from __future__ import annotations

import unittest

from quac_server import generate_server_stac_catalogue, parse_qgs_xml

SERVER = 'https://qgis.example.test/ows'
NULL_CODE = '{2839923C-8B7D-419E-B84B-CA2FE9B80EC7}'


def _served_columns(map_xml: str, flags: str = 'NoFlag') -> dict[str, dict]:
    """The served columns of a one-layer project whose `condition` field has a Value Map widget holding `map_xml`."""
    project = parse_qgs_xml(
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<qgis version="3.44.8-Solothurn" projectname="Maps">'
        '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
        '<projectlayers><maplayer type="vector" geometry="Point">'
        '<id>assets_1</id><layername>Assets</layername>'
        '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
        '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
        '<fieldConfiguration>'
        '<field name="asset_id" configurationFlags="NoFlag"><editWidget type="TextEdit"><config><Option/></config></editWidget></field>'
        f'<field name="condition" configurationFlags="{flags}">'
        f'<editWidget type="ValueMap"><config><Option type="Map">{map_xml}</Option></config></editWidget>'
        '</field></fieldConfiguration>'
        '</maplayer></projectlayers>'
        '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'
        '</qgis>'
    )
    collection = generate_server_stac_catalogue(project, SERVER)['collections'][0]
    return {column['name']: column for column in collection.get('table:columns', [])}


def _entry(label: str, value: str) -> str:
    return f'<Option type="Map"><Option type="QString" name="{label}" value="{value}"/></Option>'


class ValueMapOnAServedColumn(unittest.TestCase):
    def test_reads_the_blank_code_as_a_blank_entry(self) -> None:
        columns = _served_columns('<Option type="List" name="map">' + _entry('Good', 'G') + _entry('Not assessed', NULL_CODE) + '</Option>')
        self.assertEqual(columns['condition']['quac:values'], [{'value': 'G', 'label': 'Good'}, {'value': '', 'label': 'Not assessed'}])

    def test_reads_the_older_flat_form_one_entry_per_child(self) -> None:
        columns = _served_columns(
            '<Option type="Map" name="map">'
            '<Option type="QString" name="Good" value="G"/>'
            '<Option type="QString" name="Poor" value="P"/>'
            '</Option>'
        )
        self.assertEqual(columns['condition']['quac:values'], [{'value': 'G', 'label': 'Good'}, {'value': 'P', 'label': 'Poor'}])

    def test_leaves_out_an_entry_with_no_label_and_a_widget_with_no_entry(self) -> None:
        columns = _served_columns('<Option type="List" name="map">' + _entry('', 'X') + _entry('Good', 'G') + '</Option>')
        self.assertEqual(columns['condition']['quac:values'], [{'value': 'G', 'label': 'Good'}])
        self.assertNotIn('quac:values', _served_columns('<Option type="List" name="map"></Option>')['condition'])
        self.assertNotIn('quac:values', columns['asset_id'])

    def test_serves_no_list_for_a_field_hidden_from_qgis_server(self) -> None:
        columns = _served_columns('<Option type="List" name="map">' + _entry('Good', 'G') + '</Option>', flags='HideFromWfs')
        self.assertNotIn('condition', columns)


if __name__ == '__main__':
    unittest.main()
