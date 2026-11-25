"""
The QUAC Processing provider and its one algorithm, Write QUAC catalogue
(`quac:writequaccatalogue`), which writes a project file's catalogue as the
save does (`desktop.write_catalogue`), from a project of its own.

Each run reads its project file into a new `QgsProject`, never the one on
screen, and releases its layers before it returns, so the runs of QGIS's batch
mode share nothing. It runs on QGIS's main thread (no threading flag), where
QGIS reads a project.
"""

from __future__ import annotations

import os
from typing import Any

from qgis.core import (
    Qgis,
    QgsProcessingAlgorithm,
    QgsProcessingException,
    QgsProcessingOutputFile,
    QgsProcessingOutputNumber,
    QgsProcessingParameterFile,
    QgsProcessingProvider,
)
from qgis.PyQt.QtGui import QIcon

from .desktop import ICON, FolderMissing, ProjectUnreadable, saved_as_file, saved_project, write_catalogue
from .publish import catalogue_names, message

PROJECT = 'PROJECT'
FOLDER = 'FOLDER'
ROOT_FILE = 'ROOT_FILE'
LAYERS_WRITTEN = 'LAYERS_WRITTEN'
LAYERS_LEFT_OUT = 'LAYERS_LEFT_OUT'

HELP = (
    'Writes a QGIS project\'s STAC catalogue, as saving the project with the QUAC option on does: '
    'for a project Parks.qgz, Parks.stac.json, and the Parks.stac folder beside it holding the other documents and each layer\'s style.\n\n'
    'It writes into the folder given here or, with none, the folder chosen on the project\'s QUAC page of Project Properties, '
    'the project\'s own folder until another is chosen. It writes whether or not the project writes its catalogue on save.\n\n'
    'It reads the project file as last saved, apart from the project open in QGIS, so it can run over many project files in batch mode, '
    'or from the command line with qgis_process.\n\n'
    'A layer is left out where its data file is outside the folder, where its data is held in a database, '
    'where QGIS could not open its data (a WMS, WMTS or XYZ layer is written all the same), or where its web address holds a user name or password. '
    'The log names each layer left out, and what to do to include it.'
)


def _flag(new_group: str, new_name: str, old_name: str) -> Any:
    """An enum value by its QGIS 3.36-and-later name in `Qgis`, or its earlier name on `QgsProcessingAlgorithm` or `QgsProcessingParameterFile`."""
    group = getattr(Qgis, new_group, None)
    if group is not None and hasattr(group, new_name):
        return getattr(group, new_name)
    for owner in (QgsProcessingAlgorithm, QgsProcessingParameterFile):
        if hasattr(owner, old_name):
            return getattr(owner, old_name)
    raise AttributeError(old_name)


class QuacProvider(QgsProcessingProvider):
    """The QUAC provider in the Processing Toolbox."""

    def id(self) -> str:
        return 'quac'

    def name(self) -> str:
        return 'QUAC'

    def longName(self) -> str:  # noqa: N802 - the name QGIS calls
        return 'QUAC'

    def icon(self) -> QIcon:
        return QIcon(ICON)

    def loadAlgorithms(self) -> None:  # noqa: N802 - the name QGIS calls
        self.addAlgorithm(WriteCatalogue())


class WriteCatalogue(QgsProcessingAlgorithm):
    """Write QUAC catalogue: a project file's catalogue, into its chosen folder or the one given."""

    def name(self) -> str:
        return 'writequaccatalogue'

    def displayName(self) -> str:  # noqa: N802 - the name QGIS calls
        return 'Write QUAC catalogue'

    def shortHelpString(self) -> str:  # noqa: N802 - the name QGIS calls
        return HELP

    def icon(self) -> QIcon:
        return QIcon(ICON)

    def flags(self) -> Any:
        return super().flags() | _flag('ProcessingAlgorithmFlag', 'NoThreading', 'FlagNoThreading')

    def createInstance(self) -> 'WriteCatalogue':  # noqa: N802 - the name QGIS calls
        return WriteCatalogue()

    def initAlgorithm(self, config: Any = None) -> None:  # noqa: N802 - the name QGIS calls
        self.addParameter(QgsProcessingParameterFile(
            PROJECT,
            'Project file',
            _flag('ProcessingFileParameterBehavior', 'File', 'File'),
            fileFilter='QGIS projects (*.qgz *.qgs *.QGZ *.QGS)',
        ))
        self.addParameter(QgsProcessingParameterFile(
            FOLDER,
            "Folder for the catalogue (empty: the project's chosen folder)",
            _flag('ProcessingFileParameterBehavior', 'Folder', 'Folder'),
            optional=True,
        ))
        self.addOutput(QgsProcessingOutputFile(ROOT_FILE, 'Root file'))
        self.addOutput(QgsProcessingOutputNumber(LAYERS_WRITTEN, 'Layers written'))
        self.addOutput(QgsProcessingOutputNumber(LAYERS_LEFT_OUT, 'Layers left out'))

    def processAlgorithm(self, parameters: Any, context: Any, feedback: Any) -> dict[str, Any]:  # noqa: N802 - the name QGIS calls
        file_name = self.parameterAsFile(parameters, PROJECT, context)
        folder = self.parameterAsFile(parameters, FOLDER, context) or None
        if not file_name or not file_name.lower().endswith(('.qgs', '.qgz')) or not os.path.isfile(file_name):
            raise QgsProcessingException(f'{file_name or "No project file was given"} is not a QGIS project file. Choose a .qgz or .qgs file.')
        try:
            with saved_project(os.path.abspath(file_name)) as project:
                if not saved_as_file(project):
                    raise QgsProcessingException(f'{file_name} is not a QGIS project file. Choose a .qgz or .qgs file.')
                written_to, publication = write_catalogue(project, os.path.abspath(folder) if folder else None)
        except ProjectUnreadable as unreadable:
            raise QgsProcessingException(f'The project {unreadable.file_name} could not be read: {unreadable.reason}. Open it in QGIS to check it, and run this again.') from None
        except FolderMissing as missing:
            raise QgsProcessingException(f'The STAC catalogue was not written, because its folder does not exist: {missing.folder}. Choose a folder that exists, or one on the QUAC page of the project\'s Project Properties.') from None
        if publication.refusal is not None:
            raise QgsProcessingException(publication.refusal)
        level, text = message(publication)
        if level == 'info':
            feedback.pushInfo(text)
        else:
            feedback.pushWarning(text)
        root_file_name, _children_folder = catalogue_names(file_name)
        return {
            ROOT_FILE: os.path.join(written_to, root_file_name),
            LAYERS_WRITTEN: publication.layer_count,
            LAYERS_LEFT_OUT: len(publication.left_out),
        }
