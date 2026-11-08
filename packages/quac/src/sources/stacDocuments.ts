import type { StacCatalog, StacCollection } from '../model/Stac'

/**
 * Pure helpers over a fetched STAC document, used by `StacEndpointAdapter` as
 * it reads and inlines a catalogue. None of them makes a request.
 */

/**
 * Walks a Catalog and collects every Collection it holds, recursing into
 * nested Catalogs. A Collection at the endpoint root is passed here already
 * wrapped in a synthetic Catalog by the normaliser, and every child linked
 * as a separate document has already been inlined by `inlineChildLinks`.
 */
export function collectAllCollections(root: StacCatalog): StacCollection[] {
  const out: StacCollection[] = []
  for (const c of root.collections ?? []) out.push(c)
  for (const child of root.catalogs ?? []) out.push(...collectAllCollections(child))
  return out
}

/**
 * Rewrites a fetched document's asset and link hrefs to absolute addresses,
 * against the URL the document itself came from.
 *
 * A published catalogue gives each Collection its own document and addresses
 * that Collection's files relative to it — `./roads.parquet` beside
 * `collections/roads.json`. Inlining puts the Collection under a Catalog
 * fetched from somewhere else entirely, so the document it was relative *to* is
 * gone by the time anything reads the href. Resolving here, while that URL is
 * still in hand, is what makes every href in the inlined tree fetchable on its
 * own.
 *
 * An href that is already absolute passes through unchanged; one that cannot be
 * resolved at all is left exactly as it stands, so nothing is lost by trying.
 * A tile template's placeholders (`{z}`, `{quadkey}`) are kept as written:
 * `URL` escapes their braces, after which the href no longer reads as a template.
 * A new document is built rather than the fetched one edited, matching the
 * immutable style of `StacEndpointAdapter.ts`.
 */
export function resolveDocumentHrefs<T extends StacCatalog | StacCollection>(document: T, url: string): T {
  const absolute = (href: string): string => {
    if (!href || href.startsWith('#')) return href
    try {
      return new URL(href, url).toString().replace(/%7B(\w+)%7D/g, '{$1}')
    } catch {
      return href
    }
  }

  // STAC 1.1 allows assets on a Catalog as well as a Collection, and only the
  // Collection type here declares the field.
  const assets = (document as StacCollection).assets
  const catalogs = (document as StacCatalog).catalogs
  const collections = (document as StacCatalog).collections
  return {
    ...document,
    ...(document.links ? { links: document.links.map((link) => ({ ...link, href: absolute(link.href) })) } : {}),
    ...(assets
      ? {
        assets: Object.fromEntries(
          Object.entries(assets).map(([key, asset]) => [key, { ...asset, href: absolute(asset.href) }])
        )
      }
      : {}),
    // A document that inlines its children addresses their files relative to
    // itself as well, so the whole subtree resolves against this one URL.
    ...(collections ? { collections: collections.map((child) => resolveDocumentHrefs(child, url)) } : {}),
    ...(catalogs ? { catalogs: catalogs.map((child) => resolveDocumentHrefs(child, url)) } : {})
  }
}

/**
 * The document with a `self` link to the address it was fetched from, where it
 * declares none. Inlining loses that address, and a `latest-version` link on an
 * outdated Collection names its replacement by it (`readCollectionSelfHref`).
 */
export function withSelfLink<T extends StacCatalog | StacCollection>(document: T, url: string): T {
  if ((document.links ?? []).some((link) => link.rel === 'self')) return document
  return { ...document, links: [...(document.links ?? []), { rel: 'self', href: url, type: 'application/json' }] }
}

/** Shallow-copies a Catalog, along with its own `collections` / `catalogs` arrays, so appending children never mutates the fetched document. */
export function cloneCatalogShallow(catalog: StacCatalog): StacCatalog {
  return {
    ...catalog,
    collections: catalog.collections ? [...catalog.collections] : catalog.collections,
    catalogs: catalog.catalogs ? [...catalog.catalogs] : catalog.catalogs
  }
}
