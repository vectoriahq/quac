"""`quac_server/parse/qt_regex.py` gives the answers `qtRegex.ts` saved in `answers/qtRegex.json`: the same patterns refused, and the same matches and replacements."""

from __future__ import annotations

import unittest

from quac_server.parse.qt_regex import compile_qt_regex, replace_qt_regex

from .answers import load

ANSWERS = load('qtRegex')


class QtRegexAgrees(unittest.TestCase):
    def test_reads_each_pattern_as_the_javascript_does(self) -> None:
        self.assertGreater(len(ANSWERS), 0)
        for case in ANSWERS:
            for form, unicode in (('unicode', True), ('ascii', False)):
                expected = case[form]
                with self.subTest(pattern=case['pattern'], unicode=unicode):
                    regex = compile_qt_regex(case['pattern'], unicode)
                    self.assertEqual(regex is None, expected is None)
                    if regex is None:
                        continue
                    for found in expected['matches']:
                        match = regex.search(found['text'])
                        got = match and {'index': match.start(), 'groups': [match.group(0), *match.groups()]}
                        self.assertEqual(got, found['match'], found['text'])
                    for replaced in expected['replaced']:
                        self.assertEqual(replace_qt_regex(replaced['text'], regex, replaced['after']), replaced['result'], replaced)


if __name__ == '__main__':
    unittest.main()
