from __future__ import annotations

import io
import unittest
import zipfile

from quac_server import parse_qgs_xml, read_project_xml


def zipped(entries: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, text in entries.items():
            archive.writestr(name, text)
    return buffer.getvalue()


class ReadProjectXml(unittest.TestCase):
    def test_reads_a_qgs_as_text(self) -> None:
        self.assertEqual(read_project_xml('a.qgs', '﻿<qgis/>'.encode('utf-8')), '<qgis/>')

    def test_reads_the_qgs_inside_a_qgz(self) -> None:
        body = zipped({'a.qgd': 'not the project', 'a.qgs': '<qgis version="3.44"/>'})
        self.assertEqual(read_project_xml('a.qgz', body), '<qgis version="3.44"/>')

    def test_refuses_a_qgz_that_is_not_a_zip(self) -> None:
        with self.assertRaisesRegex(ValueError, 'not a valid zip'):
            read_project_xml('a.qgz', b'<qgis/>')

    def test_refuses_a_qgz_with_no_project(self) -> None:
        with self.assertRaisesRegex(ValueError, 'holds no .qgs'):
            read_project_xml('a.qgz', zipped({'a.qgd': ''}))


class ParseQgsXml(unittest.TestCase):
    def test_refuses_a_document_that_is_not_a_project(self) -> None:
        with self.assertRaisesRegex(ValueError, 'Expected <qgis>'):
            parse_qgs_xml('<map/>')

    def test_refuses_text_that_is_not_xml(self) -> None:
        with self.assertRaisesRegex(ValueError, 'Failed to parse'):
            parse_qgs_xml('<qgis>')


if __name__ == '__main__':
    unittest.main()
