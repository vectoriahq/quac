"""
The plugin's QGIS Desktop part: a QUAC page in Project Properties, and on each
save of a project with the option on, its catalogue written into the chosen
folder as STAC documents (`publish.py` works out what to write).

What happens on save:

- Only for a project saved as a `.qgs` or `.qgz` file, with the option on.
- A layer QGIS could not open, or that it does not hold, is left out.
- The saved file is read from disk, the field types and WGS84 boxes from
  QGIS (`qgis_inputs.py`), and each layer's current style as QML.
- Each file is written to a temporary file in its own folder and then renamed
  over the old one, so a sync client never sees half a file. A file whose
  bytes have not changed is left as it is.
- After writing, the documents and styles the previous catalogue linked under
  `<project>.stac/` and this one does not are removed, and so is each folder
  under `<project>.stac/` they leave empty.
- Any error is caught, so the save itself is never affected: the message bar
  says what happened and what to do, and the details go to the QGIS log under
  the tag `QUAC`.
"""

from __future__ import annotations

import os
import tempfile
import traceback
from typing import Any, Optional

from qgis.core import Qgis, QgsMapLayer, QgsMessageLog, QgsPathResolver, QgsProject, QgsReadWriteContext
from qgis.gui import QgsFileWidget, QgsOptionsPageWidget, QgsOptionsWidgetFactory
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QCheckBox, QFormLayout, QLabel, QLineEdit, QVBoxLayout
from qgis.PyQt.QtXml import QDomDocument

from .publish import (
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
)
from .qgis_inputs import field_types, layer_extents, stored_project

LOG_TAG = 'QUAC'
TITLE = 'QUAC'
ICON = os.path.join(os.path.dirname(__file__), 'icon.png')

FAILURE_MESSAGE = 'The STAC catalogue could not be written. The project itself was saved. The QUAC tab of the Log Messages panel has the details.'

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


def publish_project(project: Any) -> Optional[Publication]:
    """Writes the project's catalogue where its settings say. None where the option is off or the project is not saved as a file."""
    write_on_save, setting = read_settings(project)
    if not write_on_save or not saved_as_file(project):
        return None
    home = os.path.realpath(project_folder(project))
    folder = os.path.realpath(chosen_folder(home, setting))
    root_file_name, children_folder = catalogue_names(project.fileName())
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
    )
    if publication.refusal is None:
        write_publication(folder, publication)
    return publication


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
    """The plugin in QGIS Desktop, which starts it through `classFactory`."""

    def __init__(self, iface: Any) -> None:
        self.iface = iface
        self._factory: Optional[SettingsPageFactory] = None

    def initGui(self) -> None:  # noqa: N802 - the name QGIS calls
        self._factory = SettingsPageFactory()
        self.iface.registerProjectPropertiesWidgetFactory(self._factory)
        QgsProject.instance().projectSaved.connect(self.project_saved)

    def unload(self) -> None:
        try:
            QgsProject.instance().projectSaved.disconnect(self.project_saved)
        except (TypeError, RuntimeError):
            pass
        if self._factory is not None:
            self.iface.unregisterProjectPropertiesWidgetFactory(self._factory)
            self._factory = None

    def project_saved(self) -> None:
        project = QgsProject.instance()
        try:
            publication = publish_project(project)
        except FolderMissing as missing:
            self._show('warning', f'The STAC catalogue was not written, because its folder does not exist: {missing.folder}. Choose a folder on the QUAC page of Project Properties, and save again.')
            return
        except Exception as error:  # noqa: BLE001 - a failure here must never reach the save
            QgsMessageLog.logMessage(f'The STAC catalogue for {project.baseName()} could not be written: {type(error).__name__}: {error}\n{traceback.format_exc()}', LOG_TAG, _level('Critical'))
            self._show('warning', FAILURE_MESSAGE)
            return
        if publication is None:
            return
        for sentence in publication.warnings():
            QgsMessageLog.logMessage(f'{project.baseName()}: {sentence}', LOG_TAG, _level('Warning'))
        level, text = message(publication)
        self._show(level, text)

    def _show(self, level: str, text: str) -> None:
        if level == 'info':
            self.iface.messageBar().pushMessage(TITLE, text, _level('Info'), 5)
        else:
            self.iface.messageBar().pushMessage(TITLE, text, _level('Warning'), 0)


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
    The option, the folder and the root document's name. Saved in the project
    (`QgsProject.writeEntry`), the folder relative to the project file, when
    Project Properties is closed with OK or Apply.
    """

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        project = QgsProject.instance()
        self._saved_as_file = saved_as_file(project)
        write_on_save, setting = read_settings(project)
        root_file_name, children_folder = catalogue_names(project.fileName() or 'project.qgz')

        self.write_on_save = QCheckBox('Write a STAC catalogue when the project is saved')
        self.write_on_save.setChecked(write_on_save)
        self.folder = QgsFileWidget()
        self.folder.setStorageMode(getattr(QgsFileWidget, 'GetDirectory', None) or QgsFileWidget.StorageMode.GetDirectory)
        self.folder.setDialogTitle('Folder for the STAC catalogue')
        self.root_file = QLineEdit(root_file_name)
        self.root_file.setReadOnly(True)
        self.explanation = QLabel(
            f'Each save writes {root_file_name}, and the {children_folder} folder beside it, into this folder. '
            'A layer whose data is outside this folder is left out.'
        )
        self.explanation.setWordWrap(True)
        self.not_saved = QLabel('Save the project as a .qgz or .qgs file first. A STAC catalogue is written only for a project saved as a file.')
        self.not_saved.setWordWrap(True)

        if self._saved_as_file:
            home = project_folder(project)
            self.folder.setDefaultRoot(home)
            self.folder.setFilePath(chosen_folder(home, setting))
        self.not_saved.setVisible(not self._saved_as_file)
        for control in (self.write_on_save, self.folder, self.root_file, self.explanation):
            control.setEnabled(self._saved_as_file)

        form = QFormLayout()
        form.addRow('Folder', self.folder)
        form.addRow('Root file', self.root_file)
        layout = QVBoxLayout(self)
        layout.addWidget(self.not_saved)
        layout.addWidget(self.write_on_save)
        layout.addLayout(form)
        layout.addWidget(self.explanation)
        layout.addStretch(1)

    def apply(self) -> None:
        if not self._saved_as_file:
            return
        project = QgsProject.instance()
        project.writeEntry(SETTINGS_SCOPE, WRITE_ON_SAVE_KEY, self.write_on_save.isChecked())
        project.writeEntry(SETTINGS_SCOPE, FOLDER_KEY, folder_setting(project_folder(project), self.folder.filePath()))
