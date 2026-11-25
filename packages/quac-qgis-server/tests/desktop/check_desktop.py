"""
The plugin's QGIS Desktop part in QGIS's own Python, with no window: run with
QGIS's Python bindings and `QT_QPA_PLATFORM=offscreen`.

    QT_QPA_PLATFORM=offscreen python3 tests/desktop/check_desktop.py [screenshot.png]

It lays out the plugin as QGIS installs it, starts it through `classFactory`
with a stand-in for QGIS's `iface`, and saves a made-up project:

1. with the option off, and checks nothing is written;
2. with the option on and `publish/` chosen, and checks the documents, the
   data hrefs, the QML styles and a categorised one's field, the map
   canvas's extent in WGS84 as the initial view, the web map links of an XYZ
   layer and of a WMS layer whose made-up server QGIS cannot reach, and the
   message bar's one warning for a layer whose data is outside the folder;
3. after removing a layer, and checks only that layer's document and style
   are removed;
4. after a layer's data file is deleted and the project read again, and checks
   that layer is left out with its own warning;
5. with the option off, through Project ▸ Write STAC catalogue now: saved, with
   changes not yet saved, and for a project not saved as a file;
6. through the Processing algorithm, on two made-up project files one after
   the other, as batch mode runs them, and on a file that is not a project,
   checking the project on screen is untouched;
7. after `unload`, and checks nothing more is written, the menu action and the
   Processing provider are gone.

It also draws the QUAC page of Project Properties and, given a path, saves it
as a PNG. It prints what it checked and exits non-zero on a failure. It is not
one of the unit tests: it needs QGIS and its Processing plugin, which it looks
for in QGIS's own `python/plugins` folder.
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

from qgis.core import (  # noqa: E402
    QgsApplication,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsEditorWidgetSetup,
    QgsProcessingException,
    QgsProcessingFeedback,
    QgsProject,
    QgsRasterLayer,
    QgsRectangle,
    QgsVectorLayer,
)
from qgis.gui import QgsMapCanvas  # noqa: E402
from qgis.PyQt.QtWidgets import QMainWindow, QMenu  # noqa: E402

try:
    from qgis.PyQt.QtGui import QAction  # noqa: E402
except ImportError:
    from qgis.PyQt.QtWidgets import QAction  # noqa: E402

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
    """The parts of `QgisInterface` the plugin uses, with a Project menu holding Save, Save As and Close."""

    def __init__(self) -> None:
        self.bar = MessageBar()
        self.factories: list[Any] = []
        self.window = QMainWindow()
        self.project_menu = QMenu('Project', self.window)
        self.save_as = QAction('Save As…', self.window)
        for action in (QAction('Save', self.window), self.save_as, QAction('Close', self.window)):
            self.project_menu.addAction(action)

    def messageBar(self) -> MessageBar:  # noqa: N802 - QGIS's name
        return self.bar

    def mainWindow(self) -> QMainWindow:  # noqa: N802 - QGIS's name
        return self.window

    def projectMenu(self) -> QMenu:  # noqa: N802 - QGIS's name
        return self.project_menu

    def actionSaveProjectAs(self) -> QAction:  # noqa: N802 - QGIS's name
        return self.save_as

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


# Made-up web map layers, as QGIS writes their sources. QGIS reaches neither host.
XYZ_SOURCE = 'type=xyz&url=https://tiles.example.test/%7Bz%7D/%7Bx%7D/%7By%7D.png&zmax=19&zmin=0'
WMS_SOURCE = 'crs=EPSG:3857&format=image/png&layers=parcels&styles&url=https://maps.example.test/wms'


def web_layer(project: Any, source: str, name: str, group: Any) -> QgsRasterLayer:
    added = QgsRasterLayer(source, name, 'wms')
    project.addMapLayer(added, False)
    group.addLayer(added)
    return added


class Feedback(QgsProcessingFeedback):
    """Keeps what an algorithm reports."""

    def __init__(self) -> None:
        super().__init__()
        self.warnings: list[str] = []
        self.infos: list[str] = []

    def pushWarning(self, text: str) -> None:  # noqa: N802 - QGIS's name
        self.warnings.append(text)

    def pushInfo(self, text: str) -> None:  # noqa: N802 - QGIS's name
        self.infos.append(text)


def start_processing() -> Any:
    """QGIS's Processing framework, from QGIS's own `python/plugins` folder, started as a standalone script starts it."""
    plugins = Path(QgsApplication.pkgDataPath()) / 'python' / 'plugins'
    if str(plugins) not in sys.path:
        sys.path.append(str(plugins))
    from processing.core.Processing import Processing

    Processing.initialize()
    import processing

    return processing


def save_apart(path: Path, layers: list[tuple[Path, str]], folder_setting: str = '') -> None:
    """Saves a made-up project file holding `layers`, each a data file and a name, through a `QgsProject` of its own."""
    project = QgsProject()
    for data, name in layers:
        added = QgsVectorLayer(str(data), name, 'ogr')
        assert added.isValid(), name
        project.addMapLayer(added)
    if folder_setting:
        project.writeEntry('quac', 'catalogue/folder', folder_setting)
    assert project.write(str(path)), path
    project.clear()


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
        import quac

        home = work / 'Parks Project'
        publish = home / 'publish'
        parks = write(publish / 'vector' / 'parks.geojson', points([{'id': 1, 'name': 'Example Park', 'kind': 'dog'}, {'id': 2, 'name': 'Sample Reserve', 'kind': 'nature'}]))
        playgrounds = write(publish / 'vector' / 'playgrounds.geojson', points([{'id': 1, 'name': 'Swings'}]))
        kinds = write(publish / 'lookups' / 'kinds.geojson', points([{'code': 'dog', 'label': 'Dog park'}, {'code': 'nature', 'label': 'Nature reserve'}]))
        benches = write(publish / 'vector' / 'benches.geojson', points([{'id': 1, 'name': 'Bench by the lake'}]))
        trails = write(home / 'outside' / 'trails.geojson', points([{'id': 1, 'name': 'Lake loop'}]))

        processing = start_processing()
        iface = Iface()
        plugin = quac.classFactory(iface)
        plugin.initGui()
        check(len(iface.factories) == 1, 'initGui registers the QUAC page of Project Properties')
        labels = [action.text() for action in iface.project_menu.actions()]
        check(labels == ['Save', 'Save As…', 'Write STAC catalogue now', 'Close'], f'the Project menu has Write STAC catalogue now after Save As: {labels}')
        write_now = iface.project_menu.actions()[2]
        provider = QgsApplication.processingRegistry().providerById('quac')
        algorithm = QgsApplication.processingRegistry().algorithmById('quac:writequaccatalogue')
        check(provider is not None and provider.name() == 'QUAC' and not provider.icon().isNull(), 'initGui adds the QUAC Processing provider, with the icon')
        check(algorithm is not None and algorithm.displayName() == 'Write QUAC catalogue', 'the provider holds Write QUAC catalogue')

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
        streets_layer = web_layer(project, XYZ_SOURCE, 'Streets', root)
        parcels_wms_layer = web_layer(project, WMS_SOURCE, 'Parcels WMS', root)
        check(streets_layer.isValid(), 'QGIS opens the XYZ layer without reaching its host')
        check(not parcels_wms_layer.isValid(), 'QGIS cannot open the WMS layer, whose host it cannot reach')
        parks_layer.setEditorWidgetSetup(parks_layer.fields().indexOf('kind'), QgsEditorWidgetSetup('ValueRelation', {
            'Layer': kinds_layer.id(), 'LayerName': 'Kinds', 'Key': 'code', 'Value': 'label',
            'AllowNull': False, 'AllowMulti': False, 'OrderByValue': False, 'FilterExpression': '',
        }))
        parks_layer.setRenderer(QgsCategorizedSymbolRenderer('kind', []))
        # A map canvas writes its extent into the project on save, as QGIS Desktop's does.
        canvas = QgsMapCanvas()
        canvas.setDestinationCrs(QgsCoordinateReferenceSystem('EPSG:3857'))
        canvas.setExtent(QgsRectangle(12890000, -3760000, 12900000, -3750000))
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
        check(root_document['type'] == 'Catalog' and [link['title'] for link in root_document['links'] if link['rel'] == 'child'] == ['Recreation', 'Kinds', 'Streets', 'Parcels WMS'], 'the root links the Recreation group, Kinds, Streets and Parcels WMS; Base maps, left with no layer, is left out')
        collections = {}
        for name in written:
            if name.endswith('.json') and name.startswith('Parks.stac/'):
                document = json.loads((publish / name).read_text(encoding='utf-8'))
                if document['type'] == 'Collection':
                    collections[document['title']] = (name, document)
        check(sorted(collections) == ['Benches', 'Kinds', 'Parcels WMS', 'Parks', 'Playgrounds', 'Streets'], 'a Collection for each layer in the folder, for Streets and for Parcels WMS, none for Trails')
        streets_document = collections['Streets'][1]
        web_links = [link for link in streets_document['links'] if link['rel'] in ('wms', 'wmts', 'xyz')]
        check(web_links == [{'rel': 'xyz', 'href': 'https://tiles.example.test/{z}/{x}/{y}.png'}], f'Streets links its tile address: {web_links}')
        check('https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json' in streets_document.get('stac_extensions', []), 'Streets lists the Web Map Links extension')
        check('data' not in streets_document['assets'] and streets_document.get('quac:editable') is False, 'Streets has no data asset and is not editable')
        parcels_document = collections['Parcels WMS'][1]
        wms_links = [link for link in parcels_document['links'] if link['rel'] in ('wms', 'wmts', 'xyz')]
        check([(link['rel'], link['href'], link.get('wms:layers')) for link in wms_links] == [('wms', 'https://maps.example.test/wms', ['parcels'])], f'Parcels WMS, which QGIS could not open, links its WMS address: {wms_links}')
        check('https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json' in parcels_document.get('stac_extensions', []), 'Parcels WMS lists the Web Map Links extension')
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
        check(style.get('quac:categorised_field') == 'kind', f"Parks's categorised style names the field it classifies by: {style}")
        view = root_document.get('quac:initial_view')
        print('      initial view:', view)
        # The canvas widens the extent to its own shape, so the view is checked to be around the extent's centre, 115.838, -31.936, in degrees.
        around_centre = isinstance(view, list) and len(view) == 4 and 115.7 < view[0] < 115.838 < view[2] < 116 and -32.1 < view[1] < -31.936 < view[3] < -31.8
        check(around_centre, "the root's initial view is the canvas's extent in WGS84")
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
        check('Parcels WMS' not in iface.bar.messages[-1][1] and 'could not open' not in iface.bar.messages[-1][1], 'the warning does not name Parcels WMS')

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
        iface.bar.messages.clear()
        write_now.trigger()
        check([text for _title, text, _level in iface.bar.messages] == ['Save the project as a .qgz or .qgs file first, then write its STAC catalogue.'], 'for a project not saved as a file the menu action says to save it first')
        check(not unsaved_project.exists(), 'nothing is written for a project not saved as a file')

        # 5. Project ▸ Write STAC catalogue now, with the option off.
        check(project.read(str(project_file)), 'the project reads again')
        project.writeEntry('quac', 'catalogue/write_on_save', False)
        project.writeEntry('quac', 'catalogue/folder', 'publish')
        check(project.write(), 'the project saves with the option off and publish/ chosen')
        shutil.rmtree(publish / 'Parks.stac')
        (publish / 'Parks.stac.json').unlink()
        iface.bar.messages.clear()
        check(not project.isDirty(), 'the project has no unsaved changes')
        write_now.trigger()
        print('      message:', iface.bar.messages[-1][1] if iface.bar.messages else None)
        check((publish / 'Parks.stac.json').is_file() and (publish / 'Parks.stac').is_dir(), 'the menu action writes the catalogue with the option off')
        check(len(iface.bar.messages) == 1 and iface.bar.messages[0][1].startswith('Wrote the STAC catalogue Parks.stac.json.') and 'as last saved' not in iface.bar.messages[0][1], 'the menu action gives the message a save gives, with no note on unsaved changes')
        saved_files = files_under(publish)

        project.removeMapLayer(next(loaded.id() for loaded in project.mapLayers().values() if loaded.name() == 'Kinds'))
        # QGIS Desktop marks the project changed when a layer is removed; a project on its own does not.
        project.setDirty(True)
        check(project.isDirty(), 'removing Kinds leaves the project with unsaved changes')
        iface.bar.messages.clear()
        write_now.trigger()
        print('      message:', iface.bar.messages[-1][1] if iface.bar.messages else None)
        check(files_under(publish) == saved_files, 'with unsaved changes, the menu action writes the project as last saved: Kinds is still written')
        check(len(iface.bar.messages) == 1 and iface.bar.messages[0][1].endswith('It follows the project as last saved. To include your unsaved changes, save the project.'), 'the message says the catalogue follows the project as last saved, and to save to include the changes')
        check(project.isDirty() and not [loaded for loaded in project.mapLayers().values() if loaded.name() == 'Kinds'], 'the project on screen keeps its unsaved changes')

        # 6. The Processing algorithm, on two project files one after the other, as batch mode runs them.
        batch = work / 'Batch'
        sites = write(batch / 'data' / 'sites.geojson', points([{'id': 1, 'name': 'Site A'}]))
        wells = write(batch / 'data' / 'wells.geojson', points([{'id': 1, 'name': 'Well 1'}]))
        elsewhere = write(work / 'Elsewhere' / 'roads.geojson', points([{'id': 1, 'name': 'Main road'}]))
        save_apart(batch / 'Alpha.qgz', [(sites, 'Sites')])
        save_apart(batch / 'Beta.qgs', [(wells, 'Wells'), (elsewhere, 'Roads')], folder_setting='not-made')
        (batch / 'Broken.qgz').write_bytes(b'not a project')
        on_screen = (project.fileName(), sorted(project.mapLayers()), project.isDirty())
        alpha_feedback, beta_feedback = Feedback(), Feedback()
        alpha = processing.run('quac:writequaccatalogue', {'PROJECT': str(batch / 'Alpha.qgz')}, feedback=alpha_feedback)
        beta = processing.run('quac:writequaccatalogue', {'PROJECT': str(batch / 'Beta.qgs'), 'FOLDER': str(batch)}, feedback=beta_feedback)
        print('      results:', alpha, beta)
        print('      warning:', beta_feedback.warnings)
        batch_files = files_under(batch)
        check(alpha == {'ROOT_FILE': str(batch.resolve() / 'Alpha.stac.json'), 'LAYERS_WRITTEN': 1, 'LAYERS_LEFT_OUT': 0}, "Alpha, with no folder given, writes into its own folder, and gives the root file's path and the counts")
        check(beta == {'ROOT_FILE': str(batch.resolve() / 'Beta.stac.json'), 'LAYERS_WRITTEN': 1, 'LAYERS_LEFT_OUT': 1}, 'Beta, with the folder given, writes there rather than its own setting, and counts Roads left out')
        for stem, title in (('Alpha', 'Sites'), ('Beta', 'Wells')):
            names = sorted(name for name in batch_files if name.startswith(f'{stem}.stac'))
            documents = [json.loads((batch / name).read_text(encoding='utf-8')) for name in names if name.endswith('.json')]
            check(f'{stem}.stac.json' in names and all(name == f'{stem}.stac.json' or name.startswith(f'{stem}.stac/') for name in names), f'{stem} writes {stem}.stac.json and its own {stem}.stac/: {names}')
            check([document['title'] for document in documents if document['type'] == 'Collection'] == [title], f'{stem} holds its own layer, {title}, only')
        print('      infos:', alpha_feedback.infos)
        check('Wrote the STAC catalogue Alpha.stac.json.' in alpha_feedback.infos and alpha_feedback.warnings == [], 'Alpha reports what it wrote')
        check(len(beta_feedback.warnings) == 1 and 'Roads (its data file is outside the chosen folder)' in beta_feedback.warnings[0] and 'move its data file into the chosen folder' in beta_feedback.warnings[0], 'Beta warns that Roads was left out, with the message bar\'s reason and next step')
        check((project.fileName(), sorted(project.mapLayers()), project.isDirty()) == on_screen and QgsProject.instance() is project, 'the project on screen is untouched')
        broken_error = ''
        try:
            processing.run('quac:writequaccatalogue', {'PROJECT': str(batch / 'Broken.qgz')}, feedback=Feedback())
        except QgsProcessingException as error:
            broken_error = str(error)
        print('      error:', broken_error)
        check('Broken.qgz could not be read' in broken_error, 'a file QGIS cannot read as a project gives a clear error')
        check(files_under(batch) == batch_files, 'and writes no file')
        missing_error = ''
        try:
            processing.run('quac:writequaccatalogue', {'PROJECT': str(batch / 'Beta.qgs')}, feedback=Feedback())
        except QgsProcessingException as error:
            missing_error = str(error)
        check('its folder does not exist' in missing_error and 'not-made' in missing_error, f"Beta, with no folder given, names its own chosen folder, which does not exist: {missing_error}")

        # 7. After unload.
        project.writeEntry('quac', 'catalogue/write_on_save', True)
        plugin.unload()
        check(iface.factories == [], 'unload unregisters the page')
        check([action.text() for action in iface.project_menu.actions()] == ['Save', 'Save As…', 'Close'], 'unload takes Write STAC catalogue now out of the Project menu')
        check(QgsApplication.processingRegistry().providerById('quac') is None, 'unload removes the QUAC Processing provider')
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
