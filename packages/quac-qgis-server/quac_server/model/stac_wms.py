"""Mirrors `packages/quac/src/model/stacWms.ts`, as far as the server route needs."""

from __future__ import annotations

# The CRS a QGIS Server layer is requested in: the map's own when the server offers it.
PREFERRED_WMS_CRS = 'EPSG:3857'

WEB_MAP_LINKS_EXTENSION = 'https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json'

# The parameters of a WMS request, which an endpoint's address does not keep.
WMS_REQUEST_PARAMETERS = {'SERVICE', 'REQUEST', 'VERSION', 'LAYERS', 'STYLES', 'FORMAT', 'TRANSPARENT', 'CRS', 'SRS', 'BBOX', 'WIDTH', 'HEIGHT'}


def choose_wms_crs(crs_list: list[str]) -> str:
    """The CRS a WMS link asks for from the CRSs its server offers: `PREFERRED_WMS_CRS` where it is offered or none is listed, else the first."""
    return PREFERRED_WMS_CRS if not crs_list or PREFERRED_WMS_CRS in crs_list else crs_list[0]
