"""Mirrors `packages/quac/src/model/stacXyz.ts`, as far as the plugin writes an XYZ link. The readers of a link, for an application, are not ported."""

from __future__ import annotations

from typing import Any, Optional

# The placeholders a web-map-links v1.3.0 `rel: "xyz"` link's template must hold. A template addressing tiles by Bing's `{quadkey}` has none of them.
_XYZ_PLACEHOLDERS = ('{z}', '{x}', '{y}')

# The media type of a Mapbox Vector Tile, which a `rel: "xyz"` link's `type` names when its tiles hold vector features rather than images.
VECTOR_TILE_MEDIA_TYPE = 'application/vnd.mapbox-vector-tile'


def _holds_xyz_placeholders(href: str) -> bool:
    """Whether a tile template holds `{z}`, `{x}` and `{y}`."""
    return all(placeholder in href for placeholder in _XYZ_PLACEHOLDERS)


def build_xyz_link(template: str, tiles: str = 'image') -> Optional[dict[str, Any]]:
    """The `rel: "xyz"` link for a tile template, or None for one it cannot express. A link to vector tiles states `VECTOR_TILE_MEDIA_TYPE` as its `type`."""
    if not _holds_xyz_placeholders(template):
        return None
    return {'rel': 'xyz', 'href': template, 'type': VECTOR_TILE_MEDIA_TYPE} if tiles == 'vector' else {'rel': 'xyz', 'href': template}
