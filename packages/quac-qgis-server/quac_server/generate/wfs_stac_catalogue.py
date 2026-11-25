"""Mirrors `packages/quac/src/generate/wfsStacCatalogue.ts`, as far as a QGIS project's WFS layer needs: its data asset.

The WFS producer, which builds a catalogue from a service's capabilities, is
another kind of source; `port-exemptions.json` lists it.
"""

from __future__ import annotations

from typing import Any

from ..js_compat import search_params_to_string
from ..util.catalogue_file_formats import GEOJSON_MEDIA_TYPE
from ..util.wfs_versions import WFS_CAPABILITIES_VERSION


def wfs_get_feature_asset(endpoint: str, type_name: str, title: str) -> dict[str, Any]:
    """A WFS layer's data asset: a GetFeature request for one feature type as GeoJSON, which an HTTP GET answers in full."""
    params = [('SERVICE', 'WFS'), ('VERSION', WFS_CAPABILITIES_VERSION), ('REQUEST', 'GetFeature'), ('TYPENAMES', type_name), ('OUTPUTFORMAT', 'application/json')]
    separator = '&' if '?' in endpoint else '?'
    return {
        'href': f'{endpoint}{separator}{search_params_to_string(params)}',
        'type': GEOJSON_MEDIA_TYPE,
        'title': f'WFS GetFeature: {title}',
        'roles': ['data'],
    }
