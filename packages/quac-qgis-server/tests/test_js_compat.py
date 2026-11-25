"""
The helpers that give JavaScript's answers in Python. Each expected value is
what Node 24 gave for the same input on 2026-11-07 (`URLSearchParams`,
`encodeURIComponent` and `Number`), and on 2026-11-25 for `Number.parseInt` and for a web map service's
address (`wmsEndpoint` and `wmtsEndpoint` in `packages/quac/src/model/`, which
take an address apart and write it again with the `URL` class).
"""

from __future__ import annotations

import math
import unittest

from quac_server.js_compat import encode_uri_component, js_number, js_parse_int, search_params_to_string, url_search_params
from quac_server.model.stac_wms import wms_endpoint
from quac_server.model.stac_wmts import wmts_endpoint

# An address, and `wmsEndpoint` and `wmtsEndpoint`'s answers for it.
ENDPOINTS = [
    ("https://maps.example.test/wms", "https://maps.example.test/wms", "https://maps.example.test/wms"),
    ("https://maps.example.test/wms?SERVICE=WMS&request=GetMap&map=parks", "https://maps.example.test/wms?map=parks", "https://maps.example.test/wms?map=parks"),
    ("https://maps.example.test/wms?map=a b&SERVICE=WMS", "https://maps.example.test/wms?map=a+b", "https://maps.example.test/wms?map=a+b"),
    ("https://maps.example.test/wms?map=a b", "https://maps.example.test/wms?map=a%20b", "https://maps.example.test/wms?map=a%20b"),
    ("HTTP://Maps.Example.Test:80/./x/../wms?Service=WMS#frag", "http://maps.example.test/wms", "http://maps.example.test/wms"),
    ("https://maps.example.test/wms?SERVICE=WMS", "https://maps.example.test/wms", "https://maps.example.test/wms"),
    ("https://maps.example.test/wms?", "https://maps.example.test/wms?", "https://maps.example.test/wms?"),
    ("https://maps.example.test/wms?&&SERVICE=WMS&&k", "https://maps.example.test/wms?k=", "https://maps.example.test/wms?k="),
    ("https://maps.example.test/wms?q=%zz&LAYERS=x", "https://maps.example.test/wms?q=%25zz", "https://maps.example.test/wms?q=%zz&LAYERS=x"),
    ("https://maps.example.test/wms?q=é&LAYERS=x", "https://maps.example.test/wms?q=%C3%A9", "https://maps.example.test/wms?q=%C3%A9&LAYERS=x"),
    ("https://maps.example.test/wms?q={a}&LAYERS=x", "https://maps.example.test/wms?q=%7Ba%7D", "https://maps.example.test/wms?q={a}&LAYERS=x"),
    ("https://maps.example.test/wms?q=a+b~*&LAYERS=x", "https://maps.example.test/wms?q=a+b%7E*", "https://maps.example.test/wms?q=a+b~*&LAYERS=x"),
    ("https://editor:secret@maps.example.test/wms", None, None),
    ("ftp://maps.example.test/wms", None, None),
    ("not an address", None, None),
    ("https://tiles.example.test/wmts/1.0.0/WMTSCapabilities.XML?SERVICE=WMTS#x", "https://tiles.example.test/wmts/1.0.0/WMTSCapabilities.XML", "https://tiles.example.test/wmts/1.0.0/WMTSCapabilities.XML?SERVICE=WMTS"),
    ("https://tiles.example.test/wmts?api_key=EXAMPLEKEY&SERVICE=WMTS&REQUEST=GetCapabilities&TileMatrix=3", "https://tiles.example.test/wmts?api_key=EXAMPLEKEY&TileMatrix=3", "https://tiles.example.test/wmts?api_key=EXAMPLEKEY"),
    ("https://tiles.example.test/wmts?key={api_key}&SERVICE=WMTS", "https://tiles.example.test/wmts?key=%7Bapi_key%7D", "https://tiles.example.test/wmts?key=%7Bapi_key%7D"),
]


class JavaScriptAnswers(unittest.TestCase):
    def test_search_params(self) -> None:
        self.assertEqual(search_params_to_string([('TYPENAMES', 'a b~*:é'), ('OUTPUTFORMAT', 'application/json')]), 'TYPENAMES=a+b%7E*%3A%C3%A9&OUTPUTFORMAT=application%2Fjson')

    def test_reads_search_params(self) -> None:
        self.assertEqual(url_search_params('?a=1&&b&c=x%3Dy+z&a=2'), [('a', '1'), ('b', ''), ('c', 'x=y z'), ('a', '2')])

    def test_web_map_service_endpoints(self) -> None:
        for address, wms, wmts in ENDPOINTS:
            with self.subTest(address=address):
                self.assertEqual((wms_endpoint(address), wmts_endpoint(address)), (wms, wmts))

    def test_encode_uri_component(self) -> None:
        self.assertEqual(encode_uri_component('Street trees: 2024/é'), 'Street%20trees%3A%202024%2F%C3%A9')

    def test_number(self) -> None:
        self.assertEqual([js_number(' 12.50 '), js_number('0x10'), js_number(''), js_number('1e3')], [12.5, 16, 0, 1000])
        self.assertTrue(math.isnan(js_number('abc')))
        self.assertIsInstance(js_number('1e3'), int)

    def test_parse_int(self) -> None:
        self.assertEqual([js_parse_int(text) for text in (' 12px', '-3', '+7', '0x10', '1e3', ' \xa0 5')], [12, -3, 7, 0, 1, 5])
        for text in ('', 'x1', None):
            self.assertTrue(math.isnan(js_parse_int(text)), text)


if __name__ == '__main__':
    unittest.main()
