"""`quac_server/parse/sql_feature_filter.py` gives the answers `sqlFeatureFilter.ts` saved in `answers/sqlFeatureFilter.json`: the same filters read, and the same features kept."""

from __future__ import annotations

import unittest

from quac_server.parse.sql_feature_filter import read_sql_feature_test

from .answers import load

ANSWERS = load('sqlFeatureFilter')


class SqlFeatureFilterAgrees(unittest.TestCase):
    def test_reads_each_filter_and_keeps_the_same_features(self) -> None:
        self.assertGreater(len(ANSWERS), 0)
        for case in ANSWERS:
            with self.subTest(expression=case['expression'], dialect=case['dialect']):
                feature_filter = {'expression': case['expression'], 'dialect': case['dialect']}
                test = read_sql_feature_test(feature_filter)
                self.assertEqual(test['kind'], case['kind'])
                if test['kind'] == 'unreadable':
                    self.assertEqual(test, {'kind': 'unreadable', 'expression': case['expression']})
                else:
                    self.assertIs(test['filter'], feature_filter)
                for feature in case['kept']:
                    kept = test['keeps'](feature['properties']) if test['kind'] == 'readable' else None
                    self.assertEqual(kept, feature['kept'], feature['properties'])


if __name__ == '__main__':
    unittest.main()
