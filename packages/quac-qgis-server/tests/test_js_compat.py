"""
The helpers that give JavaScript's answers in Python. Each expected value is
what Node 24 gave for the same input on 2026-11-07 (`URLSearchParams`,
`encodeURIComponent` and `Number`).
"""

from __future__ import annotations

import math
import unittest

from quac_server.js_compat import encode_uri_component, js_number, search_params_to_string


class JavaScriptAnswers(unittest.TestCase):
    def test_search_params(self) -> None:
        self.assertEqual(search_params_to_string([('TYPENAMES', 'a b~*:é'), ('OUTPUTFORMAT', 'application/json')]), 'TYPENAMES=a+b%7E*%3A%C3%A9&OUTPUTFORMAT=application%2Fjson')

    def test_encode_uri_component(self) -> None:
        self.assertEqual(encode_uri_component('Street trees: 2024/é'), 'Street%20trees%3A%202024%2F%C3%A9')

    def test_number(self) -> None:
        self.assertEqual([js_number(' 12.50 '), js_number('0x10'), js_number(''), js_number('1e3')], [12.5, 16, 0, 1000])
        self.assertTrue(math.isnan(js_number('abc')))
        self.assertIsInstance(js_number('1e3'), int)


if __name__ == '__main__':
    unittest.main()
