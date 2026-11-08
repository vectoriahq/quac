// @vitest-environment jsdom
import { Validator } from '@cfworker/json-schema'
import { describe, expect, it } from 'vitest'

import referenceDoc from '../../spec/README.md?raw'
import { generateServerStacCatalogue, generateStacCatalogue, parseQgsXml } from '../index'
import everyFieldJson from './examples/every-field.json?raw'
import schemaJson from './quac.schema.json?raw'

const schema = JSON.parse(schemaJson) as {
  definitions: Record<string, { properties: Record<string, { properties?: Record<string, unknown> }> }>
}
const validator = new Validator(JSON.parse(schemaJson), '7', false)

/**
 * Every fixture project, by path. Groundwork's own projects, basemap catalogues
 * and profile document are checked by Groundwork's own tests.
 */
const PROJECTS = import.meta.glob(['../tests/fixtures/qgis/**/*.qgs'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

function errorsOf(document: unknown): string[] {
  const result = validator.validate(document)
  return result.valid ? [] : result.errors.map((error) => `${error.instanceLocation}: ${error.error}`)
}

/** The quac: fields the schema defines, on a Catalog, a Collection, its summaries, a link, an asset and a column. */
function schemaFields(): Set<string> {
  const { catalog, collection, link, asset, column } = schema.definitions
  const names = [
    ...Object.keys(catalog!.properties),
    ...Object.keys(collection!.properties),
    ...Object.keys(collection!.properties.summaries!.properties ?? {}),
    ...Object.keys(link!.properties),
    ...Object.keys(asset!.properties),
    ...Object.keys(column!.properties)
  ]
  return new Set(names.filter((name) => name.startsWith('quac:')))
}

/** The quac: keys anywhere in a document. */
function documentFields(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) documentFields(item, found)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('quac:')) found.add(key)
      documentFields(child, found)
    }
  }
  return found
}

describe('quac.schema.json', () => {
  it('has a fixture project to check', () => {
    expect(Object.keys(PROJECTS).length).toBeGreaterThan(0)
  })

  it.each(Object.keys(PROJECTS))('accepts the catalogue generated from %s', (path) => {
    // As JSON, which leaves out the members a generator sets to undefined.
    const catalogue: unknown = JSON.parse(JSON.stringify(generateStacCatalogue(parseQgsXml(PROJECTS[path]!))))
    expect(errorsOf(catalogue)).toEqual([])
  })

  it.each(Object.keys(PROJECTS))('accepts the server catalogue generated from %s', (path) => {
    const catalogue: unknown = JSON.parse(JSON.stringify(generateServerStacCatalogue(parseQgsXml(PROJECTS[path]!), { serverAddress: 'https://qgis.example.com/ows' })))
    expect(errorsOf(catalogue)).toEqual([])
  })

  it('accepts the example carrying every field', () => {
    expect(errorsOf(JSON.parse(everyFieldJson))).toEqual([])
  })

  it('has every field it defines in the example', () => {
    expect([...documentFields(JSON.parse(everyFieldJson))].sort()).toEqual([...schemaFields()].sort())
  })

  it('names in the field reference exactly the fields it defines', () => {
    // A name ending in `*`, such as `quac:wfs_*`, stands for a group of fields rather than one.
    const documented = new Set([...referenceDoc.matchAll(/`(quac:[a-z_]+)(?![a-z_*])/g)].map((match) => match[1]!))
    expect([...documented].sort()).toEqual([...schemaFields()].sort())
  })

  it('accepts a single Collection', () => {
    expect(errorsOf({ type: 'Collection', id: 'trees', 'quac:private': true })).toEqual([])
  })

  it.each([
    ['an undefined quac: field on a Collection', { type: 'Collection', 'quac:colour': 'red' }],
    ['an undefined quac: field on a nested Catalog', { type: 'Catalog', catalogs: [{ type: 'Catalog', 'quac:hidden': true }] }],
    ['an undefined quac: field in summaries', { type: 'Collection', summaries: { 'quac:geometry_types': ['Point'] } }],
    ['an undefined quac: field on an asset', { type: 'Collection', assets: { data: { href: './a.geojson', 'quac:subset': 'x' } } }],
    ['a geometry filter naming a shape it does not read', { type: 'Collection', assets: { data: { href: './a.geojson', 'quac:geometry_filter': ['MultiPoint'] } } }],
    ['a geometry filter written as one shape rather than a list', { type: 'Collection', assets: { data: { href: './a.geojson', 'quac:geometry_filter': 'Point' } } }],
    ['a geometry filter listing no shape', { type: 'Collection', assets: { data: { href: './a.geojson', 'quac:geometry_filter': [] } } }],
    ['a layer name left empty', { type: 'Collection', assets: { data: { href: './a.gpkg', 'quac:layer_name': '' } } }],
    ['a feature filter with no dialect', { type: 'Collection', assets: { data: { href: './a.geojson', 'quac:feature_filter': { expression: '"a" = 1' } } } }],
    ['a feature filter in a dialect it does not name', { type: 'Collection', assets: { data: { href: './a.geojson', 'quac:feature_filter': { expression: '"a" = 1', dialect: 'sqlite' } } } }],
    ['an undefined quac: field on a column', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:required': true }] }],
    ['quac:hidden written as false', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:hidden': false }] }],
    ['quac:in_form written as true', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:in_form': true }] }],
    ['an empty list of visibility expressions', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:visible_when': [] }] }],
    ['a blank Editable expression', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:editable_when': '' }] }],
    ['a blank visibility expression', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:visible_when': [''] }] }],
    ['a form order naming a blank field', { type: 'Collection', 'quac:form_order': [''] }],
    ['a fixed default with no value', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:default': { kind: 'fixed', on_update: false } }] }],
    ['a default of an unknown kind', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:default': { kind: 'random', on_update: false } }] }],
    [
      'a value relation ordered by a field it does not name',
      { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:value_relation': { collection: 'b', key: 'k', value: 'v', order_by: 'field' } }] }
    ],
    ['a relation with no join fields', { type: 'Collection', 'quac:related_to': [{ id: 'r', parent_collection_id: 'p', fields: [] }] }],
    ['an attachment with no relative storage', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:attachment': { viewer: 'image' } }] }],
    ['a constraint of an unknown strength', { type: 'Collection', 'table:columns': [{ name: 'a', 'quac:constraints': { not_null: 'always' } }] }]
  ])('rejects %s', (_case, document) => {
    expect(errorsOf(document)).not.toEqual([])
  })
})
