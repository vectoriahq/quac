import { readDataAsset } from './stacAssetRoles'

import type { StacCollection } from './Stac'

/**
 * How a relative asset href is spelled, and how it is read back.
 *
 * An href is a URI reference, not a file path, so the characters URIs reserve
 * have to be escaped in it. `#` and `?` are the two that bite: both are legal
 * in a file name on every service Groundwork reads, and both end the path when
 * a reader takes an href apart. A folder holding `Building #3.geojson` written
 * unescaped publishes `./Building #3.geojson`, which reads back as `Building `
 * — a file no folder holds, so the layer is dropped.
 *
 * Every generator writes its relative hrefs through `encodeAssetPath`, and
 * every reader takes them back through `decodeAssetPath`, so the pair is here
 * rather than in any one of them.
 */

/**
 * Percent-encodes a relative path for use in an href, keeping `/` as the
 * separator between segments.
 */
export function encodeAssetPath(path: string): string {
  return stripLeadingDotSlash(path).split('/').map(encodeURIComponent).join('/')
}

/**
 * The path an href addresses: its leading `./` removed and its segments
 * decoded.
 *
 * A segment with a stray `%` is left as it stands rather than throwing —
 * that is an href somebody else wrote without escaping, and the file's own name
 * is the best reading available of it.
 */
export function decodeAssetPath(href: string): string {
  return stripLeadingDotSlash(href).split('/').map(decodeSegment).join('/')
}

/**
 * True for an href pointing to something inside the published folder, as opposed to
 * an absolute address, another server, or a bare fragment. Only a relative one
 * can be resolved against a folder listing.
 */
export function isRelativeHref(href: string): boolean {
  if (!href || href.startsWith('#')) return false
  // A scheme (`https:`, `file:`) or a protocol-relative address (`//host/…`).
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//')
}

/**
 * Reads a Collection's `data` asset back as a path inside the published folder
 * — the counterpart of the data asset both the QGIS project and the folder
 * generators write.
 *
 * Returns null for an asset that is not a relative path: a WFS GetFeature URL,
 * the empty href an unsupported source gets, or any absolute address. Those are
 * not files in the folder, so there is nothing here to look up.
 */
export function readCollectionDataPath(collection: StacCollection): string | null {
  const href = readDataAsset(collection)?.href
  if (!href || !isRelativeHref(href)) return null

  // Anything from the first `#` or `?` is a fragment or a query, never part of
  // the path — a file whose name holds either has it escaped.
  const path = decodeAssetPath(href.split('#')[0]!.split('?')[0]!)
  return path || null
}

/**
 * Reads a Collection's `data` asset as an online file: an absolute `http` or
 * `https` address, such as a QGIS layer reading a file through GDAL's
 * `/vsicurl/` prefix publishes. `name` is the address's last path segment.
 * Null for any other href, a relative path in the folder included.
 */
export function readCollectionOnlineFile(collection: StacCollection): { url: string, name: string } | null {
  const href = readDataAsset(collection)?.href
  if (!href || !/^https?:\/\//i.test(href)) return null
  let pathname: string
  try {
    pathname = new URL(href).pathname
  } catch {
    return null
  }
  const segment = pathname.split('/').pop() ?? ''
  return { url: href, name: decodeSegment(segment) || segment }
}

export function stripLeadingDotSlash(path: string): string {
  return path.replace(/^\.\//, '')
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
