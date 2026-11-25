"""Mirrors `packages/quac/src/generate/arcgisStacCatalogue.ts`, as far as a QGIS project's ArcGIS layer needs: its data asset.

The ArcGIS producer, which builds a catalogue from an ArcGIS item's layers, is
another kind of source; `port-exemptions.json` lists it.
"""

from __future__ import annotations

from typing import Any, Optional

from ..js_compat import search_params_to_string
from ..util.catalogue_file_formats import GEOJSON_MEDIA_TYPE


def arcgis_query_asset(layer_url: str, where: Optional[str], title: str, updated: Optional[str] = None) -> dict[str, Any]:
    """
    A FeatureServer layer's data asset: its query for every feature the filter
    keeps, as GeoJSON in WGS84. The JavaScript takes the layer's address and
    filter as one `source` object.
    """
    params = [('where', where if where is not None else '1=1'), ('outFields', '*'), ('outSR', '4326'), ('f', 'geojson')]
    asset: dict[str, Any] = {
        'href': f'{layer_url}/query?{search_params_to_string(params)}',
        'type': GEOJSON_MEDIA_TYPE,
        'title': f'ArcGIS feature service query: {title}',
        'roles': ['data'],
    }
    if updated:
        asset['updated'] = updated
    return asset
