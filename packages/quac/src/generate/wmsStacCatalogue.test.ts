import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { generateStacCatalogueFromWms } from './wmsStacCatalogue'
import { collectCatalogueCollections } from '../model/stacTreeWalk'
import { readCollectionWms } from '../model/stacWms'
import { parseGetProjectSettings } from '../parse/parseGetProjectSettings'
import fixtureXml from '../tests/fixtures/qgis/graffiti/graffiti-get-project-settings.xml?raw'

import type { WfsCapabilities } from '../model/wfs'
import type { WmsLayerGroup } from '../model/WmsProject'

const project = parseGetProjectSettings(fixtureXml)

const WFS_ENDPOINT = 'http://qgis.example/wms?map=%2Fprojects%2Fgraffiti.qgs'

/**
 * QGIS Server sanitises the WFS type name ("Graffiti Reports" →
 * "Graffiti_Reports") while copying the WMS title into the WFS Title, which
 * is exactly the mismatch the converter's title matching has to bridge.
 */
const capabilities = {
  version: '2.0.0',
  serviceTitle: 'Graffiti',
  operations: { GetCapabilities: true, DescribeFeatureType: true, GetFeature: true, Transaction: true },
  getFeatureOutputFormats: ['application/json'],
  featureTypes: [{
    name: 'Graffiti_Reports',
    title: 'Graffiti Reports',
    abstract: null,
    keywords: [],
    defaultSrs: 'EPSG:4326',
    otherSrs: [],
    supportedSrs: ['EPSG:4326'],
    wgs84BoundingBox: null,
    operations: null
  }]
} as unknown as WfsCapabilities

describe('generateStacCatalogueFromWms — WFS source options', () => {
  it('emits no quac:wfs_* fields and an empty asset href without options', () => {
    const catalog = generateStacCatalogueFromWms(project)
    const collection = collectCatalogueCollections(catalog)
      .find((entry) => entry.title === 'Graffiti Reports')!
    expect(collection['quac:wfs_endpoint']).toBeUndefined()
    expect(collection['quac:wfs_type_name']).toBeUndefined()
    expect(collection.assets?.data?.href).toBe('')
  })

  it('declares the WFS source structurally when the endpoint and capabilities are given', () => {
    const catalog = generateStacCatalogueFromWms(project, {
      wfsEndpoint: WFS_ENDPOINT,
      wfsCapabilities: capabilities
    })
    const collection = collectCatalogueCollections(catalog)
      .find((entry) => entry.title === 'Graffiti Reports')!
    expect(collection['quac:wfs_endpoint']).toBe(WFS_ENDPOINT)
    // Resolved via the capabilities title match, not the WMS layer name.
    expect(collection['quac:wfs_type_name']).toBe('Graffiti_Reports')
    expect(collection.assets?.data?.href).toContain('REQUEST=GetFeature')
    expect(collection.assets?.data?.href).toContain('TYPENAMES=Graffiti_Reports')
  })

  it('leaves non-WFS-published layers without quac:wfs_* fields', () => {
    const catalog = generateStacCatalogueFromWms(
      { ...project, wfsLayerNames: [] },
      { wfsEndpoint: WFS_ENDPOINT, wfsCapabilities: capabilities }
    )
    for (const collection of collectCatalogueCollections(catalog)) {
      expect(collection['quac:wfs_endpoint']).toBeUndefined()
      expect(collection['quac:wfs_type_name']).toBeUndefined()
    }
  })
})

describe('generateStacCatalogueFromWms — layers published only over WMS', () => {
  const WMS_ENDPOINT = 'http://qgis.example/wms?map=/projects/graffiti.qgs&SERVICE=WMS&REQUEST=GetProjectSettings'

  it('links a layer not published for WFS to GetMap on the project address, with no data asset', () => {
    const catalog = generateStacCatalogueFromWms(
      { ...project, wfsLayerNames: [] },
      { wfsEndpoint: WFS_ENDPOINT, wfsCapabilities: capabilities, wmsEndpoint: WMS_ENDPOINT }
    )
    const collection = collectCatalogueCollections(catalog)
      .find((entry) => entry.title === 'Graffiti Reports')!
    expect(collection.assets).toEqual({})
    expect(collection['table:columns']).toBeUndefined()
    expect(collection['quac:editable']).toBe(false)
    expect(readCollectionWms(collection)).toEqual({
      url: 'http://qgis.example/wms?map=%2Fprojects%2Fgraffiti.qgs',
      layers: ['Graffiti Reports'],
      styles: [''],
      format: 'image/png',
      crs: 'EPSG:3857',
      version: null,
      transparent: true,
      dimensions: {}
    })
  })

  it('keeps a layer published for WFS as a feature layer', () => {
    const catalog = generateStacCatalogueFromWms(project, {
      wfsEndpoint: WFS_ENDPOINT,
      wfsCapabilities: capabilities,
      wmsEndpoint: WMS_ENDPOINT
    })
    const collection = collectCatalogueCollections(catalog)
      .find((entry) => entry.title === 'Graffiti Reports')!
    expect(readCollectionWms(collection)).toBeNull()
    expect(collection['quac:wfs_type_name']).toBe('Graffiti_Reports')
  })
})

describe('collectCatalogueCollections', () => {
  it('collects the fixture tree exactly once per Collection', () => {
    const catalog = generateStacCatalogueFromWms(project)
    const collections = collectCatalogueCollections(catalog)

    const directCount = (catalog.collections ?? []).length
    const groupCount = (catalog.catalogs ?? [])
      .reduce((sum, group) => sum + collectCatalogueCollections(group).length, 0)
    expect(collections).toHaveLength(directCount + groupCount)
    expect(new Set(collections.map((entry) => entry.id)).size).toBe(collections.length)
  })

  it('interleaves group members between top-level Collections, per the child links', () => {
    const catalog = generateStacCatalogueFromWms(parseGetProjectSettings(fixtureXml))
    // Rebuild a synthetic tree: [first, group(inner), last] with the links in
    // that order — the two flat arrays alone cannot express the interleaving.
    const collection = (id: string) => ({
      ...collectCatalogueCollections(catalog)[0]!,
      id,
      title: id,
      links: []
    })
    const group = {
      type: 'Catalog' as const,
      stac_version: '1.1.0' as const,
      id: 'group',
      description: 'group',
      links: [{ rel: 'child', href: './collections/inner.json', type: 'application/json', title: 'inner' }],
      collections: [collection('inner')]
    }
    const root = {
      type: 'Catalog' as const,
      stac_version: '1.1.0' as const,
      id: 'root',
      description: 'root',
      links: [
        { rel: 'child', href: './collections/first.json', type: 'application/json', title: 'first' },
        { rel: 'child', href: './catalogs/group/catalog.json', type: 'application/json', title: 'group' },
        { rel: 'child', href: './collections/last.json', type: 'application/json', title: 'last' }
      ],
      collections: [collection('first'), collection('last')],
      catalogs: [group]
    }

    expect(collectCatalogueCollections(root).map((entry) => entry.id)).toEqual(['first', 'inner', 'last'])
  })

  it('keeps every member of sibling groups whose slugified ids collide', () => {
    const catalog = generateStacCatalogueFromWms(parseGetProjectSettings(fixtureXml))
    const collection = (id: string) => ({
      ...collectCatalogueCollections(catalog)[0]!,
      id,
      title: id,
      links: []
    })
    // Two sibling groups named "Roads" and "roads" both slugify to the same
    // Catalog id. Links and children are in source order, so the two "roads"
    // links must claim the two group objects positionally — neither group's
    // Collections may be dropped.
    const group = (memberId: string) => ({
      type: 'Catalog' as const,
      stac_version: '1.1.0' as const,
      id: 'roads',
      description: 'group',
      links: [{ rel: 'child', href: `./collections/${memberId}.json`, type: 'application/json', title: memberId }],
      collections: [collection(memberId)]
    })
    const root = {
      type: 'Catalog' as const,
      stac_version: '1.1.0' as const,
      id: 'root',
      description: 'root',
      links: [
        { rel: 'child', href: './catalogs/roads/catalog.json', type: 'application/json', title: 'Roads' },
        { rel: 'child', href: './catalogs/roads/catalog.json', type: 'application/json', title: 'roads' }
      ],
      catalogs: [group('highways'), group('laneways')]
    }

    expect(collectCatalogueCollections(root).map((entry) => entry.id)).toEqual(['highways', 'laneways'])
  })
})

describe('generateStacCatalogueFromWms — groups', () => {
  it('marks a mutually exclusive group, and only that one', () => {
    const group = (title: string, mutuallyExclusive: boolean): WmsLayerGroup => ({
      kind: 'group',
      name: title,
      title,
      mutuallyExclusive,
      visibilityChecked: true,
      bbox: null,
      treeName: title,
      children: project.layerTree.filter((node) => node.kind === 'layer')
    })
    const catalog = generateStacCatalogueFromWms({ ...project, layerTree: [group('Basemaps', true), group('Assets', false)] })

    expect(catalog.catalogs?.map((child) => [child.id, child['quac:mutually_exclusive']])).toEqual([
      ['basemaps', true],
      ['assets', undefined]
    ])
  })
})

describe('generateStacCatalogueFromWms — column data types', () => {
  const xml = fixtureXml
    .replace('name="gir_number" type="QString"', 'name="gir_number" type="qlonglong"')
    .replace('typeName="String" editType="TextEdit" precision="0" name="asset_owner" type="QString"', 'typeName="Unsigned" editType="TextEdit" precision="0" name="asset_owner" type="uint"')

  it('writes the STAC data type beside each mapped column type, and none beside an unmapped one', () => {
    const collection = collectCatalogueCollections(generateStacCatalogueFromWms(parseGetProjectSettings(xml)))
      .find((entry) => entry.title === 'Graffiti Reports')!
    const columns = collection['table:columns'] as Array<{ name: string, type?: string, data_type?: string }>
    const byName = Object.fromEntries(columns.map((column) => [column.name, column]))
    expect(byName.incident_uid).toMatchObject({ type: 'string', data_type: 'other' })
    expect(byName.gir_number).toMatchObject({ type: 'long', data_type: 'int64' })
    expect(byName.offensive_flag).toMatchObject({ type: 'boolean', data_type: 'other' })
    expect(byName.asset_owner).toEqual({ name: 'asset_owner', type: 'unsigned' })
  })
})

describe('generateStacCatalogueFromWms — geometry types', () => {
  function geometryTypesFor(wkbName: string): unknown {
    const xml = fixtureXml.replace('geometryType="Point"', `geometryType="${wkbName}"`)
    const collection = collectCatalogueCollections(generateStacCatalogueFromWms(parseGetProjectSettings(xml)))
      .find((entry) => entry.title === 'Graffiti Reports')!
    return collection['vector:geometry_types']
  }

  it('writes the layer\'s WKB type as its GeoJSON geometry type, beside the QGIS name', () => {
    const collection = collectCatalogueCollections(generateStacCatalogueFromWms(project))
      .find((entry) => entry.title === 'Graffiti Reports')!
    expect(collection['vector:geometry_types']).toEqual(['Point'])
    expect(collection.summaries?.['quac:geometry_type']).toEqual(['Point'])
    expect(collection.stac_extensions).toContain('https://stac-extensions.github.io/vector/v0.1.0/schema.json')
  })

  it('drops a Z, M, ZM or 25D suffix', () => {
    expect(geometryTypesFor('MultiPolygonZ')).toEqual(['MultiPolygon'])
    expect(geometryTypesFor('LineStringZM')).toEqual(['LineString'])
    expect(geometryTypesFor('Point25D')).toEqual(['Point'])
  })

  it('writes none for a curved type or a layer with no geometry', () => {
    expect(geometryTypesFor('CompoundCurve')).toBeUndefined()
    expect(geometryTypesFor('NoGeometry')).toBeUndefined()
  })
})

describe('generateStacCatalogueFromWms — the names QGIS Server gives a layer', () => {
  it('writes the WMS layer name, and the WFS type name the WFS capabilities confirm', () => {
    const collection = collectCatalogueCollections(generateStacCatalogueFromWms(project, { wfsEndpoint: WFS_ENDPOINT, wfsCapabilities: capabilities }))
      .find((entry) => entry.title === 'Graffiti Reports')!
    expect(collection['quac:qgis_server_wms_name']).toBe(collection.id)
    expect(collection['quac:qgis_server_wfs_type_name']).toBe('Graffiti_Reports')
  })

  it('writes no WFS type name where nothing confirms one', () => {
    const collection = collectCatalogueCollections(generateStacCatalogueFromWms(project))
      .find((entry) => entry.title === 'Graffiti Reports')!
    expect(collection['quac:qgis_server_wms_name']).toBe(collection.id)
    expect(collection).not.toHaveProperty('quac:qgis_server_wfs_type_name')
  })
})
