import { Validator } from '@cfworker/json-schema'

import type { StacCatalog, StacCollection } from '../model/Stac.ts'

/**
 * Checks a catalogue against STAC 1.1.0's own Catalog and Collection schemas,
 * kept in `stac-1.1.0/` as published at `https://schemas.stacspec.org/v1.1.0/`.
 */

const FILES = import.meta.glob(['./stac-1.1.0/*.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const SCHEMA_BASE = 'https://schemas.stacspec.org/v1.1.0/'

/** Where each schema sits under `SCHEMA_BASE`, which is how the others refer to it. */
const SCHEMA_FOLDER: Record<string, string> = {
  'catalog.json': 'catalog-spec/json-schema/',
  'collection.json': 'collection-spec/json-schema/'
}

function schemaOf(name: string): object {
  const text = FILES[`./stac-1.1.0/${name}`]
  if (!text) throw new Error(`stac-1.1.0/${name} is missing`)
  return JSON.parse(text) as object
}

/**
 * A validator for one of the root schemas, holding every schema it refers to.
 * Each is added under the address the others use for it, not its own `$id`:
 * the published `common.json` gives its `$id` as `…/commonjson`. The GeoJSON
 * schemas, which only an Item's geometry uses, and the JSON Schema
 * meta-schema, which only a summary written as a JSON Schema uses, are
 * outside STAC and accept anything here.
 */
function validatorFor(root: 'catalog.json' | 'collection.json'): Validator {
  const validator = new Validator(schemaOf(root), '7', false)
  for (const path of Object.keys(FILES)) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (name === root) continue
    validator.addSchema(schemaOf(name), `${SCHEMA_BASE}${SCHEMA_FOLDER[name] ?? 'item-spec/json-schema/'}${name}`)
  }
  validator.addSchema({}, 'https://geojson.org/schema/Feature.json')
  validator.addSchema({}, 'https://geojson.org/schema/Geometry.json')
  validator.addSchema({}, 'http://json-schema.org/draft-07/schema')
  return validator
}

const catalogValidator = validatorFor('catalog.json')
const collectionValidator = validatorFor('collection.json')

/** Each error's place and message, less the summaries that only repeat a deeper one. */
function errorsOf(result: ReturnType<Validator['validate']>, where: string): string[] {
  if (result.valid) return []
  return result.errors
    .filter((error) => !/does not match every subschema|subschema had errors|does not match schema|does not match additional properties schema/.test(error.error))
    .map((error) => `${where}${error.instanceLocation}: ${error.error}`)
}

/**
 * Every place a catalogue breaks STAC 1.1.0, as `<where>: <error>`; empty for a
 * catalogue STAC accepts. The catalogue is read as saved, as JSON. Each Catalog
 * is checked without the children it holds inline, and each of those
 * Collections and Catalogs on its own.
 */
export function stacErrors(catalogue: StacCatalog): string[] {
  const walk = (catalog: StacCatalog, where: string): string[] => {
    const { collections = [], catalogs = [], ...own } = catalog
    return [
      ...errorsOf(catalogValidator.validate(own), `${where}catalog ${catalog.id} `),
      ...collections.flatMap((collection: StacCollection) => errorsOf(collectionValidator.validate(collection), `${where}collection ${collection.id} `)),
      ...catalogs.flatMap((child) => walk(child, `${where}catalog ${child.id} > `))
    ]
  }
  return walk(JSON.parse(JSON.stringify(catalogue)) as StacCatalog, '')
}

/** Every place a Collection standing on its own breaks STAC 1.1.0, as `stacErrors` gives them. */
export function stacCollectionErrors(collection: StacCollection): string[] {
  return errorsOf(collectionValidator.validate(JSON.parse(JSON.stringify(collection))), `collection ${collection.id} `)
}
