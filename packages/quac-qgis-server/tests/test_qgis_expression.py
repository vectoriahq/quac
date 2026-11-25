"""`quac_server/parse/qgis_expression.py` gives the answers `qgisExpression.ts` saved in `answers/qgisExpression.json`, under each set of options."""

from __future__ import annotations

import unittest
from typing import Any

from quac_server.parse.parse_measurement import MeasureFactors
from quac_server.parse.qgis_expression import (
    expression_to_geo_styler_function,
    expression_to_template,
    is_qgis_condition_filter,
    qgis_condition_to_filter,
    read_current_value_fields,
    read_expression_fields,
    read_layer_lookups,
    read_qgis_expression,
    unescape_string_literal,
)

from .answers import as_json, load

ANSWERS = load('qgisExpression')
_KEYWORDS = {'currentValue': 'current_value', 'geometry': 'geometry', 'aggregates': 'aggregates', 'lookups': 'lookups', 'variables': 'variables', 'coordinates': 'coordinates'}


def keywords_of(options: dict[str, Any]) -> dict[str, Any]:
    """The JavaScript's options as `read_qgis_expression`'s keyword arguments, a unit's factors as `MeasureFactors`."""
    out = {_KEYWORDS[name]: value for name, value in options.items()}
    if isinstance(out.get('geometry'), dict):
        out['geometry'] = MeasureFactors(area=out['geometry']['area'], distance=out['geometry']['distance'])
    return out


OPTIONS = {name: keywords_of(options) for name, options in ANSWERS['options'].items()}


def read(expression: str, options: dict[str, Any]) -> Any:
    node = read_qgis_expression(expression, **options)
    return node and {
        'node': node,
        'geoStyler': expression_to_geo_styler_function(node),
        'template': expression_to_template(node),
        'fields': read_expression_fields(node),
        'currentValueFields': read_current_value_fields(node),
        'lookups': read_layer_lookups(node),
    }


class QgisExpressionAgrees(unittest.TestCase):
    def test_reads_each_expression_under_each_set_of_options(self) -> None:
        self.assertGreater(len(ANSWERS['expressions']), 0)
        for case in ANSWERS['expressions']:
            for group in case['reads']:
                for name in group['options']:
                    with self.subTest(expression=case['expression'], options=name):
                        self.assertEqual(as_json(read(case['expression'], OPTIONS[name])), group['read'])

    def test_writes_each_condition_as_a_filter(self) -> None:
        hectares = OPTIONS['hectares']['geometry']
        for case in ANSWERS['expressions']:
            with self.subTest(expression=case['expression']):
                self.assertEqual(as_json(qgis_condition_to_filter(case['expression'])), case['condition'])
                self.assertEqual(as_json(qgis_condition_to_filter(case['expression'], hectares)), case['conditionInHectares'])

    def test_tells_a_condition_filter(self) -> None:
        for case in ANSWERS['conditionFilters']:
            with self.subTest(filter=case['filter']):
                self.assertEqual(is_qgis_condition_filter(case['filter']), case['isCondition'])

    def test_unescapes_each_literal(self) -> None:
        for case in ANSWERS['literals']:
            with self.subTest(text=case['text']):
                self.assertEqual(unescape_string_literal(case['text']), case['unescaped'])


if __name__ == '__main__':
    unittest.main()
