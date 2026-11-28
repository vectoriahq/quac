"""
The plugin's QGIS Desktop part: a QUAC page in Project Properties (`SettingsPage`), Project ▸
Write STAC catalogue now, the QUAC Processing provider (`algorithm.py`), and
the catalogue written into the chosen folder as STAC documents (`publish.py`
works out what to write).

A project publishes one of two ways, chosen on its QUAC page:

- Linking the data in the folder, the default: each layer's data is linked
  where it is, a layer whose data is not in the folder is left out, and each
  save writes the catalogue where the option is on.
- Exporting a copy of every layer: the menu action and the algorithm copy
  every layer's data into the folder, a vector layer's in the formats ticked
  and a raster layer's as a cloud-optimised GeoTIFF (`copy_data.py`), from
  the menu in a background task, and then write the catalogue. A save writes
  nothing. Where the QUAC page turns an upload on, the export is then
  uploaded to an S3 bucket (`upload.py`), from the menu in a background task
  of its own.

The save, the menu action and the Processing algorithm all write through
`write_catalogue`:

- Only for a project saved as a `.qgs` or `.qgz` file.
- A layer QGIS could not open, or that it does not hold, is left out, except a
  WMS, WMTS or XYZ layer.
- The saved file is read from disk, the field types and comments, the
  layers' WGS84 boxes and the map canvas extent in WGS84 from QGIS
  (`qgis_inputs.py`), each layer's current style as QML, and each data file's
  size and last change from the file system (`publish.read_data_file`).
- Each file is written to a temporary file in its own folder and then renamed
  over the old one, so a sync client never sees half a file. A file whose
  bytes have not changed is left as it is.
- After writing, the documents and styles the previous catalogue linked under
  `<project>.stac/` and this one does not are removed, and so is each folder
  under `<project>.stac/` they leave empty.

On save, and from the menu, any error is caught, so the save itself is never
affected: the message bar says what happened and what to do, and the details
go to the QGIS log under the tag `QUAC`. The menu writes the project as last
saved: it reads the saved file into a project of its own (`saved_project`), as
the algorithm does, so a change not yet saved, such as a layer removed, does
not reach the catalogue.
"""

from __future__ import annotations

import configparser
import os
import tempfile
import traceback
from datetime import datetime
from contextlib import contextmanager
from html import escape
from typing import Any, Iterator, Optional, Union

from dataclasses import dataclass, field

from qgis.core import Qgis, QgsApplication, QgsCoordinateTransformContext, QgsFeedback, QgsMapLayer, QgsMessageLog, QgsPathResolver, QgsProject, QgsRasterLayer, QgsReadWriteContext, QgsTask, QgsVectorLayer
from qgis.gui import QgsAuthConfigSelect, QgsFileWidget, QgsOptionsPageWidget, QgsOptionsWidgetFactory
from qgis.PyQt.QtCore import QSize, Qt, QUrl
from qgis.PyQt.QtGui import QColor, QDesktopServices, QIcon, QPalette
from qgis.PyQt.QtWidgets import QButtonGroup, QCheckBox, QFormLayout, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, QRadioButton, QStyle, QVBoxLayout, QWidget
from qgis.PyQt.QtXml import QDomDocument

try:
    from qgis.PyQt.QtGui import QAction  # Qt 6, QGIS 4
except ImportError:
    from qgis.PyQt.QtWidgets import QAction  # Qt 5, QGIS 3

from .copy_data import COG_EXTENSION, CSV, FLATGEOBUF, FORMAT_IDS, GEOJSON, GEOPACKAGE, GEOPARQUET, PMTILES, Copies, CopyFormat, LayerSource, copy_formats, copy_layers, copy_processing, default_formats, discard, place_copies, source_last_edit, writable_formats
from .publish import (
    EXPORT,
    FOLDER_KEY,
    FORMATS_KEY,
    LINK,
    COPIES_FOLDER,
    MODE_KEY,
    SETTINGS_SCOPE,
    WRITE_ON_SAVE_KEY,
    CopiedData,
    LayerStyle,
    Publication,
    catalogue_names,
    chosen_folder,
    copy_path,
    emptied_folders,
    folder_setting,
    message,
    plan_publication,
    previous_copies,
    read_data_file,
    same_style_document,
    unchanged_copies,
)
from .qgis_inputs import field_types, layer_extents, stored_project, wgs84_box
from .upload import (
    AUTHCFG_KEY,
    AWS_S3_PROVIDER,
    BUCKET_FOLDER_KEY,
    BUCKET_KEY,
    ENDPOINT_KEY,
    NEXT_RUN_NOTE,
    NOT_UPLOADED,
    UPLOAD_KEY,
    Credentials,
    PendingUpload,
    UploadProblem,
    UploadFailed,
    UploadResult,
    pending_upload,
    read_credentials,
    result_message,
    run_upload,
)

LOG_TAG = 'QUAC'
TITLE = 'QUAC'
ICON = os.path.join(os.path.dirname(__file__), 'icon.png')

FAILURE_MESSAGE = 'The STAC catalogue could not be written. The project itself was saved. The QUAC tab of the Log Messages panel has the details.'
WRITE_NOW_LABEL = 'Write STAC catalogue now'
WRITE_NOW_FAILURE_MESSAGE = 'The STAC catalogue could not be written. The QUAC tab of the Log Messages panel has the details.'
NOT_SAVED_MESSAGE = 'Save the project as a .qgz or .qgs file first, then write its STAC catalogue.'
EXPORT_CANCELLED_MESSAGE = 'The export of the STAC catalogue was cancelled. Nothing was changed.'
UNSAVED_CHANGES_MESSAGE = 'It follows the project as last saved. To include your unsaved changes, save the project.'

# The parts of a layer's style that draw it. A layer's form settings are left out: a Value Relation's there names its lookup's data source, which can hold a password.
_STYLE_CATEGORIES = ('Symbology', 'Symbology3D', 'Labeling', 'Diagrams', 'Rendering')


def _level(name: str) -> Any:
    levels = getattr(Qgis, 'MessageLevel', Qgis)
    return getattr(levels, name)


def saved_as_file(project: Any) -> bool:
    """Whether the project is saved as a `.qgs` or `.qgz` file, rather than not saved or kept in a database."""
    return project.projectStorage() is None and bool(project.fileName()) and project.fileName().lower().endswith(('.qgs', '.qgz'))


def read_settings(project: Any) -> tuple[bool, str]:
    """Whether the option is on, and the saved folder setting."""
    write_on_save, _found = project.readBoolEntry(SETTINGS_SCOPE, WRITE_ON_SAVE_KEY, False)
    folder, _found = project.readEntry(SETTINGS_SCOPE, FOLDER_KEY, '')
    return bool(write_on_save), folder or ''


def read_mode(project: Any) -> str:
    """How the project publishes: `LINK`, its data linked where it is, until `EXPORT`, every layer's data copied, is chosen."""
    mode, _found = project.readEntry(SETTINGS_SCOPE, MODE_KEY, LINK)
    return EXPORT if mode == EXPORT else LINK


def read_formats(project: Any) -> list[str]:
    """The formats the project ticks for its copies, none among them, or the default where it has never chosen."""
    formats, found = project.readListEntry(SETTINGS_SCOPE, FORMATS_KEY, [])
    if not found:
        return default_formats()
    return [format_id for format_id in formats if format_id in FORMAT_IDS]


def project_folder(project: Any) -> str:
    return os.path.dirname(os.path.abspath(project.fileName()))


def export_styles(project: Any, styles_folder: str) -> dict[str, LayerStyle]:
    """
    Each layer's current style as QML, by layer id, as QGIS writes it to a
    `.qml` file. A path a style names, such as a marker's SVG, is written
    relative to `styles_folder`, where the file goes.
    """
    categories = None
    for name in _STYLE_CATEGORIES:
        category = getattr(QgsMapLayer, name, None) or getattr(QgsMapLayer.StyleCategory, name)
        categories = category if categories is None else categories | category
    styles: dict[str, LayerStyle] = {}
    for layer in project.mapLayers().values():
        if not layer.isValid():
            continue
        document = QDomDocument('qgis')
        context = QgsReadWriteContext()
        context.setPathResolver(QgsPathResolver(os.path.join(styles_folder, 'style.qml')))
        error = layer.exportNamedStyle(document, context, categories)
        if error:
            QgsMessageLog.logMessage(f'The style of {layer.name()} could not be read: {error}', LOG_TAG, _level('Warning'))
            continue
        styles[layer.id()] = LayerStyle(layer.styleManager().currentStyle() or 'default', bytes(document.toByteArray(2)))
    return styles


def write_catalogue(project: Any, folder: Optional[str] = None, copies: Optional[dict[str, Any]] = None, copy_failures: Optional[set[str]] = None, unchanged: Optional[set[str]] = None, row_counts: Optional[dict[str, int]] = None) -> tuple[str, Publication]:
    """
    Writes the catalogue of `project`, saved as a file, from its saved file and
    what QGIS gives for its layers, into `folder`, or where its settings say
    where `folder` is None. Returns the folder and what was written, or why
    nothing was. `copies` holds the copies an export just made, by layer id,
    and makes this an export; None links each layer's data where it is.
    `unchanged` holds the layers whose earlier copies the export kept, and
    `row_counts` each copied vector layer's feature count.
    """
    folder, publication = plan_catalogue(project, folder, copies, copy_failures, unchanged, row_counts)
    if publication.refusal is None:
        write_publication(folder, publication)
    return folder, publication


def plan_catalogue(project: Any, folder: Optional[str] = None, copies: Optional[dict[str, Any]] = None, copy_failures: Optional[set[str]] = None, unchanged: Optional[set[str]] = None, row_counts: Optional[dict[str, int]] = None) -> tuple[str, Publication]:
    """What `write_catalogue` writes, and into which folder, without writing it."""
    _write_on_save, setting = read_settings(project)
    home = os.path.realpath(project_folder(project))
    folder = os.path.realpath(chosen_folder(home, setting) if folder is None else folder)
    _root_file_name, children_folder = catalogue_names(project.fileName())
    if not os.path.isdir(folder):
        raise FolderMissing(folder)
    file_name, data = stored_project(project)
    publication = plan_publication(
        file_name,
        data,
        field_types(project),
        layer_extents(project),
        home,
        folder,
        export_styles(project, os.path.join(folder, children_folder, 'styles')),
        lambda name: _read_inside(folder, name),
        opened_layer_ids={layer_id for layer_id, layer in project.mapLayers().items() if layer.isValid()},
        wgs84_box=wgs84_box(project),
        data_file=read_data_file,
        copies=copies,
        copy_failures=copy_failures,
        unchanged=unchanged,
        row_counts=row_counts,
    )
    return folder, publication


@dataclass
class ExportJob:
    """
    What an export copies, worked out on the main thread from the project as
    saved: the folder, the documents' folder, each layer to copy, the
    formats, whether GeoParquet was ticked and cannot be written, the
    project's datum transformations, the earlier copies kept, by layer id,
    of each layer whose data has not changed (`unchanged_copies`), the
    raster layers among them all, and each vector layer's feature count, its
    filter applied, where QGIS gives one.
    """

    folder: str
    children_folder: str
    formats: list[CopyFormat]
    geoparquet_fallback: bool = False
    sources: list[LayerSource] = field(default_factory=list)
    transform_context: Any = None
    kept: dict[str, list[CopiedData]] = field(default_factory=dict)
    rasters: set[str] = field(default_factory=set)
    row_counts: dict[str, int] = field(default_factory=dict)


def prepare_export(project: Any, folder: Optional[str] = None) -> ExportJob:
    """
    Every layer an export of `project` copies, with the formats it ticks, less
    each whose earlier copies can be kept as they are. Raises `FolderMissing`
    as `write_catalogue` does.
    """
    formats, fallback = copy_formats(read_formats(project))
    if not formats:
        raise NoFormatTicked()
    planned_folder, publication = plan_catalogue(project, folder, copies={})
    job = ExportJob(planned_folder, publication.children_folder, formats, fallback, transform_context=QgsCoordinateTransformContext(project.transformContext()))
    if publication.refusal is not None:
        return job
    previous = previous_copies(publication.root_file_name, publication.children_folder, lambda name: _read_inside(job.folder, name))
    for request in publication.to_copy:
        layer = project.mapLayer(request.layer_id)
        if not isinstance(layer, (QgsVectorLayer, QgsRasterLayer)) or not layer.isValid():
            continue
        raster = isinstance(layer, QgsRasterLayer)
        if raster:
            job.rasters.add(request.layer_id)
        else:
            count = layer.featureCount()
            if count >= 0:
                job.row_counts[request.layer_id] = count
        last_edit = source_last_edit(layer)
        processing = copy_processing(layer, request.hidden_fields)
        earlier = previous.get(request.layer_id, {})
        extensions = [COG_EXTENSION] if raster else [format_.extension for format_ in formats if format_.id != PMTILES or layer.isSpatial()]
        expected = [copy_path(job.children_folder, request.layer_id, extension) for extension in extensions]
        kept = unchanged_copies(earlier, expected, last_edit, processing, lambda path: _size_inside(job.folder, path))
        if kept is not None:
            job.kept[request.layer_id] = kept
            continue
        job.sources.append(LayerSource(
            request.layer_id, layer.name(), layer.source(), layer.providerType(), request.hidden_fields, raster,
            last_edit=last_edit,
            previous={path: asset['file:checksum'] for path, asset in earlier.items() if isinstance(asset.get('file:checksum'), str)},
            processing=processing,
        ))
    return job


def finish_export(project: Any, job: ExportJob, copies: Copies) -> Publication:
    """Moves the copies into place and writes the catalogue that names them, with each failed copy logged and left out."""
    for layer_id, reason in copies.failed.items():
        layer = project.mapLayer(layer_id)
        QgsMessageLog.logMessage(f'{project.baseName()}: the data of {layer.name() if layer is not None else layer_id} could not be copied: {reason}', LOG_TAG, _level('Warning'))
    placed = {**job.kept, **place_copies(copies, job.folder)}
    publication = write_catalogue(project, job.folder, copies=placed, copy_failures=set(copies.failed), unchanged=set(job.kept) | copies.unchanged, row_counts=job.row_counts)[1]
    publication.geoparquet_fallback = job.geoparquet_fallback and any(layer_id not in job.rasters for layer_id in placed)
    return publication


def export_catalogue(project: Any, folder: Optional[str] = None, feedback: Any = None) -> tuple[str, Optional[Publication]]:
    """
    Exports the catalogue of `project` on this thread: copies every layer's
    data, then writes the catalogue. Returns the folder and what was written,
    or None where `feedback` was cancelled, which leaves the folder as it was.
    """
    job = prepare_export(project, folder)
    copies = copy_layers(job.sources, job.folder, job.children_folder, job.formats, job.transform_context, feedback)
    if copies.cancelled:
        return job.folder, None
    return job.folder, finish_export(project, job, copies)


def write_as_set(project: Any, folder: Optional[str] = None, feedback: Any = None) -> tuple[str, Optional[Publication]]:
    """Writes the catalogue as the project's choice says: linked where its data is, or exported with every layer's data copied."""
    if read_mode(project) == EXPORT:
        return export_catalogue(project, folder, feedback)
    return write_catalogue(project, folder)


def publish_project(project: Any) -> Optional[Publication]:
    """Writes the project's catalogue where its settings say, on save: only where it links its data and the option is on, and it is saved as a file."""
    write_on_save, _setting = read_settings(project)
    if not write_on_save or read_mode(project) != LINK or not saved_as_file(project):
        return None
    return write_catalogue(project)[1]


class ProjectUnreadable(Exception):
    def __init__(self, file_name: str, reason: str) -> None:
        super().__init__(file_name)
        self.file_name = file_name
        self.reason = reason


@contextmanager
def saved_project(file_name: str) -> Iterator[Any]:
    """
    The project file read into a `QgsProject` of its own, apart from the one on
    screen, without its layouts; its layers are released when the block ends.
    Raises `ProjectUnreadable` where QGIS cannot read the file.
    """
    project = QgsProject()
    try:
        flags = getattr(Qgis, 'ProjectReadFlag', None)
        dont_load_layouts = getattr(flags, 'DontLoadLayouts', None) if flags is not None else getattr(QgsProject, 'FlagDontLoadLayouts', None)
        try:
            read = project.read(file_name, dont_load_layouts)
        except TypeError:
            read = project.read(file_name)
        if not read:
            raise ProjectUnreadable(file_name, project.error() or 'QGIS could not read it')
        yield project
    finally:
        project.clear()


class NoFormatTicked(Exception):
    """An export of a project that ticks no format, which would copy nothing."""


NO_FORMAT_MESSAGE = 'The STAC catalogue was not exported, because no format is ticked. Tick a format on the QUAC page of Project Properties. Nothing was changed.'


class FolderMissing(Exception):
    def __init__(self, folder: str) -> None:
        super().__init__(folder)
        self.folder = folder


def write_publication(folder: str, publication: Publication) -> None:
    """Writes each file, then removes what the previous catalogue linked and this one does not, and the folders that leaves empty."""
    for name, data in publication.files:
        _write_atomically(_path_inside(folder, name), data)
    for name in publication.removals:
        target = _path_inside(folder, name)
        if os.path.isfile(target):
            os.remove(target)
    for name in emptied_folders(publication.removals, publication.children_folder):
        try:
            os.rmdir(_path_inside(folder, name))
        except OSError:
            pass


def _path_inside(folder: str, name: str) -> str:
    """A path relative to `folder`, joined by `/`, as a path on this system; refused where it would leave `folder`."""
    target = os.path.normpath(os.path.join(folder, *name.split('/')))
    if os.path.commonpath([folder, target]) != os.path.normpath(folder) or target == os.path.normpath(folder):
        raise ValueError(f'{name} is not inside the chosen folder')
    return target


def _size_inside(folder: str, name: str) -> Optional[int]:
    """The size of a file in the chosen folder by its path relative to it, joined by `/`, or None where there is none."""
    try:
        return os.path.getsize(_path_inside(folder, name))
    except (OSError, ValueError):
        return None


def _read_inside(folder: str, name: str) -> Optional[bytes]:
    target = _path_inside(folder, name)
    if not os.path.isfile(target):
        return None
    with open(target, 'rb') as handle:
        return handle.read()


def _write_atomically(target: str, data: bytes) -> None:
    """Writes `data` to a temporary file beside `target` and renames it over `target`; leaves an unchanged file alone, and a style that says the same (`same_style_document`)."""
    if os.path.isfile(target):
        with open(target, 'rb') as handle:
            earlier = handle.read()
        if earlier == data or (target.lower().endswith('.qml') and same_style_document(earlier, data)):
            return
    folder = os.path.dirname(target)
    os.makedirs(folder, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f'.{os.path.basename(target)}.', suffix='.tmp', dir=folder)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except BaseException:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise


class QuacDesktop:
    """
    The plugin in QGIS Desktop, which starts it through `classFactory` and
    `initGui`. `qgis_process` starts it with no `iface` and calls
    `initProcessing` alone, which adds the Processing provider.
    """

    def __init__(self, iface: Any) -> None:
        self.iface = iface
        self._factory: Optional[SettingsPageFactory] = None
        self._provider: Any = None
        self._write_now: Optional[QAction] = None
        self._menu: Any = None
        self._task: Optional[QgsTask] = None

    def initProcessing(self) -> None:  # noqa: N802 - the name QGIS calls
        from .algorithm import QuacProvider

        if self._provider is None:
            self._provider = QuacProvider()
            QgsApplication.processingRegistry().addProvider(self._provider)

    def initGui(self) -> None:  # noqa: N802 - the name QGIS calls
        self.initProcessing()
        self._factory = SettingsPageFactory()
        self.iface.registerProjectPropertiesWidgetFactory(self._factory)
        QgsProject.instance().projectSaved.connect(self.project_saved)
        self._write_now = QAction(QIcon(ICON), WRITE_NOW_LABEL, self.iface.mainWindow())
        self._write_now.setObjectName('quacWriteCatalogueNow')
        self._write_now.triggered.connect(self.write_now)
        self._menu = self._add_to_project_menu(self._write_now)

    def unload(self) -> None:
        try:
            QgsProject.instance().projectSaved.disconnect(self.project_saved)
        except (TypeError, RuntimeError):
            pass
        if self._write_now is not None:
            if self._menu is not None:
                self._menu.removeAction(self._write_now)
            else:
                self.iface.removePluginMenu(TITLE, self._write_now)
            self._write_now.deleteLater()
            self._write_now = None
            self._menu = None
        if self._factory is not None:
            self.iface.unregisterProjectPropertiesWidgetFactory(self._factory)
            self._factory = None
        if self._provider is not None:
            QgsApplication.processingRegistry().removeProvider(self._provider)
            self._provider = None

    def _add_to_project_menu(self, action: QAction) -> Any:
        """Puts the action in the Project menu after Save As, and returns the menu; or, where QGIS gives no Project menu, in the Plugins menu under QUAC, and returns None."""
        project_menu = getattr(self.iface, 'projectMenu', None)
        menu = project_menu() if project_menu is not None else None
        if menu is None:
            self.iface.addPluginToMenu(TITLE, action)
            return None
        actions = menu.actions()
        save_as = self.iface.actionSaveProjectAs() if hasattr(self.iface, 'actionSaveProjectAs') else None
        index = actions.index(save_as) if save_as in actions else -1
        if 0 <= index < len(actions) - 1:
            menu.insertAction(actions[index + 1], action)
        else:
            menu.addAction(action)
        return menu

    def project_saved(self) -> None:
        project = QgsProject.instance()
        self._report(project, lambda: publish_project(project), FAILURE_MESSAGE)

    def write_now(self) -> None:
        """
        Project ▸ Write STAC catalogue now: the project as last saved, into its
        chosen folder, as the project's choice says. Linked, it is written at
        once. Exported, every layer's data is copied first in a background
        task, which QGIS's task manager shows with its progress and a cancel
        button, and the catalogue is written once the copies are made.
        """
        project = QgsProject.instance()
        if not saved_as_file(project):
            self._show('warning', NOT_SAVED_MESSAGE)
            return
        if self._task is not None:
            self._show('warning', 'The STAC catalogue is already being exported or uploaded. Wait for that to finish, or cancel it in the task manager.')
            return
        note = UNSAVED_CHANGES_MESSAGE if project.isDirty() else None
        file_name = project.fileName()
        job: Optional[ExportJob] = None
        upload: Union[PendingUpload, UploadProblem, None] = None

        def start() -> Optional[Publication]:
            nonlocal job, upload
            with saved_project(file_name) as saved:
                if read_mode(saved) != EXPORT:
                    return write_catalogue(saved)[1]
                job = prepare_export(saved)
                upload = pending_upload(saved, job.folder, *catalogue_names(file_name))
                if not job.sources:
                    return finish_export(saved, job, Copies())
            return None

        if not self._report(project, start, WRITE_NOW_FAILURE_MESSAGE, note) or job is None:
            return
        if not job.sources:
            self._upload(upload)
            return
        self._task = ExportTask(job, lambda copies: self._finish_export(file_name, job, copies, note, upload))
        QgsApplication.taskManager().addTask(self._task)

    def _finish_export(self, file_name: str, job: ExportJob, copies: Copies, note: Optional[str], upload: Union[PendingUpload, UploadProblem, None]) -> None:
        self._task = None
        if copies.cancelled:
            self._show('info', EXPORT_CANCELLED_MESSAGE)
            return

        def finish() -> Publication:
            with saved_project(file_name) as saved:
                return finish_export(saved, job, copies)

        if self._report(QgsProject.instance(), finish, WRITE_NOW_FAILURE_MESSAGE, note):
            self._upload(upload)

    def _upload(self, pending: Union[PendingUpload, UploadProblem, None]) -> None:
        """
        Uploads the export just written, where the project turns an upload on:
        the credentials read here, on the main thread, and the files uploaded
        in a background task, which QGIS's task manager shows with its
        progress and a cancel button.
        """
        if pending is None:
            return
        if isinstance(pending, UploadProblem):
            self._show('warning', pending.message)
            return
        try:
            credentials = read_credentials(pending.target)
        except UploadFailed as failed:
            QgsMessageLog.logMessage(failed.message, LOG_TAG, _level('Warning'))
            self._show('warning', failed.message)
            return
        self._task = UploadTask(pending, credentials, self._finish_upload)
        QgsApplication.taskManager().addTask(self._task)

    def _finish_upload(self, task: 'UploadTask') -> None:
        self._task = None
        if task.failure is not None:
            QgsMessageLog.logMessage(f'{task.failure}{task.details}', LOG_TAG, _level('Warning'))
            self._show('warning', task.failure)
        elif task.uploaded is not None:
            text = result_message(task.pending.target, task.uploaded)
            self._show('warning' if task.uploaded.cancelled else 'info', text)

    def _report(self, project: Any, write: Any, failure_message: str, note: Optional[str] = None) -> bool:
        """
        Runs `write` and shows the message bar's one entry for what it wrote,
        with `note` after it; catches any error, so it never reaches a save.
        Returns whether `write` finished without an error or a refusal.
        """
        try:
            publication = write()
        except FolderMissing as missing:
            self._show('warning', f'The STAC catalogue was not written, because its folder does not exist: {missing.folder}. Choose a folder on the QUAC page of Project Properties, and save again.')
            return False
        except NoFormatTicked:
            self._show('warning', NO_FORMAT_MESSAGE)
            return False
        except Exception as error:  # noqa: BLE001 - a failure here must never reach the save
            QgsMessageLog.logMessage(f'The STAC catalogue for {project.baseName()} could not be written: {type(error).__name__}: {error}\n{traceback.format_exc()}', LOG_TAG, _level('Critical'))
            self._show('warning', failure_message)
            return False
        if publication is None:
            return True
        for sentence in publication.warnings():
            QgsMessageLog.logMessage(f'{project.baseName()}: {sentence}', LOG_TAG, _level('Warning'))
        level, text = message(publication)
        if note and publication.refusal is None:
            level, text = 'warning', f'{text} {note}'
        self._show(level, text)
        return publication.refusal is None

    def _show(self, level: str, text: str) -> None:
        if level == 'info':
            self.iface.messageBar().pushMessage(TITLE, text, _level('Info'), 5)
        else:
            self.iface.messageBar().pushMessage(TITLE, text, _level('Warning'), 0)


class ExportTask(QgsTask):
    """The copies of an export, made off the main thread; `done` runs on the main thread with what was made, or with `cancelled` set."""

    def __init__(self, job: ExportJob, done: Any) -> None:
        super().__init__(f'Exporting the STAC catalogue: {len(job.sources)} layers to copy')
        self.job = job
        self.done = done
        self.copies = Copies()
        self.feedback = QgsFeedback()
        self.feedback.progressChanged.connect(self.setProgress)

    def cancel(self) -> None:
        self.feedback.cancel()
        super().cancel()

    def run(self) -> bool:
        self.copies = copy_layers(self.job.sources, self.job.folder, self.job.children_folder, self.job.formats, self.job.transform_context, self.feedback)
        return not self.copies.cancelled

    def finished(self, result: bool) -> None:
        if not result:
            self.copies.cancelled = True
            discard(self.copies)
        self.done(self.copies)


class UploadTask(QgsTask):
    """An export's upload, made off the main thread; `done` runs on the main thread with the task, which holds what was uploaded or why it failed."""

    def __init__(self, pending: PendingUpload, credentials: Credentials, done: Any) -> None:
        super().__init__(f'Uploading the STAC catalogue to {pending.target.where()}')
        self.pending = pending
        self.credentials = credentials
        self.done = done
        self.uploaded: Optional[UploadResult] = None
        self.failure: Optional[str] = None
        self.details = ''

    def run(self) -> bool:
        try:
            self.uploaded = run_upload(self.pending, self.credentials, self.isCanceled, self.setProgress)
        except UploadFailed as failed:
            self.failure = failed.message
        except Exception as error:  # noqa: BLE001 - reported on the main thread
            self.failure = f'{NOT_UPLOADED} to {self.pending.target.where()}. The QUAC tab of the Log Messages panel has the details. {NEXT_RUN_NOTE}'
            self.details = f'\n{type(error).__name__}: {error}'
            self.details += f'\n{traceback.format_exc()}'
        return True

    def finished(self, result: bool) -> None:
        self.done(self)


class SettingsPageFactory(QgsOptionsWidgetFactory):
    """The QUAC page of Project Properties."""

    def __init__(self) -> None:
        super().__init__(TITLE, QIcon(ICON))

    def icon(self) -> QIcon:
        return QIcon(ICON)

    def title(self) -> str:
        return TITLE

    def createWidget(self, parent: Any = None) -> 'SettingsPage':  # noqa: N802 - the name QGIS calls
        return SettingsPage(parent)


GEOPARQUET_UNAVAILABLE = "This version of QGIS can't write GeoParquet."
PMTILES_UNAVAILABLE = "This version of QGIS can't write PMTiles."
PMTILES_PURPOSE = 'Map tiles for viewing the layer on a web map.'
CSV_PURPOSE = 'A table for spreadsheets. Point layers get X and Y columns.'
PORTOLAN_ADDRESS = 'https://portolan-sdi.org/'
ENDPOINT_PURPOSE = 'For an S3-compatible store, such as Cloudflare R2 or MinIO, its address, such as https://storage.example.test. Empty for Amazon S3.'
NO_FORMAT_NOTE = 'Tick a format to export.'
NO_DATA_NOTE = "No format holds the vector layers' data."
NOT_PORTOLAN_NOTE = "Not a Portolan catalogue: Portolan needs GeoParquet for each vector layer's data."
NOT_PORTOLAN_HERE_NOTE = "Not a Portolan catalogue: this version of QGIS can't write GeoParquet, which Portolan needs for each vector layer's data."

PURPOSE = "Publishes this project's map as a STAC catalogue, so web and mobile apps can show its layers as you've set them up here."
STAC_ADDRESS = 'https://stacspec.org/'
LINK_LABEL = 'Link the data where it is'
LINK_PURPOSE = "For a folder you sync or serve yourself, with the project's data inside it. The data stays where it is."
EXPORT_LABEL = 'Export a copy of every layer'
EXPORT_PURPOSE = "For web storage. Copies each layer's data into the folder, read-only, in the formats you tick."
NOT_SAVED_NOTE = 'Save the project as a .qgz or .qgs file to choose where its catalogue goes. QUAC writes a catalogue only for a project saved as a file.'
UNSAVED_CATALOGUE = 'Named after the project once it is saved.'
WRITE_NOW_PATH = f'Project ▸ {WRITE_NOW_LABEL}'
MAKER = 'Vectoria'
MAKER_ADDRESS = 'https://vectoria.com.au'

_ICONS = os.path.join(os.path.dirname(__file__), 'icons')
MARK = os.path.join(_ICONS, 'quac-mark.svg')
MAKER_LOGO = os.path.join(_ICONS, 'vectoria-logo.svg')
MAKER_LOGO_ON_DARK = os.path.join(_ICONS, 'vectoria-logo-dark.svg')

_MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')


def last_change(folder: str, root_file_name: str, exported: bool) -> Optional[str]:
    """
    When the catalogue in `folder` last changed, in local time, such as
    `today at 2:05 pm` or `27 Nov 2026 at 2:05 am`: its root document's last
    change, where the folder holds it, and for an export, where the folder
    also holds a copy under `<project>.stac/data/`. None otherwise.
    """
    if not folder:
        return None
    root = os.path.join(folder, root_file_name)
    try:
        if not os.path.isfile(root):
            return None
        if exported:
            with os.scandir(os.path.join(folder, root_file_name[:-len('.json')], COPIES_FOLDER)) as entries:
                if not any(entry.is_file() for entry in entries):
                    return None
        when = datetime.fromtimestamp(os.path.getmtime(root))
    except OSError:
        return None
    day = 'today' if when.date() == datetime.now().date() else f'{when.day} {_MONTHS[when.month - 1]} {when.year}'
    return f'{day} at {when.hour % 12 or 12}:{when.minute:02d} {"am" if when.hour < 12 else "pm"}'


def status_text(exporting: bool, write_on_save: bool, bucket: Optional[str], changed: Optional[str]) -> tuple[str, str]:
    """
    The QUAC page's status line, as the page's choices stand: what the chosen
    way does, then the rest, ending with when the catalogue in the folder last
    changed (`last_change`). `bucket` is the bucket an export uploads to, empty
    where none is named yet, or None where it uploads nowhere.
    """
    if exporting:
        upload = '' if bucket is None else f' and uploads it to {bucket or "an S3 bucket"}'
        when = f'The export last changed files {changed}.' if changed else 'Nothing is exported to this folder yet.'
        return 'Exports when you ask.', f'{WRITE_NOW_PATH} exports a copy{upload}. {when}'
    when = f'The catalogue last changed {changed}.' if changed else 'Nothing is written to this folder yet.'
    if write_on_save:
        return 'Writes on each save.', when
    return 'Writes when you ask.', f'Choose {WRITE_NOW_PATH}. {when}'


def plugin_metadata() -> dict[str, str]:
    """The `[general]` section of the plugin's `metadata.txt`: its version, homepage and tracker among them."""
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(os.path.join(os.path.dirname(__file__), 'metadata.txt'), encoding='utf-8')
    return dict(parser['general']) if parser.has_section('general') else {}


def _mix(base: QColor, other: QColor, amount: float) -> QColor:
    """`base` moved `amount` of the way to `other`."""
    return QColor(*(round(getattr(base, part)() * (1 - amount) + getattr(other, part)() * amount) for part in ('red', 'green', 'blue')))


class SettingsPage(QgsOptionsPageWidget):
    """
    The QUAC page of Project Properties, from the top:

    - What QUAC does, beside its mark, with a link to what STAC is.
    - A status line, as the page's choices stand: what the chosen way does,
      and when the catalogue in the folder last changed, with a button that
      opens the folder. For a project not saved as a file, a note to save it
      first takes its place, and every control is off.
    - How the project publishes: linking its data where it is, with writing
      on save, or exporting a copy of every layer, in the formats ticked, and
      uploading the export to an S3 bucket: its name, the folder in it, an
      S3-compatible store's endpoint, and an "AWS S3" configuration from
      QGIS's Authentication Manager, saved by its id. Each way says when to
      choose it, and only the chosen way's settings show.
    - Where: the folder, and the root document's name.
    - The plugin's version, links to its documentation and its issues, and
      who made it.

    The colours come from QGIS's palette, so the page follows its theme. The
    settings are saved in the project (`QgsProject.writeEntry`), the folder
    relative to the project file, when Project Properties is closed with OK
    or Apply.
    """

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        project = QgsProject.instance()
        self._saved_as_file = saved_as_file(project)
        write_on_save, setting = read_settings(project)
        root_file_name, children_folder = catalogue_names(project.fileName() or 'project.qgz')
        palette = self.palette()
        window = palette.color(QPalette.ColorRole.Window)
        text = palette.color(QPalette.ColorRole.WindowText)
        self._muted_colour = _mix(text, window, 0.3)
        on_dark = window.lightness() < 128
        style = self.style()
        indent = style.pixelMetric(QStyle.PixelMetric.PM_ExclusiveIndicatorWidth) + style.pixelMetric(QStyle.PixelMetric.PM_RadioButtonLabelSpacing)

        # What QUAC does.
        mark = QLabel()
        mark.setPixmap(QIcon(MARK).pixmap(QSize(44, 44)))
        mark.setFixedSize(44, 44)
        name = QLabel(TITLE)
        title_font = name.font()
        if title_font.pointSizeF() > 0:
            title_font.setPointSizeF(title_font.pointSizeF() * 1.3)
        title_font.setBold(True)
        name.setFont(title_font)
        self.purpose = self._label(f'{escape(PURPOSE)} <a href="{STAC_ADDRESS}">What is STAC?</a>', muted=True)
        about = QVBoxLayout()
        about.setSpacing(2)
        about.addWidget(name)
        about.addWidget(self.purpose)
        header = QHBoxLayout()
        header.setSpacing(14)
        header.addWidget(mark, 0, Qt.AlignmentFlag.AlignTop)
        header.addLayout(about, 1)

        # The status line, or the note to save the project first.
        self.status = self._label('')
        self.open_folder = QPushButton('Open folder')
        self.open_folder.clicked.connect(self._open_folder)
        self.status_panel = self._panel('quacStatus', _mix(window, text, 0.04), _mix(window, text, 0.16))
        status_row = QHBoxLayout(self.status_panel)
        status_row.setContentsMargins(12, 8, 10, 8)
        status_row.setSpacing(10)
        status_row.addWidget(self.status, 1)
        status_row.addWidget(self.open_folder, 0, Qt.AlignmentFlag.AlignVCenter)
        highlight = palette.color(QPalette.ColorRole.Highlight)
        self.not_saved = self._panel('quacNotSaved', _mix(window, highlight, 0.14), _mix(window, highlight, 0.5))
        not_saved_row = QHBoxLayout(self.not_saved)
        not_saved_row.setContentsMargins(12, 9, 12, 9)
        not_saved_row.addWidget(self._label(escape(NOT_SAVED_NOTE)), 1)

        # How the project publishes.
        self.link = QRadioButton(LINK_LABEL)
        self.link_note = self._label(escape(LINK_PURPOSE), muted=True, indent=indent)
        self.write_on_save = QCheckBox('Write the catalogue each time the project is saved')
        self.write_on_save.setChecked(write_on_save)
        self.export = QRadioButton(EXPORT_LABEL)
        self.export_note = self._label(escape(EXPORT_PURPOSE), muted=True, indent=indent)
        self._mode = QButtonGroup(self)
        self._mode.addButton(self.link)
        self._mode.addButton(self.export)
        (self.export if read_mode(project) == EXPORT else self.link).setChecked(True)

        writable = writable_formats()
        chosen = read_formats(project)
        self.geoparquet = QCheckBox('GeoParquet')
        self.flatgeobuf = QCheckBox('FlatGeobuf')
        self.geopackage = QCheckBox('GeoPackage')
        self.geojson = QCheckBox('GeoJSON')
        self.csv = QCheckBox('CSV')
        self.csv.setToolTip(CSV_PURPOSE)
        self._format_boxes = {GEOPARQUET: self.geoparquet, FLATGEOBUF: self.flatgeobuf, GEOPACKAGE: self.geopackage, GEOJSON: self.geojson, CSV: self.csv}
        for format_id, box in self._format_boxes.items():
            box.setChecked(format_id in chosen and format_id in writable)
        self._geoparquet_writable = GEOPARQUET in writable
        if not self._geoparquet_writable:
            self.flatgeobuf.setChecked(self.flatgeobuf.isChecked() or GEOPARQUET in chosen)
            self.geoparquet.setToolTip(GEOPARQUET_UNAVAILABLE)
        self.pmtiles = QCheckBox('PMTiles')
        self._pmtiles_writable = PMTILES in writable
        self.pmtiles.setChecked(PMTILES in chosen and self._pmtiles_writable)
        self.pmtiles.setToolTip(PMTILES_PURPOSE if self._pmtiles_writable else PMTILES_UNAVAILABLE)
        formats = QGridLayout()
        formats.setHorizontalSpacing(16)
        for index, box in enumerate((self.geoparquet, self.flatgeobuf, self.pmtiles, self.geopackage, self.geojson, self.csv)):
            formats.addWidget(box, index // 3, index % 3)
        formats.setColumnStretch(3, 1)
        self.format_note = QLabel()
        self.format_note.setWordWrap(True)
        self.format_note.setOpenExternalLinks(True)
        format_choice = QVBoxLayout()
        format_choice.setSpacing(2)
        format_choice.addLayout(formats)
        format_choice.addWidget(self.format_note)

        upload_on, _found = project.readBoolEntry(SETTINGS_SCOPE, UPLOAD_KEY, False)
        self.upload = QCheckBox('Upload to an S3 bucket after each export')
        self.upload.setChecked(bool(upload_on))
        self.bucket = QLineEdit(project.readEntry(SETTINGS_SCOPE, BUCKET_KEY, '')[0])
        self.bucket.setPlaceholderText('parks-catalogue')
        self.bucket_folder = QLineEdit(project.readEntry(SETTINGS_SCOPE, BUCKET_FOLDER_KEY, '')[0])
        self.bucket_folder.setPlaceholderText("The bucket's top level")
        self.endpoint = QLineEdit(project.readEntry(SETTINGS_SCOPE, ENDPOINT_KEY, '')[0])
        self.endpoint.setPlaceholderText('Amazon S3')
        self.endpoint.setToolTip(ENDPOINT_PURPOSE)
        self.credentials = QgsAuthConfigSelect(self, AWS_S3_PROVIDER)
        self.credentials.setConfigId(project.readEntry(SETTINGS_SCOPE, AUTHCFG_KEY, '')[0])
        self.upload_settings = QWidget()
        upload_form = QFormLayout(self.upload_settings)
        upload_form.setContentsMargins(indent, 0, 0, 0)
        upload_form.addRow('Bucket', self.bucket)
        upload_form.addRow('Folder in bucket', self.bucket_folder)
        upload_form.addRow('Endpoint', self.endpoint)
        upload_form.addRow('Credentials', self.credentials)
        self._upload_fields = (self.bucket, self.bucket_folder, self.endpoint, self.credentials)

        self.link_settings = QWidget()
        link_form = QVBoxLayout(self.link_settings)
        link_form.setContentsMargins(indent, 2, 0, 0)
        link_form.addWidget(self.write_on_save)
        self.export_settings = QWidget()
        export_form = QFormLayout(self.export_settings)
        export_form.setContentsMargins(indent, 4, 0, 0)
        export_form.addRow('Formats', format_choice)
        export_form.addRow(self.upload)
        export_form.addRow(self.upload_settings)

        how = QVBoxLayout()
        how.setSpacing(0)
        how.addWidget(self._heading('How to publish'))
        how.addSpacing(6)
        for radio, note, settings in ((self.link, self.link_note, self.link_settings), (self.export, self.export_note, self.export_settings)):
            how.addWidget(radio)
            how.addWidget(note)
            how.addWidget(settings)
            how.addSpacing(8)

        # Where.
        self.folder = QgsFileWidget()
        self.folder.setStorageMode(getattr(QgsFileWidget, 'GetDirectory', None) or QgsFileWidget.StorageMode.GetDirectory)
        self.folder.setDialogTitle('Folder for the STAC catalogue')
        catalogue = f'{root_file_name}, with the other documents in {children_folder}/' if self._saved_as_file else UNSAVED_CATALOGUE
        self.root_file = self._label(escape(catalogue), muted=True)
        where_form = QFormLayout()
        where_form.addRow('Folder', self.folder)
        where_form.addRow('Catalogue', self.root_file)
        where = QVBoxLayout()
        where.setSpacing(6)
        where.addWidget(self._heading('Where'))
        where.addLayout(where_form)

        # The plugin's version, its links, and who made it.
        metadata = plugin_metadata()
        links = [escape(f'{TITLE} {metadata.get("version", "")}'.strip())]
        links += [f'<a href="{escape(address)}">{label}</a>' for label, address in (('Documentation', metadata.get('homepage')), ('Report a problem', metadata.get('tracker'))) if address]
        self.about = self._label(' · '.join(links), muted=True, small=True)
        made_by = self._label('Made by', muted=True, small=True)
        maker_logo = QLabel()
        maker_logo.setPixmap(QIcon(MAKER_LOGO_ON_DARK if on_dark else MAKER_LOGO).pixmap(QSize(22, 14)))
        self.maker = self._label(f'<a href="{MAKER_ADDRESS}" style="color: {self._muted_colour.name()}; text-decoration: none">{MAKER}</a>', muted=True, small=True)
        footer = QHBoxLayout()
        footer.setSpacing(5)
        footer.addWidget(self.about)
        footer.addStretch(1)
        footer.addWidget(made_by)
        footer.addWidget(maker_logo)
        footer.addWidget(self.maker)
        rule = QFrame()
        rule.setFrameShape(QFrame.Shape.HLine)
        rule.setFrameShadow(QFrame.Shadow.Plain)
        rule_palette = rule.palette()
        rule_palette.setColor(QPalette.ColorRole.WindowText, _mix(window, text, 0.16))
        rule.setPalette(rule_palette)

        body = QWidget()
        body.setMaximumWidth(680)
        layout = QVBoxLayout(body)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)
        layout.addLayout(header)
        layout.addWidget(self.status_panel)
        layout.addWidget(self.not_saved)
        layout.addLayout(how)
        layout.addLayout(where)
        layout.addStretch(1)
        layout.addWidget(rule)
        layout.addLayout(footer)
        page = QHBoxLayout(self)
        page.addWidget(body, 1)
        page.addStretch(0)

        if self._saved_as_file:
            home = project_folder(project)
            self.folder.setDefaultRoot(home)
            self.folder.setFilePath(chosen_folder(home, setting))
        self.status_panel.setVisible(self._saved_as_file)
        self.not_saved.setVisible(not self._saved_as_file)

        self._root_file_name = root_file_name
        self.link.toggled.connect(self._enable_options)
        self.upload.toggled.connect(self._enable_options)
        self.write_on_save.toggled.connect(self._show_status)
        self.bucket.textChanged.connect(self._show_status)
        self.folder.fileChanged.connect(self._show_status)
        for box in (*self._format_boxes.values(), self.pmtiles):
            box.toggled.connect(self._show_format_note)
        self._enable_options()
        if not self._saved_as_file:
            for control in (self.folder, self.root_file, self.link, self.link_note, self.export, self.export_note, self.write_on_save, *self._format_boxes.values(), self.pmtiles, self.upload, *self._upload_fields):
                control.setEnabled(False)

    def _label(self, text: str, muted: bool = False, small: bool = False, indent: int = 0) -> QLabel:
        """A label of rich text that wraps, opens its links in the browser, and is in the muted colour where `muted`."""
        label = QLabel(text)
        label.setTextFormat(Qt.TextFormat.RichText)
        label.setWordWrap(not small)
        label.setOpenExternalLinks(True)
        label.setContentsMargins(indent, 0, 0, 0)
        if muted:
            palette = label.palette()
            for group in (QPalette.ColorGroup.Active, QPalette.ColorGroup.Inactive):
                palette.setColor(group, QPalette.ColorRole.WindowText, self._muted_colour)
            label.setPalette(palette)
        if small:
            font = label.font()
            if font.pointSizeF() > 0:
                font.setPointSizeF(font.pointSizeF() * 0.92)
            label.setFont(font)
        return label

    @staticmethod
    def _heading(text: str) -> QLabel:
        heading = QLabel(text)
        font = heading.font()
        font.setBold(True)
        heading.setFont(font)
        return heading

    @staticmethod
    def _panel(name: str, background: QColor, border: QColor) -> QFrame:
        """A panel with a faint background and border, in colours worked out from QGIS's palette."""
        panel = QFrame()
        panel.setObjectName(name)
        panel.setStyleSheet(f'QFrame#{name} {{ background-color: {background.name()}; border: 1px solid {border.name()}; border-radius: 3px; }}')
        return panel

    def _enable_options(self) -> None:
        """Shows the chosen way's own settings and hides the other's, and the upload's while it is on; turns off what cannot be used."""
        linking = self.link.isChecked()
        self.link_settings.setVisible(linking)
        self.export_settings.setVisible(not linking)
        self.upload_settings.setVisible(self.upload.isChecked())
        self.write_on_save.setEnabled(linking)
        for box in (self.flatgeobuf, self.geopackage, self.geojson, self.csv):
            box.setEnabled(not linking)
        self.geoparquet.setEnabled(not linking and self._geoparquet_writable)
        self.pmtiles.setEnabled(not linking and self._pmtiles_writable)
        self.upload.setEnabled(not linking)
        for control in self._upload_fields:
            control.setEnabled(not linking and self.upload.isChecked())
        self._show_format_note()
        self._show_status()

    def _show_status(self, *_args: Any) -> None:
        """The status line, as the page's choices stand (`status_text`), and the Open folder button, on where the folder exists."""
        if not self._saved_as_file:
            return
        exporting = self.export.isChecked()
        folder = self.folder.filePath()
        bucket = self.bucket.text().strip() if exporting and self.upload.isChecked() else None
        lead, rest = status_text(exporting, self.write_on_save.isChecked(), bucket, last_change(folder, self._root_file_name, exporting))
        self.status.setText(f'<b>{escape(lead)}</b> <span style="color: {self._muted_colour.name()}">{escape(rest)}</span>')
        self.open_folder.setEnabled(bool(folder) and os.path.isdir(folder))

    def _open_folder(self) -> None:
        QDesktopServices.openUrl(QUrl.fromLocalFile(self.folder.filePath()))

    def _show_format_note(self) -> None:
        """
        Says what the ticked formats leave out, while exporting: no format at
        all, no format for the vector layers' data, or no GeoParquet, which
        Portolan needs for each vector layer's data, linked to Portolan's site.
        Nothing where GeoParquet is ticked: the plugin does not check Portolan's
        other rules.
        """
        sentences = []
        data_ticked = any(box.isChecked() for format_id, box in self._format_boxes.items() if format_id != CSV)
        if not data_ticked and not self.csv.isChecked() and not self.pmtiles.isChecked():
            sentences.append(NO_FORMAT_NOTE)
        elif not self.geoparquet.isChecked():
            if not data_ticked:
                sentences.append(NO_DATA_NOTE)
            sentences.append(f'{NOT_PORTOLAN_NOTE if self._geoparquet_writable else NOT_PORTOLAN_HERE_NOTE} <a href="{PORTOLAN_ADDRESS}">About Portolan</a>')
        self.format_note.setText(' '.join(sentences))
        self.format_note.setVisible(self.export.isChecked() and bool(sentences))

    def apply(self) -> None:
        if not self._saved_as_file:
            return
        project = QgsProject.instance()
        project.writeEntry(SETTINGS_SCOPE, MODE_KEY, EXPORT if self.export.isChecked() else LINK)
        project.writeEntry(SETTINGS_SCOPE, WRITE_ON_SAVE_KEY, self.write_on_save.isChecked())
        project.writeEntry(SETTINGS_SCOPE, FOLDER_KEY, folder_setting(project_folder(project), self.folder.filePath()))
        project.writeEntry(SETTINGS_SCOPE, FORMATS_KEY, [format_id for format_id, box in (*self._format_boxes.items(), (PMTILES, self.pmtiles)) if box.isChecked()])
        project.writeEntry(SETTINGS_SCOPE, UPLOAD_KEY, self.upload.isChecked())
        project.writeEntry(SETTINGS_SCOPE, BUCKET_KEY, self.bucket.text().strip())
        project.writeEntry(SETTINGS_SCOPE, BUCKET_FOLDER_KEY, self.bucket_folder.text().strip())
        project.writeEntry(SETTINGS_SCOPE, ENDPOINT_KEY, self.endpoint.text().strip())
        project.writeEntry(SETTINGS_SCOPE, AUTHCFG_KEY, self.credentials.configId())
