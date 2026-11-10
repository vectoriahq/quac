"""
The reading route's QGIS Server checks, run by `.github/workflows/qgis-server.yml` against the
official QGIS Server image. Python's standard library only.

`prepare <work>` lays out what the server container mounts: the fixture
projects under `<work>/data`, with a stand-in GeoJSON file for each local data
file a hand-written fixture names but does not hold, generated projects of
several sizes, and under `<work>/plugins` the harness plugin and the QUAC
catalogue plugin, each with `quac_server` inside, and the test access-control
plugin. `check_catalogue.py` checks the catalogue plugin on the same server.

`check <work> <server> [<postgresql URI>]` asks the running server, for each
project, for the harness's layer tree and for QGIS Server's own
GetProjectSettings, WFS GetCapabilities and DescribeFeatureType, and writes
`<work>/results.json` and a Markdown report. It fails where the harness's tree,
read inside the server, differs from the tree the JavaScript saved, or where
QGIS Server publishes a layer, a WFS type or a field the tree says it hides.
"""

from __future__ import annotations

import json
import os
import shutil
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

PACKAGE = Path(__file__).resolve().parents[2]
FIXTURES = PACKAGE.parent / 'quac' / 'src' / 'tests' / 'fixtures' / 'qgis'
HARNESS = Path(__file__).resolve().parent / 'quac_spike_harness'
CATALOGUE_PLUGIN = PACKAGE / 'quac_catalogue'
TEST_ACCESS = Path(__file__).resolve().parent / 'quac_test_access'
# A copy of a fixture the catalogue plugin's cache check edits, apart from the spike's.
CACHE_PROJECT = 'cache/publishing.qgs'

sys.path.insert(0, str(PACKAGE))
from build_plugin import lay_out_plugin  # noqa: E402 - the package two folders up
from quac_server import read_server_layer_tree  # noqa: E402

# The generated projects' sizes, as layer counts.
SYNTHETIC_SIZES = (50, 200, 1000)
SYNTHETIC_FIELDS = 30
EDIT_PROJECT = 'edit/edit.qgs'


# ---------------------------------------------------------------- prepare


def prepare(work: Path) -> None:
    data = work / 'data'
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(FIXTURES, data / 'fixtures', ignore=shutil.ignore_patterns('examples'))
    for project in sorted((data / 'fixtures').glob('*/*.qgs')):
        write_stand_in_data(project)
    for size in SYNTHETIC_SIZES:
        write_synthetic_project(data / 'synthetic' / f'size-{size}' / f'size-{size}.qgs', size)
    (data / 'edit').mkdir(parents=True)
    shutil.copy(FIXTURES / 'server-groups' / 'groups.qgs', data / EDIT_PROJECT)
    write_stand_in_data(data / EDIT_PROJECT)

    (data / 'cache').mkdir(parents=True)
    shutil.copy(FIXTURES / 'server-publishing' / 'publishing.qgs', data / CACHE_PROJECT)
    write_stand_in_data(data / CACHE_PROJECT)

    # The spike's harness and the catalogue plugin each hold their own copy of quac_server, laid out as the plugin's zip holds it.
    for source in (HARNESS, CATALOGUE_PLUGIN):
        lay_out_plugin(source, work / 'plugins')
    shutil.copytree(TEST_ACCESS, work / 'plugins' / TEST_ACCESS.name, ignore=shutil.ignore_patterns('__pycache__'))
    for path in work.rglob('*'):
        path.chmod(0o755 if path.is_dir() else 0o644)
    print(f'Prepared {work}')


def local_file_of(datasource: str) -> str | None:
    """The relative file a layer's data source names, or None for a database, a service or an absolute path."""
    path = datasource.split('|', 1)[0].strip()
    if not path or '://' in path or path.startswith(('/', 'dbname=', 'url=', 'type=', 'contextualWMSLegend', 'crs=')) or '=' in path:
        return None
    return path


GEOMETRIES = {
    'Point': {'type': 'Point', 'coordinates': [144.96, -37.81]},
    'Line': {'type': 'LineString', 'coordinates': [[144.96, -37.81], [144.97, -37.82]]},
    'Polygon': {'type': 'Polygon', 'coordinates': [[[144.96, -37.81], [144.97, -37.81], [144.97, -37.82], [144.96, -37.81]]]},
}


def write_stand_in_data(project: Path) -> None:
    """A one-feature GeoJSON file, with the layer's fields, for each local data file the project names and does not hold."""
    root = ElementTree.parse(project).getroot()
    for maplayer in root.iter('maplayer'):
        relative = local_file_of(maplayer.findtext('datasource') or '')
        if relative is None:
            continue
        target = (project.parent / relative).resolve()
        if target.exists() or project.parent.resolve() not in target.parents:
            continue
        fields = [field.get('name') for field in maplayer.iterfind('fieldConfiguration/field') if field.get('name')]
        geometry = GEOMETRIES.get(maplayer.get('geometry') or '')
        feature = {'type': 'Feature', 'geometry': geometry, 'properties': {name: 'x' for name in fields}}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({'type': 'FeatureCollection', 'features': [feature]}), encoding='utf-8')


def write_synthetic_project(path: Path, layer_count: int) -> None:
    """A project of `layer_count` layers in groups of ten, each of `SYNTHETIC_FIELDS` fields, all reading one file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [f'field_{index:02d}' for index in range(SYNTHETIC_FIELDS)]
    feature = {'type': 'Feature', 'geometry': GEOMETRIES['Point'], 'properties': {name: 'x' for name in fields}}
    (path.parent / 'points.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': [feature]}), encoding='utf-8')

    ids = [f'layer_{index:04d}_0a1b2c3d_4e5f_4a6b_8c7d_9e0f1a2b3c4d' for index in range(layer_count)]
    tree, maplayers = [], []
    for start in range(0, layer_count, 10):
        tree.append(f'    <layer-tree-group checked="Qt::Checked" expanded="1" name="Group {start // 10:03d}">')
        for index in range(start, min(start + 10, layer_count)):
            tree.append(f'      <layer-tree-layer checked="Qt::Checked" source="./points.geojson" expanded="1" name="Layer {index:04d}" providerKey="ogr" id="{ids[index]}"/>')
        tree.append('    </layer-tree-group>')
    for index, layer_id in enumerate(ids):
        hidden = 'HideFromWms|HideFromWfs' if index % 10 == 0 else 'NoFlag'
        field_xml = ''.join(f'<field configurationFlags="{hidden if position == 0 else "NoFlag"}" name="{name}"/>' for position, name in enumerate(fields))
        alias_xml = ''.join(f'<alias field="{name}" index="{position}" name="Field {position}"/>' for position, name in enumerate(fields))
        maplayers.append(
            '    <maplayer type="vector" geometry="Point" wkbType="Point" readOnly="0">'
            f'<id>{layer_id}</id><datasource>./points.geojson</datasource><layername>Layer {index:04d}</layername>'
            '<srs><spatialrefsys nativeFormat="Wkt"><authid>EPSG:4326</authid></spatialrefsys></srs>'
            '<provider encoding="UTF-8">ogr</provider>'
            f'<fieldConfiguration>{field_xml}</fieldConfiguration><aliases>{alias_xml}</aliases>'
            f'<previewExpression>"{fields[1]}"</previewExpression></maplayer>'
        )
    wfs = ''.join(f'<value>{layer_id}</value>' for index, layer_id in enumerate(ids) if index % 2 == 0)
    path.write_text(
        "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n"
        f'<qgis projectname="Synthetic {layer_count}" version="3.44.8-Solothurn">\n'
        f'  <title>Synthetic {layer_count}</title>\n'
        '  <projectCrs><spatialrefsys nativeFormat="Wkt"><authid>EPSG:4326</authid></spatialrefsys></projectCrs>\n'
        '  <layer-tree-group>\n' + '\n'.join(tree) + '\n  </layer-tree-group>\n'
        '  <projectlayers>\n' + '\n'.join(maplayers) + '\n  </projectlayers>\n'
        f'  <properties><WFSLayers type="QStringList">{wfs}</WFSLayers></properties>\n'
        '</qgis>\n',
        encoding='utf-8',
    )


# ---------------------------------------------------------------- check


class Server:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip('/')

    def get(self, project: str, **params: str) -> tuple[int, bytes, float]:
        query = urllib.parse.urlencode({'MAP': project, **params})
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(f'{self.base}/ows/?{query}', timeout=300) as answer:
                body, status = answer.read(), answer.status
        except urllib.error.HTTPError as error:
            body, status = error.read(), error.code
        return status, body, (time.perf_counter() - started) * 1000

    def wait(self, seconds: int = 120) -> None:
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                urllib.request.urlopen(f'{self.base}/ows/?SERVICE=WMS&REQUEST=GetCapabilities', timeout=5)
                return
            except urllib.error.HTTPError:
                return
            except OSError:
                time.sleep(2)
        raise SystemExit(f'QGIS Server did not answer at {self.base} within {seconds} s')

    def harness(self, project: str, repeat: int = 1) -> dict:
        status, body, elapsed = self.get(project, SERVICE='QUACSPIKE', REQUEST='GetLayerTree', REPEAT=str(repeat))
        try:
            answer = json.loads(body)
        except ValueError:
            answer = {'error': body[:2000].decode('utf-8', 'replace')}
        answer['status'] = status
        answer['requestMs'] = elapsed
        return answer


def local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def children(element: ElementTree.Element, name: str) -> list[ElementTree.Element]:
    return [child for child in element if local(child.tag) == name]


def wms_published(server: Server, project: str) -> dict:
    """Names and attributes from QGIS Server's own GetProjectSettings."""
    status, body, elapsed = server.get(project, SERVICE='WMS', VERSION='1.3.0', REQUEST='GetProjectSettings')
    if status != 200:
        return {'error': f'GetProjectSettings answered {status}: {body[:500].decode("utf-8", "replace")}', 'ms': elapsed}
    root = ElementTree.fromstring(body)
    leaves, groups, attributes = [], [], {}
    for layer in root.iter():
        if local(layer.tag) != 'Layer':
            continue
        name = next((child.text or '' for child in children(layer, 'Name')), None)
        if name is None:
            continue
        if children(layer, 'Layer'):
            groups.append(name)
            continue
        leaves.append(name)
        attributes[name] = [attribute.get('name') for block in children(layer, 'Attributes') for attribute in children(block, 'Attribute')]
    return {'leaves': leaves, 'groups': groups, 'attributes': attributes, 'ms': elapsed}


def wfs_published(server: Server, project: str) -> dict:
    """Type names from WFS GetCapabilities, and each type's fields from DescribeFeatureType."""
    status, body, _ = server.get(project, SERVICE='WFS', VERSION='1.1.0', REQUEST='GetCapabilities')
    if status != 200:
        return {'error': f'WFS GetCapabilities answered {status}'}
    root = ElementTree.fromstring(body)
    names = [name.text.split(':')[-1] for feature in root.iter() if local(feature.tag) == 'FeatureType' for name in children(feature, 'Name') if name.text]
    fields = {}
    for name in names:
        status, body, _ = server.get(project, SERVICE='WFS', VERSION='1.1.0', REQUEST='DescribeFeatureType', TYPENAME=name)
        if status != 200:
            fields[name] = None
            continue
        schema = ElementTree.fromstring(body)
        fields[name] = [element.get('name') for sequence in schema.iter() if local(sequence.tag) == 'sequence' for element in children(sequence, 'element')]
    return {'names': names, 'fields': fields}


def walk_layers(nodes: list[dict]) -> list[dict]:
    found = []
    for node in nodes:
        found.extend(walk_layers(node['children']) if node['kind'] == 'group' else [node])
    return found


def walk_groups(nodes: list[dict]) -> list[dict]:
    found = []
    for node in nodes:
        if node['kind'] == 'group':
            found.append(node)
            found.extend(walk_groups(node['children']))
    return found


def compare_with_server(tree: dict, wms: dict, wfs: dict) -> list[str]:
    """
    Where QGIS Server's own answers and the tree disagree. A layer the server
    could not open is still listed by its names, with QGIS_SERVER_IGNORE_BAD_LAYERS
    set, so every layer of the tree is expected.
    """
    problems = []
    layers = walk_layers(tree['children'])
    if 'error' in wms:
        problems.append(wms['error'])
    else:
        expected = sorted(layer['wmsName'] for layer in layers if layer['wmsName'])
        if sorted(wms['leaves']) != expected:
            problems.append(f'WMS layer names: server {sorted(wms["leaves"])}, tree {expected}')
        for group in walk_groups(tree['children']):
            if not group['wmsPublished'] and group['name'] in wms['groups']:
                problems.append(f'WMS lists the group {group["name"]!r}, which the tree says the project leaves out')
        for layer in layers:
            served = wms['attributes'].get(layer['wmsName'] or '', [])
            for field in layer['hiddenFields']['wms']:
                if field in served:
                    problems.append(f'GetProjectSettings lists {layer["name"]}.{field}, which the tree says is hidden from WMS')
    if 'error' in wfs:
        problems.append(wfs['error'])
    else:
        expected = sorted(layer['wfsTypeName'] for layer in layers if layer['wfsTypeName'])
        if sorted(wfs['names']) != expected:
            problems.append(f'WFS type names: server {sorted(wfs["names"])}, tree {expected}')
        for layer in layers:
            served = wfs['fields'].get(layer['wfsTypeName'] or '') or []
            for field in layer['hiddenFields']['wfs']:
                if field in served:
                    problems.append(f'DescribeFeatureType lists {layer["name"]}.{field}, which the tree says is hidden from WFS')
    return problems


def major_version(version: str | None) -> int:
    """QGIS's major version from a version string such as `4.2.0-Belém do Pará`; 0 where there is none."""
    head = (version or '').split('.', 1)[0]
    return int(head) if head.isdigit() else 0


def expected_tree(project: Path) -> dict:
    return json.loads(project.with_suffix('.server.layers.json').read_text(encoding='utf-8'))


def check(work: Path, base: str, postgres_uri: str | None) -> int:
    server = Server(base)
    server.wait()
    data = work / 'data'
    results: dict = {'projects': [], 'routes': [], 'sizes': [], 'edit': None}
    failures: list[str] = []

    # Every whole-project fixture, read from its file.
    for project in sorted((data / 'fixtures').glob('*/*.qgs')):
        container_path = f'/io/data/{project.relative_to(data)}'
        answer = server.harness(container_path)
        entry = {'project': str(project.relative_to(data / 'fixtures')), 'status': answer['status']}
        if answer['status'] != 200:
            entry['error'] = answer.get('error')
            failures.append(f'{entry["project"]}: the harness answered {answer["status"]}: {answer.get("error")}')
        else:
            entry['matchesJavaScript'] = answer['tree'] == expected_tree(project)
            if not entry['matchesJavaScript']:
                failures.append(f'{entry["project"]}: the tree read inside the server differs from the JavaScript\'s')
            valid = set(answer['validLayerIds'])
            layer_ids = [layer['id'] for layer in walk_layers(answer['tree']['children'])]
            entry['layers'] = len(layer_ids)
            entry['unopenedLayers'] = [layer_id for layer_id in layer_ids if layer_id not in valid]
            entry['serverDisagrees'] = compare_with_server(answer['tree'], wms_published(server, container_path), wfs_published(server, container_path))
            saved_in = major_version(ElementTree.parse(project).getroot().get('version'))
            entry['savedByNewerQgis'] = saved_in > major_version(answer['qgisVersion'])
            if not entry['savedByNewerQgis']:
                failures.extend(f'{entry["project"]}: {problem}' for problem in entry['serverDisagrees'])
            results.setdefault('process', answer['process'])
            results.setdefault('qgisVersion', answer['qgisVersion'])
            results.setdefault('pythonVersion', answer['pythonVersion'])
        results['projects'].append(entry)

    # The three ways a project is stored.
    routes = [('.qgs file', '/io/data/fixtures/server-publishing/publishing.qgs', FIXTURES / 'server-publishing' / 'publishing.qgs'),
              ('.qgz file', '/io/data/fixtures/server-publishing/publishing.qgz', FIXTURES / 'server-publishing' / 'publishing.qgs')]
    if postgres_uri:
        routes.append(('PostgreSQL project storage', postgres_uri, FIXTURES / 'server-publishing' / 'publishing.qgs'))
    for label, map_value, golden in routes:
        answer = server.harness(map_value)
        entry = {'route': label, 'status': answer['status'], 'source': answer.get('source'), 'fileName': answer.get('fileName'), 'bytes': answer.get('bytes')}
        if answer['status'] == 200:
            entry['matchesJavaScript'] = answer['tree'] == expected_tree(golden)
            if not entry['matchesJavaScript']:
                failures.append(f'{label}: the tree differs from the JavaScript\'s: read {json.dumps(answer["tree"])}')
        else:
            entry['error'] = answer.get('error')
            failures.append(f'{label}: the harness answered {answer["status"]}: {answer.get("error")}')
        results['routes'].append(entry)
    if not postgres_uri:
        results['routes'].append({'route': 'PostgreSQL project storage', 'skipped': 'no PostgreSQL URI given'})

    # What one read costs, by project size.
    for size in SYNTHETIC_SIZES:
        map_value = f'/io/data/synthetic/size-{size}/size-{size}.qgs'
        cold = wms_published(server, map_value)
        warm = [wms_published(server, map_value)['ms'] for _ in range(5)]
        answer = server.harness(map_value, repeat=10)
        local_tree_path = data / 'synthetic' / f'size-{size}' / f'size-{size}.qgs'
        same = answer.get('tree') == read_server_layer_tree(local_tree_path.name, local_tree_path.read_bytes())
        if not same:
            failures.append(f'size {size}: the tree read inside the server differs from the one read outside it')
        results['sizes'].append({
            'layers': size,
            'fields': SYNTHETIC_FIELDS,
            'bytes': answer.get('bytes'),
            'readMs': answer.get('readMs'),
            'buildMs': answer.get('buildMs'),
            'harnessRequestMs': answer.get('requestMs'),
            'getProjectSettingsColdMs': cold.get('ms'),
            'getProjectSettingsWarmMs': statistics.median(warm),
            'sameTreeOutside': same,
            'unopenedLayers': size - len(answer.get('validLayerIds') or []),
        })

    store_log = work / 'store.log'
    if store_log.exists():
        results['storeLog'] = store_log.read_text(encoding='utf-8', errors='replace')

    # A project edited on disk after the server opened it.
    results['edit'] = edit_check(server, data)

    (work / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    report = markdown_report(results, failures)
    print(report)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as handle:
            handle.write(report)
    return 1 if failures else 0


def edit_check(server: Server, data: Path) -> dict:
    """Whether the harness and GetProjectSettings agree right after the project file changes."""
    map_value = f'/io/data/{EDIT_PROJECT}'
    path = data / EDIT_PROJECT

    def names() -> dict:
        tree = server.harness(map_value).get('tree') or {'children': []}
        harness = sorted(layer['wmsName'] for layer in walk_layers(tree['children']) if layer['wmsName'])
        return {'harness': harness, 'getProjectSettings': sorted(wms_published(server, map_value).get('leaves', []))}

    before = names()
    text = path.read_text(encoding='utf-8')
    path.write_text(text.replace('<shortname>monitoring_sites</shortname>', '<shortname>monitoring_sites_edited</shortname>'), encoding='utf-8')
    right_after = names()
    time.sleep(3)
    after_3s = names()
    return {'before': before, 'rightAfter': right_after, 'after3s': after_3s}


def markdown_report(results: dict, failures: list[str]) -> str:
    lines = [f'## QUAC reading spike on QGIS {results.get("qgisVersion")}', '']
    process = results.get('process') or {}
    lines.append(f'QGIS Server process user: `{process.get("user")}` (uid {process.get("uid")}); Python {results.get("pythonVersion")}.')
    lines += ['', '### Fixtures, read from their files', '', '| Project | Matches the JavaScript | Layers | Layers the server could not open | Where QGIS Server disagrees |', '|---|---|---|---|---|']
    for entry in results['projects']:
        disagrees = '; '.join(entry.get('serverDisagrees', [])) or ('none' if entry['status'] == 200 else entry.get('error', ''))
        if entry.get('savedByNewerQgis') and entry.get('serverDisagrees'):
            disagrees = f'saved by a newer QGIS than this server, so not counted: {disagrees}'
        lines.append(f'| {entry["project"]} | {entry.get("matchesJavaScript")} | {entry.get("layers")} | {len(entry.get("unopenedLayers", []))} | {disagrees} |')
    lines += ['', '### Storage routes', '', '| Route | Answer | Read from | Bytes | Matches the JavaScript |', '|---|---|---|---|---|']
    for entry in results['routes']:
        if 'skipped' in entry:
            lines.append(f'| {entry["route"]} | skipped: {entry["skipped"]} | | | |')
        else:
            lines.append(f'| {entry["route"]} | {entry["status"]} {entry.get("error") or ""} | {entry.get("source")} {entry.get("fileName") or ""} | {entry.get("bytes")} | {entry.get("matchesJavaScript")} |')
    store_log = results.get('storeLog')
    if store_log:
        lines += ['', 'Storing the project in PostgreSQL with QGIS printed:', '', '```text', store_log.strip()[-3000:], '```']
    lines += ['', '### Cost of one read, by project size (median milliseconds)', '', '| Layers | Fields each | Project bytes | Read the stored text | Build the tree | Harness request (10 reads) | GetProjectSettings, first | GetProjectSettings, warm | Layers the server could not open |', '|---|---|---|---|---|---|---|---|---|']
    for entry in results['sizes']:
        def ms(value):
            return f'{value:.1f}' if isinstance(value, (int, float)) else str(value)
        lines.append(f'| {entry["layers"]} | {entry["fields"]} | {entry["bytes"]} | {ms(entry["readMs"])} | {ms(entry["buildMs"])} | {ms(entry["harnessRequestMs"])} | {ms(entry["getProjectSettingsColdMs"])} | {ms(entry["getProjectSettingsWarmMs"])} | {entry["unopenedLayers"]} |')
    edit = results.get('edit') or {}
    lines += ['', '### A project edited on disk while the server has it open', '', '| When | Harness WMS names | GetProjectSettings WMS names |', '|---|---|---|']
    for key, label in (('before', 'before the edit'), ('rightAfter', 'right after'), ('after3s', 'three seconds after')):
        value = edit.get(key) or {}
        lines.append(f'| {label} | {", ".join(value.get("harness", []))} | {", ".join(value.get("getProjectSettings", []))} |')
    lines += ['', '### Result', '']
    lines += [f'- {failure}' for failure in failures] or ['All checks passed.']
    return '\n'.join(lines) + '\n'


def main(argv: list[str]) -> int:
    if len(argv) >= 3 and argv[1] == 'prepare':
        prepare(Path(argv[2]))
        return 0
    if len(argv) in (4, 5) and argv[1] == 'check':
        return check(Path(argv[2]), argv[3], argv[4] if len(argv) == 5 and argv[4] else None)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
