import { listQuacExtension } from '../model/quacExtension.ts'
import { STAC_VERSION } from '../model/Stac.ts'
import { readDataAsset } from '../model/stacAssetRoles.ts'

import type { StacCatalog, StacCollection, StacExtent } from '../model/Stac.ts'

/**
 * Converts a STAC document fetched from somewhere else to the Groundwork
 * profile (`packages/quac/spec/README.md`), so the rest of the app reads one shape
 * whatever the source.
 *
 * Everything the source declared is kept — this fills gaps, it never
 * overwrites. Three gaps get filled:
 *
 *   - a root that is a single Collection is wrapped in a Catalog, so the
 *     result is always a Catalog of Collections
 *   - a Collection extent missing the required `temporal` gets the open
 *     interval `[[null, null]]`
 *   - a WFS-backed Collection with no `quac:wfs_*` fields gets them read out of its
 *     GetFeature asset href
 *
 * That last one is the fallback the profile allows: an external catalogue
 * cannot be expected to have our vendor fields, so its `data` asset href is
 * sniffed instead. Catalogues Groundwork generates have the fields, and the
 * sniff never runs on them.
 *
 * Children linked as separate documents (`rel: "child"`) are not followed
 * here — this function only sees what's already inlined. `StacEndpointAdapter`
 * is what walks those links and inlines the fetched documents before calling
 * this function.
 */
export function normalizeExternalStacCatalogue(root: StacCatalog | StacCollection): StacCatalog {
  return normalizeCatalog(root.type === 'Collection' ? wrapAsCatalog(root) : root)
}

function normalizeCatalog(catalog: StacCatalog): StacCatalog {
  const normalized: StacCatalog = {
    ...catalog,
    type: 'Catalog',
    stac_version: catalog.stac_version ?? STAC_VERSION,
    links: catalog.links ?? []
  }

  if (catalog.collections) {
    normalized.collections = catalog.collections.map(normalizeCollection)
  }
  if (catalog.catalogs) {
    normalized.catalogs = catalog.catalogs.map(normalizeCatalog)
  }

  return normalized
}

function normalizeCollection(collection: StacCollection): StacCollection {
  const normalized: StacCollection = {
    ...collection,
    type: 'Collection',
    stac_version: collection.stac_version ?? STAC_VERSION,
    // STAC core requires a license. An external Collection that omits one is
    // making no statement about reuse, which is what 'other' says.
    license: collection.license ?? 'other',
    extent: normalizeExtent(collection.extent),
    links: collection.links ?? []
  }

  const declaresWfsFields = readNonEmptyString(collection['quac:wfs_endpoint'])
    && readNonEmptyString(collection['quac:wfs_type_name'])
  if (!declaresWfsFields) {
    const sniffed = parseWfsGetFeatureUrl(readDataAsset(collection)?.href ?? '')
    if (sniffed) {
      normalized['quac:wfs_endpoint'] = sniffed.endpoint
      normalized['quac:wfs_type_name'] = sniffed.typeName
      listQuacExtension(normalized)
    }
  }

  return normalized
}

function normalizeExtent(extent: StacExtent | undefined): StacExtent {
  const spatialBbox = extent?.spatial?.bbox
  return {
    spatial: {
      bbox: Array.isArray(spatialBbox) && spatialBbox.length > 0 ? spatialBbox : [[-180, -90, 180, 90]]
    },
    temporal: extent?.temporal ?? { interval: [[null, null]] }
  }
}

/**
 * If the fetched root is already a Catalog, returns it unchanged. If it's a
 * Collection, wraps it in a synthetic single-collection Catalog so the profile
 * (a Catalog of Collections) holds and consumers don't special-case the root
 * type. Many real STAC URLs point at a leaf Collection.
 */
function wrapAsCatalog(root: StacCollection): StacCatalog {
  return {
    type: 'Catalog',
    stac_version: root.stac_version ?? STAC_VERSION,
    id: `${root.id}-catalog`,
    title: root.title,
    description: 'Synthetic Catalog wrapping the Collection at the endpoint root.',
    links: [],
    collections: [root]
  }
}

/**
 * Reads the endpoint and feature type a Collection is backed by: the `quac:wfs_*`
 * fields when it declares them, otherwise whatever its GetFeature asset href
 * gives up. Returns null for a Collection that is not WFS-backed.
 *
 * The asset comes from `readDataAsset`, the same reader
 * `classifyStacCollectionFormat` uses. The two have to agree: the classifier is
 * what lists a Collection in the Add Layer picker, and this is what the add
 * then resolves, so a Collection either of them could find alone would be
 * offered and then refused with "Could not resolve the WFS endpoint or type
 * name".
 */
export function resolveWfsCollectionSource(
  collection: StacCollection
): { endpoint: string, typeName: string } | null {
  const endpoint = readNonEmptyString(collection['quac:wfs_endpoint'])
  const typeName = readNonEmptyString(collection['quac:wfs_type_name'])
  if (endpoint && typeName) return { endpoint, typeName }

  return parseWfsGetFeatureUrl(readDataAsset(collection)?.href ?? '')
}

/**
 * Pulls the bare endpoint URL (no query) and the type name out of a WFS
 * GetFeature URL. Returns null when the URL has no recognisable type-name
 * parameter — WFS 1.x spells it `typeName`, 2.x `typeNames`, and servers vary
 * on case.
 */
export function parseWfsGetFeatureUrl(href: string): { endpoint: string, typeName: string } | null {
  if (!href) return null

  try {
    const url = new URL(href)
    let typeName: string | null = null
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() !== 'typenames' && key.toLowerCase() !== 'typename') continue
      if (value.trim()) {
        typeName = value.trim()
        break
      }
    }
    if (!typeName) return null

    return { endpoint: `${url.origin}${url.pathname}`, typeName }
  } catch {
    return null
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
