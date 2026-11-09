"""
Run inside the QGIS Server image: reads a project file with QGIS and writes it
into PostgreSQL project storage, as QGIS Desktop's Project → Save To →
PostgreSQL does. `python3 store_in_postgres.py <project file> <postgresql:// URI>`.
"""

from __future__ import annotations

import os
import sys

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')

from qgis.core import QgsApplication, QgsProject  # noqa: E402


def main(source: str, uri: str) -> int:
    application = QgsApplication([], False)
    application.initQgis()
    project = QgsProject()
    if not project.read(source):
        print(f'Could not read {source}: {project.error()}', flush=True)
        return 1
    print(f'Read {source}: {len(project.mapLayers())} layers.', flush=True)
    if not project.write(uri):
        print(f'Could not write to PostgreSQL: {project.error()}', flush=True)
        return 1
    print(f'Stored {source} in PostgreSQL project storage.', flush=True)
    return 0


if __name__ == '__main__':
    # Leave without QGIS's own shutdown, which can end a standalone script with a crash.
    code = main(sys.argv[1], sys.argv[2])
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
