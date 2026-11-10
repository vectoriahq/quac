"""
Lays out the QUAC catalogue plugin as QGIS installs it, and zips it for the
QGIS plugin repository. Python's standard library only.

`python3 build_plugin.py <folder>` writes `quac_catalogue-<version>.zip` into
`<folder>` and prints its path. The zip holds one folder, `quac_catalogue/`,
with its own copy of `quac_server` inside, as an installed plugin needs.
"""

from __future__ import annotations

import configparser
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent
CATALOGUE_PLUGIN = PACKAGE / 'quac_catalogue'
LEFT_OUT = shutil.ignore_patterns('__pycache__', '*.pyc')


def lay_out_plugin(source: Path, plugins: Path) -> Path:
    """Copies the plugin folder `source` into `plugins`, with `quac_server` inside it, and returns the copy."""
    plugin = plugins / source.name
    shutil.copytree(source, plugin, ignore=LEFT_OUT)
    shutil.copytree(PACKAGE / 'quac_server', plugin / 'quac_server', ignore=LEFT_OUT)
    return plugin


def read_metadata(plugin: Path = CATALOGUE_PLUGIN) -> dict[str, str]:
    """The `[general]` section of a plugin's `metadata.txt`."""
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(plugin / 'metadata.txt', encoding='utf-8')
    return dict(parser['general'])


def build_zip(folder: Path) -> Path:
    """Writes the catalogue plugin's zip into `folder` and returns its path."""
    version = read_metadata()['version']
    archive = folder / f'{CATALOGUE_PLUGIN.name}-{version}.zip'
    with tempfile.TemporaryDirectory() as work:
        plugin = lay_out_plugin(CATALOGUE_PLUGIN, Path(work))
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for path in sorted(plugin.rglob('*')):
                if path.is_file():
                    zip_file.write(path, path.relative_to(work).as_posix())
    return archive


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python3 build_plugin.py <folder>')
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    print(build_zip(out))
