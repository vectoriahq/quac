// @vitest-environment jsdom
import { Validator } from '@cfworker/json-schema'
import { describe, expect, it } from 'vitest'

import { generateStacCatalogue, parseQgsXml } from '../index.ts'
import schemaJson from '../schema/quac.schema.json?raw'
import PROJECT from '../../../../site/demo/street-trees.qgs?raw'

import type { StacCatalog, StacCollection, StacLink } from '../model/Stac.ts'

/**
 * The demo catalogue under `site/demo/`, which the site publishes beside the
 * schema: a made-up street-tree project, `street-trees.qgs`, and the catalogue
 * this package writes for it, in two forms.
 *
 * - `catalogue.json` is the one document the package writes, with its
 *   Collections inline.
 * - `catalog.json` and `collections/<id>.json` are the same catalogue split
 *   into one file per Collection, linked with `rel: "child"`, for a STAC client
 *   that follows links rather than reading inline Collections.
 *
 * The demo passes `projectPath` but no `selfHref`, so every address in it is
 * relative and each file reads from wherever it is served, such as the site
 * or a branch's raw files.
 *
 * jsdom parses the project because it decodes `&lt;` in an attribute, as a
 * browser does, and linkedom does not. `npx vitest run -u` rewrites the files,
 * to be read as a diff.
 */

const DEMO = '../../../../site/demo/'

const validator = new Validator(JSON.parse(schemaJson), '7', false)

function generateDemo(): StacCatalog {
  const project = parseQgsXml(PROJECT)
  const extent = project.mapExtent
  const initialView = extent?.crs === 'EPSG:4326' ? { xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax } : null
  return generateStacCatalogue(project, [], { projectPath: 'street-trees.qgs', initialView })
}

/** An href relative to the root document, rewritten relative to a Collection's own file under `collections/`. */
function fromCollectionsFolder(href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
  return `../${href.replace(/^\.\//, '')}`
}

/**
 * Splits the one document into a root Catalog and a file per Collection.
 * Every relative href in the one document resolves against the root, apart
 * from a Collection's `parent` and `root` links, which the generator already
 * writes from the Collection's own file. Each Collection's `self` link is
 * written as its own file.
 */
function splitDemo(catalogue: StacCatalog): { root: StacCatalog, collections: StacCollection[] } {
  if (catalogue.catalogs?.length) throw new Error('The demo has no groups; splitting one is not written.')
  const { collections = [], ...root } = catalogue
  const split = collections.map((collection) => {
    const links: StacLink[] = (collection.links ?? []).map((link) => {
      if (link.rel === 'self') return { ...link, href: `./${collection.id}.json` }
      if (link.rel === 'parent' || link.rel === 'root') return link
      return { ...link, href: fromCollectionsFolder(link.href) }
    })
    const assets = Object.fromEntries(Object.entries(collection.assets ?? {}).map(([key, asset]) => (
      [key, { ...asset, href: fromCollectionsFolder(asset.href) }]
    )))
    return { ...collection, links, assets }
  })
  return { root, collections: split }
}

function asFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function schemaErrors(value: unknown): string[] {
  const result = validator.validate(JSON.parse(JSON.stringify(value)))
  return result.valid ? [] : result.errors.map((error) => `${error.instanceLocation}: ${error.error}`)
}

describe('the demo catalogue', () => {
  const catalogue = generateDemo()

  it('passes the schema', () => {
    expect(schemaErrors(catalogue)).toEqual([])
  })

  it('reads the height rule, whose expression holds a "<"', () => {
    const trees = catalogue.collections?.find((collection) => collection.id === 'trees')
    const columns = trees?.['table:columns'] as Array<{ name: string, 'quac:constraints'?: unknown }> | undefined
    const height = columns?.find((column) => column.name === 'height')
    expect(height?.['quac:constraints']).toEqual({
      expression: { expression: '"height" < 40', description: 'Taller than any tree on this street', strength: 'warn' }
    })
  })

  it('is the committed one-document form', async () => {
    await expect(asFile(catalogue)).toMatchFileSnapshot(`${DEMO}catalogue.json`)
  })

  it('is the committed split form, each file passing the schema', async () => {
    const { root, collections } = splitDemo(catalogue)
    expect(schemaErrors(root)).toEqual([])
    await expect(asFile(root)).toMatchFileSnapshot(`${DEMO}catalog.json`)
    const childHrefs = (root.links ?? []).filter((link) => link.rel === 'child').map((link) => link.href)
    expect(childHrefs).toEqual(collections.map((collection) => `./collections/${collection.id}.json`))
    for (const collection of collections) {
      expect(schemaErrors(collection)).toEqual([])
      await expect(asFile(collection)).toMatchFileSnapshot(`${DEMO}collections/${collection.id}.json`)
    }
  })
})
