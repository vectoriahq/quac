"""
Copying a layer's data into the chosen folder, for an export of the catalogue
with its data (`desktop.export_catalogue`). `publish.plan_publication` says
which layers to copy; this writes each copy with QGIS and gives what the
catalogue records of it.

- The formats are the ones the project ticks, GeoParquet, FlatGeobuf,
  GeoPackage and GeoJSON for the layer's data, CSV as a table for
  spreadsheets, and PMTiles for viewing it on a web map (`copy_formats`). GeoParquet is written only where this QGIS's GDAL writes
  it with the bounding-box column Portolan asks for, with its rows sorted in
  space and compressed with zstd where GDAL offers them; where it cannot,
  FlatGeobuf is written in its place. The first format is the layer's data.
- PMTiles is written by tippecanoe where it is installed, which thins the
  features evenly at the smaller zooms, and by GDAL otherwise, from the
  smallest zoom at which no tile needs thinning (`fitting_zooms`), as GDAL
  thins tile by tile.
- A copy holds what the project shows: the layer's filter applies, as QGIS
  reads the layer, and the fields QGIS Server excludes are left out. Its
  geometry is in WGS84 (EPSG:4326).
- A raster layer is copied as a cloud-optimised GeoTIFF whatever the formats
  ticked (`_write_cog`): its cell values as QGIS reads them, in its own
  coordinate system, with overviews and each band's statistics in the file.
- Each copy is written to a temporary file beside where it goes, and moved
  into place only once every copy is made (`place_copies`), so a cancelled
  export changes nothing.

`copy_layers` makes no use of a project, so it can run in a `QgsTask` off the
main thread: it opens each layer afresh from its source.
"""

from __future__ import annotations

import hashlib
import math
import os
import shutil
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from qgis.core import (
    Qgis,
    QgsCoordinateReferenceSystem,
    QgsFeatureRequest,
    QgsCoordinateTransform,
    QgsCoordinateTransformContext,
    QgsField,
    QgsRasterBlockFeedback,
    QgsRasterDataProvider,
    QgsRasterFileWriter,
    QgsRasterLayer,
    QgsRasterPipe,
    QgsVectorFileWriter,
    QgsVectorLayer,
    QgsWkbTypes,
)

from qgis.PyQt.QtCore import QMetaType, QProcess, QVariant

from .publish import CopiedData, copy_layer_name, copy_path


# The formats a copy can be written in, by id, in the order a layer's copies are listed: the first ticked is the layer's data.
GEOPARQUET = 'geoparquet'
FLATGEOBUF = 'flatgeobuf'
GEOPACKAGE = 'geopackage'
GEOJSON = 'geojson'
CSV = 'csv'
PMTILES = 'pmtiles'
FORMAT_IDS = (GEOPARQUET, FLATGEOBUF, GEOPACKAGE, GEOJSON, CSV, PMTILES)
# The formats a layer's data is written in; PMTiles is a copy for viewing.
DATA_FORMAT_IDS = (GEOPARQUET, FLATGEOBUF, GEOPACKAGE, GEOJSON, CSV)
# A raster layer's one copy, and its file extension.
COG = 'cog'
COG_EXTENSION = 'tif'
# DEFLATE with a predictor, lossless; a BigTIFF only where the file may pass 4 GB.
_COG_OPTIONS = ('COMPRESS=DEFLATE', 'PREDICTOR=YES', 'BIGTIFF=IF_SAFER')


@dataclass(frozen=True)
class CopyFormat:
    """A format a copy is written in: its id, the GDAL driver, its file extension and its layer creation options."""

    id: str
    driver: str
    extension: str
    layer_options: tuple[str, ...]


@dataclass(frozen=True)
class LayerSource:
    """What opens a layer again: its id, name, source and provider as QGIS gives them, and the fields its copy leaves out."""

    layer_id: str
    name: str
    source: str
    provider: str
    hidden_fields: frozenset[str] = frozenset()
    raster: bool = False


@dataclass
class Copies:
    """What `copy_layers` made: each layer's copies by layer id, each with its temporary file, and each failure with why."""

    made: dict[str, list[tuple[str, CopiedData]]] = field(default_factory=dict)
    failed: dict[str, str] = field(default_factory=dict)
    cancelled: bool = False


def _creation_options(driver_name: str) -> str:
    from osgeo import gdal

    driver = gdal.GetDriverByName(driver_name)
    if driver is None or driver.GetMetadataItem('DCAP_CREATE') != 'YES':
        return ''
    return driver.GetMetadataItem('DS_LAYER_CREATIONOPTIONLIST') or ''


def writable_formats() -> dict[str, CopyFormat]:
    """
    The formats this QGIS writes a copy in, by id: GeoParquet where GDAL's
    Parquet driver writes the bounding-box column (`WRITE_COVERING_BBOX`, GDAL
    3.9 and later), with its rows sorted in space (`SORT_BY_BBOX`) and zstd
    where offered, FlatGeobuf, GeoPackage, GeoJSON (RFC 7946) and CSV, and
    PMTiles where tippecanoe or GDAL writes it.
    """
    formats: dict[str, CopyFormat] = {}
    options = _creation_options('Parquet')
    if 'WRITE_COVERING_BBOX' in options:
        layer_options = ['WRITE_COVERING_BBOX=YES']
        if 'SORT_BY_BBOX' in options:
            layer_options.append('SORT_BY_BBOX=YES')
        if 'ZSTD' in options:
            layer_options.append('COMPRESSION=ZSTD')
        formats[GEOPARQUET] = CopyFormat(GEOPARQUET, 'Parquet', 'parquet', tuple(layer_options))
    formats[FLATGEOBUF] = CopyFormat(FLATGEOBUF, 'FlatGeobuf', 'fgb', ('SPATIAL_INDEX=YES',))
    formats[GEOPACKAGE] = CopyFormat(GEOPACKAGE, 'GPKG', 'gpkg', ())
    formats[GEOJSON] = CopyFormat(GEOJSON, 'GeoJSON', 'geojson', ('RFC7946=YES',))
    # A table for spreadsheets: a byte order mark, so Excel reads it as UTF-8, no geometry, and X and Y columns last for a point layer (`_write_points_csv`).
    formats[CSV] = CopyFormat(CSV, 'CSV', 'csv', ('WRITE_BOM=YES',))
    if tippecanoe() is not None or _creation_options('PMTiles'):
        formats[PMTILES] = CopyFormat(PMTILES, 'PMTiles', 'pmtiles', ())
    return formats


def tippecanoe() -> Optional[str]:
    """tippecanoe's path, where it is installed on the PATH."""
    return shutil.which('tippecanoe')


def default_formats() -> list[str]:
    """The formats a project ticks until it chooses: GeoParquet where this QGIS writes it and FlatGeobuf otherwise, and PMTiles where it can be written."""
    writable = writable_formats()
    return [GEOPARQUET if GEOPARQUET in writable else FLATGEOBUF] + ([PMTILES] if PMTILES in writable else [])


def copy_formats(chosen: list[str]) -> tuple[list[CopyFormat], bool]:
    """
    The formats to copy in, from the ids the project ticks, the layer's data
    first, and whether GeoParquet was ticked and FlatGeobuf written in its
    place, as this QGIS cannot write it. None where none is ticked.
    """
    writable = writable_formats()
    ids = [format_id for format_id in DATA_FORMAT_IDS if format_id in chosen and format_id in writable]
    fallback = GEOPARQUET in chosen and GEOPARQUET not in writable
    if fallback and FLATGEOBUF not in ids:
        ids.insert(0, FLATGEOBUF)
    if PMTILES in chosen and PMTILES in writable:
        ids.append(PMTILES)
    return [writable[format_id] for format_id in ids], fallback


def checksum(file_path: str) -> str:
    """The file's SHA-256 as a multihash in hex, as the File extension's `file:checksum` holds it: `1220` and the digest."""
    digest = hashlib.sha256()
    with open(file_path, 'rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return '1220' + digest.hexdigest()


def copy_layers(
    sources: list[LayerSource],
    folder: str,
    children_folder: str,
    formats: list[CopyFormat],
    transform_context: Optional[QgsCoordinateTransformContext] = None,
    feedback: Any = None,
) -> Copies:
    """
    Copies each vector layer in each format, and each raster layer as a COG,
    to a temporary file beside where its copy goes under `folder`. Stops
    between copies where `feedback` is cancelled, and removes what it made
    then.
    """
    copies = Copies()
    context = transform_context or QgsCoordinateTransformContext()
    for index, source in enumerate(sources):
        made: list[tuple[str, CopiedData]] = []
        for format_ in (_COG_FORMAT,) if source.raster else formats:
            if feedback is not None and feedback.isCanceled():
                copies.cancelled = True
                break
            relative = copy_path(children_folder, source.layer_id, format_.extension)
            target = os.path.join(folder, *relative.split('/'))
            try:
                if format_.id == COG:
                    temporary = _write_cog(source, target, feedback)
                elif format_.id == PMTILES:
                    temporary = _write_pmtiles(source, target, context, feedback)
                else:
                    temporary = _copy_one(source, target, format_, context, feedback)
            except Exception as error:  # noqa: BLE001 - one layer's failure is reported and the export goes on
                copies.failed[source.layer_id] = f'{type(error).__name__}: {error}'
                break
            if temporary is None:
                copies.cancelled = True
                break
            if temporary == '':
                continue
            made.append((temporary, CopiedData(relative, os.path.getsize(temporary), checksum(temporary))))
        if source.layer_id in copies.failed or copies.cancelled:
            for temporary, _copied in made:
                _remove(temporary)
            if copies.cancelled:
                break
            continue
        copies.made[source.layer_id] = made
        if feedback is not None:
            feedback.setProgress(100 * (index + 1) / len(sources))
    if copies.cancelled:
        discard(copies)
    return copies


def _open(source: LayerSource) -> QgsVectorLayer:
    layer = QgsVectorLayer(source.source, source.name, source.provider)
    if not layer.isValid():
        raise RuntimeError(f'QGIS could not open {source.name} from its source')
    return layer


def _temporary_beside(target: str, extension: str) -> str:
    folder = os.path.dirname(target)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f'.{os.path.basename(target)}.{uuid.uuid4().hex}.tmp.{extension}')


def _copy_one(source: LayerSource, target: str, format_: CopyFormat, context: QgsCoordinateTransformContext, feedback: Any) -> Optional[str]:
    """Writes one layer's copy to a temporary file beside `target`, in WGS84, and returns its path, or None where `feedback` was cancelled during it."""
    layer = _open(source)
    temporary = _temporary_beside(target, format_.extension)
    if format_.id == CSV and is_point_layer(layer):
        return _write_points_csv(layer, source, target, temporary, format_, context, feedback)
    return _write(layer, source, temporary, format_.driver, list(format_.layer_options), [], 'EPSG:4326', context, feedback, copy_layer_name(source.layer_id))


def is_point_layer(layer: QgsVectorLayer) -> bool:
    """Whether a layer holds one point a feature, the one kind whose CSV copy gets coordinate columns; a multipoint layer does not."""
    return layer.isSpatial() and QgsWkbTypes.displayString(QgsWkbTypes.flatType(layer.wkbType())) == 'Point'


def coordinate_columns(field_names: list[str]) -> tuple[str, str]:
    """The names of a point layer's CSV coordinate columns: `X` and `Y`, or `X_WGS84` and `Y_WGS84` where a field of the layer is named `X` or `Y` in any case."""
    return ('X_WGS84', 'Y_WGS84') if {name.lower() for name in field_names} & {'x', 'y'} else ('X', 'Y')


def _write_points_csv(layer: QgsVectorLayer, source: LayerSource, target: str, temporary: str, format_: CopyFormat, context: QgsCoordinateTransformContext, feedback: Any) -> Optional[str]:
    """
    Writes a point layer's CSV copy with its longitude and latitude as the
    last two columns (`coordinate_columns`). The points are first written in
    WGS84 to a temporary FlatGeobuf, as every copy's geometry is, and the
    columns read from it, so they match the other copies.
    """
    points = _temporary_beside(target, 'fgb')
    try:
        if _write(layer, source, points, 'FlatGeobuf', [], [], 'EPSG:4326', context, feedback) is None:
            return None
        located = QgsVectorLayer(points, source.name, 'ogr')
        if not located.isValid():
            raise RuntimeError(f'QGIS could not read the points of {source.name} back')
        x, y = coordinate_columns(located.fields().names())
        located.addExpressionField('x($geometry)', QgsField(x, _DOUBLE))
        located.addExpressionField('y($geometry)', QgsField(y, _DOUBLE))
        return _write(located, source, temporary, format_.driver, list(format_.layer_options), [], 'EPSG:4326', context, feedback)
    finally:
        _remove(points)


def _write(layer: QgsVectorLayer, source: LayerSource, temporary: str, driver: str, layer_options: list[str], dataset_options: list[str], crs: str, context: QgsCoordinateTransformContext, feedback: Any, layer_name: str = '') -> Optional[str]:
    """Writes the layer, with its filter and without its hidden fields, to `temporary` with GDAL's `driver` in `crs`; None where `feedback` was cancelled."""
    options = QgsVectorFileWriter.SaveVectorOptions()
    options.driverName = driver
    options.fileEncoding = 'UTF-8'
    options.layerOptions = layer_options
    options.datasourceOptions = dataset_options
    if layer_name:
        options.layerName = layer_name
    options.attributes = [index for index, field_ in enumerate(layer.fields()) if field_.name() not in source.hidden_fields]
    options.ct = QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem(crs), context)
    if feedback is not None:
        options.feedback = feedback
    result = QgsVectorFileWriter.writeAsVectorFormatV3(layer, temporary, context, options)
    error_code, error_message = result[0], result[1]
    if feedback is not None and feedback.isCanceled():
        _remove(temporary)
        return None
    if error_code != _NO_ERROR:
        _remove(temporary)
        raise RuntimeError(error_message or f'QGIS could not write {source.name} as {driver}')
    return temporary


# GDAL's MVT and PMTiles writers thin a tile over 500,000 bytes (`MAX_SIZE`) or 200,000 features (`MAX_FEATURES`).
# A zoom is taken to fit where the densest tile's estimated size is within 80% of the first, and its features within the second.
_TILE_BYTES = 400_000
_TILE_FEATURES = 200_000
# The largest zoom: no smaller than 13, where a tile's 4096 units are about a metre on the ground, and no larger than 16,
# at the first zoom from 13 where the densest tile holds 2,000 features or fewer.
_PRECISE_ZOOM = 13
_DETAILED_TILE_FEATURES = 2_000
_LARGEST_ZOOM = 16
# A tile range wider than this many tiles for one feature is not counted: such a feature is rare and its share of any one tile small.
_COUNTED_TILES = 4_096


def fitting_zooms(features: Any) -> tuple[int, int]:
    """
    The smallest and largest zoom to write PMTiles for with GDAL, from each
    feature's WGS84 box and estimated encoded size in bytes, as
    `(xmin, ymin, xmax, ymax, size)`. The smallest is the first at which the
    densest tile fits within what GDAL writes without thinning; where none
    does, both are the largest.
    """
    counts: list[dict[tuple[int, int], int]] = [{} for _ in range(_LARGEST_ZOOM + 1)]
    sizes: list[dict[tuple[int, int], int]] = [{} for _ in range(_LARGEST_ZOOM + 1)]
    for xmin, ymin, xmax, ymax, size in features:
        for zoom in range(_LARGEST_ZOOM + 1):
            x0, y1 = _tile(xmin, ymin, zoom)
            x1, y0 = _tile(xmax, ymax, zoom)
            if (x1 - x0 + 1) * (y1 - y0 + 1) > _COUNTED_TILES:
                continue
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    counts[zoom][(x, y)] = counts[zoom].get((x, y), 0) + 1
                    sizes[zoom][(x, y)] = sizes[zoom].get((x, y), 0) + size
    densest = [max(level.values(), default=0) for level in counts]
    largest_size = [max(level.values(), default=0) for level in sizes]
    largest = next((zoom for zoom in range(_PRECISE_ZOOM, _LARGEST_ZOOM + 1) if densest[zoom] <= _DETAILED_TILE_FEATURES), _LARGEST_ZOOM)
    smallest = next((zoom for zoom in range(largest + 1) if densest[zoom] <= _TILE_FEATURES and largest_size[zoom] <= _TILE_BYTES), largest)
    return smallest, largest


def _tile(longitude: float, latitude: float, zoom: int) -> tuple[int, int]:
    """The Web Mercator tile holding a point at a zoom."""
    latitude = max(-85.0511, min(85.0511, latitude))
    count = 1 << zoom
    x = int((longitude + 180.0) / 360.0 * count)
    y = int((1.0 - math.asinh(math.tan(math.radians(latitude))) / math.pi) / 2.0 * count)
    return min(max(x, 0), count - 1), min(max(y, 0), count - 1)


def _feature_boxes(layer: QgsVectorLayer, source: LayerSource, context: QgsCoordinateTransformContext) -> Any:
    """Each feature's WGS84 box and estimated encoded size: 8 bytes, 4 for each vertex, and the text of each attribute the copy keeps."""
    transform = QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem('EPSG:4326'), context)
    kept = [index for index, field_ in enumerate(layer.fields()) if field_.name() not in source.hidden_fields]
    for feature in layer.getFeatures(QgsFeatureRequest()):
        geometry = feature.geometry()
        if geometry is None or geometry.isEmpty():
            continue
        box = transform.transformBoundingBox(geometry.boundingBox())
        attributes = feature.attributes()
        size = 8 + 4 * geometry.constGet().nCoordinates() + sum(len(str(attributes[index])) for index in kept if attributes[index] is not None)
        yield box.xMinimum(), box.yMinimum(), box.xMaximum(), box.yMaximum(), size


def _write_pmtiles(source: LayerSource, target: str, context: QgsCoordinateTransformContext, feedback: Any) -> Optional[str]:
    """
    Writes a layer's PMTiles copy, its one tile layer named by
    `copy_layer_name`, to a temporary file beside `target`, and returns its
    path; None where `feedback` was cancelled, and an empty path for a layer
    with no geometry, which has no PMTiles copy.
    """
    layer = _open(source)
    if not layer.isSpatial():
        return ''
    name = copy_layer_name(source.layer_id)
    temporary = _temporary_beside(target, 'pmtiles')
    program = tippecanoe()
    if program is None:
        smallest, largest = fitting_zooms(_feature_boxes(layer, source, context))
        return _write(layer, source, temporary, 'PMTiles', [], [f'MINZOOM={smallest}', f'MAXZOOM={largest}'], 'EPSG:3857', context, feedback, name)
    features = _temporary_beside(target, 'fgb')
    try:
        if _write(layer, source, features, 'FlatGeobuf', [], [], 'EPSG:4326', context, feedback) is None:
            return None
        arguments = [
            '--quiet', '--force', f'--output={temporary}', f'--layer={name}',
            '--minimum-zoom=0', '-zg', f'--smallest-maximum-zoom-guess={_PRECISE_ZOOM}',
            '--drop-densest-as-needed', '--extend-zooms-if-still-dropping', features,
        ]
        process = QProcess()
        process.start(program, arguments)
        if not process.waitForStarted(30_000):
            raise RuntimeError(f'tippecanoe could not be started: {process.errorString()}')
        while not process.waitForFinished(500):
            if process.state() == _NOT_RUNNING:
                break
            if feedback is not None and feedback.isCanceled():
                process.kill()
                process.waitForFinished(30_000)
                _remove(temporary)
                return None
        errors = bytes(process.readAllStandardError()).decode('utf-8', 'replace').strip()
        if process.exitCode() != 0 or not os.path.isfile(temporary):
            _remove(temporary)
            raise RuntimeError(f'tippecanoe could not write {source.name}: {errors or process.errorString()}')
        return temporary
    finally:
        _remove(features)


_COG_FORMAT = CopyFormat(COG, 'COG', COG_EXTENSION, ())


def _write_cog(source: LayerSource, target: str, feedback: Any) -> Optional[str]:
    """
    Writes a raster layer's copy as a cloud-optimised GeoTIFF to a temporary
    file beside `target`, and returns its path, or None where `feedback` was
    cancelled. QGIS writes the cell values its provider reads to a tiled
    GeoTIFF, GDAL works out each band's statistics into it, and GDAL's COG
    driver copies that with overviews.
    """
    from osgeo import gdal

    if gdal.GetDriverByName('COG') is None:
        raise RuntimeError("this version of QGIS can't write a cloud-optimised GeoTIFF")
    layer = QgsRasterLayer(source.source, source.name, source.provider)
    if not layer.isValid():
        raise RuntimeError(f'QGIS could not open {source.name} from its source')
    provider = layer.dataProvider()
    if not provider.capabilities() & _SIZE:
        raise RuntimeError(f'{source.name} gives an image to draw rather than cells to copy, as a map service does')
    temporary = _temporary_beside(target, COG_EXTENSION)
    cells = _temporary_beside(target, 'cells.tif')
    cells_feedback = None
    try:
        writer = QgsRasterFileWriter(cells)
        writer.setOutputFormat('GTiff')
        (getattr(writer, 'setCreationOptions', None) or writer.setCreateOptions)(['TILED=YES', 'COMPRESS=DEFLATE', 'BIGTIFF=IF_SAFER'])
        pipe = QgsRasterPipe()
        if not pipe.set(provider.clone()):
            raise RuntimeError(f'QGIS could not read the cells of {source.name}')
        # `writeRaster` takes a raster block feedback, which follows the export's: its cancel, and its progress for the first half.
        if feedback is not None and feedback.isCanceled():
            return None
        cells_feedback = QgsRasterBlockFeedback()
        if feedback is not None:
            feedback.canceled.connect(cells_feedback.cancel)
            cells_feedback.progressChanged.connect(lambda done: feedback.setProgress(done / 2))
        error = writer.writeRaster(pipe, provider.xSize(), provider.ySize(), provider.extent(), provider.crs(), QgsCoordinateTransformContext(), cells_feedback)
        if feedback is not None and feedback.isCanceled():
            return None
        if error != _RASTER_NO_ERROR:
            raise RuntimeError(f'QGIS could not write the cells of {source.name}: {error}')
        dataset = gdal.Open(cells, gdal.GA_Update)
        if dataset is None:
            raise RuntimeError(f'GDAL could not read the cells of {source.name}: {gdal.GetLastErrorMsg()}')
        for band in range(1, dataset.RasterCount + 1):
            dataset.GetRasterBand(band).ComputeStatistics(False)
        dataset = None

        def progress(done: float, _message: Any, _data: Any) -> int:
            if feedback is None:
                return 1
            feedback.setProgress(50 + 50 * done)
            return 0 if feedback.isCanceled() else 1

        copied = gdal.Translate(temporary, cells, format='COG', creationOptions=list(_COG_OPTIONS), callback=progress)
        failure = gdal.GetLastErrorMsg()
        written = copied is not None
        # Letting go of the dataset closes the file.
        copied = None
        if feedback is not None and feedback.isCanceled():
            _remove(temporary)
            return None
        if not written:
            _remove(temporary)
            raise RuntimeError(f'GDAL could not write {source.name} as a cloud-optimised GeoTIFF: {failure}')
        return temporary
    finally:
        if cells_feedback is not None and feedback is not None:
            feedback.canceled.disconnect(cells_feedback.cancel)
        _remove(cells)
        _remove(f'{cells}.aux.xml')


def place_copies(copies: Copies, folder: str) -> dict[str, list[CopiedData]]:
    """Moves each copy from its temporary file into place, over the earlier copy, and returns the copies by layer id."""
    placed: dict[str, list[CopiedData]] = {}
    for layer_id, made in copies.made.items():
        for temporary, copied in made:
            os.replace(temporary, os.path.join(folder, *copied.path.split('/')))
        placed[layer_id] = [copied for _temporary, copied in made]
    return placed


def discard(copies: Copies) -> None:
    """Removes every temporary file the copies were written to."""
    for made in copies.made.values():
        for temporary, _copied in made:
            _remove(temporary)
    copies.made.clear()


# `QProcess.NotRunning` in Qt 5, and in the scoped `ProcessState` in Qt 6.
_NOT_RUNNING = QProcess.NotRunning if hasattr(QProcess, 'NotRunning') else QProcess.ProcessState.NotRunning

# `QgsRasterDataProvider.Size` and `QgsRasterFileWriter.NoError` in QGIS 3, and in the scoped `RasterInterfaceCapability` and `RasterFileWriterResult` in QGIS 4.
_SIZE = QgsRasterDataProvider.Size if hasattr(QgsRasterDataProvider, 'Size') else Qgis.RasterInterfaceCapability.Size
_RASTER_NO_ERROR = QgsRasterFileWriter.NoError if hasattr(QgsRasterFileWriter, 'NoError') else Qgis.RasterFileWriterResult.Success

# A field of decimal numbers: `QgsField` takes a `QMetaType.Type` from QGIS 3.38 and a `QVariant.Type` before it.
_DOUBLE = QMetaType.Type.Double if Qgis.QGIS_VERSION_INT >= 33800 else QVariant.Double

# `QgsVectorFileWriter.NoError` in QGIS 3, and in the scoped `WriterError` in QGIS 4.
_NO_ERROR = QgsVectorFileWriter.NoError if hasattr(QgsVectorFileWriter, 'NoError') else QgsVectorFileWriter.WriterError.NoError


def _remove(file_path: str) -> None:
    try:
        os.remove(file_path)
    except OSError:
        pass

