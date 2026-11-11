import { findAssetByRole } from './stacAssetRoles.ts'

import type { StacCollection } from './Stac.ts'

/**
 * A Collection's PMTiles rendering derivative — the vector tile archive a
 * Portolan catalogue publishes alongside its GeoParquet so a client can draw
 * the whole dataset without downloading it.
 *
 * Portolan registers it in two places, and both are read here
 * (the Portolan convention): a collection-level `rel: "pmtiles"`
 * link per the web-map-links extension v1.3.0, which is the normative
 * registration, and an asset with the `visual` role. The two coexist and
 * address the same file.
 */

/** PMTiles, per Portolan's media-type registry. */
export const PMTILES_MEDIA_TYPE = 'application/vnd.pmtiles'

/** The role marking an asset as a rendering derivative rather than the data. */
export const VISUAL_ROLE = 'visual'

export interface StacPmtilesSource {
  /** The archive's address — an absolute `http`/`https` URL. */
  href: string
  /**
   * Layer names inside the archive to draw, from the link's `pmtiles:layers`.
   * Empty where the source declares none — web-map-links leaves the choice to
   * the reader in that case, which may draw every layer the archive has.
   */
  layers: string[]
}

/**
 * The PMTiles archive a Collection has, or null when it has none this can
 * fetch.
 *
 * The link is read first because it is the registration Portolan requires; the
 * `visual` asset is the fallback for a catalogue that publishes only that half.
 * A registration whose href is not an address the tile reader can fetch is not
 * a registration: it is passed over, so a Collection with an unusable link and
 * a loadable data asset still loads from the data asset rather than resolving
 * to a PMTiles layer that can only draw nothing.
 */
export function readCollectionPmtiles(collection: StacCollection): StacPmtilesSource | null {
  const link = collection.links?.find(
    (candidate) => candidate.rel === 'pmtiles' && isFetchableArchiveHref(candidate.href)
  )
  if (link) {
    return { href: link.href, layers: readPmtilesLayers(link['pmtiles:layers']) }
  }

  const asset = findAssetByRole(collection, VISUAL_ROLE)
  if (asset && asset.type === PMTILES_MEDIA_TYPE && isFetchableArchiveHref(asset.href)) {
    return { href: asset.href, layers: [] }
  }
  return null
}

/**
 * True for an href the tile reader can fetch: an absolute `http` or `https`
 * address.
 *
 * Parsing alone is not the test. `new URL` accepts any well-formed absolute
 * address whatever its scheme, so `file:`, `javascript:` and a `pmtiles://`
 * prefix all parse — the last being the scheme the protomaps `pmtiles`
 * package's MapLibre protocol handler reads, whose `Protocol.tilev4` matches
 * `pmtiles://…` (read in `node_modules/pmtiles` at 4.5.0, the version
 * `ol-pmtiles` pins). web-map-links says this href is a "Link to a PMTiles
 * file (usually ends with `.pmtiles`)"
 * (https://github.com/stac-extensions/web-map-links § PMTiles, read
 * 2026-08-12), so none of those is an address to follow here.
 */
function isFetchableArchiveHref(href: string | undefined): boolean {
  if (!href) return false
  try {
    const { protocol } = new URL(href)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** The `pmtiles:layers` array, keeping only the strings a layer name can be. */
function readPmtilesLayers(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}
