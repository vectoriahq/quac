"""Mirrors `packages/quac/src/model/stacWms.ts`, as far as the plugin writes a WMS link. The reader of a link, for an application, is not ported."""

from __future__ import annotations

from typing import Any, Optional

from ..js_compat import split_url, url_to_string, without_search_params
from .qgs_project import DataSource

# The CRS a QGIS Server layer is requested in: the map's own when the server offers it.
PREFERRED_WMS_CRS = 'EPSG:3857'

WEB_MAP_LINKS_EXTENSION = 'https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json'

# The parameters of a WMS request, which an endpoint's address does not keep.
WMS_REQUEST_PARAMETERS = {'SERVICE', 'REQUEST', 'VERSION', 'LAYERS', 'STYLES', 'FORMAT', 'TRANSPARENT', 'CRS', 'SRS', 'BBOX', 'WIDTH', 'HEIGHT'}


def choose_wms_crs(crs_list: list[str]) -> str:
    """The CRS a WMS link asks for from the CRSs its server offers: `PREFERRED_WMS_CRS` where it is offered or none is listed, else the first."""
    return PREFERRED_WMS_CRS if not crs_list or PREFERRED_WMS_CRS in crs_list else crs_list[0]


def wms_endpoint(href: str) -> Optional[str]:
    """
    The address less its WMS request parameters and its fragment, keeping the
    parameters that route to a service, such as `map`. None for anything but
    an `http` or `https` address with no user name or password in it.
    """
    parts = split_url(href)
    if parts is None or parts['userinfo']:
        return None
    parts = without_search_params(parts, lambda key: key.upper() in WMS_REQUEST_PARAMETERS)
    return url_to_string({**parts, 'fragment': None})


def build_wms_link(source: DataSource) -> Optional[dict[str, Any]]:
    """The web-map-links `rel: "wms"` link for a QGIS WMS layer, or None where its address is refused (`wms_endpoint`)."""
    href = wms_endpoint(source.url or '')
    if not href:
        return None
    link: dict[str, Any] = {
        'rel': 'wms',
        'href': href,
        'type': source.format,
        'wms:layers': [','.join(source.layers or [])],
        'wms:styles': [','.join(source.styles or [])],
        'wms:transparent': source.transparent,
        'wms:dimensions': dict(source.dimensions or {}),
        'quac:wms_crs': source.crs,
    }
    if source.version:
        link['quac:wms_version'] = source.version
    return link
