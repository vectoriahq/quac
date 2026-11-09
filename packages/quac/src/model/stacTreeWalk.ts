import type { StacCatalog, StacCollection } from './Stac'

/**
 * Collects every Collection in a Catalog tree, depth-first, in the order the
 * source declared its layers — a Collection inside a group Catalog appears
 * between the top-level Collections that surround the group.
 *
 * A Catalog holds its child Collections and child Catalogs in two separate
 * arrays, so the interleaving is read back from the `rel: "child"` links,
 * which the generator writes in source order (`./collections/{id}.json` for a
 * Collection, `./catalogs/{id}/catalog.json` for a group). A child whose link
 * cannot be matched — an external document with its own link shapes — is
 * appended after the linked ones, so nothing is dropped and external
 * catalogues degrade to "Collections first, then groups" order.
 *
 * Child ids are not guaranteed unique: sibling group Catalogs slugify their
 * names, and two group names can collapse to the same slug ("Roads"/"roads",
 * or two unnamed groups both falling back to "group"). Visits are therefore
 * tracked per object, and a link claims the first still-unvisited child with
 * its id — links and children are both written in source order, so colliding
 * siblings pair up by position and every child is emitted exactly once.
 */
export function collectCatalogueCollections(catalog: StacCatalog): StacCollection[] {
  return listCatalogueChildren(catalog).flatMap((child) => (
    child.kind === 'collection' ? [child.collection] : collectCatalogueCollections(child.catalog)
  ))
}

/** One child of a Catalog: a Collection, or a group Catalog. */
export type CatalogueChild =
  | { kind: 'collection', collection: StacCollection }
  | { kind: 'catalog', catalog: StacCatalog }

/**
 * A Catalog's own children, Collections and group Catalogs together, in the
 * order its `rel: "child"` links list them, by the rule `collectCatalogueCollections`
 * describes. The basemap picker offers these as its choices.
 */
export function listCatalogueChildren(catalog: StacCatalog): CatalogueChild[] {
  const collections = catalog.collections ?? []
  const catalogs = catalog.catalogs ?? []

  const visited = new Set<object>()
  const out: CatalogueChild[] = []

  for (const link of catalog.links ?? []) {
    if (link.rel !== 'child') continue
    const collectionId = matchIdFromHref(link.href, /\/collections\/(.+)\.json$/)
    if (collectionId !== null) {
      const collection = firstUnvisited(collections, collectionId, visited)
      if (collection) {
        visited.add(collection)
        out.push({ kind: 'collection', collection })
        continue
      }
    }
    const catalogId = matchIdFromHref(link.href, /\/catalogs\/(.+)\/catalog\.json$/)
    if (catalogId !== null) {
      const child = firstUnvisited(catalogs, catalogId, visited)
      if (child) {
        visited.add(child)
        out.push({ kind: 'catalog', catalog: child })
      }
    }
  }

  for (const collection of collections) {
    if (!visited.has(collection)) out.push({ kind: 'collection', collection })
  }
  for (const child of catalogs) {
    if (!visited.has(child)) out.push({ kind: 'catalog', catalog: child })
  }

  return out
}

function firstUnvisited<T extends { id: string }>(
  items: T[],
  id: string,
  visited: ReadonlySet<object>
): T | null {
  for (const item of items) {
    if (item.id === id && !visited.has(item)) return item
  }
  return null
}

// The generator writes ids into hrefs verbatim, so the match is verbatim too.
function matchIdFromHref(href: string, pattern: RegExp): string | null {
  const match = pattern.exec(href)
  return match ? match[1]! : null
}
