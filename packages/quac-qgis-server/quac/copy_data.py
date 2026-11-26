"""
Copying a layer's data into the chosen folder, for an export of the catalogue
with its data (`desktop.export_catalogue`). `publish.plan_publication` says
which layers to copy; this writes each copy with QGIS and gives what the
catalogue records of it.

- The formats are the ones the project ticks, GeoParquet and FlatGeobuf
  (`copy_formats`). GeoParquet is written only where this QGIS's GDAL writes
  it with the bounding-box column Portolan asks for, with its rows sorted in
  space and compressed with zstd where GDAL offers them; where it cannot,
  FlatGeobuf is written in its place. The first format is the layer's data.
- A copy holds what the project shows: the layer's filter applies, as QGIS
  reads the layer, and the fields QGIS Server excludes are left out. Its
  geometry is in WGS84 (EPSG:4326).
- Each copy is written to a temporary file beside where it goes, and moved
  into place only once every copy is made (`place_copies`), so a cancelled
  export changes nothing.

`copy_layers` makes no use of a project, so it can run in a `QgsTask` off the
main thread: it opens each layer afresh from its source.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from qgis.core import (
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsCoordinateTransformContext,
    QgsVectorFileWriter,
    QgsVectorLayer,
)

from .publish import CopiedData, copy_path


# The formats a copy can be written in, by id, in the order a layer's copies are listed: the first ticked is the layer's data.
GEOPARQUET = 'geoparquet'
FLATGEOBUF = 'flatgeobuf'
FORMAT_IDS = (GEOPARQUET, FLATGEOBUF)


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
    where offered, and FlatGeobuf.
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
    return formats


def default_formats() -> list[str]:
    """The formats a project ticks until it chooses: GeoParquet where this QGIS writes it, and FlatGeobuf otherwise."""
    return [GEOPARQUET] if GEOPARQUET in writable_formats() else [FLATGEOBUF]


def copy_formats(chosen: list[str]) -> tuple[list[CopyFormat], bool]:
    """
    The formats to copy in, from the ids the project ticks, the layer's data
    first, and whether GeoParquet was ticked and FlatGeobuf written in its
    place, as this QGIS cannot write it. With none ticked, FlatGeobuf.
    """
    writable = writable_formats()
    ids = [format_id for format_id in FORMAT_IDS if format_id in chosen and format_id in writable]
    fallback = GEOPARQUET in chosen and GEOPARQUET not in writable
    if (fallback or not ids) and FLATGEOBUF not in ids:
        ids.append(FLATGEOBUF)
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
    Copies each layer in each format to a temporary file beside where its copy
    goes under `folder`. Stops between copies where `feedback` is cancelled,
    and removes what it made then.
    """
    copies = Copies()
    context = transform_context or QgsCoordinateTransformContext()
    for index, source in enumerate(sources):
        made: list[tuple[str, CopiedData]] = []
        for format_ in formats:
            if feedback is not None and feedback.isCanceled():
                copies.cancelled = True
                break
            relative = copy_path(children_folder, source.layer_id, format_.extension)
            target = os.path.join(folder, *relative.split('/'))
            try:
                temporary = _copy_one(source, target, format_, context, feedback)
            except Exception as error:  # noqa: BLE001 - one layer's failure is reported and the export goes on
                copies.failed[source.layer_id] = f'{type(error).__name__}: {error}'
                break
            if temporary is None:
                copies.cancelled = True
                break
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


def _copy_one(source: LayerSource, target: str, format_: CopyFormat, context: QgsCoordinateTransformContext, feedback: Any) -> Optional[str]:
    """Writes one layer's copy to a temporary file beside `target`, and returns its path, or None where `feedback` was cancelled during it."""
    layer = QgsVectorLayer(source.source, source.name, source.provider)
    if not layer.isValid():
        raise RuntimeError(f'QGIS could not open {source.name} from its source')
    folder = os.path.dirname(target)
    os.makedirs(folder, exist_ok=True)
    temporary = os.path.join(folder, f'.{os.path.basename(target)}.{uuid.uuid4().hex}.tmp.{format_.extension}')
    options = QgsVectorFileWriter.SaveVectorOptions()
    options.driverName = format_.driver
    options.fileEncoding = 'UTF-8'
    options.layerOptions = list(format_.layer_options)
    options.attributes = [index for index, field_ in enumerate(layer.fields()) if field_.name() not in source.hidden_fields]
    options.ct = QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem('EPSG:4326'), context)
    if feedback is not None:
        options.feedback = feedback
    result = QgsVectorFileWriter.writeAsVectorFormatV3(layer, temporary, context, options)
    error_code, error_message = result[0], result[1]
    if feedback is not None and feedback.isCanceled():
        _remove(temporary)
        return None
    if error_code != _NO_ERROR:
        _remove(temporary)
        raise RuntimeError(error_message or f'QGIS could not write {source.name} as {format_.driver}')
    return temporary


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


# `QgsVectorFileWriter.NoError` in QGIS 3, and in the scoped `WriterError` in QGIS 4.
_NO_ERROR = QgsVectorFileWriter.NoError if hasattr(QgsVectorFileWriter, 'NoError') else QgsVectorFileWriter.WriterError.NoError


def _remove(file_path: str) -> None:
    try:
        os.remove(file_path)
    except OSError:
        pass

