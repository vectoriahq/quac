import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { generateServerStacCatalogue, serverWmsEndpoint } from './serverStacCatalogue'
import { QUAC_SCHEMA_URL } from '../model/quacExtension'
import { collectCatalogueCollections } from '../model/stacTreeWalk'
import { parseQgsXml } from '../parse/parseQgsXml'
import fixtureXml from '../tests/fixtures/qgis/related-datasets/street-trees.qgs?raw'
import serverAddresses from '../tests/fixtures/server-addresses.json'

import type { StacCatalog, StacCollection, TableColumn } from '../model/Stac'

const TREES_ID = 'street_trees_5b1d0a72_4e33_4c1a_9f6d_2c8b7a1e4d90'
const INSPECTIONS_ID = 'tree_inspections_0a4f9c81_7b26_4f55_8ad3_16e0f9b25c47'
const SERVER = 'https://qgis.example.com/ows?MAP=/projects/street-trees.qgs'

function values(name: string, items: string[]): string {
  return `<${name} type="QStringList">${items.map((item) => `<value>${item}</value>`).join('')}</${name}>`
}

/** The fixture with QGIS Server settings: the layers published for WFS, with every edit allowed, those left out of WMS, and any other edit. */
function project(options: { wfs?: string[]; restricted?: string[]; edit?: (xml: string) => string } = {}): string {
  const wfs = options.wfs ?? [TREES_ID, INSPECTIONS_ID]
  const transactions = `<WFSTLayers>${values('Insert', wfs)}${values('Update', wfs)}${values('Delete', wfs)}</WFSTLayers>`
  const properties = `<properties>${values('WFSLayers', wfs)}${transactions}${values('WMSRestrictedLayers', options.restricted ?? [])}</properties>`
  const xml = fixtureXml.replace('</qgis>', `${properties}</qgis>`)
  return options.edit ? options.edit(xml) : xml
}

function serve(xml: string): StacCatalog {
  return JSON.parse(JSON.stringify(generateServerStacCatalogue(parseQgsXml(xml), { serverAddress: SERVER }))) as StacCatalog
}

function byId(catalog: StacCatalog): Map<string, StacCollection> {
  return new Map(collectCatalogueCollections(catalog).map((collection) => [collection.id, collection]))
}

function columnNames(collection: StacCollection | undefined): string[] {
  return ((collection?.['table:columns'] ?? []) as TableColumn[]).map((column) => column.name)
}

/** Sets a field's configurationFlags in the layer whose block holds it. */
function flag(field: string, flags: string): (xml: string) => string {
  return (xml) => xml.replace(`<field configurationFlags="NoFlag" name="${field}"/>`, `<field configurationFlags="${flags}" name="${field}"/>`)
}

describe('generateServerStacCatalogue', () => {
  it('gives each Collection the layer\'s WMS name as its id', () => {
    expect([...byId(serve(project())).keys()].sort()).toEqual(['Inspections', 'Street trees'])
  })

  it('reaches the data only through the server', () => {
    const trees = byId(serve(project())).get('Street trees')!
    expect(trees.links).toEqual([{ rel: 'wms', href: SERVER, type: 'image/png', 'wms:layers': ['Street trees'], 'wms:styles': [''], 'wms:transparent': true, 'quac:wms_crs': 'EPSG:3857' }])
    expect(Object.keys(trees.assets ?? {})).toEqual(['data'])
    expect(trees.assets!.data!.href).toBe(`${SERVER}&SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=Street_trees&OUTPUTFORMAT=application%2Fjson`)
    expect(trees['quac:wfs_endpoint']).toBe(SERVER)
    expect(trees['quac:wfs_type_name']).toBe('Street_trees')
  })

  it('names no file of the project', () => {
    expect(JSON.stringify(serve(project()))).not.toMatch(/geojson|\.qgs#/)
  })

  it('gives a layer not published for WFS a WMS link only, and no editing', () => {
    const trees = byId(serve(project({ wfs: [INSPECTIONS_ID] }))).get('Street trees')!
    expect(trees.assets).toBeUndefined()
    expect(trees['quac:wfs_endpoint']).toBeUndefined()
    expect(trees['quac:editable']).toBe(false)
    expect(trees.links.map((link) => link.rel)).toEqual(['wms'])
  })

  it('leaves out a layer the project leaves out of WMS, though it is published for WFS, and drops a relation to it', () => {
    const served = byId(serve(project({ restricted: ['Street trees'] })))
    expect([...served.keys()]).toEqual(['Inspections'])
    expect(served.get('Inspections')!['quac:related_to']).toBeUndefined()
  })

  it('leaves out every layer inside a group the project leaves out of WMS', () => {
    const grouped = project({
      restricted: ['Hidden group'],
      edit: (xml) => xml.replace(/(<layer-tree-layer[^>]*id="street_trees[^"]*">[\s\S]*?<\/layer-tree-layer>)/, '<layer-tree-group name="Hidden group" checked="Qt::Checked" expanded="1">$1</layer-tree-group>')
    })
    const catalog = serve(grouped)
    expect([...byId(catalog).keys()]).toEqual(['Inspections'])
    expect(catalog.catalogs).toBeUndefined()
  })

  it('rewrites a relation to the parent\'s WMS name', () => {
    expect(byId(serve(project())).get('Inspections')!['quac:related_to']).toEqual([
      { id: 'tree_inspections_rel', name: 'Inspections', parent_collection_id: 'Street trees', fields: [{ parent: 'tree_id', child: 'tree_id' }] }
    ])
  })

  it('leaves out a field hidden from WMS, from WFS or from both, read from configurationFlags', () => {
    const served = byId(serve(project({ edit: (xml) => flag('species', 'HideFromWms')(flag('planted', 'HideFromWfs')(xml)) })))
    expect(columnNames(served.get('Street trees'))).toEqual(['tree_id'])
  })

  it('reads the fields a project saved by QGIS 3.14 or older excludes', () => {
    const legacy = project({ edit: (xml) => xml.replace('<layername>Street trees</layername>', '<layername>Street trees</layername><excludeAttributesWFS><attribute>species</attribute></excludeAttributesWFS>') })
    expect(columnNames(byId(serve(legacy)).get('Street trees'))).toEqual(['tree_id', 'planted'])
  })

  it('drops a relation joined on a hidden field', () => {
    const served = byId(serve(project({ edit: flag('tree_id', 'HideFromWms|HideFromWfs') })))
    expect(served.get('Inspections')!['quac:related_to']).toBeUndefined()
  })

  it('drops the display field where it is hidden', () => {
    const plain = byId(serve(project())).get('Street trees')!
    expect(plain['quac:display_field']).toBe('species')
    const hidden = byId(serve(project({ edit: flag('species', 'HideFromWfs') }))).get('Street trees')!
    expect(hidden['quac:display_field']).toBeUndefined()
  })

  it('drops each expression that uses a hidden field, and keeps the rest', () => {
    const forms = '<constraints><constraint field="planted" constraints="4" notnull_strength="0" unique_strength="0" exp_strength="1"/></constraints>'
      + '<constraintExpressions><constraint field="planted" exp="&quot;species&quot; IS NOT NULL" desc=""/></constraintExpressions>'
      + '<defaults><default field="tree_id" expression="&quot;species&quot; || \'-1\'" applyOnUpdate="0"/><default field="planted" expression="now()" applyOnUpdate="0"/></defaults>'
    const withForms = (xml: string) => xml.replace('<aliases>\n        <alias field="tree_id"', `${forms}<aliases>\n        <alias field="tree_id"`)
    const columnsOf = (xml: string) => new Map(((byId(serve(xml)).get('Street trees')!['table:columns'] ?? []) as TableColumn[]).map((column) => [column.name, column]))

    const shown = columnsOf(project({ edit: withForms }))
    expect(shown.get('planted')!['quac:constraints']).toBeDefined()
    expect(shown.get('tree_id')!['quac:default']).toBeDefined()

    const hidden = columnsOf(project({ edit: (xml) => flag('species', 'HideFromWfs')(withForms(xml)) }))
    expect(hidden.get('planted')!['quac:constraints']).toBeUndefined()
    expect(hidden.get('tree_id')!['quac:default']).toBeUndefined()
    expect(hidden.get('planted')!['quac:default']).toEqual({ kind: 'now', on_update: false })
  })

  it('locks an edit for every feature where its lock\'s expression uses a hidden field', () => {
    const lock = '<customproperties><Option type="Map">'
      + '<Option type="bool" name="QFieldSync/is_attribute_editing_locked" value="false"/>'
      + '<Option type="bool" name="QFieldSync/is_attribute_editing_locked_expression_active" value="true"/>'
      + '<Option type="QString" name="QFieldSync/attribute_editing_locked_expression" value="&quot;species&quot; = \'oak\'"/>'
      + '</Option></customproperties>'
    const withLock = (xml: string) => xml.replace('<layername>Street trees</layername>', `<layername>Street trees</layername>${lock}`)
    expect(byId(serve(project({ edit: withLock }))).get('Street trees')!['quac:locks']).toEqual({ attributes: { expression: '"species" = \'oak\'' } })
    expect(byId(serve(project({ edit: (xml) => flag('species', 'HideFromWms')(withLock(xml)) }))).get('Street trees')!['quac:locks']).toEqual({ attributes: true })
  })

  describe('on a form', () => {
    /** A one-layer project published for WFS: `notes` is editable while `last_inspected` is empty, and `photo` is an attachment kept under a folder of the author's. */
    function formProject(lastInspectedFlags: string): string {
      const editable = '<field name="notes"><Option type="Map"><Option type="QString" value="" name="name"/><Option type="Map" name="properties">'
        + '<Option type="Map" name="dataDefinedEditable"><Option type="bool" value="true" name="active"/>'
        + '<Option type="QString" value="&quot;last_inspected&quot; IS NULL" name="expression"/><Option type="int" value="3" name="type"/></Option>'
        + '</Option><Option type="QString" value="collection" name="type"/></Option></field>'
      const attachment = '<editWidget type="ExternalResource"><config><Option type="Map">'
        + '<Option type="QString" value="C:\\Users\\author\\survey\\photos" name="DefaultRoot"/><Option type="int" value="1" name="RelativeStorage"/>'
        + '</Option></config></editWidget>'
      const fields = ['last_inspected', 'notes', 'photo']
      return '<?xml version="1.0" encoding="UTF-8"?><qgis version="3.44.8-Solothurn" projectname="Form">'
        + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
        + '<projectlayers><maplayer type="vector" geometry="Point"><id>assets_1</id><layername>Assets</layername>'
        + '<datasource>./assets.geojson</datasource><provider>ogr</provider><srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
        + '<fieldConfiguration>'
        + `<field name="last_inspected" configurationFlags="${lastInspectedFlags}"><editWidget type="TextEdit"><config><Option/></config></editWidget></field>`
        + '<field name="notes" configurationFlags="NoFlag"><editWidget type="TextEdit"><config><Option/></config></editWidget></field>'
        + `<field name="photo" configurationFlags="NoFlag">${attachment}</field>`
        + '</fieldConfiguration><editorlayout>tablayout</editorlayout><attributeEditorForm>'
        + fields.map((name, index) => `<attributeEditorField index="${index}" name="${name}" showLabel="1"/>`).join('')
        + `</attributeEditorForm><dataDefinedFieldProperties>${editable}</dataDefinedFieldProperties>`
        + '</maplayer></projectlayers>'
        + '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'
        + `<properties>${values('WFSLayers', ['assets_1'])}<WFSTLayers>${values('Insert', ['assets_1'])}${values('Update', ['assets_1'])}${values('Delete', ['assets_1'])}</WFSTLayers></properties>`
        + '</qgis>'
    }

    function columnsOf(xml: string): Map<string, TableColumn> {
      return new Map(((byId(serve(xml)).get('Assets')!['table:columns'] ?? []) as TableColumn[]).map((column) => [column.name, column]))
    }

    it('makes a field read-only where the expression deciding when it is editable uses a hidden field', () => {
      const shown = columnsOf(formProject('NoFlag')).get('notes')!
      expect(shown['quac:editable_when']).toBe('"last_inspected" IS NULL')
      expect(shown['quac:editable']).toBeUndefined()

      const hidden = columnsOf(formProject('HideFromWfs')).get('notes')!
      expect(hidden['quac:editable_when']).toBeUndefined()
      expect(hidden['quac:editable']).toBe(false)
    })

    it('leaves out an attachment\'s default folder', () => {
      const photo = columnsOf(formProject('NoFlag')).get('photo')!
      expect(photo['quac:attachment']).toEqual({ relative_storage: 'project' })
      expect(JSON.stringify(serve(formProject('NoFlag')))).not.toContain('author')
    })
  })

  it('asks for EPSG:3857 where the project restricts no CRS, or where its restriction lists it', () => {
    const crsOf = (xml: string) => byId(serve(xml)).get('Street trees')!.links[0]!['quac:wms_crs']
    expect(crsOf(project())).toBe('EPSG:3857')
    expect(crsOf(project({ edit: (xml) => xml.replace('</properties>', `${values('WMSCrsList', ['EPSG:4326', 'EPSG:3857'])}</properties>`) }))).toBe('EPSG:3857')
  })

  it('asks for the first CRS the project restricts its WMS layers to where EPSG:3857 is not one', () => {
    const xml = project({ edit: (text) => text.replace('</properties>', `${values('WMSCrsList', ['EPSG:28350', 'EPSG:4326'])}</properties>`) })
    expect(byId(serve(xml)).get('Street trees')!.links[0]!['quac:wms_crs']).toBe('EPSG:28350')
  })

  it('refuses a server address holding a password, or not on the web', () => {
    const parsed = parseQgsXml(project())
    expect(() => generateServerStacCatalogue(parsed, { serverAddress: 'https://user:secret@qgis.example.com/ows' })).toThrow(/no user name, password/)
    expect(() => generateServerStacCatalogue(parsed, { serverAddress: 'https://qgis.example.com/ows?MAP=postgresql://user:secret@db/qgis' })).toThrow(/in its query either/)
    expect(() => generateServerStacCatalogue(parsed, { serverAddress: 'file:///projects/ows' })).toThrow(/http or https/)
  })

  it('lists the QUAC schema on the top-level Catalog', () => {
    expect(serve(project()).stac_extensions).toEqual([QUAC_SCHEMA_URL])
  })

  it('gives each column the type QGIS Server reports for its field, with its data type', () => {
    const fieldTypes = { [TREES_ID]: { tree_id: { type: 'qlonglong', typeName: 'Integer64' }, species: { type: 'QString', typeName: 'String' } } }
    const trees = byId(JSON.parse(JSON.stringify(generateServerStacCatalogue(parseQgsXml(project()), { serverAddress: SERVER, fieldTypes }))) as StacCatalog).get('Street trees')!
    const columns = trees['table:columns'] as TableColumn[]
    expect(columns.find((column) => column.name === 'tree_id')).toMatchObject({ type: 'long', data_type: 'int64' })
    expect(columns.find((column) => column.name === 'species')).toMatchObject({ type: 'string', data_type: 'other' })
    expect(columns.filter((column) => column.type !== undefined).map((column) => column.name).sort()).toEqual(['species', 'tree_id'])
  })

  it('takes the box of a layer whose project saves none from QGIS Server, and covers only the served layers at the top', () => {
    const box = { xmin: 115.8, ymin: -32.0, xmax: 115.9, ymax: -31.9 }
    const away = { xmin: 0, ymin: 0, xmax: 1, ymax: 1 }
    const parsed = parseQgsXml(project({ restricted: ['Inspections'] }))
    const trees = parsed.layers.find((layer) => layer.id === TREES_ID)!
    const inspections = parsed.layers.find((layer) => layer.id === INSPECTIONS_ID)!
    trees.wgs84Extent = null
    inspections.wgs84Extent = away
    const served = JSON.parse(JSON.stringify(generateServerStacCatalogue(parsed, { serverAddress: SERVER, layerWgs84Extents: { [TREES_ID]: box } }))) as StacCatalog
    expect(byId(served).get('Street trees')!.extent.spatial.bbox).toEqual([[115.8, -32.0, 115.9, -31.9]])
    expect((served['extent'] as { spatial: { bbox: number[][] } }).spatial.bbox).toEqual([[115.8, -32.0, 115.9, -31.9]])
  })

  it.each(serverAddresses.cases)('names $address in a WMS link as $wms', ({ address, wms }) => {
    expect(serverWmsEndpoint(address)).toBe(wms)
  })
})
