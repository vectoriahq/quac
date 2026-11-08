"""What the plugin reads from QGIS rather than from the project's text: the stored text itself, each field's type, and each layer's WGS84 box."""

from __future__ import annotations

import os
from typing import Any

from qgis.core import QgsMapLayer, QgsReadWriteContext, QgsVectorLayer
from qgis.PyQt.QtCore import QBuffer, QIODevice, QMetaType, QVariant

from .access import LayerAnswer
from .quac_server.model.qgs_project import BoundingBox


def _read_write_mode() -> Any:
    flags = getattr(QIODevice, 'OpenModeFlag', QIODevice)
    return flags.ReadWrite


def stored_project(project: Any) -> tuple[str, bytes]:
    """
    The project's stored bytes, with the name `read_project_xml` reads them by:
    the file for a `.qgs` or `.qgz`, and the zip `QgsProjectStorage.readProject`
    gives for a project held in a storage backend such as PostgreSQL. It never
    writes or changes the project.
    """
    storage = project.projectStorage()
    if storage is not None:
        buffer = QBuffer()
        buffer.open(_read_write_mode())
        context = QgsReadWriteContext()
        if not storage.readProject(project.fileName(), buffer, context):
            messages = '; '.join(message.message() for message in context.takeMessages())
            raise RuntimeError(f'The project storage could not read the project: {messages}')
        return 'stored.qgz', bytes(buffer.data())
    path = project.fileName()
    with open(path, 'rb') as handle:
        return os.path.basename(path), handle.read()


def qt_type_name(field: Any) -> str:
    """A field's Qt type name, as GetProjectSettings writes it (`QVariant::typeToName`), such as `qlonglong` or `QString`."""
    field_type = field.type()
    type_to_name = getattr(QVariant, 'typeToName', None)
    if type_to_name is not None:
        try:
            name = type_to_name(field_type)
            if name:
                return name.decode() if isinstance(name, bytes) else str(name)
        except TypeError:
            pass
    name = QMetaType(int(getattr(field_type, 'value', field_type))).name()
    return name.decode() if isinstance(name, bytes) else str(name)


def field_types(project: Any) -> dict[str, dict[str, dict[str, str]]]:
    """Each valid vector layer's fields' types, by layer id and field name, as the server route takes them."""
    types: dict[str, dict[str, dict[str, str]]] = {}
    for layer in project.mapLayers().values():
        if not layer.isValid() or layer.type() != _vector_layer_type():
            continue
        types[layer.id()] = {field.name(): {'type': qt_type_name(field), 'typeName': field.typeName()} for field in layer.fields()}
    return types


def layer_extents(project: Any) -> dict[str, BoundingBox]:
    """Each valid layer's WGS84 box as QGIS works it out, by layer id; the server route uses it only where the project saves none."""
    extents: dict[str, BoundingBox] = {}
    for layer in project.mapLayers().values():
        if not layer.isValid():
            continue
        box = layer.wgs84Extent()
        if box.isNull() or box.isEmpty():
            continue
        extents[layer.id()] = BoundingBox(box.xMinimum(), box.yMinimum(), box.xMaximum(), box.yMaximum())
    return extents


def _vector_layer_type() -> Any:
    layer_type = getattr(QgsMapLayer, 'LayerType', None)
    if layer_type is not None and hasattr(layer_type, 'VectorLayer'):
        return layer_type.VectorLayer
    return QgsMapLayer.VectorLayer


def access_answers(project: Any, access_controls: Any, layer_ids_by_name: dict[str, list[str]], columns_by_name: dict[str, list[str]]) -> dict[str, LayerAnswer]:
    """
    QGIS's combined access answers for the person on this request, for each
    served layer by its WMS name: read, insert, update and delete, and which of
    the catalogue's columns `QgsAccessControl.layerAttributes` lets through.
    Two layers served under one name are combined, each answer allowing only
    what both allow. With no access controls every answer allows everything,
    except for a layer the project cannot find, which is refused everything.
    """
    answers: dict[str, LayerAnswer] = {}
    for name, layer_ids in layer_ids_by_name.items():
        combined: LayerAnswer | None = None
        for layer_id in layer_ids:
            layer = project.mapLayer(layer_id)
            answer = _answer_for(layer, access_controls, columns_by_name.get(name, []))
            combined = answer if combined is None else combined.combine(answer)
        if combined is not None:
            answers[name] = combined
    return answers


def _answer_for(layer: Any, access_controls: Any, columns: list[str]) -> LayerAnswer:
    if layer is None:
        return LayerAnswer(read=False, insert=False, update=False, delete=False, fields=frozenset())
    if access_controls is None:
        return LayerAnswer()
    read = bool(access_controls.layerReadPermission(layer))
    # QGIS answers editing and fields for a vector layer only; an image layer is never editable, and has no fields.
    if not isinstance(layer, QgsVectorLayer):
        return LayerAnswer(read=read)
    fields = frozenset(access_controls.layerAttributes(layer, list(columns))) if columns else None
    return LayerAnswer(
        read=read,
        insert=bool(access_controls.layerInsertPermission(layer)),
        update=bool(access_controls.layerUpdatePermission(layer)),
        delete=bool(access_controls.layerDeletePermission(layer)),
        fields=fields,
    )
