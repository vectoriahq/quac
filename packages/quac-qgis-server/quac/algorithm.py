"""
The QUAC Processing provider and its one algorithm, Write QUAC catalogue
(`quac:writequaccatalogue`), which writes a project file's catalogue as
Project ▸ Write STAC catalogue now does, as the project's choice says
(`desktop.write_as_set`): linking its data, or exporting a copy of every
layer, from a project of its own. An export is then uploaded to an S3
bucket where the parameters name one, or where the project's QUAC page turns
an upload on (`upload.py`).

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
    QgsProcessingParameterAuthConfig,
    QgsProcessingParameterFile,
    QgsProcessingParameterString,
    QgsProcessingProvider,
)
from qgis.PyQt.QtGui import QIcon

from .desktop import ICON, NO_FORMAT_MESSAGE, FolderMissing, NoFormatTicked, ProjectUnreadable, read_mode, saved_as_file, saved_project, write_as_set
from .publish import EXPORT, catalogue_names, message
from .upload import UploadFailed, pending_upload, read_credentials, result_message, run_upload, upload_target

PROJECT = 'PROJECT'
FOLDER = 'FOLDER'
ROOT_FILE = 'ROOT_FILE'
LAYERS_WRITTEN = 'LAYERS_WRITTEN'
LAYERS_LEFT_OUT = 'LAYERS_LEFT_OUT'
LAYERS_COPIED = 'LAYERS_COPIED'
LAYERS_UNCHANGED = 'LAYERS_UNCHANGED'
UPLOAD_BUCKET = 'UPLOAD_BUCKET'
UPLOAD_FOLDER = 'UPLOAD_FOLDER'
UPLOAD_ENDPOINT = 'UPLOAD_ENDPOINT'
UPLOAD_CREDENTIALS = 'UPLOAD_CREDENTIALS'
FILES_UPLOADED = 'FILES_UPLOADED'
FILES_REMOVED = 'FILES_REMOVED'

HELP = (
    'Writes a QGIS project\'s STAC catalogue, as saving the project with the QUAC option on does: '
    'for a project Parks.qgz, Parks.stac.json, and the Parks.stac folder beside it holding the other documents and each layer\'s style.\n\n'
    'It writes into the folder given here or, with none, the folder chosen on the project\'s QUAC page of Project Properties, '
    'the project\'s own folder until another is chosen. It writes whether or not the project writes its catalogue on save.\n\n'
    'It reads the project file as last saved, apart from the project open in QGIS, so it can run over many project files in batch mode, '
    'or from the command line with qgis_process.\n\n'
    'A layer is left out where its data file is outside the folder, where its data is held in a database, '
    'where QGIS could not open its data (a WMS, WMTS or XYZ layer is written all the same), or where its web address holds a user name or password. '
    'Where the project\'s QUAC page is set to export a copy of every layer, it copies every layer\'s data into the Parks.stac/data folder first, '
    'in the formats ticked there, and the layer is not left out for where its data is. '
    'The log names each layer left out, and what to do to include it.\n\n'
    'An export is then uploaded to an S3 bucket, or an S3-compatible store at another endpoint, '
    'where a bucket is given here, or where the QUAC page turns an upload on and none is given here. '
    'A bucket given here goes with the folder, endpoint and credentials given here, and none of the QUAC page\'s. '
    'Only the files that changed since the last upload are uploaded, and files the catalogue no longer names are removed. '
    'The credentials are an "AWS S3" configuration in QGIS\'s Authentication Manager. '
    'Where the upload fails, the export is left as written, and the next run uploads what was missed.'
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
        for name, description in ((UPLOAD_BUCKET, 'S3 bucket to upload an export to (empty: as the QUAC page says)'), (UPLOAD_FOLDER, 'Folder in the bucket'), (UPLOAD_ENDPOINT, 'Endpoint of an S3-compatible store (empty: Amazon S3)')):
            self.addParameter(QgsProcessingParameterString(name, description, optional=True))
        self.addParameter(QgsProcessingParameterAuthConfig(UPLOAD_CREDENTIALS, 'Credentials for the bucket', optional=True))
        self.addOutput(QgsProcessingOutputFile(ROOT_FILE, 'Root file'))
        self.addOutput(QgsProcessingOutputNumber(LAYERS_WRITTEN, 'Layers written'))
        self.addOutput(QgsProcessingOutputNumber(LAYERS_LEFT_OUT, 'Layers left out'))
        self.addOutput(QgsProcessingOutputNumber(LAYERS_COPIED, 'Layers copied'))
        self.addOutput(QgsProcessingOutputNumber(LAYERS_UNCHANGED, 'Layers unchanged'))
        self.addOutput(QgsProcessingOutputNumber(FILES_UPLOADED, 'Files uploaded'))
        self.addOutput(QgsProcessingOutputNumber(FILES_REMOVED, 'Files removed from the bucket'))

    def processAlgorithm(self, parameters: Any, context: Any, feedback: Any) -> dict[str, Any]:  # noqa: N802 - the name QGIS calls
        file_name = self.parameterAsFile(parameters, PROJECT, context)
        folder = self.parameterAsFile(parameters, FOLDER, context) or None
        bucket = self.parameterAsString(parameters, UPLOAD_BUCKET, context)
        try:
            given_target = upload_target(
                bucket,
                self.parameterAsString(parameters, UPLOAD_FOLDER, context),
                self.parameterAsString(parameters, UPLOAD_ENDPOINT, context),
                self.parameterAsString(parameters, UPLOAD_CREDENTIALS, context),
            ) if bucket.strip() else None
        except UploadFailed as failed:
            raise QgsProcessingException(failed.message) from None
        root_file_name, children_folder = catalogue_names(file_name)
        if not file_name or not file_name.lower().endswith(('.qgs', '.qgz')) or not os.path.isfile(file_name):
            raise QgsProcessingException(f'{file_name or "No project file was given"} is not a QGIS project file. Choose a .qgz or .qgs file.')
        try:
            with saved_project(os.path.abspath(file_name)) as project:
                if not saved_as_file(project):
                    raise QgsProcessingException(f'{file_name} is not a QGIS project file. Choose a .qgz or .qgs file.')
                target = os.path.abspath(folder) if folder else None
                exporting = read_mode(project) == EXPORT
                if given_target is not None and not exporting:
                    raise QgsProcessingException(f'The STAC catalogue was not written: an upload to {given_target.where()} needs an export, and this project links its data. Choose Export a copy of every layer on the QUAC page of its Project Properties, or leave the bucket empty.')
                written_to, publication = write_as_set(project, target, feedback)
                upload = pending_upload(project, written_to, root_file_name, children_folder, given_target) if exporting else None
        except ProjectUnreadable as unreadable:
            raise QgsProcessingException(f'The project {unreadable.file_name} could not be read: {unreadable.reason}. Open it in QGIS to check it, and run this again.') from None
        except NoFormatTicked:
            raise QgsProcessingException(NO_FORMAT_MESSAGE) from None
        except FolderMissing as missing:
            raise QgsProcessingException(f'The STAC catalogue was not written, because its folder does not exist: {missing.folder}. Choose a folder that exists, or one on the QUAC page of the project\'s Project Properties.') from None
        if publication is None:
            raise QgsProcessingException('The export of the STAC catalogue was cancelled. Nothing was changed.')
        if publication.refusal is not None:
            raise QgsProcessingException(publication.refusal)
        level, text = message(publication)
        if level == 'info':
            feedback.pushInfo(text)
        else:
            feedback.pushWarning(text)
        uploaded = removed = 0
        if upload is not None:
            if upload.target is None:
                raise QgsProcessingException(upload.problem or '')
            try:
                result = run_upload(upload, read_credentials(upload.target), feedback.isCanceled, feedback.setProgress)
            except UploadFailed as failed:
                raise QgsProcessingException(failed.message) from None
            feedback.pushInfo(result_message(upload.target, result))
            if result.cancelled:
                raise QgsProcessingException(result_message(upload.target, result))
            uploaded, removed = len(result.uploaded), len(result.removed)
        return {
            ROOT_FILE: os.path.join(written_to, root_file_name),
            LAYERS_WRITTEN: publication.layer_count,
            LAYERS_LEFT_OUT: len(publication.left_out),
            LAYERS_COPIED: len(publication.copied),
            LAYERS_UNCHANGED: len(publication.unchanged),
            FILES_UPLOADED: uploaded,
            FILES_REMOVED: removed,
        }
