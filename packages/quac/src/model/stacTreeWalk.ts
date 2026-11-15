import type { StacCatalog, StacCollection } from './Stac.ts'

/**
 * Collects every Collection in a Catalog tree, depth-first, in the order the
 * source declared its layers — a Collection inside a group Catalog appears
 * between the top-level Collections that surround the group.
 *
 * A Catalog holds its child Collections and child Catalogs in two separate
 * arrays, so the interleaving is read back from the `rel: "child"` links,
 * which the generator writes in source order, from the top-level document:
 * `{folder}collections/{id}.json` for a Collection and
 * `{folder}catalogs/{id}/catalog.json` for a group, where `{folder}` is the
 * Catalog's own, as `catalogueFolder` reads it. A child whose link
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

  const folder = catalogueFolder(catalog)
  const visited = new Set<object>()
  const out: CatalogueChild[] = []

  for (const link of catalog.links ?? []) {
    if (link.rel !== 'child') continue
    const collectionId = matchChildId(link.href, folder, 'collections/', '.json')
    if (collectionId !== null) {
      const collection = firstUnvisited(collections, collectionId, visited)
      if (collection) {
        visited.add(collection)
        out.push({ kind: 'collection', collection })
        continue
      }
    }
    const catalogId = matchChildId(link.href, folder, 'catalogs/', '/catalog.json')
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

/**
 * Where a Catalog would sit as a file of its own, relative to the top-level
 * document, read from its `self` link: `./` for `./catalog.json`, and
 * `./catalogs/roads/` for `./catalogs/roads/catalog.json`. Null where the
 * `self` link is absent or names some other file, such as a catalogue another
 * application published.
 */
export function catalogueFolder(catalog: StacCatalog): string | null {
  const self = (catalog.links ?? []).find((link) => link.rel === 'self')?.href
  if (!self || (self !== 'catalog.json' && !self.endsWith('/catalog.json'))) return null
  return self.slice(0, self.length - 'catalog.json'.length)
}

/**
 * The id in a child link written as `{folder}{prefix}{id}{suffix}`. Ids are
 * written into hrefs verbatim, and an id can hold a `/`, such as a folder
 * source's path, so the id is what lies between the Catalog's own folder and
 * the suffix. An href outside that folder, such as another application's, is
 * matched from its first `/{prefix}` instead.
 */
function matchChildId(href: string, folder: string | null, prefix: string, suffix: string): string | null {
  if (!href.endsWith(suffix)) return null
  let start: number
  if (folder !== null && href.startsWith(`${folder}${prefix}`)) {
    start = folder.length + prefix.length
  } else {
    const at = href.indexOf(`/${prefix}`)
    if (at < 0) return null
    start = at + 1 + prefix.length
  }
  const id = href.slice(start, href.length - suffix.length)
  return start <= href.length - suffix.length && id ? id : null
}
