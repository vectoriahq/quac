import type { StacCollection, StacLink } from './Stac.ts'

/**
 * The placeholders a web-map-links v1.3.0 `rel: "xyz"` link's template must
 * hold. A template addressing tiles by Bing's `{quadkey}` has none of them, so
 * it cannot be written as such a link.
 */
const XYZ_PLACEHOLDERS = ['{z}', '{x}', '{y}']

function holdsXyzPlaceholders(href: string): boolean {
  return XYZ_PLACEHOLDERS.every((placeholder) => href.includes(placeholder))
}

/**
 * The media type of a Mapbox Vector Tile, which a `rel: "xyz"` link's `type`
 * names when its tiles hold vector features rather than images.
 */
export const VECTOR_TILE_MEDIA_TYPE = 'application/vnd.mapbox-vector-tile'

/**
 * The `rel: "xyz"` link for a tile template, or null for one it cannot express.
 * A link to vector tiles states `VECTOR_TILE_MEDIA_TYPE` as its `type`.
 */
export function buildXyzLink(template: string, tiles: 'image' | 'vector' = 'image'): StacLink | null {
  if (!holdsXyzPlaceholders(template)) return null
  return tiles === 'vector' ? { rel: 'xyz', href: template, type: VECTOR_TILE_MEDIA_TYPE } : { rel: 'xyz', href: template }
}

/** A Collection's tile template, and whether its tiles hold vector features. */
export interface XyzTemplate {
  template: string
  vector: boolean
}

/**
 * A Collection's first `rel: "xyz"` link that holds `{z}`, `{x}` and `{y}`, or
 * null when it has none. A template naming its server as `{s}` takes the first
 * of the link's `href:servers`, and is skipped when the link lists none.
 */
export function readCollectionXyzLink(collection: StacCollection): XyzTemplate | null {
  for (const link of collection.links ?? []) {
    if (link.rel !== 'xyz' || typeof link.href !== 'string' || !holdsXyzPlaceholders(link.href)) continue
    const vector = link.type === VECTOR_TILE_MEDIA_TYPE
    if (!link.href.includes('{s}')) return { template: link.href, vector }
    const servers = link['href:servers']
    const server = Array.isArray(servers) ? servers[0] : undefined
    if (typeof server === 'string' && server) return { template: link.href.replaceAll('{s}', server), vector }
  }
  return null
}

/** The template of `readCollectionXyzLink`, or null when there is none. */
export function readCollectionXyzTemplate(collection: StacCollection): string | null {
  return readCollectionXyzLink(collection)?.template ?? null
}
