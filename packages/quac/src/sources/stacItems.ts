import { STAC_VERSION } from '../model/Stac'

import type { StacCollection, StacItem, StacLink } from '../model/Stac'

/**
 * Reading the Items inside a STAC API's Collection.
 *
 * A static catalogue puts its data on the Collection — one downloadable asset,
 * which `classifyStacCollectionFormat` reads and the rest of the app loads. A
 * STAC API does not: its Collections have no such asset, and every file sits on
 * an Item inside, reached through the Collection's `rel: "items"` link. Without
 * this module every Collection a STAC API lists classifies as unsupported.
 *
 * The one deliberate shape here is `itemAsCollection`: rather than teach the
 * four load paths about a second kind of thing, an Item is rewritten as a
 * Collection with the same assets. `classifyStacCollectionFormat`,
 * `readCogDisplaySource`, `readPmtilesDisplaySource` and
 * `loadStacCollectionData` then all work on an Item with no change of their
 * own, and an item-backed layer is the same kind of layer as a collection-backed
 * one everywhere downstream.
 */

/** How many Items one page of the list asks for. */
export const ITEMS_PAGE_SIZE = 20

/**
 * Separates the two halves of an item row's id. An Item is identified by the
 * Collection holding it as well as by its own id, and both are needed to fetch
 * it again — so the pair is passed as one string through the picker's selection
 * set, the workspace connection's `collectionIds`, and a share link.
 *
 * Shaped like the path `buildItemUrl` builds from the Collection's items href
 * (`<items href>/<item id>`), so the recorded value reads as what it addresses.
 * Whether every STAC API serves an Item at that address was not established
 * here. Split on the last occurrence, not the first: a Collection id may itself
 * contain a slash.
 */
const ITEM_ID_SEPARATOR = '/items/'

/** The row id recording which Item inside which Collection. */
export function encodeItemRowId(collectionId: string, itemId: string): string {
  return `${collectionId}${ITEM_ID_SEPARATOR}${itemId}`
}

/** The Collection and Item ids back out of a row id, or null if it is not one. */
export function decodeItemRowId(rowId: string): { collectionId: string; itemId: string } | null {
  const index = rowId.lastIndexOf(ITEM_ID_SEPARATOR)
  if (index <= 0) return null
  const collectionId = rowId.slice(0, index)
  const itemId = rowId.slice(index + ITEM_ID_SEPARATOR.length)
  if (!collectionId || !itemId) return null
  return { collectionId, itemId }
}

/**
 * The link with a relation, preferring one that answers JSON.
 *
 * A document may list the same relation more than once in different renditions —
 * an HTML page beside the JSON. Taking the first match blindly can hand an HTML
 * address to a JSON parser, so a link declaring a JSON media type wins, and a
 * link declaring no type is taken over one declaring something else.
 */
function findLink(links: StacLink[] | undefined, rel: string): StacLink | null {
  const candidates = (links ?? []).filter((link) => link.rel === rel && link.href)
  return candidates.find((link) => link.type?.includes('json'))
    ?? candidates.find((link) => !link.type)
    ?? candidates[0]
    ?? null
}

/** The Collection's `rel: "items"` link href, or null when it has none. */
export function readItemsHref(collection: StacCollection): string | null {
  return findLink(collection.links, 'items')?.href ?? null
}

/** One page of Items, and where the next page is if the service returned one. */
export interface StacItemsPage {
  items: StacItem[]
  /** The `rel: "next"` href, or null at the end of the list. */
  nextHref: string | null
}

/**
 * Adds the paging and ordering parameters to a Collection's items href.
 *
 * `sortby=-datetime` and `limit` are the parameters a STAC API is expected to
 * accept for ordering and page size. Which specification defines each, and what
 * a service implementing neither does with them, were not established here — no
 * STAC API and no specification document was reachable from the environment this
 * was written in — so nothing downstream relies on either being honoured:
 * `sortItemsNewestFirst` re-sorts whatever page comes back.
 *
 * An href that already has either parameter is left with what it declares.
 */
export function buildItemsPageUrl(itemsHref: string, pageSize = ITEMS_PAGE_SIZE): string {
  try {
    const url = new URL(itemsHref)
    if (!url.searchParams.has('limit')) url.searchParams.set('limit', String(pageSize))
    if (!url.searchParams.has('sortby')) url.searchParams.set('sortby', '-datetime')
    return url.toString()
  } catch {
    // A relative or malformed href is left exactly as it stands: the caller
    // resolved it against its document already, and guessing here would only
    // turn a fetchable address into an unfetchable one.
    return itemsHref
  }
}

/**
 * The instant an Item is filed under, as an epoch milliseconds number, or null
 * when it declares none.
 *
 * `properties.datetime` is the usual field; an Item with `start_datetime`
 * instead is placed by that. Whichever is present is taken rather than assuming
 * `datetime`.
 */
export function readItemTimestamp(item: StacItem): number | null {
  const raw = item.properties?.datetime ?? item.properties?.start_datetime
  if (typeof raw !== 'string') return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Orders Items newest first, leaving those with no date at the end in the order
 * the service listed them.
 *
 * This runs over the page the service returned, and is what makes the list read
 * newest-first against a service that ignored `sortby`. It cannot make the page
 * itself the newest Items in the Collection — only the service can choose which
 * Items a page holds — so against such a service the ordering is within the page
 * rather than across the whole list.
 */
export function sortItemsNewestFirst(items: StacItem[]): StacItem[] {
  return [...items]
    .map((item, index) => ({ item, index, at: readItemTimestamp(item) }))
    .sort((left, right) => {
      if (left.at === right.at) return left.index - right.index
      if (left.at === null) return 1
      if (right.at === null) return -1
      return right.at - left.at
    })
    .map((entry) => entry.item)
}

/**
 * Type-checks one fetched page of Items and resolves each Item's hrefs against
 * the address it is served at. `url` is the address the page was fetched from.
 * Throws when the response is not a GeoJSON FeatureCollection.
 */
export function readItemsPage(json: unknown, url: string): StacItemsPage {
  const page = json as { type?: string; features?: unknown; links?: StacLink[] } | null
  if (!Array.isArray(page?.features)) {
    throw new Error('Item list did not return a GeoJSON FeatureCollection')
  }

  const items = (page.features as StacItem[])
    .filter((feature) => feature?.type === 'Feature' && Boolean(feature.id))
    .map((feature) => resolveItemHrefs(feature, itemBaseUrl(feature, buildItemUrl(url, String(feature.id)))))
  // Resolved against the page it came from: a `next` href may come back
  // relative, and by the time it is followed this URL is gone.
  const nextLink = findLink(page.links, 'next')
  let nextHref: string | null = null
  if (nextLink?.href) {
    try {
      nextHref = new URL(nextLink.href, url).toString()
    } catch {
      nextHref = null
    }
  }

  return { items: sortItemsNewestFirst(items), nextHref }
}

/**
 * The address of one Item under a Collection's items href.
 *
 * Both ways into an Item build their base through here, so the item list and the
 * item document agree on where an Item's relative assets are even when the Item
 * has no `self` link to settle it.
 *
 * The items href's own query string is kept. It is the service's, not this
 * module's — an items link with an API key or a format selector needs it on
 * the item request too, and dropping it turns a browsable Collection into one
 * that fails on reopening.
 */
export function buildItemUrl(itemsHref: string, itemId: string): string {
  const [path, query] = itemsHref.split('?')
  const base = `${path!.replace(/\/$/, '')}/${encodeURIComponent(itemId)}`
  return query ? `${base}?${query}` : base
}

/**
 * Type-checks one fetched Item and resolves its hrefs. `url` is the address it
 * was fetched from, as `buildItemUrl` builds it. Throws when the response is
 * not a STAC Item.
 */
export function readItem(json: unknown, url: string): StacItem {
  const item = json as StacItem | null
  if (item?.type !== 'Feature' || !item.id) {
    throw new Error(`Response is not a STAC Item (type=${(item as { type?: unknown } | null)?.type})`)
  }
  return resolveItemHrefs(item, itemBaseUrl(item, url))
}

/**
 * The address an Item's relative hrefs resolve against: its own `rel: "self"`
 * link, falling back to `itemAddress` — which both callers build through
 * `buildItemUrl`, so the fallback resolves to the same place either way.
 *
 * The same Item is read through the item list when it is picked and through its
 * own document when the map is rebuilt. Resolving `./scene.tif` against whichever
 * URL happened to fetch it would give two different addresses for one file, and
 * at most one of them exists — so the layer would load when added and fail on
 * reopening.
 */
function itemBaseUrl(item: StacItem, itemAddress: string): string {
  const self = findLink(item.links, 'self')?.href
  if (!self) return itemAddress
  try {
    return new URL(self, itemAddress).toString()
  } catch {
    return itemAddress
  }
}

/**
 * Rewrites an Item's asset and link hrefs to absolute addresses against the URL
 * the Item came from, the same way `resolveDocumentHrefs` does for a Catalog or
 * Collection in `stacDocuments.ts`.
 *
 * An Item's asset href may be relative to the item document — `./scene.tif`
 * beside it. By the time a loader reads that href the document it was relative
 * to is gone, so without this the app resolves it against its own address and
 * fetches nothing. An href already absolute passes through
 * unchanged, and one that cannot be resolved is left as it stands.
 */
function resolveItemHrefs(item: StacItem, url: string): StacItem {
  const absolute = (href: string): string => {
    if (!href || href.startsWith('#')) return href
    try {
      return new URL(href, url).toString()
    } catch {
      return href
    }
  }

  return {
    ...item,
    ...(item.assets
      ? {
        assets: Object.fromEntries(
          Object.entries(item.assets).map(([key, asset]) => [key, { ...asset, href: absolute(asset.href) }])
        )
      }
      : {}),
    ...(item.links ? { links: item.links.map((link) => ({ ...link, href: absolute(link.href) })) } : {})
  }
}

/**
 * Rewrites an Item as a Collection with the same assets, so every existing
 * load path reads it without knowing it came from an Item.
 *
 * The parent Collection supplies the licence, which an Item does not have. The
 * Item's own `bbox` becomes the spatial extent; an Item without one falls back to
 * the parent's, because an absent bbox says nothing about where the data is
 * rather than saying it is nowhere. Its dates are its own — see the extent below.
 *
 * The id is the encoded pair, not the Item's own id: it is what the workspace
 * connection records, and the Item's id alone would not say which Collection to
 * look in when the map is rebuilt.
 */
export function itemAsCollection(item: StacItem, parent: StacCollection): StacCollection {
  const bbox = Array.isArray(item.bbox) && item.bbox.length >= 4
    ? [item.bbox]
    : parent.extent?.spatial?.bbox ?? [[-180, -90, 180, 90]]

  // The item's own dates only. An item declaring none gets STAC's open interval
  // rather than the parent's extent: the Collection's range is not this item's
  // date, and borrowing it would put a date on screen that nothing declared.
  const at = item.properties?.datetime ?? item.properties?.start_datetime ?? null
  const end = item.properties?.end_datetime ?? item.properties?.datetime ?? null
  const interval = [[at, end]]

  return {
    type: 'Collection',
    stac_version: STAC_VERSION,
    id: encodeItemRowId(parent.id, item.id),
    title: describeItem(item),
    description: typeof item.properties?.description === 'string'
      ? item.properties.description
      : `Item ${item.id} from ${parent.title ?? parent.id}.`,
    license: parent.license ?? 'other',
    ...(parent.providers ? { providers: parent.providers } : {}),
    extent: { spatial: { bbox }, temporal: { interval } },
    ...(item.assets ? { assets: item.assets } : {}),
    links: item.links ?? []
  }
}

/** What an Item is called on screen — its own title, else its id. */
export function describeItem(item: StacItem): string {
  const title = item.properties?.title
  return typeof title === 'string' && title.trim() ? title.trim() : item.id
}
