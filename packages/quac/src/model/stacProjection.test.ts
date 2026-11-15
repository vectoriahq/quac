import { describe, expect, it } from 'vitest'

import { readCollectionCrs } from './stacProjection.ts'

import type { StacCollection } from './Stac.ts'

function collectionWith(asset: Record<string, unknown>): StacCollection {
  return { assets: { data: { href: './trees.geojson', roles: ['data'], ...asset } } } as unknown as StacCollection
}

describe('readCollectionCrs', () => {
  it('reads the data asset\'s proj:code', () => {
    expect(readCollectionCrs(collectionWith({ 'proj:code': 'EPSG:28355' }))).toBe('EPSG:28355')
  })

  it('is null where the data asset names none, names a blank one, or there is no data asset', () => {
    expect(readCollectionCrs(collectionWith({}))).toBeNull()
    expect(readCollectionCrs(collectionWith({ 'proj:code': '  ' }))).toBeNull()
    expect(readCollectionCrs(collectionWith({ 'proj:code': 28355 }))).toBeNull()
    expect(readCollectionCrs({} as StacCollection)).toBeNull()
  })
})
