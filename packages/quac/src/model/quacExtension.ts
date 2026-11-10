import type { StacCatalog, StacCollection } from './Stac.ts'

/**
 * The QUAC schema's address, as its `$id` gives it. A catalogue lists it in
 * `stac_extensions` to say which QUAC it follows. Written from this one
 * constant, so the address changes in one place when the schema moves.
 */
export const QUAC_SCHEMA_URL = 'https://vectoriahq.github.io/quac/v0.1.0/schema.json'

// A QUAC schema address is a folder named for its version, holding the
// schema file `QUAC_SCHEMA_URL` names. Only the path is matched, not the host.
const QUAC_SCHEMA_FILE = QUAC_SCHEMA_URL.slice(QUAC_SCHEMA_URL.lastIndexOf('/'))
const QUAC_VERSION_FOLDER = /\/quac\/v(\d+)\.(\d+)\.(\d+)$/

/**
 * The QUAC version a document declares, such as `0.1.0`, read from the QUAC
 * schema address in its `stac_extensions`. Null where it lists none.
 */
export function readQuacVersion(document: { stac_extensions?: unknown }): string | null {
  const extensions = Array.isArray(document.stac_extensions) ? document.stac_extensions : []
  for (const extension of extensions) {
    const match = typeof extension === 'string' && extension.endsWith(QUAC_SCHEMA_FILE)
      ? QUAC_VERSION_FOLDER.exec(extension.slice(0, -QUAC_SCHEMA_FILE.length))
      : null
    if (match) return `${match[1]}.${match[2]}.${match[3]}`
  }
  return null
}

/**
 * Whether `version` has a newer major version than the QUAC this package
 * writes and reads (`QUAC_SCHEMA_URL`). A reader treats such a catalogue as
 * one it cannot read.
 */
export function isNewerQuacMajor(version: string): boolean {
  const own = readQuacVersion({ stac_extensions: [QUAC_SCHEMA_URL] }) ?? '0'
  return Number(version.split('.')[0]) > Number(own.split('.')[0])
}

function hasQuacKey(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && Object.keys(value as object).some((key) => key.startsWith('quac:'))
}

/** Whether a Collection carries a `quac:` field: on itself, in its summaries, or on an asset, link or column. */
function collectionCarriesQuac(collection: StacCollection): boolean {
  if (hasQuacKey(collection) || hasQuacKey(collection.summaries)) return true
  if (Object.values(collection.assets ?? {}).some(hasQuacKey)) return true
  if ((collection.links ?? []).some(hasQuacKey)) return true
  const columns = collection['table:columns']
  return Array.isArray(columns) && columns.some(hasQuacKey)
}

/** Adds the QUAC schema to one document's `stac_extensions`, once. */
export function listQuacExtension(document: StacCatalog | StacCollection): void {
  const extensions = document.stac_extensions ?? []
  if (!extensions.includes(QUAC_SCHEMA_URL)) document.stac_extensions = [...extensions, QUAC_SCHEMA_URL]
}

/**
 * Lists the QUAC schema in `stac_extensions` on the top-level Catalog, and on
 * each nested Catalog and Collection that carries a `quac:` field of its own,
 * as STAC lists an extension on each object that uses its fields.
 */
export function declareQuacExtension(catalog: StacCatalog): StacCatalog {
  listQuacExtension(catalog)
  const walk = (node: StacCatalog): void => {
    for (const collection of node.collections ?? []) {
      if (collectionCarriesQuac(collection)) listQuacExtension(collection)
    }
    for (const child of node.catalogs ?? []) {
      if (hasQuacKey(child)) listQuacExtension(child)
      walk(child)
    }
  }
  walk(catalog)
  return catalog
}
