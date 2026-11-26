"""
The plugin's QGIS Desktop part: a QUAC page in Project Properties, Project ▸
Write STAC catalogue now and Project ▸ Export STAC catalogue with data, the
QUAC Processing provider (`algorithm.py`), and on each save of a project with
the option on, its catalogue written into the chosen folder as STAC documents
(`publish.py` works out what to write).

An export first copies the data of each layer the project copies
(`copy_data.py`): from the menu in a background task, and from the algorithm
on its own thread. A save, and Write STAC catalogue now, keep the copies the
last export made.

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

import os
import tempfile
import traceback
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from dataclasses import dataclass, field

from qgis.core import Qgis, QgsApplication, QgsCoordinateTransformContext, QgsFeedback, QgsMapLayer, QgsMessageLog, QgsPathResolver, QgsProject, QgsReadWriteContext, QgsTask, QgsVectorLayer
from qgis.gui import QgsFileWidget, QgsOptionsPageWidget, QgsOptionsWidgetFactory
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QButtonGroup, QCheckBox, QFormLayout, QGroupBox, QLabel, QLineEdit, QRadioButton, QVBoxLayout
from qgis.PyQt.QtXml import QDomDocument

try:
    from qgis.PyQt.QtGui import QAction  # Qt 6, QGIS 4
except ImportError:
    from qgis.PyQt.QtWidgets import QAction  # Qt 5, QGIS 3

from .copy_data import Copies, CopyFormat, LayerSource, copy_format, copy_layers, discard, place_copies
from .publish import (
    COPY_DATA_KEY,
    EXPORT_LABEL,
    FOLDER_KEY,
    SETTINGS_SCOPE,
    WRITE_ON_SAVE_KEY,
    LayerStyle,
    Publication,
    catalogue_names,
    chosen_folder,
    emptied_folders,
    folder_setting,
    message,
    plan_publication,
    read_data_file,
)
from .qgis_inputs import field_types, layer_extents, stored_project, wgs84_box

LOG_TAG = 'QUAC'
TITLE = 'QUAC'
ICON = os.path.join(os.path.dirname(__file__), 'icon.png')

FAILURE_MESSAGE = 'The STAC catalogue could not be written. The project itself was saved. The QUAC tab of the Log Messages panel has the details.'
WRITE_NOW_LABEL = 'Write STAC catalogue now'
WRITE_NOW_FAILURE_MESSAGE = 'The STAC catalogue could not be written. The QUAC tab of the Log Messages panel has the details.'
NOT_SAVED_MESSAGE = 'Save the project as a .qgz or .qgs file first, then write its STAC catalogue.'
EXPORT_FAILURE_MESSAGE = 'The STAC catalogue could not be exported. The QUAC tab of the Log Messages panel has the details.'
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


def read_copy_data(project: Any) -> bool:
    """Whether the project copies in the data of layers the chosen folder does not hold, when its catalogue is exported."""
    copy_data, _found = project.readBoolEntry(SETTINGS_SCOPE, COPY_DATA_KEY, False)
    return bool(copy_data)


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


def write_catalogue(project: Any, folder: Optional[str] = None, copies: Optional[dict[str, Any]] = None, copy_failures: Optional[set[str]] = None) -> tuple[str, Publication]:
    """
    Writes the catalogue of `project`, saved as a file, from its saved file and
    what QGIS gives for its layers, into `folder`, or where its settings say
    where `folder` is None. Returns the folder and what was written, or why
    nothing was. The save, the menu actions and the Processing algorithm all
    write through this. `copies` holds the copies an export just made, by
    layer id; None, as on a save, keeps the copies the last export made.
    """
    folder, publication = plan_catalogue(project, folder, copies, copy_failures)
    if publication.refusal is None:
        write_publication(folder, publication)
    return folder, publication


def plan_catalogue(project: Any, folder: Optional[str] = None, copies: Optional[dict[str, Any]] = None, copy_failures: Optional[set[str]] = None) -> tuple[str, Publication]:
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
        copy_data=read_copy_data(project),
        copies=copies,
        copy_failures=copy_failures,
    )
    return folder, publication


@dataclass
class ExportJob:
    """What an export copies, worked out on the main thread from the project as saved: the folder, the documents' folder, each layer to copy, the format and the project's datum transformations."""

    folder: str
    children_folder: str
    format: CopyFormat
    sources: list[LayerSource] = field(default_factory=list)
    transform_context: Any = None


def prepare_export(project: Any, folder: Optional[str] = None) -> ExportJob:
    """The layers an export of `project` copies: none where the project does not copy data. Raises `FolderMissing` as `write_catalogue` does."""
    planned_folder, publication = plan_catalogue(project, folder, copies={})
    job = ExportJob(planned_folder, publication.children_folder, copy_format(), transform_context=QgsCoordinateTransformContext(project.transformContext()))
    if publication.refusal is not None or not read_copy_data(project):
        return job
    for request in publication.to_copy:
        layer = project.mapLayer(request.layer_id)
        if isinstance(layer, QgsVectorLayer) and layer.isValid():
            job.sources.append(LayerSource(request.layer_id, layer.name(), layer.source(), layer.providerType(), request.hidden_fields))
    return job


def finish_export(project: Any, job: ExportJob, copies: Copies) -> Publication:
    """Moves the copies into place and writes the catalogue that names them, with each failed copy logged and left out."""
    for layer_id, reason in copies.failed.items():
        layer = project.mapLayer(layer_id)
        QgsMessageLog.logMessage(f'{project.baseName()}: the data of {layer.name() if layer is not None else layer_id} could not be copied: {reason}', LOG_TAG, _level('Warning'))
    placed = place_copies(copies, job.folder)
    return write_catalogue(project, job.folder, copies=placed, copy_failures=set(copies.failed))[1]


def export_catalogue(project: Any, folder: Optional[str] = None, feedback: Any = None) -> tuple[str, Optional[Publication]]:
    """
    Exports the catalogue of `project` with its data, on this thread: copies
    each layer the project copies, then writes the catalogue. Returns the
    folder and what was written, or None where `feedback` was cancelled, which
    leaves the folder as it was.
    """
    job = prepare_export(project, folder)
    if not job.sources:
        return write_catalogue(project, job.folder, copies={} if read_copy_data(project) else None)
    copies = copy_layers(job.sources, job.folder, job.children_folder, job.format, job.transform_context, feedback)
    if copies.cancelled:
        return job.folder, None
    return job.folder, finish_export(project, job, copies)


def publish_project(project: Any) -> Optional[Publication]:
    """Writes the project's catalogue where its settings say, on save. None where the option is off or the project is not saved as a file."""
    write_on_save, _setting = read_settings(project)
    if not write_on_save or not saved_as_file(project):
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


def _read_inside(folder: str, name: str) -> Optional[bytes]:
    target = _path_inside(folder, name)
    if not os.path.isfile(target):
        return None
    with open(target, 'rb') as handle:
        return handle.read()


def _write_atomically(target: str, data: bytes) -> None:
    """Writes `data` to a temporary file beside `target` and renames it over `target`; leaves an unchanged file alone."""
    if os.path.isfile(target):
        with open(target, 'rb') as handle:
            if handle.read() == data:
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
        self._export: Optional[QAction] = None
        self._menu: Any = None
        self._task: Optional[ExportTask] = None

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
        self._export = QAction(QIcon(ICON), EXPORT_LABEL, self.iface.mainWindow())
        self._export.setObjectName('quacExportCatalogueWithData')
        self._export.triggered.connect(self.export_now)
        self._add_to_project_menu(self._export, after=self._write_now)

    def unload(self) -> None:
        try:
            QgsProject.instance().projectSaved.disconnect(self.project_saved)
        except (TypeError, RuntimeError):
            pass
        for action in (self._write_now, self._export):
            if action is None:
                continue
            if self._menu is not None:
                self._menu.removeAction(action)
            else:
                self.iface.removePluginMenu(TITLE, action)
            action.deleteLater()
        self._write_now = None
        self._export = None
        self._menu = None
        if self._factory is not None:
            self.iface.unregisterProjectPropertiesWidgetFactory(self._factory)
            self._factory = None
        if self._provider is not None:
            QgsApplication.processingRegistry().removeProvider(self._provider)
            self._provider = None

    def _add_to_project_menu(self, action: QAction, after: Optional[QAction] = None) -> Any:
        """Puts the action in the Project menu after `after`, or after Save As, and returns the menu; or, where QGIS gives no Project menu, in the Plugins menu under QUAC, and returns None."""
        project_menu = getattr(self.iface, 'projectMenu', None)
        menu = project_menu() if project_menu is not None else None
        if menu is None:
            self.iface.addPluginToMenu(TITLE, action)
            return None
        actions = menu.actions()
        save_as = after or (self.iface.actionSaveProjectAs() if hasattr(self.iface, 'actionSaveProjectAs') else None)
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
        """Project ▸ Write STAC catalogue now: the project as last saved, into its chosen folder, whether or not writing on save is on."""
        project = QgsProject.instance()
        if not saved_as_file(project):
            self._show('warning', NOT_SAVED_MESSAGE)
            return

        def from_saved_file() -> Publication:
            with saved_project(project.fileName()) as saved:
                return write_catalogue(saved)[1]

        self._report(project, from_saved_file, WRITE_NOW_FAILURE_MESSAGE, UNSAVED_CHANGES_MESSAGE if project.isDirty() else None)

    def export_now(self) -> None:
        """
        Project ▸ Export STAC catalogue with data: the project as last saved,
        with the data it copies copied first in a background task, which QGIS's
        task manager shows with its progress and a cancel button. The catalogue
        is written once every copy is made.
        """
        project = QgsProject.instance()
        if not saved_as_file(project):
            self._show('warning', NOT_SAVED_MESSAGE)
            return
        if self._task is not None:
            self._show('warning', 'The STAC catalogue is already being exported. Wait for that export to finish, or cancel it in the task manager.')
            return
        note = UNSAVED_CHANGES_MESSAGE if project.isDirty() else None
        file_name = project.fileName()
        job: Optional[ExportJob] = None

        def prepare() -> Optional[Publication]:
            nonlocal job
            with saved_project(file_name) as saved:
                job = prepare_export(saved)
                if not job.sources:
                    return write_catalogue(saved, job.folder, copies={} if read_copy_data(saved) else None)[1]
            return None

        if not self._report(project, prepare, EXPORT_FAILURE_MESSAGE, note) or job is None or not job.sources:
            return
        self._task = ExportTask(job, lambda copies: self._finish_export(file_name, job, copies, note))
        QgsApplication.taskManager().addTask(self._task)

    def _finish_export(self, file_name: str, job: 'ExportJob', copies: Copies, note: Optional[str]) -> None:
        self._task = None
        if copies.cancelled:
            self._show('info', EXPORT_CANCELLED_MESSAGE)
            return
        project = QgsProject.instance()

        def finish() -> Publication:
            with saved_project(file_name) as saved:
                return finish_export(saved, job, copies)

        self._report(project, finish, EXPORT_FAILURE_MESSAGE, note)

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
        super().__init__(f'Exporting the STAC catalogue with data: {len(job.sources)} layers to copy')
        self.job = job
        self.done = done
        self.copies = Copies()
        self.feedback = QgsFeedback()
        self.feedback.progressChanged.connect(self.setProgress)

    def cancel(self) -> None:
        self.feedback.cancel()
        super().cancel()

    def run(self) -> bool:
        self.copies = copy_layers(self.job.sources, self.job.folder, self.job.children_folder, self.job.format, self.job.transform_context, self.feedback)
        return not self.copies.cancelled

    def finished(self, result: bool) -> None:
        if not result:
            self.copies.cancelled = True
            discard(self.copies)
        self.done(self.copies)


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


class SettingsPage(QgsOptionsPageWidget):
    """
    Writing on save, the folder, the root document's name, and whether the
    data of layers the folder does not hold is left out or copied in when the
    catalogue is exported. Saved in the project (`QgsProject.writeEntry`), the
    folder relative to the project file, when Project Properties is closed
    with OK or Apply.
    """

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        project = QgsProject.instance()
        self._saved_as_file = saved_as_file(project)
        write_on_save, setting = read_settings(project)
        root_file_name, _children_folder = catalogue_names(project.fileName() or 'project.qgz')

        self.write_on_save = QCheckBox('Write the catalogue each time the project is saved')
        self.write_on_save.setChecked(write_on_save)
        self.on_save_note = QLabel("Updates the catalogue's settings in seconds. Copied data is kept as it was last exported.")
        self.on_save_note.setWordWrap(True)
        self.folder = QgsFileWidget()
        self.folder.setStorageMode(getattr(QgsFileWidget, 'GetDirectory', None) or QgsFileWidget.StorageMode.GetDirectory)
        self.folder.setDialogTitle('Folder for the STAC catalogue')
        self.root_file = QLineEdit(root_file_name)
        self.root_file.setReadOnly(True)

        self.leave_out = QRadioButton('Leave them out')
        self.copy_in = QRadioButton('Copy their data in when the catalogue is exported')
        self._copy_choice = QButtonGroup(self)
        self._copy_choice.addButton(self.leave_out)
        self._copy_choice.addButton(self.copy_in)
        (self.copy_in if read_copy_data(project) else self.leave_out).setChecked(True)
        format_ = copy_format()
        self.data_format = QLabel('GeoParquet' if format_.geoparquet else "FlatGeobuf. This QGIS can't write GeoParquet as Portolan asks.")
        self.data_format.setWordWrap(True)
        self.export_note = QLabel(f'Copy the data in with Project ▸ {EXPORT_LABEL}.')
        self.export_note.setWordWrap(True)
        copy_form = QFormLayout()
        copy_form.addRow('Data', self.data_format)
        copy_box = QGroupBox('Layers with data outside this folder')
        copy_layout = QVBoxLayout(copy_box)
        copy_layout.addWidget(self.leave_out)
        copy_layout.addWidget(self.copy_in)
        copy_layout.addLayout(copy_form)
        copy_layout.addWidget(self.export_note)
        self.copy_in.toggled.connect(self._show_copy_details)
        self._show_copy_details(self.copy_in.isChecked())

        self.not_saved = QLabel('Save the project as a .qgz or .qgs file first. A STAC catalogue is written only for a project saved as a file.')
        self.not_saved.setWordWrap(True)

        if self._saved_as_file:
            home = project_folder(project)
            self.folder.setDefaultRoot(home)
            self.folder.setFilePath(chosen_folder(home, setting))
        self.not_saved.setVisible(not self._saved_as_file)
        for control in (self.write_on_save, self.on_save_note, self.folder, self.root_file, copy_box):
            control.setEnabled(self._saved_as_file)

        form = QFormLayout()
        form.addRow('Folder', self.folder)
        form.addRow('Catalogue', self.root_file)
        layout = QVBoxLayout(self)
        layout.addWidget(self.not_saved)
        layout.addWidget(self.write_on_save)
        layout.addWidget(self.on_save_note)
        layout.addLayout(form)
        layout.addWidget(copy_box)
        layout.addStretch(1)

    def _show_copy_details(self, copying: bool) -> None:
        self.data_format.setEnabled(copying)
        self.export_note.setVisible(copying)

    def apply(self) -> None:
        if not self._saved_as_file:
            return
        project = QgsProject.instance()
        project.writeEntry(SETTINGS_SCOPE, WRITE_ON_SAVE_KEY, self.write_on_save.isChecked())
        project.writeEntry(SETTINGS_SCOPE, FOLDER_KEY, folder_setting(project_folder(project), self.folder.filePath()))
        project.writeEntry(SETTINGS_SCOPE, COPY_DATA_KEY, self.copy_in.isChecked())
