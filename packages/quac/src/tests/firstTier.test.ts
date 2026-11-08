import './linkedomDomParser'

import { Validator } from '@cfworker/json-schema'
import { describe, expect, it } from 'vitest'

import { generateServerStacCatalogue, generateStacCatalogue, generateStacCatalogueFromArcgisLayers, generateStacCatalogueFromWfsCapabilities, parseQgsXml } from '../index'
import schemaJson from '../schema/quac.schema.json?raw'

import type { ArcgisLayerSet } from '../model/arcgis'
import type { StacCatalog, StacCollection } from '../model/Stac'
import type { WfsCapabilities } from '../model/wfs'

/**
 * The first tier of QUAC's fixtures: one small example per field, under
 * `packages/quac/spec/examples/`, each a source holding the one setting that
 * writes the field and the catalogue it gives, cut down by `essentials` to the
 * tree and the `quac:` fields so a person can read it against the field
 * reference. A person reviews each one; `npm run test:quac:update` rewrites an
 * `expected.json` only to be read as a diff.
 *
 * The catalogue a QGIS Server serves for each example's QGIS project is saved
 * as well, cut down the same way, in `firstTierServer.catalogues.json`: what
 * the plugin's Python port must match on the first tier. It is a generated
 * file, read as a diff.
 */

interface ExampleManifest {
  /** The fields the example shows, as the reference names them. */
  fields: string[]
  /** The kind of source, which picks the producer. */
  source: 'qgis-project' | 'qgis-server' | 'wfs' | 'arcgis' | 'hand-written'
  /** The input's file name in the example's folder. */
  input: string
  /** For a WFS service, its address with no query; for a QGIS Server, the address it serves the project from. */
  endpoint?: string
  /** For a QGIS project whose canvas is in WGS84: pass its extent as the initial view, the conversion a caller does being none. */
  canvasAsInitialView?: boolean
}

const FILES = import.meta.glob(['../../spec/examples/*/*.{json,qgs}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const MANIFESTS = Object.keys(FILES).filter((path) => path.endsWith('/example.json'))

const validator = new Validator(JSON.parse(schemaJson), '7', false)

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

function quacFieldsOf(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key.startsWith('quac:')))
}

function hasQuacField(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object' && Object.keys(value as object).some((key) => key.startsWith('quac:'))
}

/** A Collection cut down to its id and its `quac:` fields, wherever they sit. */
function collectionEssentials(collection: StacCollection): Record<string, unknown> {
  const out: Record<string, unknown> = { type: 'Collection', id: collection.id, ...quacFieldsOf(collection) }
  if (hasQuacField(collection.summaries)) out['summaries'] = quacFieldsOf(collection.summaries)
  const assets = Object.entries(collection.assets ?? {}).filter(([, asset]) => hasQuacField(asset))
  if (assets.length > 0) out['assets'] = Object.fromEntries(assets.map(([key, asset]) => [key, quacFieldsOf(asset)]))
  const links = (collection.links ?? []).filter(hasQuacField)
  if (links.length > 0) out['links'] = links.map((link) => ({ rel: link.rel, ...quacFieldsOf(link) }))
  const columns = ((collection['table:columns'] ?? []) as Array<{ name: string }>).filter(hasQuacField)
  if (columns.length > 0) out['table:columns'] = columns.map((column) => ({ name: column.name, ...quacFieldsOf(column) }))
  return out
}

/** A Catalog cut down to its tree and its `quac:` fields. */
function essentials(catalog: StacCatalog): Record<string, unknown> {
  const out: Record<string, unknown> = { type: 'Catalog', id: catalog.id, ...quacFieldsOf(catalog) }
  if (catalog.collections?.length) out['collections'] = catalog.collections.map(collectionEssentials)
  if (catalog.catalogs?.length) out['catalogs'] = catalog.catalogs.map(essentials)
  return out
}

function generate(manifest: ExampleManifest, input: string): StacCatalog {
  switch (manifest.source) {
    case 'qgis-project': {
      const project = parseQgsXml(input)
      const extent = project.mapExtent
      const initialView = manifest.canvasAsInitialView && extent?.crs === 'EPSG:4326'
        ? { xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax }
        : null
      return generateStacCatalogue(project, [], { initialView })
    }
    case 'qgis-server':
      return generateServerStacCatalogue(parseQgsXml(input), { serverAddress: manifest.endpoint! })
    case 'wfs':
      return generateStacCatalogueFromWfsCapabilities(manifest.endpoint!, JSON.parse(input) as WfsCapabilities)
    case 'arcgis':
      return generateStacCatalogueFromArcgisLayers(JSON.parse(input) as ArcgisLayerSet)
    case 'hand-written':
      return JSON.parse(input) as StacCatalog
  }
}

describe('the first-tier examples', () => {
  it('has examples to check', () => {
    expect(MANIFESTS.length).toBeGreaterThan(0)
  })

  it.each(MANIFESTS.map((path) => [folderOf(path).split('/').pop()!, path]))('%s gives its expected catalogue', async (_name, path) => {
    const manifest = JSON.parse(FILES[path]!) as ExampleManifest
    const input = FILES[`${folderOf(path)}/${manifest.input}`]
    expect(input, `${manifest.input} is in the example's folder`).toBeDefined()

    const catalogue = JSON.parse(JSON.stringify(generate(manifest, input!))) as StacCatalog
    const result = validator.validate(catalogue)
    expect(result.valid ? [] : result.errors.map((error) => `${error.instanceLocation}: ${error.error}`)).toEqual([])

    const shown = essentials(catalogue)
    for (const field of manifest.fields) expect(JSON.stringify(shown), `the example shows ${field}`).toContain(`"${field}"`)
    await expect(`${JSON.stringify(shown, null, 2)}\n`).toMatchFileSnapshot(`${folderOf(path)}/expected.json`)
  })
})

/** The address the server route is given for an example's QGIS project. */
const SERVER_ADDRESS = 'https://qgis.example.com/ows'

describe('the server route on the first tier', () => {
  it('saves the catalogue a QGIS Server serves for each example\'s QGIS project', async () => {
    const served: Record<string, unknown> = {}
    for (const path of [...MANIFESTS].sort()) {
      const manifest = JSON.parse(FILES[path]!) as ExampleManifest
      if (manifest.source !== 'qgis-project' && manifest.source !== 'qgis-server') continue
      const input = FILES[`${folderOf(path)}/${manifest.input}`]!
      const catalogue = generateServerStacCatalogue(parseQgsXml(input), { serverAddress: manifest.endpoint ?? SERVER_ADDRESS })
      served[folderOf(path).split('/').pop()!] = essentials(JSON.parse(JSON.stringify(catalogue)) as StacCatalog)
    }
    expect(Object.keys(served).length).toBeGreaterThan(0)
    await expect(`${JSON.stringify(served, null, 2)}\n`).toMatchFileSnapshot('./firstTierServer.catalogues.json')
  })
})

describe('the first tier as a whole', () => {
  type Place = 'catalog' | 'collection' | 'summaries' | 'link' | 'asset' | 'column'

  /** Each `quac:` field the schema defines, with the place it sits. */
  function schemaPlaces(): Set<string> {
    const definitions = (JSON.parse(schemaJson) as { definitions: Record<string, { properties: Record<string, { properties?: Record<string, unknown> }> }> }).definitions
    const places: Array<[Place, Record<string, unknown>]> = [
      ['catalog', definitions.catalog!.properties],
      ['collection', definitions.collection!.properties],
      ['summaries', definitions.collection!.properties.summaries!.properties ?? {}],
      ['link', definitions.link!.properties],
      ['asset', definitions.asset!.properties],
      ['column', definitions.column!.properties]
    ]
    return new Set(places.flatMap(([place, fields]) => Object.keys(fields).filter((name) => name.startsWith('quac:')).map((name) => `${place} ${name}`)))
  }

  /** Each `quac:` field an expected catalogue shows, with the place it sits. */
  function examplePlaces(expected: Record<string, unknown>, into: Set<string>): Set<string> {
    const add = (place: Place, value: unknown) => {
      for (const key of Object.keys((value ?? {}) as object)) if (key.startsWith('quac:')) into.add(`${place} ${key}`)
    }
    add('catalog', expected)
    for (const collection of (expected['collections'] ?? []) as Array<Record<string, unknown>>) {
      add('collection', collection)
      add('summaries', collection['summaries'])
      for (const asset of Object.values((collection['assets'] ?? {}) as Record<string, unknown>)) add('asset', asset)
      for (const link of (collection['links'] ?? []) as unknown[]) add('link', link)
      for (const column of (collection['table:columns'] ?? []) as unknown[]) add('column', column)
    }
    for (const catalog of (expected['catalogs'] ?? []) as Array<Record<string, unknown>>) examplePlaces(catalog, into)
    return into
  }

  it('shows every field the schema defines, in every place it can sit', () => {
    const EXPECTED = import.meta.glob(['../../spec/examples/*/expected.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const shown = new Set<string>()
    for (const text of Object.values(EXPECTED)) examplePlaces(JSON.parse(text) as Record<string, unknown>, shown)
    expect([...schemaPlaces()].filter((place) => !shown.has(place))).toEqual([])
  })
})
