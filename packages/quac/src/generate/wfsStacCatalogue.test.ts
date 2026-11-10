import { describe, expect, it } from 'vitest'

import { TABLE_EXTENSION } from './normalizedProject.ts'
import { generateStacCatalogueFromWfsCapabilities } from './wfsStacCatalogue.ts'
import capabilitiesJson from '../tests/fixtures/wfs/two-feature-types-capabilities.json?raw'

import type { WfsCapabilities } from '../model/wfs.ts'

const ENDPOINT = 'https://example.org/geoserver/wfs'

/**
 * Two feature types so the catalogue's union bbox and the pinned-name filter
 * are exercised against a real GetCapabilities parse rather than a
 * hand-built object. The
 * parse is saved as JSON; `src/tests/wfsCapabilitiesFixture.test.ts` checks that
 * Groundwork's parser still produces it from the capabilities document.
 */
const capabilities = JSON.parse(capabilitiesJson) as WfsCapabilities

describe('generateStacCatalogueFromWfsCapabilities', () => {
  const catalog = generateStacCatalogueFromWfsCapabilities(ENDPOINT, capabilities)

  it('emits a STAC Catalog titled after the service', () => {
    expect(catalog.type).toBe('Catalog')
    expect(catalog.stac_version).toBe('1.1.0')
    expect(catalog.id).toBe('city-open-data')
    expect(catalog.title).toBe('City Open Data')
    expect(catalog.links.some((link) => link.rel === 'self')).toBe(true)
    expect(catalog.links.some((link) => link.rel === 'root')).toBe(true)
  })

  it('declares the service on the Catalog in quac:wfs_* fields', () => {
    expect(catalog['quac:wfs_endpoint']).toBe(ENDPOINT)
    expect(catalog['quac:wfs_version']).toBe('2.0.0')
    expect(catalog['quac:wfs_output_formats']).toEqual([
      'application/json',
      'text/xml; subtype=gml/3.2'
    ])
  })

  it('emits one flat Collection per published feature type', () => {
    expect(catalog.catalogs).toBeUndefined()
    expect(catalog.collections).toHaveLength(2)
    expect(catalog.collections!.map((collection) => collection.id))
      .toEqual(['city:street_lights', 'city:parks'])
    expect(catalog.collections!.map((collection) => collection.title))
      .toEqual(['Street lights', 'Parks'])
  })

  it('declares the endpoint and feature type structurally on each Collection', () => {
    const collection = catalog.collections!.find((entry) => entry.id === 'city:street_lights')!
    expect(collection['quac:wfs_endpoint']).toBe(ENDPOINT)
    expect(collection['quac:wfs_type_name']).toBe('city:street_lights')
    expect(collection['quac:wfs_default_srs']).toBe('EPSG:4326')
    expect(collection['quac:wfs_supported_srs']).toEqual(['EPSG:4326', 'EPSG:3857'])
    expect(collection['quac:wfs_operations']).toEqual({
      Query: true,
      Insert: true,
      Update: true,
      Delete: false
    })
  })

  it('omits quac:wfs_operations when the service says nothing about the type', () => {
    const silent: WfsCapabilities = {
      ...capabilities,
      featureTypes: capabilities.featureTypes.map((type) => ({ ...type, operations: null }))
    }
    const collection = generateStacCatalogueFromWfsCapabilities(ENDPOINT, silent).collections!
      .find((entry) => entry.id === 'city:parks')!
    expect(collection['quac:wfs_operations']).toBeUndefined()
  })

  it('emits a resolvable GetFeature URL as the data asset', () => {
    const collection = catalog.collections!.find((entry) => entry.id === 'city:street_lights')!
    const href = collection.assets!.data.href
    expect(href).toContain(`${ENDPOINT}?`)
    expect(href).toContain('SERVICE=WFS')
    expect(href).toContain('REQUEST=GetFeature')
    expect(href).toContain('TYPENAMES=city%3Astreet_lights')
    expect(collection.assets!.data.type).toBe('application/geo+json')
    expect(collection.assets!.data.roles).toContain('data')
  })

  it('uses the advertised abstract as the description, and falls back to the endpoint', () => {
    const withAbstract = catalog.collections!.find((entry) => entry.id === 'city:street_lights')!
    expect(withAbstract.description).toBe('Council-maintained street lighting assets.')

    const withoutAbstract = catalog.collections!.find((entry) => entry.id === 'city:parks')!
    expect(withoutAbstract.description).toBe('Layer "Parks" from a map server.')
  })

  it('carries the advertised keywords onto the Collection', () => {
    const collection = catalog.collections!.find((entry) => entry.id === 'city:street_lights')!
    expect(collection['keywords']).toEqual(['lighting', 'assets'])
    expect(catalog.collections!.find((entry) => entry.id === 'city:parks')!['keywords']).toBeUndefined()
  })

  it('states no author intent, because a WFS service declares none', () => {
    for (const collection of catalog.collections!) {
      expect(collection['quac:display_field']).toBeUndefined()
      expect(collection['quac:editable']).toBeUndefined()
    }
  })

  it('emits the advertised WGS84 box per Collection and their union on the Catalog', () => {
    const streetLights = catalog.collections!.find((entry) => entry.id === 'city:street_lights')!
    expect(streetLights.extent.spatial.bbox).toEqual([[115.75, -32.1, 115.95, -31.9]])

    const catalogExtent = catalog.extent as { spatial: { bbox: number[][] } }
    expect(catalogExtent.spatial.bbox).toEqual([[115.6, -32.2, 116, -31.9]])
  })

  it('emits the open temporal interval, which STAC requires on every Collection', () => {
    for (const collection of catalog.collections!) {
      expect(collection.extent.temporal).toEqual({ interval: [[null, null]] })
    }
  })

  it('omits table:columns — field schemas come from DescribeFeatureType at load time', () => {
    for (const collection of catalog.collections!) {
      expect(collection['table:columns']).toBeUndefined()
      expect(collection.stac_extensions ?? []).not.toContain(TABLE_EXTENSION)
    }
  })

  it('emits only the named feature types, in the order given', () => {
    const pinned = generateStacCatalogueFromWfsCapabilities(ENDPOINT, capabilities, {
      typeNames: ['city:parks', 'city:street_lights', 'city:not_published']
    })
    expect(pinned.collections!.map((collection) => collection.id))
      .toEqual(['city:parks', 'city:street_lights'])
  })

  it('appends the GetFeature query to an endpoint that already carries one', () => {
    const catalogWithQuery = generateStacCatalogueFromWfsCapabilities(
      'https://example.org/qgis?map=/projects/city.qgs',
      capabilities
    )
    expect(catalogWithQuery.collections![0]!.assets!.data.href)
      .toContain('/qgis?map=/projects/city.qgs&SERVICE=WFS')
  })

  it('falls back to a generic id and description when the service declares no title', () => {
    const untitled = generateStacCatalogueFromWfsCapabilities(
      ENDPOINT,
      { ...capabilities, serviceTitle: null }
    )
    expect(untitled.id).toBe('wfs-service')
    expect(untitled.title).toBeUndefined()
    expect(untitled.description).toBe('STAC catalogue generated from a WFS GetCapabilities response.')
  })
})
