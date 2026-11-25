"""
The plugin's QGIS Desktop part in QGIS's own Python, with no window: run with
QGIS's Python bindings and `QT_QPA_PLATFORM=offscreen`.

    QT_QPA_PLATFORM=offscreen python3 tests/desktop/check_desktop.py [screenshot.png]

It lays out the plugin as QGIS installs it, starts it through `classFactory`
with a stand-in for QGIS's `iface`, and saves a made-up project:

1. with the option off, and checks nothing is written;
2. with the option on and `publish/` chosen, and checks the documents, the
   data hrefs, the QML styles and the message bar's one warning for a layer
   whose data is outside the folder;
3. after removing a layer, and checks only that layer's document and style
   are removed;
4. after a layer's data file is deleted and the project read again, and checks
   that layer is left out with its own warning;
5. after `unload`, and checks nothing more is written.

It also draws the QUAC page of Project Properties and, given a path, saves it
as a PNG. It prints what it checked and exits non-zero on a failure. It is not
one of the unit tests: it needs QGIS.
"""

from __future__ import annotations

import json
import os
import posixpath
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
# Draws the settings page at twice the size, as on a high-density screen.
os.environ.setdefault('QT_SCALE_FACTOR', '2')

PACKAGE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PACKAGE))

from build_plugin import CATALOGUE_PLUGIN, lay_out_plugin  # noqa: E402

from qgis.core import QgsApplication, QgsEditorWidgetSetup, QgsProject, QgsVectorLayer  # noqa: E402

FAILURES: list[str] = []


def check(condition: bool, what: str) -> None:
    print(('ok    ' if condition else 'FAIL  ') + what)
    if not condition:
        FAILURES.append(what)


class MessageBar:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str, Any]] = []

    def pushMessage(self, title: str, text: str, level: Any = None, duration: int = 0) -> None:  # noqa: N802 - QGIS's name
        self.messages.append((title, text, level))


class Iface:
    """The parts of `QgisInterface` the plugin uses."""

    def __init__(self) -> None:
        self.bar = MessageBar()
        self.factories: list[Any] = []

    def messageBar(self) -> MessageBar:  # noqa: N802 - QGIS's name
        return self.bar

    def registerProjectPropertiesWidgetFactory(self, factory: Any) -> None:  # noqa: N802 - QGIS's name
        self.factories.append(factory)

    def unregisterProjectPropertiesWidgetFactory(self, factory: Any) -> None:  # noqa: N802 - QGIS's name
        self.factories.remove(factory)


def points(features: list[dict[str, Any]]) -> str:
    return json.dumps({'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': properties, 'geometry': {'type': 'Point', 'coordinates': [115.85 + index * 0.01, -31.95]}}
        for index, properties in enumerate(features)
    ]})


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    return path


def files_under(folder: Path) -> set[str]:
    return {path.relative_to(folder).as_posix() for path in folder.rglob('*') if path.is_file()}


def layer(project: Any, path: Path, name: str, group: Any) -> QgsVectorLayer:
    added = QgsVectorLayer(str(path), name, 'ogr')
    assert added.isValid(), name
    project.addMapLayer(added, False)
    group.addLayer(added)
    return added


def main() -> int:
    screenshot = sys.argv[1] if len(sys.argv) > 1 else None
    work = Path(tempfile.mkdtemp())
    app = QgsApplication([], True)
    app.initQgis()
    try:
        plugins = work / 'plugins'
        plugins.mkdir()
        lay_out_plugin(CATALOGUE_PLUGIN, plugins)
        sys.path.insert(0, str(plugins))
        import quac_catalogue

        home = work / 'Parks Project'
        publish = home / 'publish'
        parks = write(publish / 'vector' / 'parks.geojson', points([{'id': 1, 'name': 'Example Park', 'kind': 'dog'}, {'id': 2, 'name': 'Sample Reserve', 'kind': 'nature'}]))
        playgrounds = write(publish / 'vector' / 'playgrounds.geojson', points([{'id': 1, 'name': 'Swings'}]))
        kinds = write(publish / 'lookups' / 'kinds.geojson', points([{'code': 'dog', 'label': 'Dog park'}, {'code': 'nature', 'label': 'Nature reserve'}]))
        benches = write(publish / 'vector' / 'benches.geojson', points([{'id': 1, 'name': 'Bench by the lake'}]))
        trails = write(home / 'outside' / 'trails.geojson', points([{'id': 1, 'name': 'Lake loop'}]))

        iface = Iface()
        plugin = quac_catalogue.classFactory(iface)
        plugin.initGui()
        check(len(iface.factories) == 1, 'initGui registers the QUAC page of Project Properties')

        project = QgsProject.instance()
        project.clear()
        root = project.layerTreeRoot()
        recreation = root.addGroup('Recreation')
        base = root.addGroup('Base maps')
        parks_layer = layer(project, parks, 'Parks', recreation)
        playgrounds_layer = layer(project, playgrounds, 'Playgrounds', recreation)
        layer(project, benches, 'Benches', recreation)
        layer(project, trails, 'Trails', base)
        kinds_layer = layer(project, kinds, 'Kinds', root)
        parks_layer.setEditorWidgetSetup(parks_layer.fields().indexOf('kind'), QgsEditorWidgetSetup('ValueRelation', {
            'Layer': kinds_layer.id(), 'LayerName': 'Kinds', 'Key': 'code', 'Value': 'label',
            'AllowNull': False, 'AllowMulti': False, 'OrderByValue': False, 'FilterExpression': '',
        }))
        project_file = home / 'Parks.qgz'

        # 1. The option off.
        check(project.write(str(project_file)), 'the project saves with the option off')
        check(not (publish / 'Parks.stac.json').exists() and not (home / 'Parks.stac.json').exists(), 'nothing is written with the option off')
        check(iface.bar.messages == [], 'no message with the option off')

        # 2. The option on, with publish/ chosen.
        project.writeEntry('quac', 'catalogue/write_on_save', True)
        project.writeEntry('quac', 'catalogue/folder', 'publish')
        check(project.write(), 'the project saves with the option on')
        written = files_under(publish)
        root_document = json.loads((publish / 'Parks.stac.json').read_text(encoding='utf-8'))
        print('      written:', ', '.join(sorted(name for name in written if name.startswith('Parks.stac'))))
        check(root_document['type'] == 'Catalog' and [link['title'] for link in root_document['links'] if link['rel'] == 'child'] == ['Recreation', 'Kinds'], 'the root links the Recreation group and Kinds; Base maps, left with no layer, is left out')
        collections = {}
        for name in written:
            if name.endswith('.json') and name.startswith('Parks.stac/'):
                document = json.loads((publish / name).read_text(encoding='utf-8'))
                if document['type'] == 'Collection':
                    collections[document['title']] = (name, document)
        check(sorted(collections) == ['Benches', 'Kinds', 'Parks', 'Playgrounds'], 'a Collection for each layer in the folder, none for Trails')
        hrefs_resolve = True
        for name, document in collections.values():
            for key, asset in document['assets'].items():
                target = publish / posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(asset['href'])))
                hrefs_resolve = hrefs_resolve and target.is_file() and str(publish) in str(target.resolve())
        check(hrefs_resolve, 'every data and style href resolves to a file inside publish/')
        parks_name, parks_document = collections['Parks']
        check(parks_document['assets']['data']['href'] == '../../../../vector/parks.geojson', f"Parks's data href is relative to its document: {parks_document['assets']['data']['href']}")
        style = parks_document['assets'].get('default', {})
        check(style.get('roles') == ['style', 'default'] and style.get('type') == 'application/x-qgis-qml+xml', 'Parks has a QML style asset with the style and default roles')
        qml = (publish / 'Parks.stac' / 'styles' / f'{posixpath.basename(parks_name)[:-5]}.qml').read_text(encoding='utf-8')
        check('<renderer-v2' in qml and '<!DOCTYPE qgis' in qml, 'the QML is the style QGIS writes')
        check('ValueRelation' not in qml and str(work) not in qml, "the QML holds no form settings and no path of this computer")
        kind = next(column for column in parks_document['table:columns'] if column['name'] == 'kind')
        check(kind.get('quac:value_relation', {}).get('collection') == kinds_layer.id(), 'the Value Relation names Kinds')
        check({column['name']: column.get('type') for column in parks_document['table:columns']} == {'id': 'int', 'name': 'string', 'kind': 'string'}, 'each column has the type QGIS reports')
        all_text = ''.join((publish / name).read_text(encoding='utf-8') for name in written if name.startswith('Parks.stac'))
        check(str(work) not in all_text and 'Parks.qgz' not in all_text, 'no document names a folder of this computer or the project file, which is outside publish/')
        check(not [name for name in written if name.endswith('.tmp')], 'no temporary file is left')
        check(len(iface.bar.messages) == 1, 'one message bar entry')
        print('      message:', iface.bar.messages[-1][1])
        check('Trails (its data file is outside the chosen folder)' in iface.bar.messages[-1][1], 'the warning names Trails and why it was left out')

        # 3. A layer removed.
        before = files_under(publish)
        project.removeMapLayer(playgrounds_layer.id())
        check(project.write(), 'the project saves after Playgrounds is removed')
        after = files_under(publish)
        removed = sorted(before - after)
        playgrounds_files = sorted(name for name in before if 'playgrounds_' in posixpath.basename(name).lower() and name.startswith('Parks.stac/'))
        check(removed == playgrounds_files and len(removed) == 2, f'only the Playgrounds document and style are removed: {removed}')
        check('vector/playgrounds.geojson' in after, "Playgrounds's data file is kept")

        # 4. A layer whose data file is deleted.
        benches.unlink()
        check(project.read(str(project_file)), 'the project reads again with the benches file gone')
        check(not [loaded for loaded in project.mapLayers().values() if loaded.name() == 'Benches' and loaded.isValid()], 'QGIS could not open Benches')
        iface.bar.messages.clear()
        check(project.write(), 'the project saves with Benches unopened')
        check(not [name for name in files_under(publish) if 'benches_' in name.lower()], "Benches's document and style are removed")
        print('      message:', iface.bar.messages[-1][1] if iface.bar.messages else None)
        check(bool(iface.bar.messages) and 'Benches (QGIS could not open its data)' in iface.bar.messages[-1][1] and 'fix its data source in QGIS and save again' in iface.bar.messages[-1][1], 'the warning names Benches and says to fix its data source')

        # The settings page.
        page = iface.factories[0].createWidget(None)
        check(page.write_on_save.isChecked() and Path(page.folder.filePath()).resolve() == publish.resolve(), 'the page shows the option on and publish/ chosen')
        check(page.root_file.text() == 'Parks.stac.json' and page.root_file.isReadOnly(), 'the page shows the root file, read-only')
        page.resize(640, 260)
        page.show()
        app.processEvents()
        if screenshot:
            image = page.grab()
            print(f'      device pixel ratio {image.devicePixelRatio()}, {image.width()} x {image.height()} pixels')
            check(image.save(screenshot), f'the page is saved as {screenshot}')
        page.folder.setFilePath(str(home))
        page.apply()
        check(project.readEntry('quac', 'catalogue/folder', 'x')[0] == '', "choosing the project's own folder saves an empty folder setting")
        page.close()

        unsaved_project = home / 'unsaved'
        project.clear()
        unsaved = iface.factories[0].createWidget(None)
        check(not unsaved.write_on_save.isEnabled() and not unsaved.folder.isEnabled() and not unsaved.not_saved.isHidden(), 'for a project not saved as a file the controls are off and the page says to save it first')
        unsaved.close()
        check(not unsaved_project.exists(), 'nothing is written for a project not saved as a file')

        # 5. After unload.
        check(project.read(str(project_file)), 'the project reads again')
        plugin.unload()
        check(iface.factories == [], 'unload unregisters the page')
        shutil.rmtree(publish / 'Parks.stac')
        (publish / 'Parks.stac.json').unlink()
        check(project.write(), 'the project saves after unload')
        check(not (publish / 'Parks.stac.json').exists(), 'nothing is written after unload')
    finally:
        QgsProject.instance().clear()
        app.exitQgis()
        shutil.rmtree(work, ignore_errors=True)
    print(f'{len(FAILURES)} failed' if FAILURES else 'all passed')
    return 1 if FAILURES else 0


if __name__ == '__main__':
    sys.exit(main())
