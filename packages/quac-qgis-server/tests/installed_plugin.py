"""
The plugin as QGIS installs it, with its own copy of `quac_server` inside, so
a test can import a plugin module that reaches `quac_server` by a relative
import. It is laid out once per test run by `build_plugin.lay_out_plugin` and
imported under the name `installed_quac_catalogue`.
"""

from __future__ import annotations

import atexit
import importlib
import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path
from types import ModuleType

from build_plugin import CATALOGUE_PLUGIN, lay_out_plugin

PACKAGE_NAME = 'installed_quac_catalogue'


def installed_module(name: str) -> ModuleType:
    """The installed plugin's module `name`, such as `publish`."""
    if PACKAGE_NAME not in sys.modules:
        work = tempfile.mkdtemp()
        atexit.register(shutil.rmtree, work, True)
        plugin = lay_out_plugin(CATALOGUE_PLUGIN, Path(work))
        spec = importlib.util.spec_from_file_location(PACKAGE_NAME, plugin / '__init__.py', submodule_search_locations=[str(plugin)])
        assert spec is not None and spec.loader is not None
        package = importlib.util.module_from_spec(spec)
        sys.modules[PACKAGE_NAME] = package
        spec.loader.exec_module(package)
    return importlib.import_module(f'{PACKAGE_NAME}.{name}')
