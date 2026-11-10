import { findAssetByRole } from './stacAssetRoles.ts'

import type { StacCollection } from './Stac.ts'

/**
 * What a published catalogue says about a Collection for the person choosing
 * it: a ready-written credit (Attribution extension), whether it is outdated
 * (Version extension), and a preview image (the `thumbnail` asset role).
 */

export const THUMBNAIL_ROLE = 'thumbnail'

/** The address where it is an `http` or `https` one, else null. */
function webAddress(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    const { protocol } = new URL(href)
    return protocol === 'http:' || protocol === 'https:' ? href : null
  } catch {
    return null
  }
}

/** The Collection's `attribution`, trimmed, or null where it is absent, blank or not text. */
export function readCollectionAttribution(collection: StacCollection): string | null {
  const attribution = collection['attribution']
  return typeof attribution === 'string' && attribution.trim() ? attribution.trim() : null
}

/**
 * Where the Collection is marked `deprecated: true`, the address of its
 * `latest-version` link, or null where it has none. Undefined where the
 * Collection is not marked outdated.
 */
export function readCollectionDeprecation(collection: StacCollection): { latestVersionHref: string | null } | undefined {
  if (collection['deprecated'] !== true) return undefined
  const link = (collection.links ?? []).find((candidate) => candidate.rel === 'latest-version')
  return { latestVersionHref: webAddress(link?.href) }
}

/** The address of the Collection's `thumbnail` asset, where it is an `http` or `https` one. */
export function readCollectionThumbnail(collection: StacCollection): string | null {
  const asset = findAssetByRole(collection, THUMBNAIL_ROLE)
  return asset?.roles?.includes(THUMBNAIL_ROLE) ? webAddress(asset.href) : null
}

/** The address the Collection says it was published at: its `self` link, where that is a web address. */
export function readCollectionSelfHref(collection: StacCollection): string | null {
  return webAddress((collection.links ?? []).find((link) => link.rel === 'self')?.href)
}
