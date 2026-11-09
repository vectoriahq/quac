"""Mirrors `packages/quac/src/parse/parseWmsPublishing.ts`."""

from __future__ import annotations

import re
from typing import Optional
from xml.etree.ElementTree import Element

from ..model.qgs_project import WmsPublishing
from .project_properties import property_list, property_text
from .xml_text import direct_child


def parse_wms_publishing(qgis_root: Element) -> Optional[WmsPublishing]:
    """
    The project's WMS publishing, from Project Properties → QGIS Server → WMS
    capabilities: **Use layer ids as names**, saved as `WMSUseLayerIDs`, and the
    layers left out of WMS, saved by name as `WMSRestrictedLayers`. None where
    the project saves neither.
    """
    properties = direct_child(qgis_root, 'properties')
    if properties is None:
        return None
    use_layer_ids = property_text(properties, 'WMSUseLayerIDs')
    restricted_layers = property_list(properties, 'WMSRestrictedLayers')
    if use_layer_ids is None and len(restricted_layers) == 0:
        return None
    return WmsPublishing(use_layer_ids=use_layer_ids == 'true', restricted_layers=restricted_layers)


_EPSG_CODE = re.compile(r'^\s*[+-]?[0-9]+\s*$')


def parse_wms_crs_list(qgis_root: Element) -> list[str]:
    """
    The CRSs the project offers its WMS layers in, from Project Properties →
    QGIS Server → WMS capabilities → **CRS restrictions**: the `WMSCrsList` it
    saves, else the EPSG codes of the older `WMSEpsgList`, as
    `QgsServerProjectUtils::wmsOutputCrsList` reads them. Empty where the
    project restricts none.
    """
    properties = direct_child(qgis_root, 'properties')
    if properties is None:
        return []
    crs_list = [crs for crs in property_list(properties, 'WMSCrsList') if crs != '']
    if crs_list:
        return crs_list
    return [f'EPSG:{int(code)}' for code in property_list(properties, 'WMSEpsgList') if _EPSG_CODE.match(code)]
