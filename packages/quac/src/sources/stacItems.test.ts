import { describe, expect, it } from 'vitest'

import {
  buildItemsPageUrl,
  buildItemUrl,
  decodeItemRowId,
  encodeItemRowId,
  itemAsCollection,
  readItemsHref,
  readItemTimestamp,
  sortItemsNewestFirst
} from './stacItems.ts'
import { imageryCollection, itemsPageOne } from '../tests/fixtures/stacApi/index.ts'

import type { StacCollection, StacItem } from '../model/Stac.ts'

/**
 * The fixtures these run against are hand-authored to the structure a STAC API
 * serves, not captured from a live service — see
 * `packages/quac/src/tests/fixtures/stacApi/index.ts` for what that does and does not
 * establish.
 */

describe('item row ids', () => {
  it('round-trips a collection and item id', () => {
    const encoded = encodeItemRowId('imagery', 'scene-aug')
    expect(decodeItemRowId(encoded)).toEqual({ collectionId: 'imagery', itemId: 'scene-aug' })
  })

  it('splits on the last separator, so a collection id containing one survives', () => {
    const encoded = encodeItemRowId('archive/items/imagery', 'scene-aug')
    expect(decodeItemRowId(encoded)).toEqual({ collectionId: 'archive/items/imagery', itemId: 'scene-aug' })
  })

  it('reads a plain collection id as not being an item reference', () => {
    expect(decodeItemRowId('imagery')).toBeNull()
  })
})

describe('buildItemsPageUrl', () => {
  it('asks for a bounded page, newest first', () => {
    const url = new URL(buildItemsPageUrl('https://api.example.com/stac/collections/imagery/items'))
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('sortby')).toBe('-datetime')
  })

  it('leaves parameters the service already put on the href alone', () => {
    const url = new URL(buildItemsPageUrl('https://api.example.com/items?limit=3&sortby=datetime'))
    expect(url.searchParams.get('limit')).toBe('3')
    expect(url.searchParams.get('sortby')).toBe('datetime')
  })
})

describe('sortItemsNewestFirst', () => {
  it('orders by datetime descending, undated last', () => {
    const sorted = sortItemsNewestFirst(itemsPageOne.features as unknown as StacItem[])
    expect(sorted.map((item) => item.id)).toEqual(['scene-aug', 'scene-may', 'scene-mar', 'scene-undated'])
  })

  it('places an item declaring only a range by its start', () => {
    const items = [
      { type: 'Feature', id: 'ranged', properties: { datetime: null, start_datetime: '2026-09-01T00:00:00Z' } },
      { type: 'Feature', id: 'dated', properties: { datetime: '2026-08-01T00:00:00Z' } }
    ] as unknown as StacItem[]
    expect(sortItemsNewestFirst(items).map((item) => item.id)).toEqual(['ranged', 'dated'])
  })

  it('reads no timestamp off an unparseable date', () => {
    const item = { type: 'Feature', id: 'x', properties: { datetime: 'not-a-date' } } as unknown as StacItem
    expect(readItemTimestamp(item)).toBeNull()
  })
})

describe('itemAsCollection', () => {
  const parent = imageryCollection as unknown as StacCollection

  it('carries the item assets onto a Collection the loaders already read', () => {
    const item = itemsPageOne.features[1] as unknown as StacItem
    const collection = itemAsCollection(item, parent)

    expect(collection.type).toBe('Collection')
    expect(collection.id).toBe('imagery/items/scene-aug')
    expect(collection.title).toBe('Coastal scene, August')
    expect(collection.assets?.data?.href).toBe('https://api.example.com/data/scene-aug.tif')
    expect(collection.extent.spatial.bbox).toEqual([[115.1, -31.9, 115.4, -31.6]])
    expect(collection.extent.temporal.interval).toEqual([['2026-08-19T01:00:00Z', '2026-08-19T01:00:00Z']])
  })

  it('inherits the licence from the collection holding it', () => {
    const item = itemsPageOne.features[0] as unknown as StacItem
    expect(itemAsCollection(item, parent).license).toBe('CC-BY-4.0')
  })

  it('falls back to the item id when it declares no title', () => {
    const item = itemsPageOne.features[2] as unknown as StacItem
    expect(itemAsCollection(item, parent).title).toBe('scene-undated')
  })

  it('falls back to the parent extent for an item with no bbox', () => {
    const item = { ...(itemsPageOne.features[0] as unknown as StacItem), bbox: undefined }
    expect(itemAsCollection(item, parent).extent.spatial.bbox).toEqual([[115, -32, 116, -31]])
  })

  it('leaves an undated item undated rather than borrowing the parent range', () => {
    // The parent declares 2026-01-01; showing that against an item that declares
    // nothing would put a date on screen no item ever had.
    const item = itemsPageOne.features[2] as unknown as StacItem
    expect(itemAsCollection(item, parent).extent.temporal.interval).toEqual([[null, null]])
  })
})

describe('buildItemUrl', () => {
  it('keeps the query the service put on its items href', () => {
    expect(buildItemUrl('https://api.example.com/items?key=abc123', 'scene'))
      .toBe('https://api.example.com/items/scene?key=abc123')
  })

  it('escapes an id that would otherwise change the path', () => {
    expect(buildItemUrl('https://api.example.com/items', 'a/b')).toBe('https://api.example.com/items/a%2Fb')
  })
})

describe('readItemsHref', () => {
  it('prefers a JSON rendition over an HTML one listed first', () => {
    const collection = {
      ...(imageryCollection as unknown as StacCollection),
      links: [
        { rel: 'items', href: 'https://api.example.com/items.html', type: 'text/html' },
        { rel: 'items', href: 'https://api.example.com/items', type: 'application/geo+json' }
      ]
    }
    expect(readItemsHref(collection)).toBe('https://api.example.com/items')
  })

  it('finds the items link', () => {
    expect(readItemsHref(imageryCollection as unknown as StacCollection))
      .toBe('https://api.example.com/stac/collections/imagery/items')
  })

  it('returns null for a collection that lists no items', () => {
    const collection = { ...(imageryCollection as unknown as StacCollection), links: [] }
    expect(readItemsHref(collection)).toBeNull()
  })
})
