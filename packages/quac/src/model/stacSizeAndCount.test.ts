import { describe, expect, it } from 'vitest'

import { readCollectionRowCount, readDataAssetFileSize } from './stacSizeAndCount.ts'

import type { StacCollection } from './Stac.ts'

function collection(fields: Record<string, unknown>, dataAsset: Record<string, unknown> = {}): StacCollection {
  return {
    type: 'Collection',
    id: 'roads',
    assets: { data: { href: './roads.parquet', roles: ['data'], ...dataAsset } },
    ...fields
  } as unknown as StacCollection
}

describe('readDataAssetFileSize', () => {
  it('reads the data asset’s file:size', () => {
    expect(readDataAssetFileSize(collection({}, { 'file:size': 1188770 }))).toBe(1188770)
  })

  // Only the file Groundwork downloads counts, not a PMTiles derivative beside it.
  it('ignores a size on an asset other than the data asset', () => {
    const withVisual = collection({}, {})
    withVisual.assets!.visual = { href: './roads.pmtiles', roles: ['visual'], 'file:size': 5 }
    expect(readDataAssetFileSize(withVisual)).toBeNull()
  })

  it.each([0, -1, 1.5, '1000', null, Number.NaN])('reads %s as absent', (size) => {
    expect(readDataAssetFileSize(collection({}, { 'file:size': size }))).toBeNull()
  })
})

describe('readCollectionRowCount', () => {
  it('reads table:row_count, zero included', () => {
    expect(readCollectionRowCount(collection({ 'table:row_count': 1012 }))).toBe(1012)
    expect(readCollectionRowCount(collection({ 'table:row_count': 0 }))).toBe(0)
  })

  it.each([-1, 2.5, '12', null])('reads %s as absent', (count) => {
    expect(readCollectionRowCount(collection({ 'table:row_count': count }))).toBeNull()
  })
})
