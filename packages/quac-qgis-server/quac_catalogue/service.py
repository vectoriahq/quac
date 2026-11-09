"""The QUAC service QGIS Server calls: `SERVICE=QUAC&REQUEST=GetCatalogue&MAP=<project>`."""

from __future__ import annotations

from typing import Any

from qgis.core import Qgis, QgsMessageLog
from qgis.PyQt.QtCore import QByteArray, Qt
from qgis.server import QgsServerProjectUtils, QgsServerSettings, QgsService

from .access import apply_access
from .catalogue import Answer, CatalogueCache, answer, version_warning
from .qgis_inputs import access_answers, field_types, layer_extents, stored_project
from .quac_server import generate_server_stac_catalogue, parse_qgs_xml, read_project_xml, server_layer_tree

LOG_TAG = 'QUAC'

# Qt 5 names the format on `Qt`, as QGIS 3 uses it; Qt 6 only on `Qt.DateFormat`.
_ISO_DATE_WITH_MS = getattr(Qt, 'ISODateWithMs', None) or Qt.DateFormat.ISODateWithMs


def _level(name: str) -> Any:
    levels = getattr(Qgis, 'MessageLevel', Qgis)
    return getattr(levels, name)


class CatalogueService(QgsService):
    def __init__(self, server_iface: Any) -> None:
        super().__init__()
        self._server_iface = server_iface
        self._cache = CatalogueCache()
        self._warned: set[Any] = set()
        # QGIS Server gives a Python plugin no access to its own settings, so they are read once, as it reads them.
        self._settings = QgsServerSettings()
        self._settings.load()

    def name(self) -> str:
        return 'QUAC'

    def version(self) -> str:
        return '0.1.0'

    def executeRequest(self, request: Any, response: Any, project: Any) -> None:  # noqa: N802 - the name QGIS Server calls
        if (request.parameter('REQUEST') or '').lower() != 'getcatalogue':
            return self._write(response, Answer(400, b'The QUAC service answers REQUEST=GetCatalogue.', 'text/plain; charset=utf-8', 'off'))
        if project is None:
            return self._write(response, Answer(400, b'Name the project with MAP.', 'text/plain; charset=utf-8', 'off'))
        try:
            server_address = QgsServerProjectUtils.wmsServiceUrl(project, request, self._settings)
            key = (project.fileName(), project.lastModified().toString(_ISO_DATE_WITH_MS), server_address, Qgis.version())
            shared = self._shared_copy_allowed()
        except Exception as error:  # noqa: BLE001 - fail closed on anything
            self._log_failure(project, f'{type(error).__name__}: {error}')
            return self._write(response, answer(None, False, _raise(error), self._cache))

        def build() -> dict[str, Any]:
            file_name, data = stored_project(project)
            parsed = parse_qgs_xml(read_project_xml(file_name, data))
            warning = version_warning(parsed.qgis_version, Qgis.version())
            if warning and key not in self._warned:
                QgsMessageLog.logMessage(f'{project.baseName()}: {warning}', LOG_TAG, _level('Warning'))
                self._warned.add(key)
            catalogue = generate_server_stac_catalogue(parsed, server_address, field_types(project), layer_extents(project))
            return apply_access(catalogue, access_answers(project, self._server_iface.accessControls(), _layer_ids_by_name(parsed), _columns_by_name(catalogue)))

        result = answer(key, shared, build, self._cache)
        if result.error:
            self._log_failure(project, result.error)
        self._write(response, result)

    def _shared_copy_allowed(self) -> bool:
        """True while no access-control plugin gives a cache key of its own (`QgsAccessControl.fillCacheKey`)."""
        access_controls = self._server_iface.accessControls()
        if access_controls is None:
            return True
        result = access_controls.fillCacheKey([])
        return bool(result[0] if isinstance(result, tuple) else result)

    def _log_failure(self, project: Any, error: str) -> None:
        hint = ''
        if 'server address' in error:
            hint = " Give the project an advertised WMS address in its QGIS Server settings, or name its database through a pg_service file, so that the address holds no password."
        QgsMessageLog.logMessage(f'The catalogue for {project.baseName()} could not be built: {error}.{hint}', LOG_TAG, _level('Critical'))

    @staticmethod
    def _write(response: Any, result: Answer) -> None:
        response.setStatusCode(result.status)
        response.setHeader('Content-Type', result.content_type)
        response.setHeader('X-QUAC-Cache', result.cache)
        response.write(QByteArray(result.body))


def _layer_ids_by_name(parsed: Any) -> dict[str, list[str]]:
    """Each served WMS name with the ids of the layers QGIS Server serves under it."""
    ids: dict[str, list[str]] = {}

    def walk(nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            if node['kind'] == 'group':
                walk(node['children'])
            elif node['wmsName']:
                ids.setdefault(node['wmsName'], []).append(node['id'])

    walk(server_layer_tree(parsed)['children'])
    return ids


def _columns_by_name(catalogue: dict[str, Any]) -> dict[str, list[str]]:
    """Each Collection's column names, with its display field, by its id, which are what QGIS is asked about."""
    columns: dict[str, list[str]] = {}

    def walk(node: dict[str, Any]) -> None:
        for collection in node.get('collections', []):
            names = columns.setdefault(collection['id'], [])
            names += [column['name'] for column in collection.get('table:columns', []) if column['name'] not in names]
            display = collection.get('quac:display_field')
            if isinstance(display, str) and display not in names:
                names.append(display)
        for child in node.get('catalogs', []):
            walk(child)

    walk(catalogue)
    return columns


def _raise(error: Exception):
    def build() -> dict[str, Any]:
        raise error
    return build


class QuacCatalogue:
    def __init__(self, server_iface: Any) -> None:
        self.service = CatalogueService(server_iface)
        server_iface.serviceRegistry().registerService(self.service)
