"""
A QGIS Server plugin used only by the QGIS Server workflow's checks of the
reading route. It is not the QUAC endpoint.

`SERVICE=QUACSPIKE&REQUEST=GetLayerTree&MAP=<project>` answers, as JSON, the
server layer tree of the project QGIS Server has open for the request, read
from that project's stored text: the file for a `.qgs` or `.qgz`, and
`QgsProjectStorage.readProject` for a project held in a storage backend such
as PostgreSQL. It never writes or changes the project.

The job copies `quac_server` into this folder before the server starts.
`REPEAT=<n>` repeats the read and the build n times and reports the median of
each, in milliseconds.
"""

from __future__ import annotations

import json
import os
import platform
import pwd
import statistics
import time
import traceback

from qgis.core import Qgis, QgsReadWriteContext
from qgis.PyQt.QtCore import QBuffer, QIODevice
from qgis.server import QgsService

from .quac_server import read_server_layer_tree


def _read_write_mode():
    flags = getattr(QIODevice, 'OpenModeFlag', QIODevice)
    return flags.ReadWrite


def stored_project(project):
    """The project's stored bytes, with the name `read_project_xml` reads them by, and where they came from."""
    storage = project.projectStorage()
    if storage is not None:
        buffer = QBuffer()
        buffer.open(_read_write_mode())
        context = QgsReadWriteContext()
        if not storage.readProject(project.fileName(), buffer, context):
            messages = '; '.join(message.message() for message in context.takeMessages())
            raise RuntimeError(f'readProject returned false: {messages}')
        return f'storage:{storage.type()}', 'stored.qgz', bytes(buffer.data())
    path = project.fileName()
    with open(path, 'rb') as handle:
        return 'file', os.path.basename(path), handle.read()


class SpikeService(QgsService):
    def name(self):
        return 'QUACSPIKE'

    def version(self):
        return '0.0.0'

    def executeRequest(self, request, response, project):
        try:
            body = self._answer(request, project)
            status = 200
        except Exception as error:  # noqa: BLE001 - the job reads the error from the answer
            body = {'error': f'{type(error).__name__}: {error}', 'traceback': traceback.format_exc()}
            status = 500
        response.setStatusCode(status)
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.write(json.dumps(body, ensure_ascii=False))

    def _answer(self, request, project):
        if project is None:
            raise ValueError('No project: pass MAP.')
        repeat = max(1, int(request.parameter('REPEAT') or '1'))
        read_ms, build_ms = [], []
        for _ in range(repeat):
            started = time.perf_counter()
            source, file_name, data = stored_project(project)
            read = time.perf_counter()
            tree = read_server_layer_tree(file_name, data)
            built = time.perf_counter()
            read_ms.append((read - started) * 1000)
            build_ms.append((built - read) * 1000)
        return {
            'source': source,
            'fileName': file_name if source == 'file' else None,
            'bytes': len(data),
            'repeat': repeat,
            'readMs': statistics.median(read_ms),
            'buildMs': statistics.median(build_ms),
            'process': {'user': pwd.getpwuid(os.geteuid()).pw_name, 'uid': os.geteuid()},
            'qgisVersion': Qgis.version(),
            'pythonVersion': platform.python_version(),
            'validLayerIds': sorted(layer.id() for layer in project.mapLayers().values() if layer.isValid()),
            'tree': tree,
        }


class QuacSpikeHarness:
    def __init__(self, server_iface):
        self.service = SpikeService()
        server_iface.serviceRegistry().registerService(self.service)


def serverClassFactory(server_iface):  # noqa: N802 - the name QGIS Server calls
    return QuacSpikeHarness(server_iface)
