"""
The port stays file for file with the JavaScript: every module in `packages/quac/src/parse/` and
`generate/` has a Python module of the same name in `quac_server/`, and each
function it exports has a Python function of the same name, or
`port-exemptions.json` says why not. An exemption for something that has a
counterpart, or that no longer exists, fails too, so the list stays true.
"""

from __future__ import annotations

import importlib
import json
import re
import unittest
from pathlib import Path

from .declared import QUAC_PACKAGE

EXEMPTIONS = json.loads((Path(__file__).resolve().parents[1] / 'port-exemptions.json').read_text(encoding='utf-8'))
FOLDERS = ('parse', 'generate')
_EXPORTED_FUNCTION = re.compile(r'^export (?:async )?function (\w+)', re.MULTILINE)


def python_name(name: str) -> str:
    """`parseQgsXml` as Python names it: `parse_qgs_xml`."""
    return re.sub(r'(?<=[a-z0-9])([A-Z])', r'_\1', name).lower()


def javascript_modules() -> list[str]:
    """Each module as `parse/parseQgsXml.ts`, tests left out."""
    source = QUAC_PACKAGE / 'src'
    return sorted(f'{folder}/{path.name}' for folder in FOLDERS for path in (source / folder).glob('*.ts') if not path.name.endswith('.test.ts'))


def exported_functions(module: str) -> list[str]:
    return _EXPORTED_FUNCTION.findall((QUAC_PACKAGE / 'src' / module).read_text(encoding='utf-8'))


def defines(python_module, name: str) -> bool:
    """Whether the Python module defines `name` itself, not only imports it."""
    value = getattr(python_module, python_name(name), None)
    return value is not None and getattr(value, '__module__', None) == python_module.__name__


def counterpart(module: str):
    folder, file_name = module.split('/')
    name = f'quac_server.{folder}.{python_name(file_name[:-3])}'
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as error:
        # Only the module itself being absent; a counterpart that fails to import is an error.
        if error.name != name:
            raise
        return None


class PortIsFileForFile(unittest.TestCase):
    def test_finds_the_javascript(self) -> None:
        self.assertIn('generate/serverStacCatalogue.ts', javascript_modules())

    def test_every_module_has_a_counterpart_or_an_exemption(self) -> None:
        missing = [module for module in javascript_modules() if counterpart(module) is None and module not in EXEMPTIONS['modules']]
        self.assertEqual(missing, [], 'add a Python module of the same name, or an entry in port-exemptions.json with its reason')

    def test_every_exported_function_has_a_counterpart_or_an_exemption(self) -> None:
        missing = []
        for module in javascript_modules():
            python_module = counterpart(module)
            if python_module is None:
                continue
            exempt = EXEMPTIONS['functions'].get(module, {})
            missing += [f'{module} {name}' for name in exported_functions(module) if not defines(python_module, name) and name not in exempt]
        self.assertEqual(missing, [], 'add a Python function of the same name, or an entry in port-exemptions.json with its reason')

    def test_every_exemption_is_still_needed(self) -> None:
        modules = javascript_modules()
        stale = [module for module in EXEMPTIONS['modules'] if module not in modules or counterpart(module) is not None]
        for module, functions in EXEMPTIONS['functions'].items():
            python_module = counterpart(module) if module in modules else None
            exported = exported_functions(module) if module in modules else []
            stale += [f'{module} {name}' for name in functions if name not in exported or (python_module is not None and defines(python_module, name))]
        self.assertEqual(stale, [], 'remove the exemption: the JavaScript is gone or the Python now has it')


if __name__ == '__main__':
    unittest.main()
