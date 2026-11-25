import './xmlParser.ts'
import { Validator } from '@cfworker/json-schema'
import { describe, expect, it } from 'vitest'

import { generateStacCatalogue, parseQgsXml, splitCatalogue } from '../index.ts'
import schemaJson from '../schema/quac.schema.json?raw'
import PROJECT from '../../../../site/demo/street-trees.qgs?raw'

import type { StacCatalog } from '../model/Stac.ts'

/**
 * The demo catalogue under `site/demo/`, which the site publishes beside the
 * schema: a made-up street-tree project, `street-trees.qgs`, and the catalogue
 * this package writes for it, in two forms.
 *
 * - `catalogue.json` is the one document the package writes, with its
 *   Collections inline.
 * - `catalog.json` and `collections/<id>.json` are the same catalogue as
 *   `splitCatalogue` writes it, one file per Collection, linked with
 *   `rel: "child"`, for a STAC client that follows links rather than reading
 *   inline Collections.
 *
 * The demo passes `projectPath` but no `selfHref`, so every address in it is
 * relative and each file reads from wherever it is served, such as the site
 * or a branch's raw files.
 *
 * `npx vitest run -u` rewrites the files, to be read as a diff.
 */

const DEMO = '../../../../site/demo/'

const validator = new Validator(JSON.parse(schemaJson), '7', false)

function generateDemo(): StacCatalog {
  const project = parseQgsXml(PROJECT)
  const extent = project.mapExtent
  const initialView = extent?.crs === 'EPSG:4326' ? { xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax } : null
  return generateStacCatalogue(project, [], { projectPath: 'street-trees.qgs', initialView })
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
    const documents = splitCatalogue(catalogue)
    expect(documents.map((document) => document.path)).toEqual(['catalog.json', ...(catalogue.collections ?? []).map((collection) => `collections/${collection.id}.json`)])
    for (const { path, document } of documents) {
      expect(schemaErrors(document), path).toEqual([])
      await expect(asFile(document)).toMatchFileSnapshot(`${DEMO}${path}`)
    }
  })
})
