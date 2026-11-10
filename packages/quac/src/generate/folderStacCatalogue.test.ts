import { describe, expect, it } from 'vitest'

import { generateStacCatalogueFromFolder } from './folderStacCatalogue.ts'
import { collectCollectionStyles } from '../model/stacStyles.ts'

import type { FolderCatalogueFile } from './folderStacCatalogue.ts'

function file(overrides: Partial<FolderCatalogueFile> = {}): FolderCatalogueFile {
  return {
    relPath: 'roads.geojson',
    name: 'roads.geojson',
    layerName: 'roads',
    mediaType: 'application/geo+json',
    styleRelPath: null,
    size: null,
    ...overrides
  }
}

const OPTIONS = { folderName: 'Coastal Survey 2026' }

describe('generateStacCatalogueFromFolder', () => {
  it('makes one Collection per file, identified by its path in the folder', () => {
    const catalogue = generateStacCatalogueFromFolder(
      [file(), file({ relPath: 'sites.geojson', name: 'sites.geojson', layerName: 'sites' })],
      OPTIONS
    )

    expect(catalogue.collections?.map((c) => c.id)).toEqual(['roads.geojson', 'sites.geojson'])
    expect(catalogue.collections?.map((c) => c.title)).toEqual(['roads', 'sites'])
    expect(catalogue.title).toBe('Coastal Survey 2026')
  })

  // The listing says nothing about either, and opening every file to find out
  // would be paid on every visit. Both are read as the layer loads.
  it('declares no extent and no field schema', () => {
    const [collection] = generateStacCatalogueFromFolder([file()], OPTIONS).collections ?? []

    expect(collection?.extent.spatial.bbox).toEqual([[-180, -90, 180, 90]])
    expect(collection?.['table:columns']).toBeUndefined()
  })

  it('declares the size the listing gives on the data asset', () => {
    const [sized, unsized] = generateStacCatalogueFromFolder(
      [file({ size: 2048 }), file({ relPath: 'sites.geojson', name: 'sites.geojson', layerName: 'sites' })],
      OPTIONS
    ).collections ?? []

    expect(sized?.assets?.data?.['file:size']).toBe(2048)
    expect(sized?.stac_extensions).toContain('https://stac-extensions.github.io/file/v2.1.0/schema.json')
    expect(unsized?.assets?.data).not.toHaveProperty('file:size')
    expect(unsized?.stac_extensions).toBeUndefined()
  })

  // A folder has no author, so author intent is left off rather than invented —
  // which is why a folder catalogue's layers are editable.
  it('omits shared presentation declarations', () => {
    const [collection] = generateStacCatalogueFromFolder([file()], OPTIONS).collections ?? []

    expect(collection?.['quac:editable']).toBeUndefined()
    expect(collection?.['quac:display_field']).toBeUndefined()
  })

  it('points the data asset at the file, with a type the loader classifies on', () => {
    const [collection] = generateStacCatalogueFromFolder([file()], OPTIONS).collections ?? []

    expect(collection?.assets?.data).toMatchObject({
      href: './roads.geojson',
      type: 'application/geo+json',
      roles: ['data']
    })
  })

  it('declares a sibling style rather than carrying it, keyed by the style\'s name', () => {
    const [collection] = generateStacCatalogueFromFolder(
      [file({ styleRelPath: 'roads.qml' })],
      OPTIONS
    ).collections ?? []

    expect(collection?.assets?.roads).toMatchObject({
      href: './roads.qml',
      type: 'application/x-qgis-qml+xml',
      title: 'roads',
      // The folder has one style per layer, so it is that layer's default.
      roles: ['style', 'default']
    })
  })

  // An href is a URI reference, so a file name holding a character URIs reserve
  // is escaped in it. The Collection's id is the plain path, since that is a
  // name rather than an address.
  it('escapes a file name that holds a character URIs reserve', () => {
    const [collection] = generateStacCatalogueFromFolder(
      [file({
        relPath: 'Building #3.geojson',
        name: 'Building #3.geojson',
        layerName: 'Building #3',
        styleRelPath: 'Building #3.qml'
      })],
      OPTIONS
    ).collections ?? []

    expect(collection?.id).toBe('Building #3.geojson')
    expect(collection?.assets?.data?.href).toBe('./Building%20%233.geojson')
    expect(collection?.assets?.['Building #3']?.href).toBe('./Building%20%233.qml')
  })

  it('keeps the data asset when the style file is named after it', () => {
    const [collection] = generateStacCatalogueFromFolder(
      [file({
        relPath: 'data.geojson',
        name: 'data.geojson',
        layerName: 'data',
        styleRelPath: 'data.qml'
      })],
      OPTIONS
    ).collections ?? []

    // The layer still has somewhere to load from, and the style is still
    // declared under its own name.
    expect(collection?.assets?.data).toMatchObject({
      href: './data.geojson',
      roles: ['data']
    })
    expect(collectCollectionStyles(collection!).map((style) => style.name)).toEqual(['data'])
  })

  it('omits the style asset when the folder holds none for that layer', () => {
    const [collection] = generateStacCatalogueFromFolder([file()], OPTIONS).collections ?? []

    expect(collection?.assets?.style).toBeUndefined()
  })

  // For a folder catalogue there is no project file to say where the layers came
  // from, so the folder's own link is the only thing that identifies the source.
  it('records the published folder’s link as the Catalog’s self link', () => {
    const catalogue = generateStacCatalogueFromFolder([file()], {
      ...OPTIONS,
      selfHref: 'https://www.dropbox.com/scl/fo/abc?rlkey=k'
    })

    expect(catalogue.links.filter((l) => l.rel === 'self')).toEqual([
      { rel: 'self', href: 'https://www.dropbox.com/scl/fo/abc?rlkey=k', type: 'application/json' }
    ])
  })

  it('produces a usable Catalog for a folder with no readable files', () => {
    const catalogue = generateStacCatalogueFromFolder([], OPTIONS)

    expect(catalogue.type).toBe('Catalog')
    expect(catalogue.collections ?? []).toEqual([])
  })
})
