"""
The QUAC catalogue plugin's QGIS Server checks, run by `.github/workflows/qgis-server.yml` after
`check_qgis_server.py prepare` and the reading route's checks, against the same
server. Python's standard library only.

`check <work> <server> [<service URI> <password URI>]` asks the server for the
catalogue of each fixture project, and of the `.qgz` copy of one and the
PostgreSQL copy named through a pg_service file, and fails where:

- the catalogue is not the one the Python builds outside the server from the
  same project text, with the field types GetProjectSettings reports and each
  layer's box as served;
- it shows anything the project keeps off the web (`tests/leaks.py`);
- the cache serves a copy where an access-control plugin gives a cache key, or
  builds afresh where none does, or serves an edited project's old catalogue;
- an address holding a password, given through QGIS Server's own service-address
  header or as a PostgreSQL project's `MAP`, is not refused with the plugin's
  failure message alone;
- a project saved by a newer QGIS than the server runs gives no warning in the
  server's log;
- for each test person of `quac_test_access/rules.py`, the catalogue is not the
  one `quac_catalogue.access.apply_access` gives from that person's answers, it
  shows what they may not see or leaves unlocked what they may not do, or its
  layers and groups differ from QGIS Server's own GetProjectSettings for them.

It also times a catalogue request on the generated projects. The report is
printed and written to the run's summary; `<work>/catalogue-results.json` keeps
the figures.
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_qgis_server import CACHE_PROJECT, FIXTURES, SYNTHETIC_SIZES, children, local  # noqa: E402 - beside this file
from quac_catalogue.access import LayerAnswer, apply_access  # noqa: E402 - the package two folders up
from quac_catalogue.catalogue import FAILURE_MESSAGE  # noqa: E402
from quac_server import generate_server_stac_catalogue, parse_qgs_xml, server_layer_tree  # noqa: E402
from quac_server.model.qgs_project import BoundingBox  # noqa: E402
from tests.leaks import leak_failures  # noqa: E402

CONTAINER = 'qgis-server'


def _load_rules():
    """The test people's rules, loaded by path: importing the plugin's package would need QGIS's modules."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('quac_test_access_rules', Path(__file__).resolve().parent / 'quac_test_access' / 'rules.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rule_for = _load_rules().rule_for


def request(base: str, map_value: str, headers: dict[str, str] | None = None, **params: str) -> tuple[int, bytes, dict[str, str], float]:
    query = urllib.parse.urlencode({'MAP': map_value, **params})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(urllib.request.Request(f'{base.rstrip("/")}/ows/?{query}', headers=headers or {}), timeout=300) as answer:
            body, status, received = answer.read(), answer.status, dict(answer.headers.items())
    except urllib.error.HTTPError as error:
        body, status, received = error.read(), error.code, dict(error.headers.items())
    return status, body, {key.lower(): value for key, value in received.items()}, (time.perf_counter() - started) * 1000


def catalogue_request(base: str, map_value: str, headers: dict[str, str] | None = None, **params: str) -> tuple[int, bytes, str, float]:
    status, body, received, elapsed = request(base, map_value, headers, SERVICE='QUAC', REQUEST='GetCatalogue', **params)
    return status, body, received.get('x-quac-cache', ''), elapsed


def reported_field_types(base: str, map_value: str, project_text: str, **params: str) -> dict[str, dict[str, dict[str, str]]]:
    """Each layer's field types as GetProjectSettings reports them, by layer id, as the server route takes them."""
    status, body, _, _ = request(base, map_value, SERVICE='WMS', VERSION='1.3.0', REQUEST='GetProjectSettings', **params)
    if status != 200:
        return {}
    by_name: dict[str, dict[str, dict[str, str]]] = {}
    for layer in ElementTree.fromstring(body).iter():
        if local(layer.tag) != 'Layer' or children(layer, 'Layer'):
            continue
        name = next((child.text or '' for child in children(layer, 'Name')), None)
        if name is None:
            continue
        by_name[name] = {
            attribute.get('name'): {'type': attribute.get('type') or '', 'typeName': attribute.get('typeName') or ''}
            for block in children(layer, 'Attributes') for attribute in children(block, 'Attribute') if attribute.get('name')
        }
    tree = server_layer_tree(parse_qgs_xml(project_text))
    types = {}
    for node in walk(tree['children']):
        if node['kind'] == 'layer' and node['wmsName'] in by_name:
            types[node['id']] = by_name[node['wmsName']]
    return types


def walk(nodes: list[dict]):
    for node in nodes:
        yield node
        if node['kind'] == 'group':
            yield from walk(node['children'])


def collections(catalog: dict):
    yield from catalog.get('collections', [])
    for child in catalog.get('catalogs', []):
        yield from collections(child)


def served_address(catalogue: dict) -> str | None:
    """The address the plugin served under, as its WMS links name it."""
    for collection in collections(catalogue):
        for link in collection.get('links', []):
            if link.get('rel') == 'wms':
                return link['href']
    return None


def served_boxes(catalogue: dict, project_text: str) -> dict[str, BoundingBox]:
    """Each served layer's box as served, by layer id, so the comparison below checks everything else."""
    tree = server_layer_tree(parse_qgs_xml(project_text))
    ids_by_name: dict[str, list[str]] = {}
    for node in walk(tree['children']):
        if node['kind'] == 'layer' and node['wmsName']:
            ids_by_name.setdefault(node['wmsName'], []).append(node['id'])
    boxes = {}
    for collection in collections(catalogue):
        bbox = collection['extent']['spatial']['bbox'][0]
        if bbox != [-180, -90, 180, 90]:
            for layer_id in ids_by_name.get(collection['id'], []):
                boxes[layer_id] = BoundingBox(*bbox)
    return boxes


def check_catalogue(base: str, map_value: str, project_text: str, label: str, newer_project: bool) -> tuple[dict, list[str]]:
    status, body, cache, elapsed = catalogue_request(base, map_value)
    entry: dict = {'project': label, 'status': status, 'cache': cache, 'ms': round(elapsed, 1)}
    if status != 200:
        entry['error'] = body[:500].decode('utf-8', 'replace')
        return entry, [f'{label}: GetCatalogue answered {status}: {entry["error"]}']
    catalogue = json.loads(body)
    address = served_address(catalogue)
    entry['address'] = address
    entry['collections'] = sum(1 for _ in collections(catalogue))
    failures = []
    if address is not None:
        expected = generate_server_stac_catalogue(
            parse_qgs_xml(project_text), address,
            field_types=reported_field_types(base, map_value, project_text),
            layer_wgs84_extents=served_boxes(catalogue, project_text),
        )
        entry['matchesPython'] = catalogue == expected
        if not entry['matchesPython']:
            failures.append(f'{label}: the served catalogue differs from the one the Python builds from the same text: {first_difference(expected, catalogue)}')
        entry['typedColumns'] = sum(1 for collection in collections(catalogue) for column in collection.get('table:columns', []) if 'type' in column)
        leaks = leak_failures(catalogue, project_text, address)
        entry['leaks'] = leaks
        failures += [f'{label}: {leak}' for leak in leaks]
    entry['savedByNewerQgis'] = newer_project
    return entry, failures


def first_difference(expected, served, path: str = '') -> str:
    if type(expected) is not type(served):
        return f'{path or "the document"}: expected {json.dumps(expected)[:200]}, served {json.dumps(served)[:200]}'
    if isinstance(expected, dict):
        for key in sorted(set(expected) | set(served)):
            if key not in served:
                return f'{path}/{key} is missing'
            if key not in expected:
                return f'{path}/{key} is not expected: {json.dumps(served[key])[:200]}'
            if expected[key] != served[key]:
                return first_difference(expected[key], served[key], f'{path}/{key}')
    if isinstance(expected, list):
        if len(expected) != len(served):
            return f'{path} has {len(served)} items, expected {len(expected)}'
        for index, (left, right) in enumerate(zip(expected, served)):
            if left != right:
                return first_difference(left, right, f'{path}/{index}')
    return f'{path}: expected {json.dumps(expected)[:200]}, served {json.dumps(served)[:200]}'


# Each test person, with the fixture their rules are written for.
ACCESS_CASES = [
    ('no-notes', 'server-publishing/publishing.qgs'),
    ('no-zone-code', 'server-publishing/publishing.qgs'),
    ('read-only', 'server-publishing/publishing.qgs'),
    ('no-sites', 'server-groups/groups.qgs'),
]


def answers_for(user: str, project_text: str, catalogue: dict) -> dict[str, LayerAnswer]:
    """The answers QGIS gives the plugin for a test person, worked out from their rules as the test access plugin answers them."""
    project = parse_qgs_xml(project_text)
    names = {layer.id: layer.name for layer in project.layers}
    columns = {}
    for collection in collections(catalogue):
        found = [column['name'] for column in collection.get('table:columns', [])]
        display = collection.get('quac:display_field')
        columns[collection['id']] = found + ([display] if isinstance(display, str) and display not in found else [])
    answers: dict[str, LayerAnswer] = {}
    for node in walk(server_layer_tree(project)['children']):
        if node['kind'] != 'layer' or not node['wmsName']:
            continue
        rule = rule_for(user, names.get(node['id'], ''))
        wanted = columns.get(node['wmsName'], [])
        answer = LayerAnswer(
            read=rule.get('read', True), insert=rule.get('insert', True), update=rule.get('update', True), delete=rule.get('delete', True),
            fields=frozenset(name for name in wanted if name not in set(rule.get('hidden', []))) if wanted else None,
        )
        answers[node['wmsName']] = answer if node['wmsName'] not in answers else answers[node['wmsName']].combine(answer)
    return answers


def published_names(base: str, map_value: str, **params: str) -> tuple[set[str], set[str]]:
    """The layer and group names GetProjectSettings lists for a request."""
    status, body, _, _ = request(base, map_value, SERVICE='WMS', VERSION='1.3.0', REQUEST='GetProjectSettings', **params)
    if status != 200:
        return set(), set()
    leaves, groups = set(), set()
    for layer in ElementTree.fromstring(body).iter():
        if local(layer.tag) != 'Layer':
            continue
        name = next((child.text or '' for child in children(layer, 'Name')), None)
        if name is None:
            continue
        (groups if children(layer, 'Layer') else leaves).add(name)
    return leaves, groups


def group_titles(catalog: dict) -> set[str]:
    titles = set()
    for child in catalog.get('catalogs', []):
        if child.get('title'):
            titles.add(child['title'])
        titles |= group_titles(child)
    return titles


def access_check(base: str, data: Path, server_major: int) -> tuple[list[dict], list[str]]:
    """Each test person's catalogue against the one their answers give, the leak checks, and GetProjectSettings for them."""
    results, failures = [], []
    for user, relative in ACCESS_CASES:
        project = data / 'fixtures' / relative
        text = project.read_text(encoding='utf-8')
        map_value = f'/io/data/fixtures/{relative}'
        label = f'{user} on {relative}'
        status, body, cache, _ = catalogue_request(base, map_value, TESTUSER=user)
        entry: dict = {'person': user, 'project': relative, 'status': status, 'cache': cache}
        results.append(entry)
        if status != 200:
            failures.append(f'access: {label}: GetCatalogue answered {status}: {body[:300].decode("utf-8", "replace")}')
            continue
        if cache != 'off':
            failures.append(f'access: {label}: the answer was {cache!r}, expected off, as the person\'s access plugin gives a key')
        served = json.loads(body)
        address = served_address(served)
        full = generate_server_stac_catalogue(
            parse_qgs_xml(text), address,
            field_types=reported_field_types(base, map_value, text, TESTUSER=user),
            layer_wgs84_extents=served_boxes(served, text),
        ) if address else served
        answers = answers_for(user, text, full)
        expected = apply_access(full, answers)
        entry['matchesTheirAnswers'] = served == expected
        if served != expected:
            failures.append(f'access: {label}: the catalogue differs from the one their answers give: {first_difference(expected, served)}')
        leaks = leak_failures(served, text, address or '', answers)
        entry['leaks'] = leaks
        failures += [f'access: {label}: {leak}' for leak in leaks]
        leaves, groups = published_names(base, map_value, TESTUSER=user)
        served_layers = {collection['id'] for collection in collections(served)}
        served_groups = group_titles(served)
        entry['getProjectSettings'] = {'layers': sorted(leaves), 'groups': sorted(groups)}
        entry['catalogue'] = {'layers': sorted(served_layers), 'groups': sorted(served_groups)}
        newer = major(ElementTree.fromstring(text).get('version')) > server_major
        entry['savedByNewerQgis'] = newer
        if not newer and (served_layers != leaves or served_groups - groups or (groups & group_titles(full)) - served_groups):
            failures.append(f'access: {label}: GetProjectSettings lists layers {sorted(leaves)} and groups {sorted(groups)}, the catalogue {sorted(served_layers)} and {sorted(served_groups)}')
    return results, failures


def cache_check(base: str, data: Path) -> tuple[dict, list[str]]:
    """With no cache key a second request is served from the cache, with one every request is built, and an edited project is built again."""
    map_value = f'/io/data/{CACHE_PROJECT}'
    seen = {}
    seen['first'] = catalogue_request(base, map_value)[2]
    seen['second'] = catalogue_request(base, map_value)[2]
    keyed = [catalogue_request(base, map_value, TESTUSER=user) for user in ('alice', 'alice', 'bob')]
    seen['keyed'] = [answer[2] for answer in keyed]
    seen['afterKeyed'] = catalogue_request(base, map_value)[2]
    path = data / CACHE_PROJECT
    path.write_text(path.read_text(encoding='utf-8').replace('<layername>Survey notes</layername>', '<layername>Field notes</layername>'), encoding='utf-8')
    time.sleep(3)
    status, body, seen['afterEdit'], _ = catalogue_request(base, map_value)
    names = sorted(collection['id'] for collection in collections(json.loads(body))) if status == 200 else []
    seen['namesAfterEdit'] = names
    failures = []
    if (seen['first'], seen['second']) != ('miss', 'hit'):
        failures.append(f'cache: two requests with no access key answered {seen["first"]} then {seen["second"]}, expected miss then hit')
    if seen['keyed'] != ['off', 'off', 'off']:
        failures.append(f'cache: requests with an access key answered {seen["keyed"]}, expected off each time')
    if seen['afterKeyed'] != 'hit':
        failures.append(f'cache: a request with no key after keyed ones answered {seen["afterKeyed"]}, expected hit')
    if seen['afterEdit'] != 'miss' or 'Field notes' not in names:
        failures.append(f'cache: after the project was edited the answer was {seen["afterEdit"]} with {names}, expected a miss naming Field notes')
    return seen, failures


def refusal_check(base: str, password_uri: str | None) -> tuple[dict, list[str]]:
    """
    An address holding a password is refused with the failure message alone:
    given as QGIS Server's own WMS service-address header, and as the `MAP` of a
    PostgreSQL project named with its user name and password.
    """
    secret = 'Pa55-in-the-header'
    map_value = '/io/data/fixtures/server-publishing/publishing.qgs'
    status, body, cache, _ = catalogue_request(base, map_value, headers={'X-Qgis-Wms-Service-Url': f'https://editor:{secret}@qgis.example.com/ows'})
    text = body.decode('utf-8', 'replace')
    result = {'status': status, 'cache': cache, 'body': text[:200]}
    failures = []
    if status != 500 or text != FAILURE_MESSAGE or secret in text:
        failures.append(f'refusal: an address holding a password gave {status} {text[:200]!r}, expected 500 and the failure message alone')
    if password_uri:
        status, body, cache, _ = catalogue_request(base, password_uri)
        text = body.decode('utf-8', 'replace')
        result['passwordInMap'] = {'status': status, 'cache': cache, 'body': text[:200]}
        password = urllib.parse.urlsplit(password_uri).password or ''
        if status != 500 or text != FAILURE_MESSAGE or (password and password in text):
            failures.append(f'refusal: a MAP holding a password gave {status} {text[:200]!r}, expected 500 and the failure message alone')
    wrong_status, wrong_body, _, _ = request(base, map_value, SERVICE='QUAC', REQUEST='GetMap')
    result['wrongRequest'] = {'status': wrong_status, 'body': wrong_body[:200].decode('utf-8', 'replace')}
    if wrong_status != 400:
        failures.append(f'refusal: REQUEST=GetMap answered {wrong_status}, expected 400')
    return result, failures


def server_log() -> str:
    """The server container's log, its error stream included, where QGIS writes its messages."""
    try:
        return subprocess.run(['docker', 'logs', CONTAINER], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60, check=False).stdout
    except (OSError, subprocess.SubprocessError) as error:
        return f'(the log could not be read: {error})'


def major(version: str | None) -> int:
    head = (version or '').split('.', 1)[0]
    return int(head) if head.isdigit() else 0


def check(work: Path, base: str, service_uri: str | None, password_uri: str | None) -> int:
    data = work / 'data'
    results: dict = {'projects': [], 'routes': [], 'sizes': []}
    failures: list[str] = []
    server_version = server_qgis_version(base)
    results['qgisVersion'] = server_version

    for project in sorted((data / 'fixtures').glob('*/*.qgs')):
        text = project.read_text(encoding='utf-8')
        newer = major(ElementTree.fromstring(text).get('version')) > major(server_version)
        entry, problems = check_catalogue(base, f'/io/data/{project.relative_to(data)}', text, str(project.relative_to(data / 'fixtures')), newer)
        results['projects'].append(entry)
        # A newer project's settings are not applied by an older server, so its catalogue is reported, not counted.
        failures += [] if newer else problems
        if newer:
            entry['notCounted'] = problems

    publishing = (FIXTURES / 'server-publishing' / 'publishing.qgs').read_text(encoding='utf-8')
    routes = [('.qgz file', '/io/data/fixtures/server-publishing/publishing.qgz')]
    if service_uri:
        routes.append(('PostgreSQL project storage, named by service', service_uri))
    for label, map_value in routes:
        entry, problems = check_catalogue(base, map_value, publishing, label, False)
        results['routes'].append(entry)
        failures += problems

    results['cache'], problems = cache_check(base, data)
    failures += problems
    results['refusal'], problems = refusal_check(base, password_uri)
    failures += problems
    results['access'], problems = access_check(base, data, major(server_version))
    failures += problems

    for size in SYNTHETIC_SIZES:
        map_value = f'/io/data/synthetic/size-{size}/size-{size}.qgs'
        first = catalogue_request(base, map_value)
        warm = [catalogue_request(base, map_value)[3] for _ in range(5)]
        keyed = [catalogue_request(base, map_value, TESTUSER='timing')[3] for _ in range(3)]
        results['sizes'].append({'layers': size, 'firstMs': round(first[3], 1), 'firstCache': first[2], 'cachedMs': round(statistics.median(warm), 1), 'builtEachTimeMs': round(statistics.median(keyed), 1)})

    log = server_log()
    newer_projects = [entry['project'] for entry in results['projects'] if entry.get('savedByNewerQgis')]
    results['versionWarning'] = {'projects': newer_projects, 'logged': 'was saved by QGIS' in log}
    if newer_projects and not results['versionWarning']['logged']:
        failures.append(f'version: {newer_projects} were saved by a newer QGIS than this server, and no warning reached the server\'s log')
    if not newer_projects and results['versionWarning']['logged']:
        failures.append('version: the server\'s log warns of a newer project, and none was requested')

    (work / 'catalogue-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    report = markdown_report(results, failures)
    print(report)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as handle:
            handle.write(report)
    return 1 if failures else 0


def server_qgis_version(base: str) -> str:
    """The server's QGIS version, from the spike harness's answer."""
    status, body, _, _ = request(base, '/io/data/fixtures/server-publishing/publishing.qgs', SERVICE='QUACSPIKE', REQUEST='GetLayerTree')
    try:
        return json.loads(body).get('qgisVersion', '') if status == 200 else ''
    except ValueError:
        return ''


def markdown_report(results: dict, failures: list[str]) -> str:
    lines = [f'## QUAC catalogue plugin on QGIS {results.get("qgisVersion")}', '', '### Fixtures', '',
             '| Project | Answer | Collections | Typed columns | Matches the Python | Leaks |', '|---|---|---|---|---|---|']
    for entry in results['projects'] + results['routes']:
        leaks = '; '.join(entry.get('leaks') or []) or ('none' if entry['status'] == 200 else entry.get('error', ''))
        if entry.get('savedByNewerQgis'):
            leaks = f'saved by a newer QGIS than this server, so not counted: {"; ".join(entry.get("notCounted") or []) or "none"}'
        lines.append(f'| {entry["project"]} | {entry["status"]} {entry.get("cache", "")} | {entry.get("collections")} | {entry.get("typedColumns")} | {entry.get("matchesPython")} | {leaks} |')
    cache = results.get('cache') or {}
    lines += ['', '### Cache', '', f'No key, twice: {cache.get("first")}, {cache.get("second")}. With a key, three times: {", ".join(cache.get("keyed", []))}. No key again: {cache.get("afterKeyed")}. After the project was edited: {cache.get("afterEdit")}, serving {", ".join(cache.get("namesAfterEdit", []))}.']
    refusal = results.get('refusal') or {}
    in_map = refusal.get('passwordInMap') or {}
    lines += ['', '### Refusal', '', f'An address holding a password, as the service-address header: {refusal.get("status")}, `{refusal.get("body")}`. As a PostgreSQL MAP: {in_map.get("status")}, `{in_map.get("body")}`. REQUEST=GetMap: {(refusal.get("wrongRequest") or {}).get("status")}.']
    lines += ['', '### Each test person', '', '| Person | Project | Answer | Matches their answers | Leaks | Layers, catalogue / GetProjectSettings | Groups, catalogue / GetProjectSettings |', '|---|---|---|---|---|---|---|']
    for entry in results.get('access', []):
        catalogue, settings = entry.get('catalogue') or {}, entry.get('getProjectSettings') or {}
        leaks = '; '.join(entry.get('leaks') or []) or 'none'
        lines.append(f'| {entry["person"]} | {entry["project"]} | {entry["status"]} {entry.get("cache", "")} | {entry.get("matchesTheirAnswers")} | {leaks} | {", ".join(catalogue.get("layers", []))} / {", ".join(settings.get("layers", []))} | {", ".join(catalogue.get("groups", []))} / {", ".join(settings.get("groups", []))} |')
    warning = results.get('versionWarning') or {}
    lines += ['', '### A project saved by a newer QGIS', '', f'Projects: {", ".join(warning.get("projects") or []) or "none"}. Warning in the server\'s log: {warning.get("logged")}.']
    lines += ['', '### Cost of a catalogue request, by project size (milliseconds)', '', '| Layers | First request | Cached, median of 5 | Built each time with an access key, median of 3 |', '|---|---|---|---|']
    for entry in results['sizes']:
        lines.append(f'| {entry["layers"]} | {entry["firstMs"]} ({entry["firstCache"]}) | {entry["cachedMs"]} | {entry["builtEachTimeMs"]} |')
    lines += ['', '### Result', '']
    lines += [f'- {failure}' for failure in failures] or ['All checks passed.']
    return '\n'.join(lines) + '\n'


def main(argv: list[str]) -> int:
    if len(argv) in (4, 6) and argv[1] == 'check':
        service_uri, password_uri = (argv[4] or None, argv[5] or None) if len(argv) == 6 else (None, None)
        return check(Path(argv[2]), argv[3], service_uri, password_uri)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
