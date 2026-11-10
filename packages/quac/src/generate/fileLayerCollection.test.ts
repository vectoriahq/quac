import { describe, expect, it } from 'vitest'

import { generateCollectionForDroppedFile, generateCollectionForLinkedFile } from './fileLayerCollection.ts'

const OPTIONS = {
  collectionId: 'roads.geojson',
  relativePath: 'roads.geojson',
  uploadedAt: '2026-10-21T04:14:00.000Z'
}

describe('generateCollectionForDroppedFile', () => {
  it('names the file and its media type in a data asset', () => {
    const collection = generateCollectionForDroppedFile(OPTIONS)

    expect(collection.id).toBe('roads.geojson')
    expect(collection.title).toBeUndefined()
    expect(collection.assets?.data).toEqual({
      href: './roads.geojson',
      type: 'application/geo+json',
      title: 'roads.geojson',
      roles: ['data']
    })
  })

  it('records the drop time as created, and declares no extent', () => {
    const collection = generateCollectionForDroppedFile(OPTIONS)

    expect(collection['created']).toBe('2026-10-21T04:14:00.000Z')
    expect(collection.extent.spatial.bbox).toEqual([[-180, -90, 180, 90]])
  })

  it('keeps the folder a file was dropped in, escaped, and titles the asset with the file name', () => {
    const collection = generateCollectionForDroppedFile({
      ...OPTIONS,
      collectionId: 'north/building #3.fgb',
      relativePath: 'north/Building #3.fgb'
    })

    expect(collection.assets?.data).toMatchObject({
      href: './north/Building%20%233.fgb',
      type: 'application/vnd.flatgeobuf',
      title: 'Building #3.fgb'
    })
  })

  it('names the table of a GeoPackage it reads', () => {
    const collection = generateCollectionForDroppedFile({
      ...OPTIONS,
      collectionId: 'assets.gpkg|layername=sites',
      relativePath: 'assets.gpkg',
      layerName: 'sites'
    })

    expect(collection.assets?.data).toMatchObject({
      href: './assets.gpkg',
      type: 'application/geopackage+sqlite3',
      'quac:layer_name': 'sites'
    })
  })
})

describe('generateCollectionForLinkedFile', () => {
  const LINKED = {
    collectionId: 'roads.geojson',
    url: 'https://data.test/files/roads.geojson?v=2',
    filename: 'roads.geojson',
    loadedAt: '2026-10-21T04:14:00.000Z'
  }

  it('names the link as the data asset, read as GeoJSON', () => {
    const collection = generateCollectionForLinkedFile(LINKED)

    expect(collection.id).toBe('roads.geojson')
    expect(collection.title).toBeUndefined()
    expect(collection.assets?.data).toEqual({
      href: 'https://data.test/files/roads.geojson?v=2',
      type: 'application/geo+json',
      title: 'roads.geojson',
      roles: ['data']
    })
    expect(collection['created']).toBe('2026-10-21T04:14:00.000Z')
  })

  it('reads a link whose file name has no extension as GeoJSON', () => {
    const collection = generateCollectionForLinkedFile({ ...LINKED, filename: 'collections', url: 'https://data.test/api/collections' })

    expect(collection.assets?.data?.type).toBe('application/geo+json')
  })
})

