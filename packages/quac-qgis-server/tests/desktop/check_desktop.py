"""
The plugin's QGIS Desktop part in QGIS's own Python, with no window: run with
QGIS's Python bindings and `QT_QPA_PLATFORM=offscreen`.

    QT_QPA_PLATFORM=offscreen python3 tests/desktop/check_desktop.py [screenshot.png]

It lays out the plugin as QGIS installs it, starts it through `classFactory`
with a stand-in for QGIS's `iface`, and saves a made-up project:

1. with the option off, and checks nothing is written;
2. with the option on and `publish/` chosen, and checks the documents, the
   data hrefs and the size and last change of Parks's data file, the QML styles
   and a categorised one's field, the map
   canvas's extent in WGS84 as the initial view, a default and the form's
   order and conditions, a condition reading a layer left out not being
   written, the web map links of an XYZ
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
7. a project of its own holding a GeoPackage layer, and checks its primary
   key, its feature id filled by the data, and a text field's length;
8. a project set to export a copy of every layer, with GeoParquet and
   FlatGeobuf ticked, holding a layer outside its folder and one inside it:
   through Project ▸ Write STAC catalogue now, in QGIS's task manager, and
   the Processing algorithm, checking each layer is copied in each format
   this QGIS writes, the filter, the field QGIS Server excludes left out,
   WGS84, each copy's size and checksum in the catalogue and the layer made
   read-only; a save writing nothing; and the copies removed once the project
   links its data again. It prints the formats this QGIS writes;
9. after `unload`, and checks nothing more is written, the menu action and the
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
from datetime import datetime, timezone
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
    Qgis,
    QgsApplication,
    QgsAttributeEditorContainer,
    QgsAttributeEditorField,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsDefaultValue,
    QgsEditFormConfig,
    QgsEditorWidgetSetup,
    QgsExpression,
    QgsFeature,
    QgsField,
    QgsGeometry,
    QgsOptionalExpression,
    QgsPointXY,
    QgsProcessingException,
    QgsProcessingFeedback,
    QgsProject,
    QgsRasterLayer,
    QgsRectangle,
    QgsVectorFileWriter,
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


def check_field_facts(home: Path) -> None:
    """
    Saves a made-up project holding one GeoPackage layer, with a text field of
    at most 20 characters, writes its catalogue, and checks what QGIS gives
    about the layer's data beyond the project's text: the feature id column as
    the primary key, filled by the data, and the text field's length.
    """
    from quac.desktop import write_catalogue

    home.mkdir(parents=True)
    data = home / 'sites.gpkg'
    source = QgsVectorLayer('Point?crs=EPSG:4326&field=name:string(20)', 'sites', 'memory')
    feature = QgsFeature(source.fields())
    feature.setAttributes(['Site A'])
    feature.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(115.85, -31.95)))
    source.dataProvider().addFeatures([feature])
    options = QgsVectorFileWriter.SaveVectorOptions()
    options.driverName = 'GPKG'
    options.layerName = 'sites'
    written = QgsVectorFileWriter.writeAsVectorFormatV3(source, str(data), QgsProject.instance().transformContext(), options)
    sites = QgsVectorLayer(f'{data}|layername=sites', 'Sites', 'ogr')
    check(sites.isValid(), f'QGIS writes and opens the made-up GeoPackage: {written}')
    project = QgsProject()
    project.addMapLayer(sites)
    project.setFileName(str(home / 'Sites.qgs'))
    check(project.write(), 'the GeoPackage project saves')
    _folder, publication = write_catalogue(project, str(home))
    documents = [json.loads(content) for name, content in publication.files if name.endswith('.json')]
    collection = next((document for document in documents if document.get('type') == 'Collection'), {})
    columns = {column['name']: column for column in collection.get('table:columns', [])}
    check(collection.get('quac:primary_key') == ['fid'], f"the GeoPackage layer's primary key is its feature id: {collection.get('quac:primary_key')}")
    check(columns.get('fid', {}).get('quac:filled_by_data') is True, f"the feature id is filled by the data: {columns.get('fid')}")
    check(columns.get('name', {}).get('quac:length') == 20, f"the text field holds at most 20 characters: {columns.get('name')}")
    project.clear()


def check_export(home: Path, processing: Any, iface: Any, plugin: Any, write_now: Any) -> None:
    """
    Saves a made-up project set to export a copy of every layer, with
    every format ticked: Roads outside its folder,
    filtered to the roads with `keep` = 1 and with `owner` excluded from QGIS
    Server, Benches inside it, and Elevation, a raster outside it. Exports it
    from the menu and the algorithm.
    """
    import hashlib
    import time

    from osgeo import ogr

    from quac.copy_data import _csv_geometry, writable_formats
    from quac.publish import copy_layer_name

    writable = writable_formats()
    print('      writes copies as:', list(writable))
    roads_file = write(home / 'outside' / 'roads.geojson', points([
        {'id': 1, 'name': 'Main road', 'keep': 1, 'owner': 'Example Council'},
        {'id': 2, 'name': 'Old track', 'keep': 0, 'owner': 'Example Trust'},
    ]))
    publish = home / 'publish'
    benches_file = write(publish / 'benches.geojson', points([{'id': 1, 'name': 'Bench'}]))
    project = QgsProject.instance()
    project.clear()
    roads = layer(project, roads_file, 'Roads', project.layerTreeRoot())
    benches = layer(project, benches_file, 'Benches', project.layerTreeRoot())
    elevation_file = elevation_raster(home / 'outside' / 'elevation.tif')
    elevation = QgsRasterLayer(str(elevation_file), 'Elevation', 'gdal')
    check(elevation.isValid(), 'the made-up raster opens')
    project.addMapLayer(elevation)
    roads.setSubsetString('"keep" = 1')
    hide = getattr(getattr(Qgis, 'FieldConfigurationFlag', None), 'HideFromWfs', None) or QgsField.ConfigurationFlag.HideFromWfs
    roads.setFieldConfigurationFlags(roads.fields().indexOf('owner'), hide)
    project.writeEntry('quac', 'catalogue/folder', 'publish')
    project.writeEntry('quac', 'catalogue/mode', 'export')
    project.writeEntry('quac', 'catalogue/formats', EVERY_FORMAT)
    project.writeEntry('quac', 'catalogue/write_on_save', True)
    check(project.write(str(home / 'Roads.qgz')), 'the export project saves, set to export a copy of every layer')
    check(not (publish / 'Roads.stac.json').exists(), 'a save of a project set to export writes nothing')
    extensions = [extension for format_id, extension in (('geoparquet', 'parquet'), ('flatgeobuf', 'fgb'), ('geopackage', 'gpkg'), ('geojson', 'geojson')) if format_id in writable]
    check(
        _csv_geometry(QgsVectorLayer('Point?crs=EPSG:4326', 'p', 'memory')) == ['GEOMETRY=AS_XY']
        and all(_csv_geometry(QgsVectorLayer(kind, 'other', 'memory')) == [] for kind in ('MultiPoint?crs=EPSG:4326', 'LineString?crs=EPSG:4326', 'Polygon?crs=EPSG:4326', 'None')),
        'a CSV copy writes a point layer as X and Y columns, and no geometry for any other layer',
    )

    def check_copies(how: str) -> None:
        root = json.loads((publish / 'Roads.stac.json').read_text(encoding='utf-8'))
        documents = {}
        for link in root['links']:
            if link['rel'] == 'child':
                path = posixpath.normpath(link['href'])
                documents[path] = json.loads((publish / path).read_text(encoding='utf-8'))
        for name, copied_layer in (('Roads', roads), ('Benches', benches)):
            document_path, collection = next((path, document) for path, document in documents.items() if document.get('title') == name)
            check(collection['quac:editable'] is False, f'{how}: {name} is read-only')
            assets = [collection['assets']['data'], *(asset for key, asset in collection['assets'].items() if key not in ('data',) and 'data' in asset.get('roles', []))]
            files = [publish / posixpath.normpath(posixpath.join(posixpath.dirname(document_path), unquote(asset['href']))) for asset in assets]
            check([file_.suffix[1:] for file_ in files] == extensions, f'{how}: {name} is copied as {extensions}, the data first: {[file_.name for file_ in files]}')
            for asset, file_ in zip(assets, files):
                check(file_.is_file() and asset['file:size'] == file_.stat().st_size and asset['file:checksum'] == '1220' + hashlib.sha256(file_.read_bytes()).hexdigest(), f'{how}: {file_.name} is in Roads.stac/data, with its size and checksum')
                copied = QgsVectorLayer(str(file_), 'copy', 'ogr')
                names = [field_.name() for field_ in copied.fields()]
                check(copied.isValid() and copied.crs().authid() == 'EPSG:4326', f'{how}: {file_.name} opens, in WGS84')
                if file_.suffix in ('.gpkg', '.fgb'):
                    dataset = ogr.Open(str(file_))
                    inner = dataset.GetLayer(0).GetName()
                    check(inner == copy_layer_name(copied_layer.id()), f'{how}: {file_.name} names its layer by the layer id: {inner}')
                if name == 'Roads':
                    check(copied.featureCount() == 1 and 'owner' not in names and 'name' in names, f'{how}: {file_.name} holds the filtered road, without the excluded field: {names}, {copied.featureCount()}')
                    if file_.suffix == '.parquet':
                        check_geoparquet(file_)
            table = collection['assets'].get('csv', {})
            table_file = publish / posixpath.normpath(posixpath.join(posixpath.dirname(document_path), unquote(table.get('href', 'missing'))))
            check(table.get('roles') == ['table'] and table.get('type') == 'text/csv' and table_file.is_file() and table['file:checksum'] == '1220' + hashlib.sha256(table_file.read_bytes()).hexdigest(), f'{how}: {name} has a CSV copy, a table asset with its checksum')
            header = table_file.read_bytes().split(b'\n', 1)[0]
            check(header.startswith(b'\xef\xbb\xbfX,Y,'), f'{how}: the CSV starts with a byte order mark and the X and Y columns: {header!r}')
            if name == 'Roads':
                check(b'owner' not in header and len(table_file.read_bytes().strip().split(b'\n')) == 2, f'{how}: the CSV holds the filtered road, without the excluded field')
                check('owner' not in [column['name'] for column in collection.get('table:columns', [])], f'{how}: the catalogue leaves the excluded field out')
            if 'pmtiles' in writable:
                check_pmtiles(how, name, collection, document_path, publish)
        document_path, collection = next((path, document) for path, document in documents.items() if document.get('title') == 'Elevation')
        data = collection['assets']['data']
        file_ = publish / posixpath.normpath(posixpath.join(posixpath.dirname(document_path), unquote(data['href'])))
        check(collection['quac:editable'] is False and 'pmtiles' not in collection['assets'], f'{how}: Elevation is read-only, with no PMTiles copy')
        check(file_.name == f'{elevation.id()}.tif' and data['type'] == 'image/tiff; application=geotiff; profile=cloud-optimized', f'{how}: Elevation is copied as a COG: {file_.name}, {data["type"]}')
        check(file_.is_file() and data['file:size'] == file_.stat().st_size and data['file:checksum'] == '1220' + hashlib.sha256(file_.read_bytes()).hexdigest(), f'{how}: {file_.name} is in Roads.stac/data, with its size and checksum')
        check_cog(how, file_)

    if os.environ.get('QUAC_EXPECT_GEOPARQUET'):
        check('geoparquet' in writable, f'this QGIS writes GeoParquet: {list(writable)}')
    iface.bar.messages.clear()
    write_now.trigger()
    waited = time.monotonic()
    while plugin._task is not None and time.monotonic() - waited < 120:
        QgsApplication.processEvents()
        time.sleep(0.05)
    print('      message:', iface.bar.messages[-1][1] if iface.bar.messages else None)
    check(plugin._task is None, 'the export task finishes')
    check_copies('from the menu')
    expected = 'Exported the STAC catalogue Roads.stac.json. Copied the data of 3 layers.'
    if 'geoparquet' not in writable:
        expected += " The vector layers were copied as FlatGeobuf, because this version of QGIS can't write GeoParquet."
    check(bool(iface.bar.messages) and iface.bar.messages[-1][1] == expected, f'the message bar says what was exported: {expected}')

    for file_ in (publish / 'Roads.stac' / 'data').iterdir():
        file_.unlink()
    # The algorithm's run writes PMTiles with GDAL, as where tippecanoe is not installed.
    import quac.copy_data
    with_tippecanoe = quac.copy_data.tippecanoe
    print('      tippecanoe:', with_tippecanoe())
    quac.copy_data.tippecanoe = lambda: None
    result = processing.run('quac:writequaccatalogue', {'PROJECT': str(home / 'Roads.qgz')}, feedback=Feedback())
    print('      result:', result)
    check(result['LAYERS_COPIED'] == 3 and result['LAYERS_LEFT_OUT'] == 0, 'the algorithm exports, as the project is set to')
    check_copies('from the algorithm' + (' (GDAL)' if with_tippecanoe() else ''))
    quac.copy_data.tippecanoe = with_tippecanoe

    before = files_under(publish)
    check(project.write(), 'the project saves')
    check(files_under(publish) == before, 'a save of a project set to export changes nothing')

    project.writeEntry('quac', 'catalogue/formats', [])
    check(project.write(), 'the project saves with no format ticked')
    refused = ''
    try:
        processing.run('quac:writequaccatalogue', {'PROJECT': str(home / 'Roads.qgz')}, feedback=Feedback())
    except QgsProcessingException as error:
        refused = str(error)
    check('no format is ticked' in refused and files_under(publish) == before, f'with no format ticked, the export is refused and nothing changes: {refused}')
    project.writeEntry('quac', 'catalogue/formats', EVERY_FORMAT)

    project.writeEntry('quac', 'catalogue/mode', 'link')
    check(project.write(), 'the project saves, set to link its data')
    check(not (publish / 'Roads.stac' / 'data').exists() or not any((publish / 'Roads.stac' / 'data').iterdir()), 'the copies are removed once the project links its data')
    check((publish / 'benches.geojson').is_file(), 'the data in the folder is untouched')
    project.clear()


def elevation_raster(path: Path) -> Path:
    """A made-up one-band raster of 1,024 by 1,024 cells in EPSG:28355, rising to the east, with its first row no data."""
    from array import array

    from osgeo import gdal, osr

    path.parent.mkdir(parents=True, exist_ok=True)
    dataset = gdal.GetDriverByName('GTiff').Create(str(path), 1024, 1024, 1, gdal.GDT_Byte)
    dataset.SetGeoTransform((390000, 5, 0, 6460000, 0, -5))
    system = osr.SpatialReference()
    system.ImportFromEPSG(28355)
    dataset.SetProjection(system.ExportToWkt())
    band = dataset.GetRasterBand(1)
    band.SetNoDataValue(255)
    cells = array('B', [255] * 1024 + [column // 5 for _row in range(1023) for column in range(1024)])
    band.WriteRaster(0, 0, 1024, 1024, cells.tobytes())
    dataset = None
    return path


def check_cog(how: str, copy_file: Path) -> None:
    """Checks a raster's COG copy: GDAL reads it as a COG, with overviews and its band's statistics in the file, in its own coordinate system, keeping its no-data value."""
    from osgeo import gdal

    dataset = gdal.Open(str(copy_file))
    band = dataset.GetRasterBand(1)
    statistics = {key: value for key, value in band.GetMetadata().items() if key.startswith('STATISTICS_')}
    print('      COG:', dataset.GetMetadata('IMAGE_STRUCTURE'), band.GetOverviewCount(), statistics)
    check(dataset.GetMetadata('IMAGE_STRUCTURE').get('LAYOUT') == 'COG' and band.GetOverviewCount() >= 1, f'{how}: the copy is a COG with overviews')
    check(statistics.get('STATISTICS_MINIMUM') == '0' and statistics.get('STATISTICS_MAXIMUM') == '204', f'{how}: the COG holds its band statistics, the no-data cells left out: {statistics}')
    check(dataset.GetSpatialRef().GetAuthorityCode(None) == '28355' and band.GetNoDataValue() == 255, f'{how}: the COG keeps its coordinate system and no-data value')


# Every format a vector layer's copy can be written in.
EVERY_FORMAT = ['geoparquet', 'flatgeobuf', 'geopackage', 'geojson', 'csv', 'pmtiles']


def check_pmtiles(how: str, name: str, collection: dict[str, Any], document_path: str, publish: Path) -> None:
    """Checks a layer's PMTiles copy: registered by a `pmtiles` link naming its tile layer and a `visual` asset, both naming a file GDAL reads with the layer's features."""
    from osgeo import ogr

    links = [link for link in collection['links'] if link['rel'] == 'pmtiles']
    asset = collection['assets'].get('pmtiles', {})
    check(len(links) == 1 and asset.get('roles') == ['visual'] and links[0]['href'] == asset.get('href'), f'{how}: {name} has a PMTiles link and a visual asset, to the same file')
    file_ = publish / posixpath.normpath(posixpath.join(posixpath.dirname(document_path), unquote(links[0]['href'])))
    archive = ogr.Open(str(file_))
    tile_layer = archive.GetLayerByName(links[0]['pmtiles:layers'][0]) if archive is not None else None
    count = tile_layer.GetFeatureCount() if tile_layer is not None else -1
    check(file_.suffix == '.pmtiles' and count == (1 if name in ('Roads', 'Benches') else count), f'{how}: {name}\'s PMTiles holds its tile layer with its features at the largest zoom: {count}')


def check_geoparquet(copy_file: Path) -> None:
    """Checks a GeoParquet copy against Portolan's rules: GeoParquet 1.1 with a bounding-box covering column, zstd, and no row group over 150,000 rows."""
    try:
        import pyarrow.parquet as parquet
    except ImportError:
        print('      pyarrow is not installed, so the GeoParquet file itself is not read')
        return
    file_ = parquet.ParquetFile(str(copy_file))
    geo = json.loads(file_.schema_arrow.metadata[b'geo'])
    column = geo['columns'][geo['primary_column']]
    print('      geo metadata:', geo['version'], column.get('covering'), column.get('encoding'))
    check(geo['version'].startswith('1.1') and 'bbox' in (column.get('covering') or {}), f"the copy is GeoParquet 1.1 with a bounding-box covering column: {geo['version']}")
    metadata = file_.metadata
    compressions = {metadata.row_group(group).column(index).compression for group in range(metadata.num_row_groups) for index in range(metadata.num_columns)}
    check(compressions == {'ZSTD'}, f'the copy is compressed with zstd: {compressions}')
    check(all(metadata.row_group(group).num_rows <= 150000 for group in range(metadata.num_row_groups)), 'no row group holds more than 150,000 rows')


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
        # A default, and a Drag and Drop Designer form whose containers show a field on a condition: one on Parks's own field,
        # one reading Trails, which is left out.
        parks_fields = parks_layer.fields()
        parks_layer.setDefaultValueDefinition(parks_fields.indexOf('name'), QgsDefaultValue("'Unnamed park'"))
        form = parks_layer.editFormConfig()
        form.setLayout(QgsEditFormConfig.TabLayout)
        form_root = form.invisibleRootContainer()
        form_root.clear()
        form_root.addChildElement(QgsAttributeEditorField('id', parks_fields.indexOf('id'), form_root))
        for title, condition, field_name in (('Details', '"kind" = \'dog\'', 'name'), ('Trail', 'aggregate(\'Trails\', \'count\', "id") > 0', 'kind')):
            container = QgsAttributeEditorContainer(title, form_root)
            container.setVisibilityExpression(QgsOptionalExpression(QgsExpression(condition)))
            container.addChildElement(QgsAttributeEditorField(field_name, parks_fields.indexOf(field_name), container))
            form_root.addChildElement(container)
        parks_layer.setEditFormConfig(form)
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
        parks_status = parks.stat()
        parks_changed = datetime.fromtimestamp(parks_status.st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        parks_data = parks_document['assets']['data']
        check((parks_data.get('file:size'), parks_data.get('updated')) == (parks_status.st_size, parks_changed), f"Parks's data carries its file's size and last change: {parks_data.get('file:size')}, {parks_data.get('updated')}")
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
        name_column = next(column for column in parks_document['table:columns'] if column['name'] == 'name')
        check(name_column.get('quac:default') == {'kind': 'fixed', 'value': 'Unnamed park', 'on_update': False}, f"the name's default reaches the document: {name_column.get('quac:default')}")
        check(name_column.get('quac:visible_when') == ['"kind" = \'dog\''], f"the condition for showing the name reaches the document: {name_column.get('quac:visible_when')}")
        check(parks_document.get('quac:form_order') == ['id', 'name', 'kind'], f"the form's order reaches the document: {parks_document.get('quac:form_order')}")
        check('quac:visible_when' not in kind and 'Trails' not in json.dumps(parks_document), 'the condition reading Trails, which is left out, is not written')
        all_text = ''.join((publish / name).read_text(encoding='utf-8') for name in written if name.startswith('Parks.stac'))
        check(str(work) not in all_text and 'Parks.qgz' not in all_text, 'no document names a folder of this computer or the project file, which is outside publish/')
        check(not [name for name in written if name.endswith('.tmp')], 'no temporary file is left')
        check(len(iface.bar.messages) == 1, 'one message bar entry')
        print('      message:', iface.bar.messages[-1][1])
        check('Trails (its data file is outside the chosen folder)' in iface.bar.messages[-1][1], 'the warning names Trails and why it was left out')
        check('Parks (kind, its condition for showing it, from Trails)' in iface.bar.messages[-1][1], 'the warning names the condition left out with Trails')
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
        from quac.copy_data import GEOPARQUET, writable_formats

        page.export.setChecked(True)
        for box in (*page._format_boxes.values(), page.pmtiles):
            box.setChecked(False)
        check(page.format_note.isVisibleTo(page) and page.format_note.text() == 'Tick a format to export.', f'with no format ticked, the page says to tick one: {page.format_note.text()}')
        page.flatgeobuf.setChecked(True)
        print('      note:', page.format_note.text())
        check('Not a Portolan catalogue' in page.format_note.text() and 'href="https://portolan-sdi.org/"' in page.format_note.text() and page.format_note.openExternalLinks(), 'with FlatGeobuf alone, the page says the catalogue is not a Portolan catalogue, with a link to Portolan\'s site')
        page.flatgeobuf.setChecked(False)
        page.csv.setChecked(True)
        check(page.format_note.text().startswith("No format holds the vector layers' data."), f'with CSV alone, the page says no format holds the data: {page.format_note.text()}')
        if GEOPARQUET in writable_formats():
            page.geoparquet.setChecked(True)
            check(not page.format_note.isVisibleTo(page), 'with GeoParquet ticked, the page says nothing more')
        page.link.setChecked(True)
        check(not page.format_note.isVisibleTo(page), 'the note is hidden while linking')
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
        check(alpha == {'ROOT_FILE': str(batch.resolve() / 'Alpha.stac.json'), 'LAYERS_WRITTEN': 1, 'LAYERS_LEFT_OUT': 0, 'LAYERS_COPIED': 0}, "Alpha, with no folder given, writes into its own folder, and gives the root file's path and the counts")
        check(beta == {'ROOT_FILE': str(batch.resolve() / 'Beta.stac.json'), 'LAYERS_WRITTEN': 1, 'LAYERS_LEFT_OUT': 1, 'LAYERS_COPIED': 0}, 'Beta, with the folder given, writes there rather than its own setting, and counts Roads left out')
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

        # 7. A GeoPackage layer, in a project of its own.
        check_field_facts(work / 'Sites Project')

        # 8. A project that copies the data of a layer outside its folder.
        check_export(work / 'Export Project', processing, iface, plugin, write_now)
        check(project.read(str(project_file)), 'the Parks project reads again after the export')

        # 9. After unload.
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
