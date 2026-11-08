"""Mirrors `packages/quac/src/parse/readProjectFile.ts`."""

from __future__ import annotations

import io
import zipfile


def read_project_xml(file_name: str, body: bytes) -> str:
    """
    Returns a QGIS project file's XML, ready for `parse_qgs_xml`.

    A `.qgz` is a zip holding the `.qgs`; its other entries, such as the `.qgd`
    auxiliary data, are not read. A project QGIS keeps in a database is stored
    as the same zip, so it is read by giving a name ending in `.qgz`.
    """
    if not file_name.lower().endswith('.qgz'):
        return body.decode('utf-8-sig', errors='replace')
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile as error:
        raise ValueError('The .qgz file is not a valid zip file.') from error
    with archive:
        for entry in archive.infolist():
            if entry.filename.lower().endswith('.qgs'):
                return archive.read(entry).decode('utf-8-sig', errors='replace')
    raise ValueError('The .qgz file holds no .qgs project.')
