import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { QUAC_ACTIVE_COLLECTION_FIELD, QUAC_FILTERS_FIELD, QUAC_LOCKS_FIELD, readCatalogueActiveCollection, readCollectionFilters, readCollectionLocks, readCatalogueInitialView, readCollectionFieldAliases, readCollectionOpacity } from './normalizedProject.ts'
import { generateStacCatalogue, parseQgisStyleAssetHref, QUAC_GEOMETRY_FILTER, readCollectionGeometryFilter } from './stacCatalogue.ts'
import { QUAC_DELIMITED_TEXT, readCollectionDelimitedText } from '../model/delimitedText.ts'
import { QUAC_FEATURE_FILTER, readCollectionFeatureFilter } from '../model/featureFilter.ts'
import { readCollectionDataPath } from '../model/stacHref.ts'
import { collectCollectionStyles, getDefaultStyle } from '../model/stacStyles.ts'
import { collectCatalogueCollections } from '../model/stacTreeWalk.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'
import annotationsXml from '../tests/fixtures/qgis/geometry-sublayers/annotations.qgs?raw'
import graffitiGeoJson from '../tests/fixtures/qgis/graffiti/graffiti.json?raw'
import fixtureXml from '../tests/fixtures/qgis/graffiti/graffiti.qgs?raw'
import treesXml from '../tests/fixtures/qgis/related-datasets/street-trees.qgs?raw'
import { annotationsProjectWith } from '../tests/geometrySublayersFixture.ts'

import type { LayerEntry, QgsProject } from '../model/QgsProject.ts'
import type { StacCollection, TableColumn } from '../model/Stac.ts'
import type { FeatureCollection } from 'geojson'

const project = parseQgsXml(fixtureXml)
const geojson = JSON.parse(graffitiGeoJson) as FeatureCollection
const graffitiLayer = project.layers.find((l) => l.name === 'Graffiti Reports')!
const schoolsLayer = project.layers.find((l) => l.name === 'Schools')!

describe('generateStacCatalogue — graffiti fixture', () => {
  // Only the file-backed layer has a companion GeoJSON; the WFS layer doesn't.
  const catalog = generateStacCatalogue(project, [{ layerId: graffitiLayer.id, geojson }])

  it('emits a STAC Catalog with the expected core fields', () => {
    expect(catalog.type).toBe('Catalog')
    expect(catalog.stac_version).toBe('1.1.0')
    expect(catalog.links.some((l) => l.rel === 'self')).toBe(true)
    expect(catalog.links.some((l) => l.rel === 'root')).toBe(true)
  })

  it('emits one Collection per layer (flat tree, no groups)', () => {
    expect(catalog.collections).toHaveLength(2)
    expect(catalog.catalogs).toBeUndefined()
    const titles = catalog.collections!.map((c) => c.title)
    expect(titles).toEqual(['Graffiti Reports', 'Schools'])
  })

  it('uses the WGS84 extent on the Graffiti Collection bbox', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    const bbox = collection.extent.spatial.bbox[0]
    expect(bbox).toHaveLength(4)
    // Perth metro area
    expect(bbox[0]).toBeCloseTo(115.75, 1)
    expect(bbox[2]).toBeCloseTo(115.95, 1)
  })

  it('emits the open temporal interval STAC requires, since QGIS declares no temporal range', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    expect(collection.extent.temporal).toEqual({ interval: [[null, null]] })
    const catExtent = catalog.extent as { temporal?: unknown } | undefined
    expect(catExtent?.temporal).toEqual({ interval: [[null, null]] })
  })

  it('uses the union of the layers for the Catalog spatial bbox, not the map canvas', () => {
    const catExtent = catalog.extent as { spatial: { bbox: number[][] } }
    const bbox = catExtent.spatial.bbox[0]!
    const layerXmins = project.layers.map((layer) => (layer.wgs84Extent ?? layer.extent)!.xmin)
    expect(bbox[0]).toBeCloseTo(Math.min(...layerXmins), 5)
    // The canvas sits outside that union, so the two cannot be confused.
    expect(bbox[0]).not.toBeCloseTo(project.mapExtent!.xmin, 5)
  })

  it('publishes the map canvas extent as quac:initial_view when the caller converts one', () => {
    const framed = generateStacCatalogue(project, [], {
      initialView: { xmin: 115.74, ymin: -32.21, xmax: 115.96, ymax: -31.79 }
    })
    expect(framed['quac:initial_view']).toEqual([115.74, -32.21, 115.96, -31.79])
    expect(readCatalogueInitialView(framed)).toEqual({
      xmin: 115.74, ymin: -32.21, xmax: 115.96, ymax: -31.79
    })
  })

  describe('the opening layer QFieldSync names', () => {
    // Into the project's `<properties>`, or a new one where the fixture has none.
    const withInitialActiveLayer = (xml: string, layerId: string) => {
      const block = `<qfieldsync>\n      <initialActiveLayer type="QString">${layerId}</initialActiveLayer>\n    </qfieldsync>`
      return xml.includes('<properties>')
        ? xml.replace('<properties>', `<properties>\n    ${block}`)
        : xml.replace('</qgis>', `  <properties>\n    ${block}\n  </properties>\n</qgis>`)
    }

    it('names the Collection made from it on the Catalog', () => {
      const named = generateStacCatalogue(parseQgsXml(withInitialActiveLayer(fixtureXml, schoolsLayer.id)))
      expect(named[QUAC_ACTIVE_COLLECTION_FIELD]).toBe(schoolsLayer.id)
      expect(readCatalogueActiveCollection(named)).toBe(schoolsLayer.id)
    })

    it('names nothing where QFieldSync saved the key blank, or names no layer of the project', () => {
      for (const layerId of ['', 'not_a_layer_of_this_project']) {
        const catalogue = generateStacCatalogue(parseQgsXml(withInitialActiveLayer(fixtureXml, layerId)))
        expect(catalogue).not.toHaveProperty(QUAC_ACTIVE_COLLECTION_FIELD)
        expect(readCatalogueActiveCollection(catalogue)).toBeNull()
      }
      expect(readCatalogueActiveCollection(catalog)).toBeNull()
    })

    it('names the first sibling\'s Collection for a layer QGIS split by shape', () => {
      const named = generateStacCatalogue(parseQgsXml(withInitialActiveLayer(annotationsXml, 'annotations_polygon_2d8e4b3a_af6c_4a9d_9e53_7b4c9fa03d03')))
      expect(readCatalogueActiveCollection(named)).toBe('annotations_point_0b6c2f1e_8d4a_4e7b_9c31_5f2a7d8e1b01')
    })
  })

  it('omits quac:initial_view when no converted canvas extent is supplied', () => {
    expect(catalog['quac:initial_view']).toBeUndefined()
    expect(readCatalogueInitialView(catalog)).toBeNull()
  })


  it('emits a data asset pointing at the GeoJSON file for the Graffiti Collection', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    expect(collection.assets).toBeDefined()
    expect(collection.assets!.data.href).toBe('./graffiti.json')
    expect(collection.assets!.data.type).toBe('application/geo+json')
    expect(collection.assets!.data.roles).toContain('data')
  })

  it('emits a WFS GetFeature URL as the data asset href for the Schools Collection', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Schools')!
    expect(collection.assets).toBeDefined()
    const href = collection.assets!.data.href
    expect(href).toContain(schoolsLayer.dataSource.kind === 'wfs' ? schoolsLayer.dataSource.url : '')
    expect(href).toContain('SERVICE=WFS')
    expect(href).toContain('REQUEST=GetFeature')
    expect(collection.assets!.data.type).toBe('application/geo+json')
  })

  it('declares the WFS endpoint and feature type structurally, not only inside the asset href', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Schools')!
    const dataSource = schoolsLayer.dataSource
    expect(dataSource.kind).toBe('wfs')
    if (dataSource.kind !== 'wfs') return
    expect(collection['quac:wfs_endpoint']).toBe(dataSource.url)
    expect(collection['quac:wfs_type_name']).toBe(dataSource.typeName)
  })

  it('leaves the quac:wfs_* fields off a file-backed Collection', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    expect(collection['quac:wfs_endpoint']).toBeUndefined()
    expect(collection['quac:wfs_type_name']).toBeUndefined()
  })

  it('declares the Table extension and emits table:columns from the GeoJSON properties', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    expect(collection.stac_extensions).toContain(
      'https://stac-extensions.github.io/table/v1.3.0/schema.json'
    )
    const columns = collection['table:columns'] as Array<{ name: string, type?: string, title?: string }>
    expect(columns.length).toBeGreaterThan(0)
    // Sanity: real graffiti GeoJSON has these fields
    const names = columns.map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['priority_status', 'asset_owner']))
  })

  it('populates the column title from QGIS field aliases', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    const columns = collection['table:columns'] as Array<{ name: string, title?: string }>
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]))
    expect(byName.priority_status?.title).toBe('Priority Status')
    expect(byName.asset_owner?.title).toBe('Asset Owner')
    expect(byName.incident_uid?.title).toBe('Incident UID')
  })

  it('reads field aliases back from Collection column titles', () => {
    const collection = {
      'table:columns': [
        { name: 'width_metres', title: 'Width (m)' },
        { name: 'area_hectares', description: 'Area (ha)' },
        { name: 'surface_type', title: 'Surface', description: 'Surface material' },
        { name: 'status' },
        { name: 'empty_alias', title: ' ' }
      ]
    } as unknown as StacCollection

    expect(readCollectionFieldAliases(collection)).toEqual({
      width_metres: 'Width (m)',
      area_hectares: 'Area (ha)',
      surface_type: 'Surface'
    })
  })

  it('emits table:columns from QGIS fieldConfiguration even before the WFS data is loaded', () => {
    const collection = catalog.collections!.find((c) => c.title === 'Schools')!
    expect(collection.stac_extensions).toContain(
      'https://stac-extensions.github.io/table/v1.3.0/schema.json'
    )
    const columns = collection['table:columns'] as Array<{ name: string, title?: string, type?: string }>
    // All 20 declared fields show up — schema is fully visible without data
    expect(columns.length).toBe(20)
    const names = columns.map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'objectid', 'code', 'schoolname', 'postaladdr', 'town', 'postcode'
    ]))
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]))
    // The one field with an explicit alias gets a title
    expect(byName.postaladdr?.title).toBe('postal_address')
    // Empty aliases on other fields → no title set (display defaults to field name)
    expect(byName.objectid?.title).toBeUndefined()
    // Without a GeoJSON we can't infer types — the fields are still listed
    expect(byName.postaladdr?.type).toBeUndefined()
  })

  it('attaches a project-level extent for dev-panel inspection', () => {
    expect(catalog.extent).toBeDefined()
  })

  it('surfaces shared per-layer settings and geometry metadata', () => {
    const graffiti = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    expect(graffiti['quac:display_field']).toBe('location_description')
    expect(graffiti['quac:editable']).toBe(true)
    const summaries = graffiti.summaries as Record<string, unknown> | undefined
    expect(summaries?.['quac:geometry_type']).toEqual(['Point'])
  })

  it('states each layer\'s opacity, and carries no qgis: queryable or opacity field', () => {
    // QGIS's queryable flag is published as `quac:identifiable`.
    for (const collection of catalog.collections!) {
      expect(readCollectionOpacity(collection)).toBe(1)
      expect(collection['qgis:queryable']).toBeUndefined()
      expect(collection['qgis:opacity']).toBeUndefined()
    }
  })

  it('writes the opacity a layer holds, and states nothing for a layer at 0', () => {
    const layer = (opacity: number) => ({ ...project.layers[0]!, opacity })
    const collectionFor = (opacity: number) => generateStacCatalogue({ ...project, layers: [layer(opacity)] }).collections![0]!
    expect(collectionFor(0.4)['quac:opacity']).toBe(0.4)
    expect(readCollectionOpacity(collectionFor(0.4))).toBe(0.4)
    expect(readCollectionOpacity(collectionFor(0))).toBeNull()
  })

  it('states each layer tree tick, which is what decides the layer starts on', () => {
    const graffiti = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!
    const schools = catalog.collections!.find((c) => c.title === 'Schools')!

    expect(graffiti['quac:visibility_checked']).toBe(graffitiLayer.isVisible)
    expect(schools['quac:visibility_checked']).toBe(schoolsLayer.isVisible)
  })

  it('declares each named style as a style asset addressing into the project', () => {
    const addressed = generateStacCatalogue(project, [], { projectPath: 'graffiti.qgs' })
    const graffiti = addressed.collections!.find((c) => c.title === 'Graffiti Reports')!

    expect(graffiti.assets!['Asset Owner']).toMatchObject({
      href: `./graffiti.qgs#${encodeURIComponent(graffitiLayer.id)}/Asset%20Owner`,
      type: 'application/x-qgis-qml+xml',
      title: 'Asset Owner',
      // The active style, so it is the one the Collection nominates.
      roles: ['style', 'default']
    })
    expect(graffiti.assets!.Priority).toMatchObject({ roles: ['style'] })
    // The data asset is untouched by the style set.
    expect(graffiti.assets!.data.roles).toEqual(['data'])
  })

  it('leaves the address a bare fragment when the caller does not know the project file', () => {
    const graffiti = catalog.collections!.find((c) => c.title === 'Graffiti Reports')!

    expect(graffiti.assets!['Asset Owner'].href).toBe(
      `#${encodeURIComponent(graffitiLayer.id)}/Asset%20Owner`
    )
  })
})

describe('generateStacCatalogue — editing locks', () => {
  const locksOf = (xml: string, layerId: string) => {
    const collection = collectCatalogueCollections(generateStacCatalogue(parseQgsXml(xml))).find((c) => c.id === layerId)!
    return { written: collection[QUAC_LOCKS_FIELD], read: readCollectionLocks(collection) }
  }
  // QFieldSync's custom properties, into the graffiti layer's own block, which follows its selection symbol.
  const withQfieldSync = (options: Record<string, string>) => fixtureXml.replace(
    '      </selection>\n      <customproperties>\n        <Option type="Map">',
    `      </selection>\n      <customproperties>\n        <Option type="Map">${
      Object.entries(options).map(([name, value]) => `<Option type="QString" name="QFieldSync/${name}" value="${value.replaceAll('"', '&quot;')}"/>`).join('')
    }`
  )

  it('locks the operations a published layer does not take, and all of them on one that takes none', () => {
    expect(locksOf(fixtureXml, graffitiLayer.id).read).toEqual({ delete: true })
    expect(locksOf(fixtureXml, schoolsLayer.id).read).toEqual({ add: true, attributes: true, geometry: true, delete: true })
  })

  it('locks nothing on a layer the project does not publish', () => {
    const unpublished = fixtureXml.replace(/<WFSLayers type="QStringList">[\s\S]*?<\/WFSLayers>/, '<WFSLayers type="QStringList"/>')
    expect(locksOf(unpublished, graffitiLayer.id).written).toBeUndefined()
    expect(locksOf(unpublished, graffitiLayer.id).read).toEqual({})
  })

  it('adds QFieldSync\'s locks, where a lock from either source wins over an expression', () => {
    const xml = withQfieldSync({
      is_feature_addition_locked: 'true',
      is_attribute_editing_locked_expression_active: 'true',
      attribute_editing_locked_expression: '"status" = \'removed\'',
      is_feature_deletion_locked_expression_active: 'true',
      feature_deletion_locked_expression: '"status" = \'open\''
    })
    expect(locksOf(xml, graffitiLayer.id).written).toEqual({
      delete: true,
      add: true,
      attributes: { expression: '"status" = \'removed\'' }
    })
  })
})

describe('generateStacCatalogue — preset filters', () => {
  // Mergin Maps' filter entries, into the project's own `<properties>`.
  const withMerginFilters = (filters: unknown[]) => fixtureXml.replace(
    '\n  <properties>\n',
    `\n  <properties>\n    <Mergin><Filtering><Enabled type="bool">true</Enabled><Filters type="QString">${
      JSON.stringify(filters).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    }</Filters></Filtering></Mergin>\n`
  )
  const merginFilter = (layerId: string, field: string, name: string) => ({
    filter_name: name, layer_id: layerId, field_name: field, filter_type: 'Single select', sql_expression: `"${field}" IS @@value@@`
  })

  it('writes the filters onto their layer\'s Collection, in order, and none where a field is missing', () => {
    const catalog = generateStacCatalogue(parseQgsXml(withMerginFilters([
      merginFilter(graffitiLayer.id, 'priority_status', 'Priority'),
      merginFilter(graffitiLayer.id, 'no_such_field', 'Gone'),
      merginFilter(graffitiLayer.id, 'damage_category', '')
    ])))
    const graffiti = collectCatalogueCollections(catalog).find((c) => c.id === graffitiLayer.id)!
    expect(graffiti[QUAC_FILTERS_FIELD]).toEqual([{ field: 'priority_status', name: 'Priority' }, { field: 'damage_category' }])
    expect(readCollectionFilters(graffiti)).toEqual([{ field: 'priority_status', name: 'Priority' }, { field: 'damage_category', name: null }])
    const schools = collectCatalogueCollections(catalog).find((c) => c.id === schoolsLayer.id)!
    expect(schools).not.toHaveProperty(QUAC_FILTERS_FIELD)
  })

  it('writes nothing for a project that sets up no filters', () => {
    expect(collectCatalogueCollections(generateStacCatalogue(project)).some((c) => QUAC_FILTERS_FIELD in c)).toBe(false)
  })
})

describe('generateStacCatalogue — the names QGIS Server gives a layer', () => {
  function graffitiWith(changes: Partial<QgsProject>, layerChanges: Partial<LayerEntry> = {}): StacCollection {
    const changed: QgsProject = {
      ...project,
      ...changes,
      layers: project.layers.map((layer) => layer.id === graffitiLayer.id ? { ...layer, ...layerChanges } : layer)
    }
    return generateStacCatalogue(changed).collections!.find((c) => c.id === graffitiLayer.id)!
  }

  it('writes the layer name as the WMS name, and no WFS name for a layer not published for WFS', () => {
    const graffiti = graffitiWith({ wmsPublishing: null, wfsTransactionLayers: null })
    expect(graffiti['quac:qgis_server_wms_name']).toBe('Graffiti Reports')
    expect(graffiti).not.toHaveProperty('quac:qgis_server_wfs_type_name')
  })

  it('writes the short name in place of the layer name', () => {
    expect(graffitiWith({ wmsPublishing: null }, { shortName: 'graffiti' })['quac:qgis_server_wms_name']).toBe('graffiti')
  })

  it('writes the layer id where the project ticks Use layer ids as names', () => {
    const graffiti = graffitiWith({ wmsPublishing: { useLayerIds: true, restrictedLayers: [] } }, { shortName: 'graffiti' })
    expect(graffiti['quac:qgis_server_wms_name']).toBe(graffitiLayer.id)
  })

  it('writes no WMS name for a layer the project leaves out of WMS', () => {
    const graffiti = graffitiWith({ wmsPublishing: { useLayerIds: false, restrictedLayers: ['Graffiti Reports'] } })
    expect(graffiti).not.toHaveProperty('quac:qgis_server_wms_name')
  })

  it('writes the WFS type name of a layer published for WFS, as QGIS Server spells it', () => {
    const published = { published: [graffitiLayer.id], insert: [], update: [], delete: [] }
    expect(graffitiWith({ wfsTransactionLayers: published })['quac:qgis_server_wfs_type_name']).toBe('Graffiti_Reports')
    expect(graffitiWith({ wfsTransactionLayers: published }, { shortName: 'ns:graffiti \u2014 2024' })['quac:qgis_server_wfs_type_name'])
      .toBe('ns-graffiti_-_2024')
  })

  it('keeps the WFS type name to the short name or name where the project ticks Use layer ids as names', () => {
    const published = { published: [graffitiLayer.id], insert: [], update: [], delete: [] }
    const graffiti = graffitiWith({ wfsTransactionLayers: published, wmsPublishing: { useLayerIds: true, restrictedLayers: [] } })
    expect(graffiti['quac:qgis_server_wfs_type_name']).toBe('Graffiti_Reports')
  })

  it('reads the short name and Use layer ids as names from the project file', () => {
    const withShortName = fixtureXml.replace('<layername>Graffiti Reports</layername>', '<layername>Graffiti Reports</layername>\n      <shortname>graffiti</shortname>')
    expect(withShortName).not.toBe(fixtureXml)
    const fromFile = (xml: string) => generateStacCatalogue(parseQgsXml(xml)).collections!.find((c) => c.id === graffitiLayer.id)!
    expect(fromFile(withShortName)['quac:qgis_server_wms_name']).toBe('graffiti')
    const withLayerIds = withShortName.replace('<WMSUseLayerIDs type="bool">false</WMSUseLayerIDs>', '<WMSUseLayerIDs type="bool">true</WMSUseLayerIDs>')
    expect(withLayerIds).not.toBe(withShortName)
    expect(fromFile(withLayerIds)['quac:qgis_server_wms_name']).toBe(graffitiLayer.id)
  })

  it('writes neither name on a file the project splits into a layer per shape', () => {
    const [collection] = collectCatalogueCollections(generateStacCatalogue(parseQgsXml(annotationsXml)))
    expect(collection).not.toHaveProperty('quac:qgis_server_wms_name')
    expect(collection).not.toHaveProperty('quac:qgis_server_wfs_type_name')
  })
})

describe('generateStacCatalogue — geometry types', () => {
  it('writes the layer\'s wkbType as vector:geometry_types beside the QGIS geometry type', () => {
    const graffiti = generateStacCatalogue(project).collections!.find((c) => c.title === 'Graffiti Reports')!
    expect(graffiti['vector:geometry_types']).toEqual(['Point'])
    expect(graffiti.summaries?.['quac:geometry_type']).toEqual(['Point'])
    expect(graffiti.stac_extensions).toContain('https://stac-extensions.github.io/vector/v0.1.0/schema.json')
  })

  it('lists each shape of a file the project splits into a layer per shape', () => {
    const [collection] = collectCatalogueCollections(generateStacCatalogue(parseQgsXml(annotationsXml)))
    expect(collection!['vector:geometry_types']).toEqual(['Point', 'LineString', 'Polygon'])
  })

  it('writes none for a layer whose project declares no wkbType', () => {
    const withoutWkb: QgsProject = { ...project, layers: project.layers.map((layer) => ({ ...layer, wkbType: null })) }
    const graffiti = generateStacCatalogue(withoutWkb).collections!.find((c) => c.title === 'Graffiti Reports')!
    expect(graffiti).not.toHaveProperty('vector:geometry_types')
    expect(graffiti.summaries?.['quac:geometry_type']).toEqual(['Point'])
  })
})

describe('generateStacCatalogue — column types', () => {
  function columnsFor(values: Array<Record<string, unknown>>): Array<{ name: string, type?: string, data_type?: string }> {
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: values.map((properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [145, -37] }, properties }))
    }
    const collection = generateStacCatalogue(project, [{ layerId: graffitiLayer.id, geojson: data }])
      .collections!.find((c) => c.title === 'Graffiti Reports')!
    const columns = collection['table:columns'] as Array<{ name: string, type?: string, data_type?: string }>
    return columns.filter((c) => c.name in values[0]!)
  }

  function columnTypes(values: Array<Record<string, unknown>>): Record<string, string | undefined> {
    return Object.fromEntries(columnsFor(values).map((c) => [c.name, c.type]))
  }

  function dataTypes(values: Array<Record<string, unknown>>): Record<string, string | undefined> {
    return Object.fromEntries(columnsFor(values).map((c) => [c.name, c.data_type]))
  }

  it('declares a field double when a later value is a fraction', () => {
    expect(columnTypes([{ depth: 12 }, { depth: 2.5 }])).toEqual({ depth: 'double' })
  })

  it('declares a field int when every value is whole', () => {
    expect(columnTypes([{ count: 12 }, { count: 3 }])).toEqual({ count: 'int' })
  })

  it('declares a field timestamp when its values mix dates and timestamps', () => {
    expect(columnTypes([{ seen: '2026-10-17' }, { seen: '2026-10-17T09:30:00Z' }])).toEqual({ seen: 'timestamp' })
  })

  it('declares a field string when its values mix unrelated types', () => {
    expect(columnTypes([{ code: 12 }, { code: 'A12' }])).toEqual({ code: 'string' })
  })

  it('ignores null values', () => {
    expect(columnTypes([{ depth: null }, { depth: 2.5 }, { depth: null }])).toEqual({ depth: 'double' })
  })

  it('declares a field long when a whole number is outside the 32-bit range', () => {
    expect(columnTypes([{ ref: 12 }, { ref: 2 ** 31 }])).toEqual({ ref: 'long' })
    expect(columnTypes([{ ref: -(2 ** 31) - 1 }, { ref: 3 }])).toEqual({ ref: 'long' })
  })

  it('declares a field double when its values mix long whole numbers and fractions', () => {
    expect(columnTypes([{ ref: 2 ** 31 }, { ref: 2.5 }])).toEqual({ ref: 'double' })
  })

  it('writes the STAC data type beside each column type', () => {
    expect(dataTypes([{ count: 12, ref: 2 ** 31, depth: 2.5, label: 'A12', open: true, seen: '2026-10-17' }]))
      .toEqual({ count: 'int32', ref: 'int64', depth: 'float64', label: 'other', open: 'other', seen: 'other' })
  })

  it('writes no data type for a field with no type', () => {
    expect(columnsFor([{ depth: null }])[0]).not.toHaveProperty('data_type')
  })
})

describe('generateStacCatalogue — style ordering', () => {
  /**
   * A project whose active style is not the first one in the file, which the
   * graffiti fixture does not exercise. QGIS records the current style
   * independently of the order they are written, and the profile's rule is that
   * the default is the style marked with the `default` role — so the two have to
   * be reconciled here rather than downstream.
   */
  function projectWithActiveStyleSecond(): QgsProject {
    const layer: LayerEntry = {
      id: 'roads_1',
      name: 'Roads',
      type: 'vector',
      geometryType: 'LineString',
      crs: 'EPSG:4326',
      extent: null,
      wgs84Extent: null,
      dataSource: {
        kind: 'file',
        geometryTypeFilter: null,
        filename: 'roads.geojson',
        relPath: 'roads.geojson',
        layerName: 'Roads',
        raw: './roads.geojson'
      },
      displayField: null,
      isVisible: true,
      queryable: true,
      opacity: 1,
      editable: true,
      fieldNames: [],
      fieldAliases: {},
      styles: [
        { name: 'Surface', isActive: false, rendererV2RawXml: '<renderer-v2/>', categorisedField: null },
        { name: 'Condition', isActive: true, rendererV2RawXml: '<renderer-v2/>', categorisedField: null }
      ],
      activeStyleIndex: 1,
      resourceMetadata: { abstract: null, license: null, keywords: [], contacts: [], temporalInterval: null },
      attribution: null,
      fieldValueMaps: {},
      isPrivate: false,
      fieldValueRelations: {},
      fieldAttachments: {},
      fieldEditRules: {},
      scaleRange: null,
      rawXml: null
    }

    return {
      qgisVersion: '3.44.0',
      title: 'Roads project',
      projectCrs: 'EPSG:4326',
      mapExtent: null,
      layers: [layer],
      layerTree: {
        kind: 'group',
        name: '',
        children: [{ kind: 'layer', layerId: 'roads_1', name: 'Roads' }]
      } as QgsProject['layerTree'],
      metadata: { abstract: null, author: null },
      rawXml: null
    }
  }

  it('emits the active style first, so the default matches what QGIS draws', () => {
    const catalog = generateStacCatalogue(projectWithActiveStyleSecond())
    const [collection] = catalog.collections ?? []

    const styleNames = Object.entries(collection.assets ?? {})
      .filter(([, asset]) => asset.roles?.includes('style'))
      .map(([name]) => name)

    expect(styleNames).toEqual(['Condition', 'Surface'])
  })

  it('records a categorised style\'s field, and writes nothing for a style without one', () => {
    const project = projectWithActiveStyleSecond()
    // Only the active style classifies by a field here, so the other one proves
    // the key is absent rather than written empty.
    project.layers[0].styles[1].categorisedField = 'condition_grade'

    const [collection] = generateStacCatalogue(project).collections ?? []
    const styles = collectCollectionStyles(collection)

    expect(styles.find((style) => style.name === 'Condition')?.categorisedField).toBe('condition_grade')
    expect(styles.find((style) => style.name === 'Surface')?.categorisedField).toBeUndefined()
  })

  it('gives the data asset the path the project records, not just the file name', () => {
    const project = projectWithActiveStyleSecond()
    const dataSource = project.layers[0].dataSource
    if (dataSource.kind === 'file') dataSource.relPath = './data/roads.geojson'

    const [collection] = generateStacCatalogue(project).collections ?? []

    expect(collection.assets!.data.href).toBe('./data/roads.geojson')
    expect(readCollectionDataPath(collection)).toBe('data/roads.geojson')
  })

  it('marks the active style as the default, so a digit-named style cannot displace it', () => {
    // JavaScript enumerates a key that looks like a whole number ahead of every
    // other key, whenever it was written — so `2023` is yielded before `2024`
    // and before `data`, and position cannot say which style is the default.
    const project = projectWithActiveStyleSecond()
    project.layers[0].styles[0].name = '2023'
    project.layers[0].styles[1].name = '2024'

    const [collection] = generateStacCatalogue(project).collections ?? []
    const styles = collectCollectionStyles(collection)

    expect(Object.keys(collection.assets!)).toEqual(['2023', '2024', 'data'])
    expect(styles.map((style) => style.name)).toEqual(['2023', '2024'])
    expect(getDefaultStyle(styles)?.name).toBe('2024')
  })

  it('nominates no second default when a layer has several styles', () => {
    const [collection] = generateStacCatalogue(projectWithActiveStyleSecond()).collections ?? []

    const defaults = collectCollectionStyles(collection).filter((style) => style.isDefault)
    expect(defaults.map((style) => style.name)).toEqual(['Condition'])
  })

  it('marks the first style with a renderer when the active one has none', () => {
    const project = projectWithActiveStyleSecond()
    // QGIS defined the active style but wrote no renderer for it, so there is
    // nothing at its address and it is not emitted at all.
    project.layers[0].styles[1].rendererV2RawXml = null

    const [collection] = generateStacCatalogue(project).collections ?? []
    const styles = collectCollectionStyles(collection)

    expect(styles.map((style) => style.name)).toEqual(['Surface'])
    expect(getDefaultStyle(styles)?.name).toBe('Surface')
  })

  it('keeps the data asset when a style is named after it', () => {
    const project = projectWithActiveStyleSecond()
    project.layers[0].styles[0].name = 'data'

    const [collection] = generateStacCatalogue(project).collections ?? []

    // The layer still has somewhere to load from, and the style is still
    // declared under its own name.
    expect(collection.assets!.data.roles).toEqual(['data'])
    expect(collection.assets!.data.href).toBe('./roads.geojson')
    const styles = collectCollectionStyles(collection)
    expect(styles.map((style) => style.name)).toEqual(['Condition', 'data'])
  })

  it('skips a style the project defined but wrote no renderer for', () => {
    const project = projectWithActiveStyleSecond()
    project.layers[0].styles.push({ name: 'Empty', isActive: false, rendererV2RawXml: null, categorisedField: null })

    const [collection] = generateStacCatalogue(project).collections ?? []

    expect(collection.assets!.Empty).toBeUndefined()
  })
})

describe('generateStacCatalogue — a file split into a layer per shape', () => {
  const POINT_ID = 'annotations_point_0b6c2f1e_8d4a_4e7b_9c31_5f2a7d8e1b01'

  it('writes the siblings as one Collection in place of the group they make up, named after the group', () => {
    const catalog = generateStacCatalogue(parseQgsXml(annotationsXml))
    expect(catalog.catalogs ?? []).toEqual([])
    expect(catalog.collections?.map((collection) => [collection.id, collection.title])).toEqual([[POINT_ID, 'Annotations']])
  })

  it('reads the whole file, with no shape on its data asset, and the first sibling\'s style', () => {
    const [collection] = collectCatalogueCollections(generateStacCatalogue(parseQgsXml(annotationsXml), [], { projectPath: 'annotations.qgs' }))
    expect(readCollectionDataPath(collection)).toBe('annotations.geojson')
    expect(collection.assets?.data).not.toHaveProperty(QUAC_GEOMETRY_FILTER)
    expect(readCollectionGeometryFilter(collection)).toBeNull()
    expect(collectCollectionStyles(collection).map((style) => style.href)).toEqual([`./annotations.qgs#${POINT_ID}/default`])
  })

  it('keeps the one shape of a single per-shape layer, inside its group', () => {
    const catalog = generateStacCatalogue(parseQgsXml(annotationsProjectWith(['Polygon'])))
    const [collection] = collectCatalogueCollections(catalog)
    expect(catalog.catalogs?.map((group) => group.title)).toEqual(['Annotations'])
    expect(collection.title).toBe('annotations')
    expect(collection.assets?.data?.[QUAC_GEOMETRY_FILTER]).toEqual(['Polygon'])
    expect(readCollectionGeometryFilter(collection)).toEqual(['Polygon'])
  })

  it('lists the shapes of two siblings, in place of the group they make up', () => {
    const catalog = generateStacCatalogue(parseQgsXml(annotationsProjectWith(['Point', 'Polygon'])))
    expect(catalog.collections?.map((collection) => collection.title)).toEqual(['Annotations'])
    expect(catalog.collections?.map(readCollectionGeometryFilter)).toEqual([['Point', 'Polygon']])
  })

  it.each([
    ['one shape rather than a list', 'Point'],
    ['an empty list', []],
    ['a shape it does not read', ['Point', 'MultiPoint']]
  ])('reads no filter from %s', (_case, value) => {
    const collection = { type: 'Collection', id: 'c', assets: { data: { href: './a.geojson', roles: ['data'], [QUAC_GEOMETRY_FILTER]: value } } } as unknown as StacCollection
    expect(readCollectionGeometryFilter(collection)).toBeNull()
  })

  it('names the Collection after the siblings, inside the group, where the group holds another layer too', () => {
    const parsed = parseQgsXml(annotationsXml)
    const [first] = parsed.layers
    const other: LayerEntry = {
      ...first,
      id: 'other_layer',
      name: 'Other',
      dataSource: { kind: 'file', filename: 'other.geojson', relPath: './other.geojson', layerName: null, geometryTypeFilter: null, raw: './other.geojson' }
    }
    const group = parsed.layerTree.children[0]
    if (group.kind !== 'group') throw new Error('The fixture\'s first layers panel entry is its group.')
    const withOther: QgsProject = {
      ...parsed,
      layers: [...parsed.layers, other],
      layerTree: { ...parsed.layerTree, children: [{ ...group, children: [...group.children, { kind: 'layer', layerId: other.id, name: other.name, checked: true }] }] }
    }

    const catalog = generateStacCatalogue(withOther)
    expect(catalog.catalogs?.map((sub) => sub.title)).toEqual(['Annotations'])
    expect(collectCatalogueCollections(catalog).map((collection) => [collection.id, collection.title])).toEqual([[POINT_ID, 'annotations'], ['other_layer', 'Other']])
  })

  it('takes the form\'s field order and visibility from the first sibling', () => {
    const parsed = parseQgsXml(annotationsXml)
    const withForms: QgsProject = {
      ...parsed,
      layers: parsed.layers.map((layer, index) => ({
        ...layer,
        fieldNames: ['label', 'notes'],
        formLayout: index === 0
          ? { fields: [{ name: 'notes', visibleWhen: ['"label" IS NOT NULL'] }, { name: 'label', visibleWhen: [] }] }
          : { fields: [{ name: 'label', visibleWhen: ['false'] }] }
      }))
    }

    const [collection] = collectCatalogueCollections(generateStacCatalogue(withForms))
    expect(collection['quac:form_order']).toEqual(['notes', 'label'])
    expect((collection['table:columns'] as TableColumn[]).map((column) => [column.name, column['quac:visible_when'] ?? null, column['quac:in_form'] ?? true])).toEqual([
      ['label', null, true],
      ['notes', ['"label" IS NOT NULL'], true]
    ])
  })

  it('writes no shape for a file source without geometrytype=', () => {
    const graffiti = collectCatalogueCollections(generateStacCatalogue(project))
      .find((collection) => collection.id === graffitiLayer.id)!
    expect(graffiti.assets?.data).not.toHaveProperty(QUAC_GEOMETRY_FILTER)
    expect(readCollectionGeometryFilter(graffiti)).toBeNull()
  })
})

describe('generateStacCatalogue — a CSV table', () => {
  const inspectionsOf = (xml: string) => collectCatalogueCollections(generateStacCatalogue(parseQgsXml(xml)))
    .find((collection) => collection.title === 'Inspections')!

  it('declares a CSV that QGIS opens with OGR as CSV, with no Delimited Text options', () => {
    const inspections = inspectionsOf(treesXml.replaceAll('tree-inspections.geojson', 'tree-inspections.csv'))
    expect(inspections.assets?.data).toMatchObject({ href: './tree-inspections.csv', type: 'text/csv' })
    expect(inspections.assets?.data).not.toHaveProperty(QUAC_DELIMITED_TEXT)
    expect(readCollectionDelimitedText(inspections)).toBeNull()
  })

  it('writes a Delimited Text source\'s options on its data asset, and reads them back', () => {
    const inspections = inspectionsOf(treesXml
      .replace('<datasource>./tree-inspections.geojson</datasource>', '<datasource>file:./tree-inspections.csv?type=csv&amp;delimiter=;&amp;skipLines=1&amp;geomType=none</datasource>')
      .replace(/(<datasource>file:\.\/tree-inspections[\s\S]*?<provider encoding="UTF-8">)ogr</, '$1delimitedtext<'))
    expect(inspections.assets?.data).toMatchObject({
      href: './tree-inspections.csv',
      type: 'text/csv',
      [QUAC_DELIMITED_TEXT]: { delimiter: ';', quote: '"', escape: '"', skip_lines: 1, header: true, trim: false }
    })
    expect(readCollectionDelimitedText(inspections)).toEqual({ delimiter: ';', quote: '"', escape: '"', skipLines: 1, header: true, trim: false })
  })
})

describe('generateStacCatalogue — the project a layer came from', () => {
  const inspectionsOf = (options: Parameters<typeof generateStacCatalogue>[2]) => collectCatalogueCollections(generateStacCatalogue(parseQgsXml(treesXml), [], options))
    .find((collection) => collection.title === 'Inspections')!

  it('links each layer to its project file, by its path where the caller gives one', () => {
    expect(inspectionsOf({ projectPath: 'street trees.qgs' }).links).toContainEqual({ rel: 'via', href: './street%20trees.qgs', title: 'QGIS project' })
  })

  it('links each layer to its project file by name alone, leaving its style addresses bare', () => {
    const inspections = inspectionsOf({ projectFileName: 'street-trees.qgs' })
    expect(inspections.links).toContainEqual({ rel: 'via', href: './street-trees.qgs', title: 'QGIS project' })
    const styleHrefs = Object.values(inspections.assets ?? {}).filter((asset) => asset.roles?.includes('style')).map((asset) => asset.href)
    expect(styleHrefs.length).toBeGreaterThan(0)
    expect(styleHrefs.every((href) => href.startsWith('#'))).toBe(true)
  })

  it('writes no link where the caller knows no project file', () => {
    expect(inspectionsOf({}).links?.some((link) => link.rel === 'via')).toBe(false)
  })
})

describe('generateStacCatalogue — a feature filter', () => {
  const inspectionsOf = (xml: string) => collectCatalogueCollections(generateStacCatalogue(parseQgsXml(xml)))
    .find((collection) => collection.title === 'Inspections')!

  it('writes a file source\'s |subset= on its data asset with its dialect, and reads it back', () => {
    const inspections = inspectionsOf(treesXml.replace(
      '<datasource>./tree-inspections.geojson</datasource>',
      '<datasource>./tree-inspections.geojson|subset="status" = \'open\'</datasource>'
    ))
    expect(inspections.assets?.data).toMatchObject({
      href: './tree-inspections.geojson',
      [QUAC_FEATURE_FILTER]: { expression: '"status" = \'open\'', dialect: 'ogr_sql' }
    })
    expect(readCollectionFeatureFilter(inspections)).toEqual({ expression: '"status" = \'open\'', dialect: 'ogr_sql' })
  })

  it('writes no filter for a file source without one', () => {
    const inspections = inspectionsOf(treesXml)
    expect(inspections.assets?.data).not.toHaveProperty(QUAC_FEATURE_FILTER)
    expect(readCollectionFeatureFilter(inspections)).toBeNull()
  })
})

describe('reading a Collection back', () => {
  it('takes a style address apart into the document, the layer and the style', () => {
    expect(parseQgisStyleAssetHref('./graffiti.qgs#roads_1/Asset%20Owner')).toEqual({
      documentPath: 'graffiti.qgs',
      layerId: 'roads_1',
      styleName: 'Asset Owner'
    })
  })

  it('reads a bare fragment as a style with no document to fetch', () => {
    expect(parseQgisStyleAssetHref('#roads_1/Surface')).toEqual({
      documentPath: null,
      layerId: 'roads_1',
      styleName: 'Surface'
    })
  })

  it('refuses an address that is not one of ours', () => {
    // A style file beside the data, which is dereferenced by fetching it.
    expect(parseQgisStyleAssetHref('./roads.qml')).toBeNull()
    // Half an address: no style name, or no layer id.
    expect(parseQgisStyleAssetHref('./graffiti.qgs#roads_1/')).toBeNull()
    expect(parseQgisStyleAssetHref('./graffiti.qgs#/Surface')).toBeNull()
    expect(parseQgisStyleAssetHref('./graffiti.qgs#roads_1')).toBeNull()
  })

  it('reads a relative data asset as a path, and nothing else as one', () => {
    const withData = (href: string) => ({ assets: { data: { href } } } as unknown as StacCollection)

    expect(readCollectionDataPath(withData('./data/roads.geojson'))).toBe('data/roads.geojson')
    expect(readCollectionDataPath(withData('roads.geojson'))).toBe('roads.geojson')
    // A WFS GetFeature URL, and the empty href an unsupported source gets:
    // neither is a file in the published folder.
    expect(readCollectionDataPath(withData('https://services.test/wfs?SERVICE=WFS'))).toBeNull()
    expect(readCollectionDataPath(withData(''))).toBeNull()
    expect(readCollectionDataPath({} as StacCollection)).toBeNull()
  })
})

describe('addresses carrying a character URIs reserve', () => {
  /**
   * `#` and `?` are legal in a file name on every service Groundwork reads, and
   * both end the path when an href is taken apart. Written unescaped they cut
   * the address in half: the data asset points to a file the folder does not hold,
   * so the layer is dropped, and the style address points to a layer the project
   * does not have, so every layer in that project draws unstyled.
   */
  function projectWithName(relPath: string): QgsProject {
    const layer: LayerEntry = {
      id: 'roads_1',
      name: 'Roads',
      type: 'vector',
      geometryType: 'LineString',
      crs: 'EPSG:4326',
      extent: null,
      wgs84Extent: null,
      dataSource: {
        kind: 'file',
        geometryTypeFilter: null,
        filename: relPath.split('/').pop()!,
        relPath,
        layerName: 'Roads',
        raw: `./${relPath}`
      },
      displayField: null,
      isVisible: true,
      queryable: true,
      opacity: 1,
      editable: true,
      fieldNames: [],
      fieldAliases: {},
      styles: [{ name: 'Surface', isActive: true, rendererV2RawXml: '<renderer-v2/>', categorisedField: null }],
      activeStyleIndex: 0,
      resourceMetadata: { abstract: null, license: null, keywords: [], contacts: [], temporalInterval: null },
      attribution: null,
      fieldValueMaps: {},
      isPrivate: false,
      fieldValueRelations: {},
      fieldAttachments: {},
      fieldEditRules: {},
      scaleRange: null,
      rawXml: null
    }

    return {
      qgisVersion: '3.44.0',
      title: 'Roads project',
      projectCrs: 'EPSG:4326',
      mapExtent: null,
      layers: [layer],
      layerTree: {
        kind: 'group',
        name: '',
        checked: true,
        children: [{ kind: 'layer', layerId: 'roads_1', name: 'Roads', checked: true }]
      },
      metadata: { abstract: null, author: null },
      rawXml: null
    }
  }

  it('reads back the whole file name when it holds a hash', () => {
    const [collection] = generateStacCatalogue(projectWithName('data/Building #3.geojson')).collections ?? []

    expect(collection.assets!.data.href).toBe('./data/Building%20%233.geojson')
    expect(readCollectionDataPath(collection)).toBe('data/Building #3.geojson')
  })

  it('reads back the whole file name when it holds a question mark', () => {
    const [collection] = generateStacCatalogue(projectWithName('sites?draft.geojson')).collections ?? []

    expect(readCollectionDataPath(collection)).toBe('sites?draft.geojson')
  })

  it('keeps the style address readable when the project file name holds a hash', () => {
    const catalogue = generateStacCatalogue(projectWithName('roads.geojson'), [], {
      projectPath: 'Assets #2.qgs'
    })
    const [collection] = catalogue.collections ?? []
    const style = collection.assets!.Surface!

    expect(parseQgisStyleAssetHref(style.href)).toEqual({
      documentPath: 'Assets #2.qgs',
      layerId: 'roads_1',
      styleName: 'Surface'
    })
  })

  it('leaves an href somebody else wrote unescaped as it stands, rather than failing', () => {
    // A stray `%` is not an escape sequence. Decoding throws on it, and the
    // file's own name is the best reading available.
    const collection = {
      assets: { data: { href: './50% complete.geojson' } }
    } as unknown as StacCollection

    expect(readCollectionDataPath(collection)).toBe('50% complete.geojson')
  })
})

describe('layerWgs84Extents option', () => {
  function projectWithExtent(extent: {
    crs: string | null
    extent: { xmin: number, ymin: number, xmax: number, ymax: number } | null
    wgs84Extent: { xmin: number, ymin: number, xmax: number, ymax: number } | null
  }): QgsProject {
    const layer: LayerEntry = {
      id: 'layer_1',
      name: 'Sites',
      type: 'vector',
      geometryType: 'Point',
      crs: extent.crs,
      extent: extent.extent,
      wgs84Extent: extent.wgs84Extent,
      dataSource: {
        kind: 'file',
        geometryTypeFilter: null,
        filename: 'sites.geojson',
        relPath: 'sites.geojson',
        layerName: null,
        raw: './sites.geojson'
      },
      displayField: null,
      isVisible: true,
      queryable: true,
      opacity: 1,
      editable: true,
      fieldNames: [],
      fieldAliases: {},
      styles: [],
      activeStyleIndex: -1,
      resourceMetadata: { abstract: null, license: null, keywords: [], contacts: [], temporalInterval: null },
      attribution: null,
      fieldValueMaps: {},
      isPrivate: false,
      fieldValueRelations: {},
      fieldAttachments: {},
      fieldEditRules: {},
      scaleRange: null,
      rawXml: null
    }

    return {
      qgisVersion: '3.44.0',
      title: 'Extent test',
      projectCrs: 'EPSG:4326',
      mapExtent: null,
      layers: [layer],
      layerTree: {
        kind: 'group',
        name: '',
        checked: true,
        children: [{ kind: 'layer', layerId: 'layer_1', name: 'Sites', checked: true }]
      },
      metadata: { abstract: null, author: null },
      rawXml: null
    }
  }

  it('uses a caller-supplied reprojection for a layer with no wgs84Extent of its own', () => {
    const project = projectWithExtent({
      crs: 'EPSG:28350',
      extent: { xmin: 400000, ymin: 6460000, xmax: 410000, ymax: 6470000 },
      wgs84Extent: null
    })

    const catalogue = generateStacCatalogue(project, [], {
      layerWgs84Extents: new Map([['layer_1', { xmin: 1, ymin: 2, xmax: 3, ymax: 4 }]])
    })

    const [collection] = catalogue.collections ?? []
    expect(collection.extent.spatial.bbox[0]).toEqual([1, 2, 3, 4])
    // The Catalog's own extent is the union of its layers, so it picks up the
    // same reprojection.
    expect((catalogue.extent as { spatial: { bbox: number[][] } }).spatial.bbox[0]).toEqual([1, 2, 3, 4])
  })

  it('publishes no box of its own for a layer whose extent was not reprojected', () => {
    const project = projectWithExtent({
      crs: 'EPSG:28350',
      extent: { xmin: 400000, ymin: 6460000, xmax: 410000, ymax: 6470000 },
      wgs84Extent: null
    })

    const catalogue = generateStacCatalogue(project)

    const [collection] = catalogue.collections ?? []
    expect(collection.extent.spatial.bbox[0]).toEqual([-180, -90, 180, 90])
    expect(catalogue.extent).toBeUndefined()
  })

  it('ignores a caller-supplied reprojection for a layer that already has its own wgs84Extent', () => {
    const project = projectWithExtent({
      crs: 'EPSG:28350',
      extent: { xmin: 400000, ymin: 6460000, xmax: 410000, ymax: 6470000 },
      wgs84Extent: { xmin: 115.75, ymin: -32.2, xmax: 115.95, ymax: -31.75 }
    })

    const catalogue = generateStacCatalogue(project, [], {
      layerWgs84Extents: new Map([['layer_1', { xmin: 1, ymin: 2, xmax: 3, ymax: 4 }]])
    })

    const [collection] = catalogue.collections ?? []
    expect(collection.extent.spatial.bbox[0]).toEqual([115.75, -32.2, 115.95, -31.75])
  })
})

describe('generateStacCatalogue — a layer the layers panel does not list', () => {
  it('gives it a Collection after every listed layer', () => {
    const unlisted = parseQgsXml(fixtureXml.replaceAll(`id="${graffitiLayer.id}"`, 'id="not_a_project_layer"'))
    const titles = collectCatalogueCollections(generateStacCatalogue(unlisted)).map((collection) => collection.title)

    expect(titles).toEqual(['Schools', 'Graffiti Reports'])
  })
})
