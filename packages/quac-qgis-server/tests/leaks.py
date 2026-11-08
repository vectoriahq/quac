"""
The leak checks a served catalogue must pass (`docs/plans/quac-separation.md`,
package 6), as one function, so that `test_leaks.py` runs them on every
fixture and `server/check_qgis_server.py` on what QGIS Server serves.

Given the catalogue, the project's text and the server address it was built
for, `leak_failures` returns a sentence for each thing the catalogue shows that
the project keeps off the web:

- a layer the project leaves out of WMS, or a group it leaves out, by id or name;
- a WFS address for a layer the project does not publish for WFS;
- a field the project hides from WMS or WFS, as a column, the display field or
  in a lock's expression;
- a connection detail or password from a layer's data source;
- a file-system path, or the name of a layer's data file.

The server address is the one string a catalogue may carry that names a
project, so every occurrence of it is set aside before the last two checks.
"""

from __future__ import annotations

import re
from typing import Any, Iterator, Optional

from quac_server import parse_qgs_xml, server_layer_tree
from quac_server.js_compat import encode_uri_component

# Links a catalogue makes between its own documents, which are relative by design.
_INTERNAL_LINKS = {'self', 'root', 'parent', 'child'}
_CONNECTION_DETAIL = re.compile(r'\b(password|passwd|pwd|dbname|host|user|authcfg)\s*=|postgres(ql)?://|\boracle:|\bmssql:', re.IGNORECASE)
_PASSWORD_IN_SOURCE = re.compile(r'''password\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))''', re.IGNORECASE)
_PATH = re.compile(r'^(/|\./|\.\./|~/|[A-Za-z]:[\\/])|file:|\\\\')
_DATA_FILE = re.compile(r'[^|/\\?]+\.(geojson|json|gpkg|shp|csv|sqlite|tif|tiff|kml|gml|qgs|qgz)\b', re.IGNORECASE)


def _strings(value: Any, skip_internal_links: bool = False) -> Iterator[str]:
    """Every string a JSON value holds, its own keys left out; a link between the catalogue's own documents is left out where asked."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item, skip_internal_links)
    elif isinstance(value, dict):
        if skip_internal_links and value.get('rel') in _INTERNAL_LINKS and isinstance(value.get('href'), str):
            value = {key: item for key, item in value.items() if key != 'href'}
        for item in value.values():
            yield from _strings(item, skip_internal_links)


def _collections(catalog: dict[str, Any]) -> Iterator[dict[str, Any]]:
    yield from catalog.get('collections', [])
    for child in catalog.get('catalogs', []):
        yield from _collections(child)


def _tree_nodes(nodes: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for node in nodes:
        yield node
        if node['kind'] == 'group':
            yield from _tree_nodes(node['children'])


def _mentions(text: str, field: str) -> bool:
    return re.search(rf'(^|[^A-Za-z0-9_]){re.escape(field)}(\Z|[^A-Za-z0-9_])', text) is not None


def leak_failures(catalogue: dict[str, Any], project_text: str, server_address: str, access: Optional[dict[str, Any]] = None) -> list[str]:
    """
    What the catalogue shows that the project keeps off the web, a sentence
    each; empty where it shows nothing. With `access`, a person's answers by
    WMS name (`quac_catalogue.access.LayerAnswer`), also what it shows that
    the person may not see, and an edit it leaves unlocked that they may not
    make.
    """
    project = parse_qgs_xml(project_text)
    tree = server_layer_tree(project)
    nodes = list(_tree_nodes(tree['children']))
    layers_by_id = {layer.id: layer for layer in project.layers}
    served_names = {node['wmsName'] for node in nodes if node['kind'] == 'layer' and node['wmsName']}
    served_names |= {layers_by_id[node['id']].name for node in nodes if node['kind'] == 'layer' and node['wmsName'] and node['id'] in layers_by_id}
    every_string = list(_strings(catalogue))
    hrefs = [link['href'] for link in _all_links(catalogue)]
    failures: list[str] = []

    for node in nodes:
        if node['kind'] == 'group' and not node['wmsPublished'] and node['name'] not in served_names:
            failures += _named(node['name'], f'the group {node["name"]!r}, left out of WMS', every_string, hrefs)
        if node['kind'] == 'layer' and node['wmsName'] is None:
            if any(node['id'] in text for text in every_string):
                failures.append(f'the id of {node["name"]!r}, a layer left out of WMS, appears')
            if node['name'] not in served_names:
                failures += _named(node['name'], f'the layer {node["name"]!r}, left out of WMS', every_string, hrefs)

    wfs_layer_names = {node['wmsName'] for node in nodes if node['kind'] == 'layer' and node['wmsName'] and node['wfsTypeName']}
    hidden_by_name: dict[str, set[str]] = {}
    for node in nodes:
        if node['kind'] == 'layer' and node['wmsName']:
            hidden_by_name.setdefault(node['wmsName'], set()).update(node['hiddenFields']['wms'], node['hiddenFields']['wfs'])
    for collection in _collections(catalogue):
        name = collection.get('quac:qgis_server_wms_name', collection['id'])
        if name not in wfs_layer_names:
            for key in ('assets', 'quac:wfs_endpoint', 'quac:wfs_type_name', 'quac:qgis_server_wfs_type_name'):
                if key in collection:
                    failures.append(f'{name!r} is not published for WFS, but its Collection has {key}')
        hidden = hidden_by_name.get(name, set())
        for column in collection.get('table:columns', []):
            if column['name'] in hidden:
                failures.append(f'the hidden field {column["name"]!r} is a column of {name!r}')
        if collection.get('quac:display_field') in hidden:
            failures.append(f'the hidden field {collection["quac:display_field"]!r} is the display field of {name!r}')
        for text in _strings(collection.get('quac:locks', {})):
            failures += [f'a lock of {name!r} names the hidden field {field!r}' for field in hidden if _mentions(text, field)]

    outside_address = [text.replace(server_address, '') for text in _strings(catalogue, skip_internal_links=True)]
    secrets = {next(group for group in match.groups() if group is not None) for layer in project.layers for match in _PASSWORD_IN_SOURCE.finditer(layer.data_source.raw)}
    data_files = {match.group(0) for layer in project.layers for match in _DATA_FILE.finditer(layer.data_source.raw)}
    for text in outside_address:
        if _CONNECTION_DETAIL.search(text):
            failures.append(f'a connection detail appears: {text!r}')
        failures += [f'a data source password appears: {text!r}' for secret in secrets if secret and secret in text]
        if _PATH.search(text):
            failures.append(f'a file-system path appears: {text!r}')
        failures += [f'the data file {data_file!r} is named: {text!r}' for data_file in data_files if data_file in text]
    if access is not None:
        failures += _access_failures(catalogue, access, every_string, hrefs)
    return failures


def _access_failures(catalogue: dict[str, Any], access: dict[str, Any], every_string: list[str], hrefs: list[str]) -> list[str]:
    failures: list[str] = []
    readable = {name for name, answer in access.items() if answer.read}
    for name, answer in access.items():
        if not answer.read and name not in readable:
            failures += _named(name, f'the layer {name!r}, which the person may not read', every_string, hrefs)
    for collection in _collections(catalogue):
        answer = access.get(collection['id'])
        if answer is None:
            failures.append(f'{collection["id"]!r} is served with no access answer')
            continue
        if answer.fields is not None:
            for column in collection.get('table:columns', []):
                if column['name'] not in answer.fields:
                    failures.append(f'the field {column["name"]!r} of {collection["id"]!r}, which the person may not see, is a column')
            display = collection.get('quac:display_field')
            if display is not None and display not in answer.fields:
                failures.append(f'the field {display!r}, which the person may not see, is the display field of {collection["id"]!r}')
        locks = collection.get('quac:locks') or {}
        for edit, allowed in (('add', answer.insert), ('attributes', answer.update), ('geometry', answer.update), ('delete', answer.delete)):
            if not allowed and locks.get(edit) is not True:
                failures.append(f'{collection["id"]!r} leaves {edit} unlocked, which the person may not do')
    return failures


def _all_links(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        if isinstance(value.get('rel'), str) and isinstance(value.get('href'), str):
            yield value
        for item in value.values():
            yield from _all_links(item)
    elif isinstance(value, list):
        for item in value:
            yield from _all_links(item)


def _named(name: str, what: str, every_string: list[str], hrefs: list[str]) -> list[str]:
    """Where a name the project keeps off the web appears: as a whole string, or escaped in an address."""
    if not name:
        return []
    found = [f'{what}, is named' for text in every_string if text == name][:1]
    escaped = encode_uri_component(name)
    found += [f'{what}, is named in the address {href!r}' for href in hrefs if escaped in href][:1]
    return found

