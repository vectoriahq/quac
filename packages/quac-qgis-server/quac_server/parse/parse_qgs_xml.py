"""Mirrors `packages/quac/src/parse/parseQgsXml.ts`, as far as the plugin's first-release fields read a project."""

from __future__ import annotations

import dataclasses
from typing import Optional
from xml.etree import ElementTree
from xml.etree.ElementTree import Element

from ..js_compat import js_trim
from ..model.qgs_project import ProjectMetadata, QgsProject
from .collect_layer_visibility import collect_layer_visibility
from .parse_layers import parse_project_layers
from .parse_legend_tree import parse_legend_tree
from .parse_qfield_sync import parse_wfs_transaction_layers
from .parse_wms_publishing import parse_wms_crs_list, parse_wms_publishing
from .xml_text import direct_child, direct_child_text, first_descendant, text_content


def parse_qgs_xml(xml_text: str) -> QgsProject:
    """
    Reads a `.qgs` file's text. Raises ValueError where the XML cannot be read
    or has no `<qgis>` root.

    The text is a project the server's administrator published, and Python's
    XML reader resolves no external entity.
    """
    try:
        qgis_root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as error:
        raise ValueError(f'Failed to parse QGS XML: {error}') from error
    if qgis_root.tag != 'qgis':
        raise ValueError(f'Expected <qgis> root element, got <{qgis_root.tag}>')

    layer_tree = parse_legend_tree(qgis_root)
    # Visibility flows from the layer tree, where the checked state is stored, not from the maplayer itself.
    visibility_by_layer_id = collect_layer_visibility(layer_tree)
    layers = [dataclasses.replace(layer, is_visible=visibility_by_layer_id.get(layer.id, True)) for layer in parse_project_layers(qgis_root)]

    return QgsProject(
        qgis_version=qgis_root.get('version') or None,
        title=direct_child_text(qgis_root, 'title') or '',
        project_crs=_read_project_crs(qgis_root),
        layers=layers,
        layer_tree=layer_tree,
        metadata=_parse_project_metadata(qgis_root),
        wfs_transaction_layers=parse_wfs_transaction_layers(qgis_root),
        wms_publishing=parse_wms_publishing(qgis_root),
        wms_crs_list=parse_wms_crs_list(qgis_root),
    )


def _read_project_crs(qgis_root: Element) -> Optional[str]:
    """`<qgis><projectCrs><spatialrefsys><authid>`, each found anywhere inside the one before, as `querySelector('projectCrs spatialrefsys authid')` finds it."""
    for project_crs in qgis_root.iter('projectCrs'):
        for spatialrefsys in project_crs.iter('spatialrefsys'):
            if spatialrefsys is project_crs:
                continue
            authid = first_descendant(spatialrefsys, 'authid')
            if authid is not None:
                return js_trim(text_content(authid)) or None
    return None


def _parse_project_metadata(qgis_root: Element) -> ProjectMetadata:
    """`<qgis><projectMetadata><abstract>`, None where blank or absent."""
    block = direct_child(qgis_root, 'projectMetadata')
    abstract = direct_child_text(block, 'abstract') if block is not None else None
    return ProjectMetadata(abstract=abstract or None)
