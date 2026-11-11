import { generateStacFromNormalized, slugify } from './normalizedProject.ts'
import { GEOJSON_MEDIA_TYPE } from '../util/catalogueFileFormats.ts'


import type { NormalizedBbox, NormalizedLayer, NormalizedProject } from './normalizedProject.ts'
import type { OgcCollection } from '../model/ogcFeatures.ts'
import type { StacAsset, StacCatalog, StacCollection } from '../model/Stac.ts'

/**
 * Generates a STAC Catalog tree from an OGC API - Features `/collections`
 * document:
 *   the service        → top-level Catalog
 *   each collection    → Collection with `ogcapi:` fields and an items asset
 *
 * The service publishes a flat list, so the catalogue has no nested Catalogs,
 * and it declares no author intent — no default visibility, no display field —
 * so those shared fields are left off rather than invented.
 *
 * A collection's `items` link is the whole of what loading it needs: features
 * come back as GeoJSON from that one address, with no capabilities document or
 * schema request in between. The link is resolved to an absolute URL here, so
 * the Collection has an address that works wherever it is read back.
 *
 * Pure function — no side effects, no I/O. The caller fetches the collections
 * document and passes the result in.
 */
export interface OgcFeaturesStacCatalogueOptions {
  /** Collection ids to emit, in the order given. Omit to emit every one. */
  collectionIds?: string[]
  /** Service title, used when the collections document declares none. */
  title?: string
}

/** Where a Collection's features are fetched from. */
export interface OgcFeaturesCollectionSource {
  kind: 'features'
  itemsUrl: string
  collectionId: string
}

/** Where a Collection's pre-rendered images are fetched from. */
export interface OgcTilesCollectionSource {
  kind: 'tiles'
  /** URL template with `{z}`, `{x}` and `{y}`. */
  tilesUrl: string
  collectionId: string
}

export type OgcCollectionSource = OgcFeaturesCollectionSource | OgcTilesCollectionSource

export function generateStacCatalogueFromOgcCollections(
  collectionsUrl: string,
  collections: OgcCollection[],
  options: OgcFeaturesStacCatalogueOptions = {}
): StacCatalog {
  return generateStacFromNormalized(
    ogcCollectionsToNormalized(collectionsUrl, collections, options)
  )
}

/**
 * Where a generated Collection's data comes from — its items endpoint, or its
 * tile template — and null for one that declares neither.
 *
 * Features come first. A collection publishing both is read as features, which
 * is the one of the two that can be selected, filtered and inspected.
 */
export function resolveOgcCollectionSource(collection: StacCollection): OgcCollectionSource | null {
  const collectionId = collection['ogcapi:collection_id']
  if (typeof collectionId !== 'string') return null

  const itemsUrl = collection['ogcapi:items_url']
  if (typeof itemsUrl === 'string') return { kind: 'features', itemsUrl, collectionId }

  const tilesUrl = collection['ogcapi:tiles_url']
  if (typeof tilesUrl === 'string') return { kind: 'tiles', tilesUrl, collectionId }

  return null
}

function ogcCollectionsToNormalized(
  collectionsUrl: string,
  collections: OgcCollection[],
  options: OgcFeaturesStacCatalogueOptions
): NormalizedProject {
  const selected = selectCollections(collections, options.collectionIds)
  const title = options.title?.trim() || ''

  return {
    id: slugify(title || 'ogc-api-features') || 'ogc-api-features',
    title,
    description: title
      ? `STAC catalogue generated from the OGC API - Features service "${title}".`
      : 'STAC catalogue generated from an OGC API - Features collections document.',
    bbox: unionBbox(selected),
    vendorFields: { 'ogcapi:collections_url': collectionsUrl },
    nodes: selected.map((collection) => ogcCollectionToNormalized(collectionsUrl, collection))
  }
}

/** Resolves the requested ids against the published list, preserving the caller's order. */
function selectCollections(
  collections: OgcCollection[],
  collectionIds: string[] | undefined
): OgcCollection[] {
  if (!collectionIds) return collections

  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  return collectionIds
    .map((id) => byId.get(id))
    .filter((collection): collection is OgcCollection => Boolean(collection))
}

function ogcCollectionToNormalized(
  collectionsUrl: string,
  collection: OgcCollection
): NormalizedLayer {
  const title = collection.title || collection.id
  const itemsUrl = readItemsUrl(collection, collectionsUrl)

  const tilesUrl = readTilesTemplate(collection, collectionsUrl)

  const vendorFields: Record<string, unknown> = {
    'ogcapi:collections_url': collectionsUrl,
    'ogcapi:collection_id': collection.id
  }
  if (itemsUrl) vendorFields['ogcapi:items_url'] = itemsUrl
  if (tilesUrl) vendorFields['ogcapi:tiles_url'] = tilesUrl
  if (collection.itemType) vendorFields['ogcapi:item_type'] = collection.itemType

  return {
    kind: 'layer',
    // The collection id is the service's own handle for the layer, and the half
    // of the layer's identity that the connection's endpoint completes.
    id: collection.id,
    title,
    description: collection.description?.trim()
      || `Layer "${title}" from a map server.`,
    bbox: readBbox(collection),
    temporalInterval: readTemporalInterval(collection),
    // The collections document declares no geometry type; it is read off the
    // features once they load.
    geometryType: null,
    tableColumns: [],
    assets: buildAssets(itemsUrl, tilesUrl, title),
    ...(collection.keywords ? { keywords: readKeywords(collection) } : {}),
    displayField: null,
    visibilityChecked: null,
    editable: null,
    vendorFields
  }
}

function buildAssets(
  itemsUrl: string | null,
  tilesUrl: string | null,
  title: string
): Record<string, StacAsset> {
  const assets: Record<string, StacAsset> = {}
  if (itemsUrl) {
    assets.data = {
      href: itemsUrl,
      type: GEOJSON_MEDIA_TYPE,
      title: `OGC API - Features items: ${title}`,
      roles: ['data']
    }
  }
  if (tilesUrl) {
    // Under its own key rather than `data`: the template is not a file that can
    // be fetched, and every reader of a `data` asset here expects one it can.
    assets.tiles = {
      href: tilesUrl,
      title: `Tiles: ${title}`,
      roles: ['overview']
    }
  }
  return assets
}

/**
 * The collection's tile template, absolute, or null where it publishes none
 * this package reads.
 *
 * Only a `{z}`/`{x}`/`{y}` template counts. A `tiles` link is also how a
 * service points at an OGC API - Tiles tileset document, which describes its
 * tiles rather than addressing them; that is a document to be fetched and read,
 * not a template to substitute into, so it is left alone here.
 */
function readTilesTemplate(collection: OgcCollection, collectionsUrl: string): string | null {
  const candidates = (collection.links ?? [])
    .filter((link) => link.rel === 'tiles' || link.rel === 'item')
    .map((link) => link.href)
  for (const href of candidates) {
    if (typeof href !== 'string') continue
    if (!href.includes('{z}') || !href.includes('{x}') || !href.includes('{y}')) continue
    try {
      // `new URL` percent-encodes the braces, which the tile source would then
      // request literally, so the template is resolved and put back.
      return decodeTileBraces(new URL(href, collectionsUrl).toString())
    } catch {
      // The next candidate, not the end of the scan: a collection may publish
      // more than one tiles link, and one that will not resolve says nothing
      // about the rest.
      continue
    }
  }
  return null
}

function decodeTileBraces(url: string): string {
  return url.replace(/%7B/g, '{').replace(/%7D/g, '}')
}

function readItemsUrl(collection: OgcCollection, collectionsUrl: string): string | null {
  const link = collection.links?.find((entry) => entry.rel === 'items' && typeof entry.href === 'string')
  if (!link) return null
  try {
    return new URL(link.href, collectionsUrl).toString()
  } catch {
    return null
  }
}

function readKeywords(collection: OgcCollection): string[] {
  const keywords = collection.keywords
  if (!Array.isArray(keywords)) return []
  return keywords.filter((keyword): keyword is string => typeof keyword === 'string')
}

/** The collection's overall period, the first of `extent.temporal.interval`, or null where it declares none. */
function readTemporalInterval(collection: OgcCollection): [string | null, string | null] | null {
  const interval = collection.extent?.temporal?.interval?.[0]
  if (!Array.isArray(interval)) return null
  const [start, end] = interval
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  return text(start) || text(end) ? [text(start), text(end)] : null
}

/**
 * The collection's overall extent. `extent.spatial.bbox` lists the overall box
 * first and any disjoint parts after it, in CRS84 — longitude/latitude — unless
 * the collection declares another CRS, in which case nothing here can read it and
 * the box is left off. A six-number box has elevation in the middle pair.
 */
function readBbox(collection: OgcCollection): NormalizedBbox | null {
  const spatial = collection.extent?.spatial
  const box = spatial?.bbox?.[0]
  if (!Array.isArray(box)) return null
  if (spatial?.crs && !isCrs84(spatial.crs)) return null

  const values = box.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 4) {
    return { xmin: values[0], ymin: values[1], xmax: values[2], ymax: values[3] }
  }
  if (values.length === 6) {
    return { xmin: values[0], ymin: values[1], xmax: values[3], ymax: values[4] }
  }
  return null
}

function isCrs84(crs: string): boolean {
  return crs.includes('CRS84') || crs.includes('EPSG:4326') || crs.endsWith('/4326')
}

function unionBbox(collections: OgcCollection[]): NormalizedBbox | null {
  let union: NormalizedBbox | null = null

  for (const collection of collections) {
    const box = readBbox(collection)
    if (!box) continue
    union = union
      ? {
        xmin: Math.min(union.xmin, box.xmin),
        ymin: Math.min(union.ymin, box.ymin),
        xmax: Math.max(union.xmax, box.xmax),
        ymax: Math.max(union.ymax, box.ymax)
      }
      : box
  }

  return union
}
