"""
`quac_server/parse/qt_date_format.py` gives the answers `qtDateFormat.ts`
saved in `answers/qtDateFormat.json`, in the time zone the JavaScript worked
them out in. Month and day names in a language other than `en-AU` are not
given (`port-exemptions.json`, departures), so for those the Python gives None.
"""

from __future__ import annotations

import datetime
import os
import time
import unittest
from typing import Any

from quac_server.parse.qt_date_format import format_qt_date_time, is_formattable_qt_date_pattern, qt_date_part, read_qt_date_time, split_qt_date_pattern

from .answers import as_json, load

ANSWERS = load('qtDateFormat')


def value_of(saved: Any) -> Any:
    """A saved value, with `{'date': milliseconds}` as the date-time the JavaScript passed as a `Date`."""
    if isinstance(saved, dict):
        return datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=saved['date'])
    return saved


def names_en_au(language: Any) -> bool:
    return not language or language.replace('_', '-').lower() == 'en-au'


@unittest.skipUnless(hasattr(time, 'tzset'), 'needs a time zone set for the process')
class QtDateFormatAgrees(unittest.TestCase):
    previous_zone: Any = None

    @classmethod
    def setUpClass(cls) -> None:
        cls.previous_zone = os.environ.get('TZ')
        os.environ['TZ'] = ANSWERS['timeZone']
        time.tzset()

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.previous_zone is None:
            os.environ.pop('TZ', None)
        else:
            os.environ['TZ'] = cls.previous_zone
        time.tzset()

    def test_splits_each_pattern(self) -> None:
        for case in ANSWERS['split']:
            with self.subTest(pattern=case['pattern']):
                self.assertEqual(split_qt_date_pattern(case['pattern']), case['pieces'])
                self.assertEqual(is_formattable_qt_date_pattern(case['pattern']), case['formattable'])

    def test_reads_each_value(self) -> None:
        for case in ANSWERS['read']:
            with self.subTest(value=case['value']):
                self.assertEqual(as_json(read_qt_date_time(value_of(case['value']))), case['moment'])

    def test_takes_each_part(self) -> None:
        for case in ANSWERS['datePart']:
            for part, expected in case['parts'].items():
                with self.subTest(value=case['value'], part=part):
                    self.assertEqual(qt_date_part(part, value_of(case['value'])), expected)

    def test_formats_each_moment(self) -> None:
        for case in ANSWERS['formatted']:
            moment = read_qt_date_time(value_of(case['value']))
            self.assertIsNotNone(moment)
            for pattern, expected in zip(ANSWERS['patterns'], case['texts']):
                with self.subTest(value=case['value'], language=case['language'], pattern=pattern):
                    text = format_qt_date_time(moment, pattern, case['language'])
                    self.assertEqual(text, expected if names_en_au(case['language']) else None)


if __name__ == '__main__':
    unittest.main()
