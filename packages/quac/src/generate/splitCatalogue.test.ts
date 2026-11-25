import { describe, expect, it } from 'vitest'

import { splitCatalogue } from './splitCatalogue.ts'
import { savedSplit } from '../tests/savedSplit.ts'
import AWKWARD_IDS from '../tests/fixtures/split/awkward-ids.catalogue.json?raw'

import type { CatalogueDocument, SplitCatalogueOptions } from './splitCatalogue.ts'
import type { StacCatalog, StacCollection } from '../model/Stac.ts'

const catalogue = JSON.parse(AWKWARD_IDS) as StacCatalog

function documentAt(documents: CatalogueDocument[], path: string): StacCatalog | StacCollection {
  const found = documents.find((document) => document.path === path)
  if (!found) throw new Error(`No document at ${path}; the paths are ${documents.map((document) => document.path).join(', ')}`)
  return found.document
}

function hrefOf(document: StacCatalog | StacCollection, rel: string): string[] {
  return document.links.filter((link) => link.rel === rel).map((link) => link.href)
}

function assetHref(document: StacCatalog | StacCollection, key: string): string | undefined {
  return (document as StacCollection).assets?.[key]?.href
}

/** Resolves an href against a document's path, as a reader holding the folder would, to check it lands where it should. */
function resolveFrom(path: string, href: string): string {
  return new URL(href, `https://folder.example.test/out/${path.split('/').map(encodeURIComponent).join('/')}`).href
}

describe('splitCatalogue', () => {
  const documents = splitCatalogue(catalogue)

  it('writes the root first and each child after its parent, in the order its child links list them', () => {
    expect(documents.map((document) => document.path)).toEqual([
      'catalog.json',
      'collections/survey_roads.geojson.json',
      'catalogs/water/catalog.json',
      'catalogs/water/collections/rivers.json',
      'catalogs/water/catalogs/deep_er/catalog.json',
      'catalogs/water/catalogs/deep_er/collections/lakes.json',
      'collections/Survey_Roads.geojson-2.json',
      'collections/__.json',
      'collections/_CON.json',
      'collections/a #1_.json.json',
      'catalogs/Water-2/catalog.json',
      'collections/unlinked.json'
    ])
  })

  it('leaves no collections or catalogs arrays, and changes nothing else on a document', () => {
    for (const { document } of documents) {
      expect(document).not.toHaveProperty('collections')
      expect(document).not.toHaveProperty('catalogs')
    }
    expect(documentAt(documents, 'catalogs/water/catalog.json')['quac:mutually_exclusive']).toBe(true)
    expect(Object.keys(documentAt(documents, 'catalog.json'))).toEqual(['type', 'stac_version', 'id', 'title', 'description', 'links'])
  })

  it('does not change the catalogue it is given', () => {
    expect(catalogue).toEqual(JSON.parse(AWKWARD_IDS))
  })

  it('links each document to its own path, its parent, the root and its children', () => {
    const water = documentAt(documents, 'catalogs/water/catalog.json')
    expect(hrefOf(water, 'self')).toEqual(['./catalog.json'])
    expect(hrefOf(water, 'parent')).toEqual(['../../catalog.json'])
    expect(hrefOf(water, 'root')).toEqual(['../../catalog.json'])
    expect(hrefOf(water, 'child')).toEqual(['./collections/rivers.json', './catalogs/deep_er/catalog.json'])

    const lakes = documentAt(documents, 'catalogs/water/catalogs/deep_er/collections/lakes.json')
    expect(hrefOf(lakes, 'self')).toEqual(['./lakes.json'])
    expect(hrefOf(lakes, 'parent')).toEqual(['../catalog.json'])
    expect(hrefOf(lakes, 'root')).toEqual(['../../../../../catalog.json'])
  })

  it('escapes a file name in an href, so it resolves to the file', () => {
    const root = documentAt(documents, 'catalog.json')
    expect(hrefOf(root, 'child')).toContain('./collections/a%20%231_.json.json')
    expect(resolveFrom('catalog.json', './collections/a%20%231_.json.json')).toBe(resolveFrom('collections/a #1_.json.json', './a%20%231_.json.json'))
  })

  it('gives a child no child link names a link of its own', () => {
    const root = documentAt(documents, 'catalog.json')
    expect(root.links.at(-1)).toEqual({ rel: 'child', href: './collections/unlinked.json', type: 'application/json', title: 'Unlinked' })
  })

  it('leaves an absolute href, one from the server root and one naming only a fragment as they are', () => {
    const root = documentAt(documents, 'catalog.json')
    expect(hrefOf(root, 'self')).toEqual(['https://data.example.test/survey/'])
    expect(hrefOf(root, 'license')).toEqual(['https://example.test/licence.html'])
    const roads = documentAt(documents, 'collections/survey_roads.geojson.json')
    expect(assetHref(roads, 'thumbnail')).toBe('https://example.test/thumbs/roads.png')
    expect(assetHref(documentAt(documents, 'collections/__.json'), 'data')).toBe('/data/dots.geojson')
    expect(assetHref(documentAt(documents, 'collections/Survey_Roads.geojson-2.json'), 'style')).toBe('#Survey%2FRoads.geojson/default')
  })

  it('rewrites every other relative href to the same file from the document\'s own folder, keeping its query and fragment', () => {
    const roads = documentAt(documents, 'collections/survey_roads.geojson.json')
    expect(assetHref(roads, 'data')).toBe('../survey/roads.geojson')
    expect(assetHref(roads, 'style')).toBe('../project.qgs#survey%2Froads.geojson/default')
    expect(hrefOf(roads, 'via')).toEqual(['../project.qgs'])
    expect(assetHref(documentAt(documents, 'collections/_CON.json'), 'data')).toBe('../data/a%20b.csv?type=csv#top')
    expect(assetHref(documentAt(documents, 'collections/unlinked.json'), 'data')).toBe('../unlinked.geojson')
    expect(assetHref(documentAt(documents, 'catalogs/water/catalogs/deep_er/collections/lakes.json'), 'data')).toBe('../../../../../water/lakes.geojson')
  })

  it('keeps a data file outside the root document\'s folder where it is', () => {
    const roads = documentAt(documents, 'collections/Survey_Roads.geojson-2.json')
    expect(assetHref(roads, 'data')).toBe('../../outside/roads.gpkg')
    expect(resolveFrom('collections/Survey_Roads.geojson-2.json', '../../outside/roads.gpkg')).toBe(resolveFrom('catalog.json', '../outside/roads.gpkg'))
  })

  it('names the root document and the children\'s folder as it is told', () => {
    const named = splitCatalogue(catalogue, { rootFileName: 'Survey.json', childrenFolder: 'Survey' })
    expect(named.map((document) => document.path).slice(0, 3)).toEqual(['Survey.json', 'Survey/collections/survey_roads.geojson.json', 'Survey/catalogs/water/catalog.json'])
    const root = documentAt(named, 'Survey.json')
    expect(hrefOf(root, 'root')).toEqual(['./Survey.json'])
    expect(hrefOf(root, 'child')[0]).toBe('./Survey/collections/survey_roads.geojson.json')
    const roads = documentAt(named, 'Survey/collections/survey_roads.geojson.json')
    expect(hrefOf(roads, 'root')).toEqual(['../../Survey.json'])
    expect(assetHref(roads, 'data')).toBe('../../survey/roads.geojson')
    expect(splitCatalogue(catalogue, { childrenFolder: 'Survey/' }).map((document) => document.path)).toEqual(splitCatalogue(catalogue, { childrenFolder: 'Survey' }).map((document) => document.path))
  })

  it('writes every path inside the root document\'s folder, of names safe on any system', () => {
    const named = splitCatalogue(catalogue, { rootFileName: 'Survey.json', childrenFolder: 'Survey/published' })
    for (const { path } of [...documents, ...named]) {
      for (const name of path.split('/')) {
        expect(name, path).not.toMatch(/^\.{0,2}$/)
        expect(name, path).not.toMatch(/[\u0000-\u001f"*:<>?\\|]|[. ]$/)
        expect(name, path).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i)
      }
    }
    const lowerCase = documents.map((document) => document.path.toLowerCase())
    expect(new Set(lowerCase).size).toBe(lowerCase.length)
  })

  // A pattern for the dots and spaces ending a name took time growing with the square of a run of spaces inside it.
  it('makes a name with a long run of spaces inside it safe in linear time', () => {
    const rootFileName = `a${' '.repeat(100_000)}b.json`
    const started = performance.now()
    expect(splitCatalogue(catalogue, { rootFileName })[0].path).toBe(rootFileName)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it.each<[string, SplitCatalogueOptions]>([
    ['a root file name with a folder', { rootFileName: 'out/catalog.json' }],
    ['a root file name not ending in .json', { rootFileName: 'catalog' }],
    ['an empty root file name', { rootFileName: '' }],
    ['an absolute children\'s folder', { childrenFolder: '/srv/catalogue' }],
    ['a children\'s folder above the root', { childrenFolder: '../elsewhere' }],
    ['a children\'s folder holding ..', { childrenFolder: 'a/../../b' }],
    ['a children\'s folder holding .', { childrenFolder: './a' }],
    ['a children\'s folder with an empty name', { childrenFolder: 'a//b' }],
    ['a children\'s folder with a backslash', { childrenFolder: 'a\\b' }],
    ['a Windows drive', { childrenFolder: 'C:' }],
    ['a children\'s folder named as the root document', { rootFileName: 'catalog.json', childrenFolder: 'Catalog.JSON/x' }]
  ])('refuses %s', (_name, options) => {
    expect(() => splitCatalogue(catalogue, options)).toThrow()
  })

  it('gives the saved documents of the awkward ids, which the Python must give too', async () => {
    await expect(savedSplit(catalogue, 'awkward-ids')).toMatchFileSnapshot('../tests/fixtures/split/awkward-ids.split.json')
  })
})
