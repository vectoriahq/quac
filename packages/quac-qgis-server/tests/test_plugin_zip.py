"""The plugin's zip holds what the QGIS plugin repository's validation asks of an upload."""

from __future__ import annotations

import re
import tempfile
import unittest
import zipfile
from pathlib import Path

from build_plugin import build_zip, read_metadata

# The fields QGIS's PyQGIS Developer Cookbook marks required in metadata.txt.
REQUIRED = ('name', 'qgisMinimumVersion', 'description', 'about', 'version', 'author', 'email', 'repository')


class PluginZipTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._work = tempfile.TemporaryDirectory()
        cls.archive = build_zip(Path(cls._work.name))
        with zipfile.ZipFile(cls.archive) as zip_file:
            cls.names = zip_file.namelist()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._work.cleanup()

    def test_is_named_for_the_version(self) -> None:
        self.assertEqual(self.archive.name, f"quac_catalogue-{read_metadata()['version']}.zip")

    def test_holds_one_folder_with_a_name_the_repository_accepts(self) -> None:
        folders = {name.split('/')[0] for name in self.names}
        self.assertEqual(folders, {'quac_catalogue'})
        self.assertRegex('quac_catalogue', r'^[A-Za-z_-][A-Za-z0-9_-]*$')

    def test_holds_the_files_the_repository_requires_and_the_python_it_runs(self) -> None:
        for name in ('metadata.txt', '__init__.py', 'LICENSE', 'quac_server/__init__.py'):
            self.assertIn(f'quac_catalogue/{name}', self.names)

    def test_holds_the_bandit_settings_beside_metadata(self) -> None:
        # The QGIS plugin repository reads `.bandit` only at the plugin's top level.
        self.assertIn('quac_catalogue/.bandit', self.names)

    def test_the_service_reports_the_version_in_metadata(self) -> None:
        service = (Path(__file__).resolve().parent.parent / 'quac_catalogue' / 'service.py').read_text(encoding='utf-8')
        reported = re.search(r"def version\(self\) -> str:\s*return '([^']+)'", service)
        self.assertIsNotNone(reported)
        self.assertEqual(reported.group(1), read_metadata()['version'])

    def test_holds_no_compiled_python(self) -> None:
        self.assertEqual([name for name in self.names if re.search(r'__pycache__|\.pyc$', name)], [])

    def test_metadata_has_every_required_field_and_its_icon(self) -> None:
        metadata = {key.lower(): value for key, value in read_metadata().items()}
        self.assertEqual([field for field in REQUIRED if not metadata.get(field.lower())], [])
        self.assertIn(f"quac_catalogue/{metadata['icon']}", self.names)


if __name__ == '__main__':
    unittest.main()
