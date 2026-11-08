"""
QUAC for QGIS Server: given a QGIS project's stored text, the catalogue QGIS
Server serves for it, and the layer tree it publishes.

Python's standard library only, so it runs inside QGIS Server's own Python and
outside it. Each module under `parse/`, `generate/`, `model/` and `util/`
mirrors the JavaScript module of the same name in `packages/quac/src/`, except
`parse/xml_text.py` and `js_compat.py`, which give the answers the browser's
DOM and JavaScript's own functions give the JavaScript. The catalogue holds
the fields `declared_fields.json` lists, the plugin's first release.
"""

from __future__ import annotations

from typing import Any

from .generate.server_layer_tree import server_layer_tree
from .generate.server_stac_catalogue import generate_server_stac_catalogue
from .parse.parse_qgs_xml import parse_qgs_xml
from .parse.read_project_file import read_project_xml

__all__ = [
    'generate_server_stac_catalogue',
    'parse_qgs_xml',
    'read_project_xml',
    'read_server_catalogue',
    'read_server_layer_tree',
    'server_layer_tree',
]


def read_server_layer_tree(file_name: str, body: bytes) -> dict[str, Any]:
    """The server layer tree of a project file's bytes: a `.qgs`, or a `.qgz` or stored project's zip."""
    return server_layer_tree(parse_qgs_xml(read_project_xml(file_name, body)))


def read_server_catalogue(file_name: str, body: bytes, server_address: str) -> dict[str, Any]:
    """The catalogue a QGIS Server serves from `server_address` for a project file's bytes."""
    return generate_server_stac_catalogue(parse_qgs_xml(read_project_xml(file_name, body)), server_address)
