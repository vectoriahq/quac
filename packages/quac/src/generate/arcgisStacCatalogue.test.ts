import { describe, expect, it } from 'vitest'

import {
  generateStacCatalogueFromArcgisLayers,
  readArcgisCatalogueItemId,
  readArcgisNotShownReason,
  resolveArcgisCollectionSource
} from './arcgisStacCatalogue.ts'
import { readCollectionScaleRange, readCollectionVisibility } from './normalizedProject.ts'
import { collectCollectionStyles, getDefaultStyle } from '../model/stacStyles.ts'
import { collectCatalogueCollections } from '../model/stacTreeWalk.ts'

import type { ArcgisLayerSet } from '../model/arcgis.ts'

const BOTANICAL = 'https://services3.arcgis.com/x/arcgis/rest/services/BotanicalSignificance/FeatureServer/0'
const VEGETATION = 'https://services3.arcgis.com/x/arcgis/rest/services/VegetationZones/FeatureServer/0'
const WEB_MAP_STYLE = 'https://www.arcgis.com/sharing/rest/content/items/a4b8dfbcaddf4e5a901034b4eca7c792/data?f=json#botanical'

const base = { visible: true, opacity: 1, minScale: null, maxScale: null, layerUrl: null, itemId: null }

const layerSet: ArcgisLayerSet = {
  kind: 'layers',
  title: 'BioLinks',
  itemId: 'a4b8dfbcaddf4e5a901034b4eca7c792',
  itemType: 'Web Map',
  initialView: null,
  summary: null,
  layers: [
    {
      ...base,
      id: 'botanical',
      title: 'Botanical Significance',
      visible: false,
      minScale: 50000,
      status: 'shown',
      source: { layerUrl: BOTANICAL, where: null },
      styleHref: WEB_MAP_STYLE
    },
    {
      ...base,
      id: 'vegetation',
      title: 'Vegetation Zones',
      status: 'shown',
      source: { layerUrl: VEGETATION, where: "Zone = 'Hills'" },
      styleHref: null
    },
    { ...base, id: 'table', title: 'Table', status: 'not-shown', reason: 'not-a-feature-layer' }
  ]
}

describe('generateStacCatalogueFromArcgisLayers', () => {
  it('makes each layer a Collection under its Web Map layer id, in the Web Map\'s order', () => {
    const catalogue = generateStacCatalogueFromArcgisLayers(layerSet)
    const collections = collectCatalogueCollections(catalogue)

    expect(catalogue.title).toBe('BioLinks')
    expect(readArcgisCatalogueItemId(catalogue)).toBe('a4b8dfbcaddf4e5a901034b4eca7c792')
    expect(collections.map((collection) => [collection.id, collection.title]))
      .toEqual([['botanical', 'Botanical Significance'], ['vegetation', 'Vegetation Zones'], ['table', 'Table']])
  })

  it('gives each shown layer its FeatureServer layer and the map\'s filter', () => {
    const [botanical, vegetation] = collectCatalogueCollections(generateStacCatalogueFromArcgisLayers(layerSet))

    expect(resolveArcgisCollectionSource(botanical)).toEqual({ layerUrl: BOTANICAL, where: null })
    expect(resolveArcgisCollectionSource(vegetation)).toEqual({ layerUrl: VEGETATION, where: "Zone = 'Hills'" })
    expect(vegetation.assets?.data.href).toBe(`${VEGETATION}/query?where=Zone+%3D+%27Hills%27&outFields=*&outSR=4326&f=geojson`)
    expect(readArcgisNotShownReason(botanical)).toBeNull()
  })

  it('writes the item\'s dates on the Collection and the data\'s edit time on its data asset', () => {
    const [shown] = layerSet.layers
    if (shown.status !== 'shown') throw new Error('expected a shown layer')
    const catalogue = generateStacCatalogueFromArcgisLayers({
      ...layerSet,
      layers: [{
        ...shown,
        created: '2022-10-23T00:41:20.000Z',
        updated: '2026-08-12T01:24:48.000Z',
        dataUpdated: '2026-08-12T01:24:27.248Z'
      }]
    })
    const [collection] = collectCatalogueCollections(catalogue)

    expect(collection.created).toBe('2022-10-23T00:41:20.000Z')
    expect(collection.updated).toBe('2026-08-12T01:24:48.000Z')
    expect(collection.assets?.data?.updated).toBe('2026-08-12T01:24:27.248Z')
  })

  it('links a layer\'s ArcGIS Online page where it has an item, and its FeatureServer layer where it can be shown', () => {
    const [botanical, vegetation, table] = collectCatalogueCollections(generateStacCatalogueFromArcgisLayers({
      ...layerSet,
      layers: layerSet.layers.map((layer) => layer.id === 'botanical' ? { ...layer, itemId: 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0' } : layer)
    }))
    const pageLinks = (collection: typeof botanical) =>
      collection.links.filter((link) => link.rel === 'about' || link.rel === 'via').map(({ rel, href, title }) => ({ rel, href, title }))

    expect(pageLinks(botanical)).toEqual([
      { rel: 'about', href: 'https://www.arcgis.com/home/item.html?id=b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0', title: 'ArcGIS Online page' },
      { rel: 'via', href: BOTANICAL, title: 'Service description (technical)' }
    ])
    expect(pageLinks(vegetation)).toEqual([{ rel: 'via', href: VEGETATION, title: 'Service description (technical)' }])
    expect(pageLinks(table)).toEqual([])
  })

  it('carries the Web Map\'s visibility and scale limits', () => {
    const [botanical, vegetation] = collectCatalogueCollections(generateStacCatalogueFromArcgisLayers(layerSet))

    expect(readCollectionVisibility(botanical)).toBe(false)
    expect(readCollectionVisibility(vegetation)).toBe(true)
    expect(readCollectionScaleRange(botanical)).toEqual({ minScale: 50000, maxScale: null })
    expect(readCollectionScaleRange(vegetation)).toBeNull()
  })

  it('declares a layer\'s ArcGIS style as its default style, and none where it has none', () => {
    const [botanical, vegetation, table] = collectCatalogueCollections(generateStacCatalogueFromArcgisLayers(layerSet))

    expect(getDefaultStyle(collectCollectionStyles(botanical))).toEqual({
      name: 'default',
      href: WEB_MAP_STYLE,
      type: 'application/json',
      isDefault: true
    })
    expect(collectCollectionStyles(vegetation)).toEqual([])
    expect(collectCollectionStyles(table)).toEqual([])
  })

  it('lists a layer that can\'t be shown with its reason and nothing to load', () => {
    const table = collectCatalogueCollections(generateStacCatalogueFromArcgisLayers(layerSet))[2]

    expect(readArcgisNotShownReason(table)).toBe('not-a-feature-layer')
    expect(resolveArcgisCollectionSource(table)).toBeNull()
    expect(table.assets?.data).toBeUndefined()
  })

  it('emits only the requested layers, in the order asked', () => {
    const catalogue = generateStacCatalogueFromArcgisLayers(layerSet, { layerIds: ['vegetation', 'gone', 'botanical'] })
    expect(collectCatalogueCollections(catalogue).map((collection) => collection.id)).toEqual(['vegetation', 'botanical'])
  })

  it('records no item for a FeatureServer that reports none', () => {
    const catalogue = generateStacCatalogueFromArcgisLayers({ ...layerSet, itemId: null, itemType: 'Feature Service' })
    expect(readArcgisCatalogueItemId(catalogue)).toBeNull()
  })
})

describe('generateStacCatalogueFromArcgisLayers — geometry types', () => {
  function collectionWithGeometry(geometryType: string): Record<string, unknown> {
    const set: ArcgisLayerSet = {
      ...layerSet,
      layers: [{ ...base, id: 'g', title: 'G', status: 'shown', source: { layerUrl: BOTANICAL, where: null }, styleHref: null, geometryType }]
    }
    return collectCatalogueCollections(generateStacCatalogueFromArcgisLayers(set))[0]! as unknown as Record<string, unknown>
  }

  it('writes the GeoJSON geometry type of a point or multipoint layer, with the Vector extension', () => {
    expect(collectionWithGeometry('esriGeometryPoint')['vector:geometry_types']).toEqual(['Point'])
    const multipoint = collectionWithGeometry('esriGeometryMultipoint')
    expect(multipoint['vector:geometry_types']).toEqual(['MultiPoint'])
    expect(multipoint.stac_extensions).toContain('https://stac-extensions.github.io/vector/v0.1.0/schema.json')
  })

  it('writes none for a polyline or polygon layer, whose features may be single or multi', () => {
    for (const type of ['esriGeometryPolyline', 'esriGeometryPolygon']) {
      const collection = collectionWithGeometry(type)
      expect(collection).not.toHaveProperty('vector:geometry_types')
      expect(collection.stac_extensions ?? []).not.toContain('https://stac-extensions.github.io/vector/v0.1.0/schema.json')
    }
  })
})
