"""Mirrors `packages/quac/src/model/stacWmts.ts`, as far as the plugin writes a WMTS link. The readers of a link, for an application, are not ported."""

from __future__ import annotations

from typing import Any, Optional

from ..js_compat import split_url, url_path, url_to_string, without_search_params
from .qgs_project import DataSource

_REQUEST_PARAMETERS = {'SERVICE', 'REQUEST', 'VERSION', 'LAYER', 'STYLE', 'FORMAT', 'TILEMATRIXSET', 'TILEMATRIX', 'TILEROW', 'TILECOL'}


def _is_capabilities_document(parts: dict[str, Any]) -> bool:
    """Whether an address is a capabilities document of its own, REST encoding, such as `…/1.0.0/WMTSCapabilities.xml`, rather than a KVP service address."""
    return url_path(parts['path']).lower().endswith('.xml')


def wmts_endpoint(href: str) -> Optional[str]:
    """
    A KVP service address less its WMTS request parameters and its fragment,
    keeping the parameters that route to a service. A capabilities document's
    address keeps its query. None for anything but an `http` or `https`
    address with no user name or password in it.
    """
    parts = split_url(href)
    if parts is None or parts['userinfo']:
        return None
    if not _is_capabilities_document(parts):
        parts = without_search_params(parts, lambda key: key.upper() in _REQUEST_PARAMETERS)
    return url_to_string({**parts, 'fragment': None})


def build_wmts_link(source: DataSource) -> Optional[dict[str, Any]]:
    """
    The web-map-links v1.3.0 link for a QGIS WMTS layer. `quac:wmts_tile_matrix_set`
    and `quac:wmts_style` keep the settings the extension does not define. A KVP
    link states the tile format as its `type`; a REST link's `type` is its
    capabilities document's, and the format comes from the document.
    """
    href = wmts_endpoint(source.url or '')
    if not href:
        return None
    parts = split_url(href)
    rest = parts is not None and _is_capabilities_document(parts)
    link: dict[str, Any] = {
        'rel': 'wmts',
        'href': href,
        'type': 'application/xml' if rest else source.format,
        'wmts:layer': source.layer,
        'wmts:encoding': 'rest' if rest else 'kvp',
    }
    if source.dimensions:
        link['wmts:dimensions'] = dict(source.dimensions)
    link['quac:wmts_tile_matrix_set'] = source.tile_matrix_set
    if source.style:
        link['quac:wmts_style'] = source.style
    return link
