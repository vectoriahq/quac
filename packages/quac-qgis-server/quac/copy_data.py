"""
Copying a layer's data into the chosen folder, for an export of the catalogue
with its data (`desktop.export_catalogue`). `publish.plan_publication` says
which layers to copy; this writes each copy with QGIS and gives what the
catalogue records of it.

- The format is GeoParquet where this QGIS's GDAL writes it with the
  bounding-box column Portolan asks for, and FlatGeobuf otherwise
  (`copy_format`). GeoParquet's rows are sorted in space and compressed with
  zstd where GDAL offers it.
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


@dataclass(frozen=True)
class CopyFormat:
    """The GDAL driver a copy is written with, its file extension, its layer creation options, and whether it is GeoParquet as Portolan asks."""

    driver: str
    extension: str
    layer_options: tuple[str, ...]
    geoparquet: bool


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
    """What `copy_layers` made: each copy by layer id with its temporary file, and each failure with why."""

    made: dict[str, tuple[str, CopiedData]] = field(default_factory=dict)
    failed: dict[str, str] = field(default_factory=dict)
    cancelled: bool = False


def _creation_options(driver_name: str) -> str:
    from osgeo import gdal

    driver = gdal.GetDriverByName(driver_name)
    if driver is None or driver.GetMetadataItem('DCAP_CREATE') != 'YES':
        return ''
    return driver.GetMetadataItem('DS_LAYER_CREATIONOPTIONLIST') or ''


def copy_format() -> CopyFormat:
    """
    GeoParquet where GDAL's Parquet driver writes the bounding-box column
    (`WRITE_COVERING_BBOX`, GDAL 3.9 and later), with its rows sorted in space
    (`SORT_BY_BBOX`) and zstd where offered; FlatGeobuf otherwise.
    """
    options = _creation_options('Parquet')
    if 'WRITE_COVERING_BBOX' in options:
        layer_options = ['WRITE_COVERING_BBOX=YES']
        if 'SORT_BY_BBOX' in options:
            layer_options.append('SORT_BY_BBOX=YES')
        if 'ZSTD' in options:
            layer_options.append('COMPRESSION=ZSTD')
        return CopyFormat('Parquet', 'parquet', tuple(layer_options), True)
    return CopyFormat('FlatGeobuf', 'fgb', ('SPATIAL_INDEX=YES',), False)


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
    format_: CopyFormat,
    transform_context: Optional[QgsCoordinateTransformContext] = None,
    feedback: Any = None,
) -> Copies:
    """
    Copies each layer to a temporary file beside where its copy goes under
    `folder`. Stops between layers where `feedback` is cancelled, and removes
    what it made then.
    """
    copies = Copies()
    context = transform_context or QgsCoordinateTransformContext()
    for index, source in enumerate(sources):
        if feedback is not None and feedback.isCanceled():
            copies.cancelled = True
            break
        relative = copy_path(children_folder, source.layer_id, format_.extension)
        target = os.path.join(folder, *relative.split('/'))
        try:
            temporary = _copy_one(source, target, format_, context, feedback)
        except Exception as error:  # noqa: BLE001 - one layer's failure is reported and the export goes on
            copies.failed[source.layer_id] = f'{type(error).__name__}: {error}'
            continue
        if temporary is None:
            copies.cancelled = True
            break
        copies.made[source.layer_id] = (temporary, CopiedData(relative, os.path.getsize(temporary), checksum(temporary)))
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


def place_copies(copies: Copies, folder: str) -> dict[str, CopiedData]:
    """Moves each copy from its temporary file into place, over the earlier copy, and returns the copies by layer id."""
    placed: dict[str, CopiedData] = {}
    for layer_id, (temporary, copied) in copies.made.items():
        os.replace(temporary, os.path.join(folder, *copied.path.split('/')))
        placed[layer_id] = copied
    return placed


def discard(copies: Copies) -> None:
    """Removes every temporary file the copies were written to."""
    for temporary, _copied in copies.made.values():
        _remove(temporary)
    copies.made.clear()


# `QgsVectorFileWriter.NoError` in QGIS 3, and in the scoped `WriterError` in QGIS 4.
_NO_ERROR = QgsVectorFileWriter.NoError if hasattr(QgsVectorFileWriter, 'NoError') else QgsVectorFileWriter.WriterError.NoError


def _remove(file_path: str) -> None:
    try:
        os.remove(file_path)
    except OSError:
        pass

