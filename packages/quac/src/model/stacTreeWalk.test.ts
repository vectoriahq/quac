import { describe, expect, it } from 'vitest'

import { catalogueFolder, collectCatalogueCollections } from './stacTreeWalk.ts'

import type { StacCatalog, StacCollection } from './Stac.ts'

function collection(id: string): StacCollection {
  return { type: 'Collection', stac_version: '1.1.0', id, description: '', license: 'other', extent: { spatial: { bbox: [[0, 0, 1, 1]] }, temporal: { interval: [[null, null]] } }, links: [] }
}

function child(href: string) {
  return { rel: 'child', href }
}

describe('collectCatalogueCollections', () => {
  // Every href starts from the top-level document, so a nested group's child
  // links carry each group's folder before their own.
  it('keeps source order through nested groups', () => {
    const inner: StacCatalog = {
      type: 'Catalog', stac_version: '1.1.0', id: 'monitoring', description: '',
      links: [{ rel: 'self', href: './catalogs/water/catalogs/monitoring/catalog.json' }, child('./catalogs/water/catalogs/monitoring/collections/sites.json')],
      collections: [collection('sites')]
    }
    const water: StacCatalog = {
      type: 'Catalog', stac_version: '1.1.0', id: 'water', description: '',
      links: [{ rel: 'self', href: './catalogs/water/catalog.json' }, child('./catalogs/water/catalogs/monitoring/catalog.json'), child('./catalogs/water/collections/bores.json')],
      collections: [collection('bores')],
      catalogs: [inner]
    }
    const root: StacCatalog = {
      type: 'Catalog', stac_version: '1.1.0', id: 'project', description: '',
      links: [{ rel: 'self', href: './catalog.json' }, child('./collections/roads.json'), child('./catalogs/water/catalog.json'), child('./collections/parks.json')],
      collections: [collection('parks'), collection('roads')],
      catalogs: [water]
    }
    expect(collectCatalogueCollections(root).map((item) => item.id)).toEqual(['roads', 'sites', 'bores', 'parks'])
  })

  it('reads an id holding a / from the Catalog\'s own folder', () => {
    const group: StacCatalog = {
      type: 'Catalog', stac_version: '1.1.0', id: 'g', description: '',
      links: [{ rel: 'self', href: './catalogs/g/catalog.json' }, child('./catalogs/g/collections/data/collections/b.geojson.json'), child('./catalogs/g/collections/a.geojson.json')],
      collections: [collection('a.geojson'), collection('data/collections/b.geojson')]
    }
    expect(collectCatalogueCollections(group).map((item) => item.id)).toEqual(['data/collections/b.geojson', 'a.geojson'])
  })
})

describe('catalogueFolder', () => {
  it('reads the folder from the self link, and none from another kind of address', () => {
    const withSelf = (href: string): StacCatalog => ({ type: 'Catalog', stac_version: '1.1.0', id: 'x', description: '', links: [{ rel: 'self', href }] })
    expect(catalogueFolder(withSelf('./catalog.json'))).toBe('./')
    expect(catalogueFolder(withSelf('./catalogs/roads/catalog.json'))).toBe('./catalogs/roads/')
    expect(catalogueFolder(withSelf('https://data.example.test/survey/'))).toBeNull()
  })
})
