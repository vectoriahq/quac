import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { parseDataSource } from './parseDataSource.ts'
import { parseQgsXml } from './parseQgsXml.ts'
import { generateStacCatalogue } from '../generate/stacCatalogue.ts'
import fixtureXml from '../tests/fixtures/qgis/graffiti/graffiti.qgs?raw'

describe('parseQgsXml — graffiti fixture', () => {
  const project = parseQgsXml(fixtureXml)

  it('reads QGIS version and project CRS', () => {
    expect(project.qgisVersion).toMatch(/^3\./)
    expect(project.projectCrs).toBe('EPSG:4326')
  })

  it('extracts the initial map view extent', () => {
    expect(project.mapExtent).not.toBeNull()
    const e = project.mapExtent!
    // Perth metro area — graffiti report fixture
    expect(e.xmin).toBeCloseTo(115.745, 1)
    expect(e.xmax).toBeCloseTo(115.955, 1)
    expect(e.ymin).toBeCloseTo(-32.211, 1)
    expect(e.ymax).toBeCloseTo(-31.739, 1)
  })

  it('finds the two vector layers (annotation layer is filtered)', () => {
    expect(project.layers).toHaveLength(2)
    const graffiti = project.layers.find((l) => l.name === 'Graffiti Reports')
    const schools = project.layers.find((l) => l.name === 'Schools')
    expect(graffiti!.type).toBe('vector')
    expect(graffiti!.geometryType).toBe('Point')
    expect(graffiti!.id).toMatch(/^WA_Municipal_Graffiti_Vandalism_Register_/)
    expect(graffiti!.crs).toBe('EPSG:4326')
    expect(schools!.crs).toBe('EPSG:4326')
  })

  it("classifies the file layer's data source as a file with the GeoJSON basename and relPath", () => {
    const layer = project.layers.find((l) => l.name === 'Graffiti Reports')!
    expect(layer.dataSource.kind).toBe('file')
    if (layer.dataSource.kind !== 'file') return
    expect(layer.dataSource.filename).toBe('graffiti.json')
    expect(layer.dataSource.relPath).toBe('./graffiti.json')
    expect(layer.dataSource.layerName).toBe('WA_Municipal_Graffiti_Vandalism_Register')
  })

  it("classifies the WFS layer's data source with url and typename", () => {
    const layer = project.layers.find((l) => l.name === 'Schools')!
    expect(layer.dataSource.kind).toBe('wfs')
    if (layer.dataSource.kind !== 'wfs') return
    expect(layer.dataSource.url).toBe(
      'https://wfs.example.test/services/Education/MapServer/WFSServer'
    )
    expect(layer.dataSource.typeName).toBe('esri:Schools')
    expect(layer.dataSource.srsName).toBe('EPSG:4326')
  })

  it('captures both styles on the Graffiti layer (Asset Owner active in current fixture)', () => {
    const layer = project.layers.find((l) => l.name === 'Graffiti Reports')!
    expect(layer.styles).toHaveLength(2)
    expect(layer.styles.map((s) => s.name)).toEqual(['Asset Owner', 'Priority'])
    expect(layer.activeStyleIndex).toBe(0)
    expect(layer.styles[0].isActive).toBe(true)
    expect(layer.styles[1].isActive).toBe(false)
    expect(layer.styles[0].rendererV2RawXml).toContain('renderer-v2')
    expect(layer.styles[1].rendererV2RawXml).toContain('renderer-v2')
    expect(layer.rawXml).not.toBeNull()
    expect(layer.rawXml!).toContain('<maplayer')
  })

  it('parses the layer tree with both layers and the correct visibility flags', () => {
    expect(project.layerTree.kind).toBe('group')
    expect(project.layerTree.children).toHaveLength(2)
    const byName: Record<string, boolean> = {}
    for (const child of project.layerTree.children) {
      if (child.kind === 'layer') byName[child.name] = child.checked
    }
    expect(byName['Graffiti Reports']).toBe(true)
    // Schools is unchecked in the QGS — used by Phase 6 to lazy-load the WFS data
    expect(byName['Schools']).toBe(false)
  })

  it('extracts per-layer QGIS settings (display field, visibility, queryable, opacity, editable)', () => {
    const graffiti = project.layers.find((l) => l.name === 'Graffiti Reports')!
    expect(graffiti.displayField).toBe('location_description')
    expect(graffiti.isVisible).toBe(true)
    expect(graffiti.queryable).toBe(true)
    expect(graffiti.opacity).toBeGreaterThan(0)
    expect(graffiti.opacity).toBeLessThanOrEqual(1)
    expect(graffiti.editable).toBe(true)

    // Schools is unchecked in the QGS layer tree.
    const schools = project.layers.find((l) => l.name === 'Schools')!
    expect(schools.isVisible).toBe(false)
  })

  it('retains the original full QGS XML for future parsers', () => {
    expect(project.rawXml).not.toBeNull()
    // Length match is sufficient — exact string equality is fragile because
    // Vite's ?raw transform may normalise line endings on Windows.
    expect(project.rawXml!.length).toBe(fixtureXml.length)
  })
})

describe('parseQgsXml — layer geometry', () => {
  function projectWithLayer(attributes: string) {
    return parseQgsXml(
      '<qgis version="3.44.8-Solothurn"><title>Geometry</title><projectlayers>'
      + `<maplayer ${attributes}><id>layer-1</id><layername>Maintenance</layername></maplayer>`
      + '</projectlayers></qgis>'
    )
  }

  it('reads a table layer\'s geometry as the "No geometry" QGIS writes', () => {
    expect(projectWithLayer('type="vector" geometry="No geometry"').layers[0]!.geometryType)
      .toBe('No geometry')
  })

  it('reads no geometry type from a layer declaring none', () => {
    expect(projectWithLayer('type="vector"').layers[0]!.geometryType).toBeNull()
  })
})

describe('parseDataSource — direct unit tests', () => {
  it('parses a relative GeoJSON path with layername', () => {
    const result = parseDataSource('./graffiti.json|layername=foo')
    expect(result.kind).toBe('file')
    if (result.kind !== 'file') return
    expect(result.filename).toBe('graffiti.json')
    expect(result.layerName).toBe('foo')
  })

  it('parses a Shapefile path without layername', () => {
    const result = parseDataSource('../data/roads.shp')
    expect(result.kind).toBe('file')
    if (result.kind !== 'file') return
    expect(result.filename).toBe('roads.shp')
    expect(result.layerName).toBeNull()
  })

  it('handles backslash paths from a Windows .qgs', () => {
    const result = parseDataSource('C:\\data\\buildings.gpkg|layername=parcels')
    expect(result.kind).toBe('file')
    if (result.kind !== 'file') return
    expect(result.filename).toBe('buildings.gpkg')
    expect(result.layerName).toBe('parcels')
  })

  it('reads no geometry filter from a file source without one', () => {
    const result = parseDataSource('./graffiti.json|layername=foo')
    expect(result.kind === 'file' && result.geometryTypeFilter).toBeNull()
  })

  it.each([
    ['Point', 'Point'],
    ['LineString', 'LineString'],
    ['Polygon', 'Polygon'],
    ['MultiPoint', 'Point'],
    ['MultiPolygon25D', 'Polygon'],
    ['CompoundCurve', 'LineString'],
    ['MultiSurface', 'Polygon']
  ])('reads geometrytype=%s as a filter keeping %s, as QGIS does', (typeName, shape) => {
    const result = parseDataSource(`./annotations.geojson|geometrytype=${typeName}`)
    expect(result.kind === 'file' && result.geometryTypeFilter).toBe(shape)
  })

  it('keeps the file path and layer name of a source with a geometry filter', () => {
    const result = parseDataSource('./data/annotations.geojson|layername=annotations|geometrytype=Point')
    expect(result).toMatchObject({ kind: 'file', relPath: './data/annotations.geojson', filename: 'annotations.geojson', layerName: 'annotations', geometryTypeFilter: 'Point' })
  })

  it('reads the option name in any case and the type name only as QGIS spells it', () => {
    const upper = parseDataSource('./annotations.geojson|GEOMETRYTYPE=Point')
    const lower = parseDataSource('./annotations.geojson|geometrytype=point')
    expect(upper.kind === 'file' && upper.geometryTypeFilter).toBe('Point')
    expect(lower.kind === 'file' && lower.geometryTypeFilter).toBeNull()
  })

  it.each([
    './annotations.geojson|geometrytype=GeometryCollection',
    './annotations.geojson|geometrytype=None',
    './annotations.geojson|geometrytype=Point|uniqueGeometryType=yes'
  ])('reads no geometry filter from %s', (raw) => {
    const result = parseDataSource(raw)
    expect(result.kind === 'file' && result.geometryTypeFilter).toBeNull()
  })

  it('reads only the first geometrytype option, as QGIS does', () => {
    const result = parseDataSource('./annotations.geojson|geometrytype=Polygon|geometrytype=Point')
    expect(result.kind === 'file' && result.geometryTypeFilter).toBe('Polygon')
  })

  it('reads everything after |subset= as the source\'s feature filter in GDAL\'s SQL, | included', () => {
    const result = parseDataSource('./data/properties.geojson|layername=properties|geometrytype=Polygon|subset="status" = \'a|b\'')
    expect(result).toMatchObject({
      kind: 'file',
      relPath: './data/properties.geojson',
      layerName: 'properties',
      geometryTypeFilter: 'Polygon',
      featureFilter: { expression: '"status" = \'a|b\'', dialect: 'ogr_sql' }
    })
  })

  it.each([
    './properties.geojson',
    './properties.geojson|subset=',
    './properties.geojson|SUBSET="status" = \'approved\''
  ])('reads no feature filter from %s', (raw) => {
    const result = parseDataSource(raw)
    expect(result.kind === 'file' && result.featureFilter).toBeUndefined()
  })

  it('reads a Delimited Text source\'s subset query item as a QGIS expression', () => {
    const result = parseDataSource('file:./types.csv?type=csv&subset=%22kind%22%20%3D%20\'Tree\'', 'delimitedtext')
    expect(result.kind === 'file' && result.featureFilter).toEqual({ expression: '"kind" = \'Tree\'', dialect: 'qgis_expression' })
  })

  it('reads a CSV QGIS opens with OGR as a file source with no Delimited Text options', () => {
    const result = parseDataSource('./data/asset-types.csv', 'ogr')
    expect(result).toMatchObject({ kind: 'file', relPath: './data/asset-types.csv', filename: 'asset-types.csv' })
    expect(result.kind === 'file' && result.delimitedText).toBeUndefined()
  })

  it('reads a Delimited Text source as its file and the options its query names', () => {
    const result = parseDataSource(
      'file:./data/asset%20types.csv?type=csv&delimiter=;&quote=\'&skipLines=2&useHeader=No&trimFields=Yes&detectTypes=yes&geomType=none&subsetIndex=no&watchFile=no',
      'delimitedtext'
    )
    expect(result).toMatchObject({
      kind: 'file',
      relPath: './data/asset types.csv',
      filename: 'asset types.csv',
      delimitedText: { delimiter: ';', quote: '\'', escape: '"', skipLines: 2, header: false, trim: true }
    })
  })

  it('reads QGIS\'s defaults where a Delimited Text source names none, and a tab written as \\t', () => {
    expect(parseDataSource('file:./types.csv?type=csv', 'delimitedtext')).toMatchObject({
      delimitedText: { delimiter: ',', quote: '"', escape: '"', skipLines: 0, header: true, trim: false }
    })
    expect(parseDataSource('file:./types.csv?type=csv&delimiter=%5Ct', 'delimitedtext')).toMatchObject({
      delimitedText: { delimiter: '\t' }
    })
  })

  it.each([
    ['file:///C:/Users/author/data/types.csv?type=csv', 'C:/Users/author/data/types.csv'],
    ['file:///home/author/types.csv?type=csv', '/home/author/types.csv'],
    ['./types.csv?type=csv', './types.csv']
  ])('reads the path of the Delimited Text source %s', (raw, relPath) => {
    expect(parseDataSource(raw, 'delimitedtext')).toMatchObject({ kind: 'file', relPath, filename: 'types.csv' })
  })

  it('leaves a Delimited Text source split on whitespace or a regular expression unsupported', () => {
    expect(parseDataSource('file:./types.txt?type=whitespace', 'delimitedtext').kind).toBe('unsupported')
    expect(parseDataSource('file:./types.txt?type=regexp&delimiter=%5Cs%2B', 'delimitedtext').kind).toBe('unsupported')
  })

  it('parses a WFS provider URI', () => {
    const raw = 'pagingEnabled=\'true\' restrictToRequestBBOX=\'1\' srsname=\'EPSG:4326\' typename=\'ns:layer\' url=\'https://example.com/wfs\' version=\'auto\''
    const result = parseDataSource(raw)
    expect(result.kind).toBe('wfs')
    if (result.kind !== 'wfs') return
    expect(result.url).toBe('https://example.com/wfs')
    expect(result.typeName).toBe('ns:layer')
    expect(result.srsName).toBe('EPSG:4326')
  })

  it('reads a WFS layer\'s filter parameter as a QGIS expression, its escaped quotes undone', () => {
    const raw = 'filter=\'"status" = \\\'approved\\\' AND "note" = \\\'a\\\\\\\\b\\\'\' pagingEnabled=\'true\' typename=\'ns:layer\' url=\'https://example.com/wfs\' version=\'auto\''
    const result = parseDataSource(raw)
    expect(result).toMatchObject({
      kind: 'wfs',
      url: 'https://example.com/wfs',
      typeName: 'ns:layer',
      featureFilter: { expression: '"status" = \'approved\' AND "note" = \'a\\\\b\'', dialect: 'qgis_expression' }
    })
  })

  it('finds sql= only after the quoted parameters, not inside one', () => {
    const raw = 'filter=\'"note" = \\\'see sql=1\\\'\' typename=\'ns:layer\' url=\'https://example.com/wfs\''
    expect(parseDataSource(raw)).toMatchObject({
      kind: 'wfs',
      typeName: 'ns:layer',
      featureFilter: { expression: '"note" = \'see sql=1\'', dialect: 'qgis_expression' }
    })
  })

  it('finds sql= after a parameter QGIS writes unquoted', () => {
    const raw = 'authcfg=ab12cd typename=\'ns:layer\' url=\'https://example.com/wfs\' sql=SELECT * FROM layer'
    expect(parseDataSource(raw)).toMatchObject({ kind: 'wfs', typeName: 'ns:layer', featureFilter: { expression: 'SELECT * FROM layer', dialect: 'wfs_sql' } })
  })

  it('reads a WFS layer\'s filter written as OGC Filter XML as one in its own dialect', () => {
    const raw = 'filter=\'<Filter><PropertyIsEqualTo><PropertyName>a</PropertyName><Literal>1</Literal></PropertyIsEqualTo></Filter>\' typename=\'ns:layer\' url=\'https://example.com/wfs\''
    const result = parseDataSource(raw)
    expect(result.kind === 'wfs' && result.featureFilter?.dialect).toBe('ogc_filter')
  })

  it('reads a WFS layer\'s sql= statement, written last and unquoted, as one in its own dialect', () => {
    const raw = 'typename=\'ns:layer\' url=\'https://example.com/wfs\' version=\'auto\' sql=SELECT * FROM layer WHERE "status" = \'approved\''
    const result = parseDataSource(raw)
    expect(result).toMatchObject({
      kind: 'wfs',
      typeName: 'ns:layer',
      featureFilter: { expression: 'SELECT * FROM layer WHERE "status" = \'approved\'', dialect: 'wfs_sql' }
    })
  })

  it('returns unsupported with a postgres hint for PostGIS sources', () => {
    const raw = 'dbname=\'gis\' host=localhost port=5432 table="public"."buildings" (geom)'
    const result = parseDataSource(raw)
    expect(result.kind).toBe('unsupported')
    if (result.kind !== 'unsupported') return
    expect(result.hint).toBe('postgres')
  })

  it('returns unsupported for empty datasource', () => {
    const result = parseDataSource('')
    expect(result.kind).toBe('unsupported')
  })
})

describe('parseQgsXml — layer tree groups', () => {
  const project = parseQgsXml(
    '<qgis version="3.44.8-Solothurn"><title>Groups</title><projectlayers>'
    + '<maplayer type="vector"><id>parcels</id><layername>Parcels</layername><datasource>./parcels.geojson</datasource></maplayer>'
    + '<maplayer type="vector"><id>roads</id><layername>Roads</layername><datasource>./roads.geojson</datasource></maplayer>'
    + '</projectlayers>'
    + '<layer-tree-group mutually-exclusive="1">'
    + '<layer-tree-group name="Basemaps" checked="Qt::Checked" mutually-exclusive="1"><layer-tree-layer id="parcels" name="Parcels"/></layer-tree-group>'
    + '<layer-tree-group name="Assets" checked="Qt::Checked" mutually-exclusive="0"><layer-tree-layer id="roads" name="Roads"/></layer-tree-group>'
    + '</layer-tree-group></qgis>'
  )

  it('reads a mutually exclusive group, never the root', () => {
    expect(project.layerTree.mutuallyExclusive).toBeUndefined()
    expect(project.layerTree.children.map((child) => child.kind === 'group' && child.mutuallyExclusive === true))
      .toEqual([true, false])
  })

  it('marks only that group\'s Catalog quac:mutually_exclusive', () => {
    const catalog = generateStacCatalogue(project)
    expect(catalog['quac:mutually_exclusive']).toBeUndefined()
    expect(catalog.catalogs?.map((child) => [child.id, child['quac:mutually_exclusive']])).toEqual([
      ['basemaps', true],
      ['assets', undefined]
    ])
  })
})
