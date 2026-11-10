import { describe, expect, it } from 'vitest'

import {
  generateStacCatalogueFromOgcCollections,
  resolveOgcCollectionSource
} from './ogcFeaturesStacCatalogue.ts'
import { collectCatalogueCollections } from '../model/stacTreeWalk.ts'

import type { OgcCollection } from '../model/ogcFeatures.ts'

const COLLECTIONS = 'https://example.test/api/collections'

const collections: OgcCollection[] = [
  {
    id: 'roads',
    title: 'Road centrelines',
    description: 'Sealed and unsealed roads',
    itemType: 'feature',
    keywords: ['transport', 42 as unknown as string],
    extent: { spatial: { bbox: [[115, -32, 116, -31]] } },
    links: [{ rel: 'items', href: 'collections/roads/items', type: 'application/geo+json' }]
  },
  {
    id: 'hillshade',
    title: 'Hillshade',
    itemType: 'coverage',
    extent: { spatial: { bbox: [[110, -35, 120, -30]] } },
    links: [{ rel: 'tiles', href: 'tiles/hillshade/{z}/{x}/{y}.png?v=1' }]
  },
  {
    id: 'tileset',
    title: 'Described only',
    itemType: 'coverage',
    links: [{ rel: 'tiles', href: 'collections/tileset/tiles' }]
  }
]

function collectionsOf(...args: Parameters<typeof generateStacCatalogueFromOgcCollections>) {
  return collectCatalogueCollections(generateStacCatalogueFromOgcCollections(...args))
}

describe('generateStacCatalogueFromOgcCollections', () => {
  it('turns each collection into a Collection carrying its id and title', () => {
    const result = collectionsOf(COLLECTIONS, collections)

    expect(result.map((entry) => entry.id)).toEqual(['roads', 'hillshade', 'tileset'])
    expect(result[0].title).toBe('Road centrelines')
    expect(result[0].description).toBe('Sealed and unsealed roads')
  })

  // A relative items link is what the standard's examples use, so it has to
  // resolve against the document it was read from rather than be stored as-is.
  it('resolves the items link to an absolute address', () => {
    const [roads] = collectionsOf(COLLECTIONS, collections)

    expect(resolveOgcCollectionSource(roads)).toEqual({
      kind: 'features',
      itemsUrl: 'https://example.test/api/collections/roads/items',
      collectionId: 'roads'
    })
    expect(roads.assets?.data.href).toBe('https://example.test/api/collections/roads/items')
  })

  // A raster collection has no items endpoint, so it resolves to the tile
  // template the service publishes instead.
  it('resolves a tile template to an absolute address, braces intact', () => {
    const [, hillshade] = collectionsOf(COLLECTIONS, collections)

    expect(resolveOgcCollectionSource(hillshade)).toEqual({
      kind: 'tiles',
      tilesUrl: 'https://example.test/api/tiles/hillshade/{z}/{x}/{y}.png?v=1',
      collectionId: 'hillshade'
    })
  })

  // `new URL` percent-encodes the braces, and a tile source would then request
  // that literal text instead of substituting the tile numbers into it.
  it('leaves the tile placeholders unencoded', () => {
    const [, hillshade] = collectionsOf(COLLECTIONS, collections)

    expect(hillshade.assets?.tiles.href).not.toContain('%7B')
  })

  // One unusable link says nothing about the rest, so the scan carries on
  // rather than reporting the collection as having no tiles at all.
  it('tries the next tiles link when one will not resolve', () => {
    const [entry] = collectionsOf(COLLECTIONS, [{
      id: 'hillshade',
      links: [
        { rel: 'tiles', href: 'http://[bad/{z}/{x}/{y}.png' },
        { rel: 'tiles', href: 'tiles/hillshade/{z}/{x}/{y}.png' }
      ]
    }])

    expect(resolveOgcCollectionSource(entry)).toEqual({
      kind: 'tiles',
      tilesUrl: 'https://example.test/api/tiles/hillshade/{z}/{x}/{y}.png',
      collectionId: 'hillshade'
    })
  })

  // A `tiles` link is also how a service points at a document describing its
  // tiles, which is not something to substitute tile numbers into.
  it('resolves no source for a tiles link that is not a template', () => {
    const [, , tileset] = collectionsOf(COLLECTIONS, collections)

    expect(resolveOgcCollectionSource(tileset)).toBeNull()
    expect(tileset.assets).toEqual({})
  })

  it('reads the collection extent as the Collection bbox', () => {
    const [roads] = collectionsOf(COLLECTIONS, collections)

    expect(roads.extent.spatial.bbox[0]).toEqual([115, -32, 116, -31])
  })

  it('keeps the collection\'s declared period as the Collection\'s temporal extent', () => {
    const [collection] = collectionsOf(COLLECTIONS, [{
      id: 'counts',
      extent: { temporal: { interval: [['2019-03-01T00:00:00Z', null]] } }
    }])
    expect(collection!.extent.temporal.interval[0]).toEqual(['2019-03-01T00:00:00Z', null])
  })

  // The middle pair of a six-number box is elevation, which the Collection's
  // own extent has no place for.
  it('drops the elevation pair from a six-number box', () => {
    const [entry] = collectionsOf(COLLECTIONS, [{
      id: 'towers',
      extent: { spatial: { bbox: [[115, -32, 0, 116, -31, 50]] } },
      links: []
    }])

    expect(entry.extent.spatial.bbox[0]).toEqual([115, -32, 116, -31])
  })

  // Nothing here can reproject, so a box in another CRS is left off rather than
  // written down as longitude and latitude.
  it('leaves the box off when the extent is not in CRS84', () => {
    const [entry] = collectionsOf(COLLECTIONS, [{
      id: 'grid',
      extent: { spatial: { bbox: [[400000, 6400000, 500000, 6500000]], crs: 'http://www.opengis.net/def/crs/EPSG/0/28350' } },
      links: []
    }])

    expect(entry.extent.spatial.bbox[0]).toEqual([-180, -90, 180, 90])
  })

  it('keeps only the keywords that are text', () => {
    const [roads] = collectionsOf(COLLECTIONS, collections)

    expect(roads.keywords).toEqual(['transport'])
  })

  it('emits only the collections asked for, in the order given', () => {
    const result = collectionsOf(COLLECTIONS, collections, { collectionIds: ['hillshade', 'missing'] })

    expect(result.map((entry) => entry.id)).toEqual(['hillshade'])
  })
})
