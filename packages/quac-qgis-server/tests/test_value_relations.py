"""
A Value Relation widget through to `quac:value_relation`: the cases
`valueRelation.test.ts` checks the JavaScript against, on the project's own
catalogue, then the server route's rules (the lookup named by its WMS name,
and dropped where it is not served or uses a hidden field) and a person's
catalogue, each run through the leak checks.
"""

from __future__ import annotations

import unittest
from typing import Any, Optional

from quac.access import LayerAnswer, apply_access
from quac_server import generate_server_stac_catalogue, parse_qgs_xml
from quac_server.generate.stac_catalogue import generate_stac_catalogue

from .declared import FIXTURES
from .leaks import leak_failures

TREES_ID = 'street_trees_5b1d0a72_4e33_4c1a_9f6d_2c8b7a1e4d90'
INSPECTIONS_ID = 'tree_inspections_0a4f9c81_7b26_4f55_8ad3_16e0f9b25c47'
SPECIES_FIELD = '<field configurationFlags="NoFlag" name="species"/>'
SERVER = 'https://qgis.example.test/ows'
FIXTURE = (FIXTURES / 'related-datasets' / 'street-trees.qgs').read_text(encoding='utf-8')


def widget_xml(**options: tuple[str, str]) -> str:
    """The options QGIS writes for a Value Relation on the Inspections table, as `valueRelation.test.ts` writes them, overridden by `options`."""
    every: dict[str, tuple[str, str]] = {
        'Layer': ('QString', INSPECTIONS_ID),
        'LayerName': ('QString', 'Inspections'),
        'LayerSource': ('QString', './tree-inspections.geojson'),
        'LayerProviderName': ('QString', 'ogr'),
        'Key': ('QString', 'inspection_id'),
        'Value': ('QString', 'condition'),
        'Group': ('QString', ''),
        'DisplayGroupName': ('bool', 'false'),
        'Description': ('QString', ''),
        'AllowMulti': ('bool', 'false'),
        'NofColumns': ('int', '1'),
        'AllowNull': ('bool', 'false'),
        'OrderByValue': ('bool', 'false'),
        'OrderByKey': ('bool', 'true'),
        'OrderByField': ('bool', 'false'),
        'OrderByFieldName': ('QString', ''),
        'OrderByDescending': ('bool', 'false'),
        'FilterExpression': ('QString', ''),
        'UseCompleter': ('bool', 'false'),
        'CompleterMatchFlags': ('int', '1'),
        **options,
    }
    entries = ''.join(f'<Option type="{kind}" value="{value}" name="{name}"/>' for name, (kind, value) in every.items())
    return f'<field configurationFlags="NoFlag" name="species"><editWidget type="ValueRelation"><config><Option type="Map">{entries}</Option></config></editWidget></field>'


def with_widget(xml: str = FIXTURE, **options: tuple[str, str]) -> str:
    return xml.replace(SPECIES_FIELD, widget_xml(**options))


def published(xml: str, restricted: tuple[str, ...] = ()) -> str:
    """Both layers published for WFS, and those named left out of WMS."""
    def values(name: str, items: tuple[str, ...]) -> str:
        return f'<{name} type="QStringList">' + ''.join(f'<value>{item}</value>' for item in items) + f'</{name}>'
    return xml.replace('</qgis>', f'<properties>{values("WFSLayers", (TREES_ID, INSPECTIONS_ID))}{values("WMSRestrictedLayers", restricted)}</properties></qgis>')


def hide_from_wfs(xml: str, field: str) -> str:
    """Ticks Do not expose via WFS for one of the Inspections table's fields."""
    old = f'<field configurationFlags="NoFlag" name="{field}"/>'
    assert xml.count(old) == 1
    return xml.replace(old, f'<field configurationFlags="HideFromWfs" name="{field}"/>')


def collections(catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    found = {collection['id']: collection for collection in catalog.get('collections', [])}
    for child in catalog.get('catalogs', []):
        found.update(collections(child))
    return found


def species_relation(catalog: dict[str, Any], trees: str) -> Optional[dict[str, Any]]:
    columns = collections(catalog)[trees].get('table:columns', [])
    return next(column for column in columns if column['name'] == 'species').get('quac:value_relation')


def project_relation(xml: str) -> Optional[dict[str, Any]]:
    return species_relation(generate_stac_catalogue(parse_qgs_xml(xml)), TREES_ID)


class OnTheProjectsCatalogue(unittest.TestCase):
    def test_names_the_lookups_collection_key_and_value_and_nothing_at_its_default(self) -> None:
        self.assertEqual(project_relation(with_widget()), {'collection': INSPECTIONS_ID, 'key': 'inspection_id', 'value': 'condition'})

    def test_writes_the_filter_allow_null_allow_multiple_the_order_and_its_direction_where_set(self) -> None:
        relation = project_relation(with_widget(
            FilterExpression=('QString', '&quot;condition&quot; != \'Poor\''),
            AllowNull=('bool', 'true'),
            AllowMulti=('bool', 'true'),
            OrderByKey=('bool', 'false'),
            OrderByField=('bool', 'true'),
            OrderByFieldName=('QString', 'inspected'),
            OrderByDescending=('bool', 'true'),
        ))
        self.assertEqual(relation, {
            'collection': INSPECTIONS_ID,
            'key': 'inspection_id',
            'value': 'condition',
            'filter': '"condition" != \'Poor\'',
            'allow_null': True,
            'allow_multi': True,
            'order_by': 'field',
            'order_field': 'inspected',
            'descending': True,
        })

    def test_orders_by_value_ahead_of_another_field_and_by_key_where_no_field_is_named(self) -> None:
        by_value = project_relation(with_widget(OrderByKey=('bool', 'false'), OrderByValue=('bool', 'true'), OrderByField=('bool', 'true'), OrderByFieldName=('QString', 'inspected')))
        self.assertEqual(by_value.get('order_by'), 'value')
        self.assertNotIn('order_field', by_value)
        self.assertNotIn('order_by', project_relation(with_widget(OrderByKey=('bool', 'false'), OrderByField=('bool', 'true'))))

    def test_finds_the_lookup_by_name_where_no_layer_has_the_id_and_by_id_ahead_of_name(self) -> None:
        self.assertEqual(project_relation(with_widget(Layer=('QString', 'renamed_in_another_project')))['collection'], INSPECTIONS_ID)
        self.assertEqual(project_relation(with_widget(LayerName=('QString', 'Street trees')))['collection'], INSPECTIONS_ID)

    def test_writes_none_where_the_lookup_is_in_no_layer_or_the_widget_lacks_a_key_or_value(self) -> None:
        self.assertIsNone(project_relation(with_widget(Layer=('QString', 'gone'), LayerName=('QString', 'Gone'))))
        self.assertIsNone(project_relation(with_widget(Key=('QString', ''))))
        self.assertIsNone(project_relation(with_widget(Value=('QString', ''))))
        self.assertIsNone(project_relation(FIXTURE))


class OnTheServedCatalogue(unittest.TestCase):
    def serve(self, xml: str) -> dict[str, Any]:
        catalogue = generate_server_stac_catalogue(parse_qgs_xml(xml), SERVER)
        self.assertEqual(leak_failures(catalogue, xml, SERVER), [])
        return catalogue

    def test_names_the_lookup_by_its_wms_name(self) -> None:
        relation = species_relation(self.serve(published(with_widget())), 'Street trees')
        self.assertEqual(relation, {'collection': 'Inspections', 'key': 'inspection_id', 'value': 'condition'})

    def test_drops_it_where_the_lookup_is_left_out_of_wms(self) -> None:
        self.assertIsNone(species_relation(self.serve(published(with_widget(), restricted=('Inspections',))), 'Street trees'))

    def test_drops_it_where_it_uses_a_field_hidden_from_qgis_server(self) -> None:
        for hidden in ('inspection_id', 'condition', 'inspected'):
            with self.subTest(hidden=hidden):
                xml = hide_from_wfs(published(with_widget(OrderByKey=('bool', 'false'), OrderByField=('bool', 'true'), OrderByFieldName=('QString', 'inspected'))), hidden)
                self.assertIsNone(species_relation(self.serve(xml), 'Street trees'))

    def test_drops_it_where_its_filter_names_a_hidden_field(self) -> None:
        xml = hide_from_wfs(published(with_widget(FilterExpression=('QString', '&quot;inspected&quot; IS NOT NULL'))), 'inspected')
        self.assertIsNone(species_relation(self.serve(xml), 'Street trees'))


class InAPersonsCatalogue(unittest.TestCase):
    def setUp(self) -> None:
        self.xml = published(with_widget())
        self.catalogue = generate_server_stac_catalogue(parse_qgs_xml(self.xml), SERVER)

    def person(self, **inspections: Any) -> dict[str, Any]:
        answers = {'Street trees': LayerAnswer(), 'Inspections': LayerAnswer(**inspections)}
        served = apply_access(self.catalogue, answers)
        self.assertEqual(leak_failures(served, self.xml, SERVER, access=answers), [])
        return served

    def test_keeps_it_where_the_person_may_read_the_lookup_and_see_its_fields(self) -> None:
        self.assertIsNotNone(species_relation(self.person(), 'Street trees'))
        self.assertIsNotNone(species_relation(self.person(fields=frozenset({'inspection_id', 'condition'})), 'Street trees'))

    def test_drops_it_where_the_person_may_not_read_the_lookup(self) -> None:
        self.assertIsNone(species_relation(self.person(read=False), 'Street trees'))

    def test_drops_it_where_the_person_may_not_see_the_lookups_key_or_shown_field(self) -> None:
        for fields in ({'inspection_id'}, {'condition'}):
            with self.subTest(fields=fields):
                self.assertIsNone(species_relation(self.person(fields=frozenset(fields)), 'Street trees'))


if __name__ == '__main__':
    unittest.main()
