import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'


import { readCollectionIdentifiable } from './normalizedProject.ts'
import { generateStacCatalogue } from './stacCatalogue.ts'
import { generateStacCatalogueFromWms } from './wmsStacCatalogue.ts'
import { parseGetProjectSettings } from '../parse/parseGetProjectSettings.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'

function mapLayerXml(id: string, name: string, flags: string): string {
  return `<maplayer type="vector" geometry="Line"><id>${id}</id><datasource>./${id}.json</datasource>`
    + `<layername>${name}</layername><provider encoding="UTF-8">ogr</provider>${flags}</maplayer>`
}

describe('QGIS project — Identifiable flag', () => {
  const project = parseQgsXml(
    '<qgis version="3.44.8-Solothurn"><title>Flags</title>'
    + '<layer-tree-group>'
    + '<layer-tree-layer id="glen" name="Glen Eira" checked="Qt::Checked"/>'
    + '<layer-tree-layer id="parcels" name="Parcels" checked="Qt::Checked"/>'
    + '<layer-tree-layer id="roads" name="Roads" checked="Qt::Checked"/>'
    + '</layer-tree-group><projectlayers>'
    + mapLayerXml('glen', 'Glen Eira', '<flags><Identifiable>0</Identifiable><Removable>1</Removable></flags>')
    + mapLayerXml('parcels', 'Parcels', '<flags><Identifiable>1</Identifiable></flags>')
    + mapLayerXml('roads', 'Roads', '')
    + '</projectlayers></qgis>'
  )
  const collections = generateStacCatalogue(project).collections ?? []
  const identifiableOf = (title: string) => {
    const collection = collections.find((entry) => entry.title === title)
    if (!collection) throw new Error(`No Collection titled ${title}`)
    return readCollectionIdentifiable(collection)
  }

  it('publishes a layer with Identifiable off as not identifiable', () => {
    expect(project.layers.find((layer) => layer.name === 'Glen Eira')?.queryable).toBe(false)
    expect(identifiableOf('Glen Eira')).toBe(false)
  })

  it('publishes a layer with Identifiable on as identifiable', () => {
    expect(identifiableOf('Parcels')).toBe(true)
  })

  it('treats a layer with no flags as identifiable, as QGIS does', () => {
    expect(identifiableOf('Roads')).toBe(true)
  })
})

describe('QGIS Server project — queryable attribute', () => {
  const project = parseGetProjectSettings(
    '<WMS_Capabilities version="1.3.0"><Service><Title>Server</Title></Service><Capability>'
    + '<Layer queryable="1"><Name>root</Name>'
    + '<Layer queryable="0" visibilityChecked="1"><Name>Glen Eira</Name></Layer>'
    + '<Layer queryable="1" visibilityChecked="1"><Name>Parcels</Name></Layer>'
    + '<Layer visibilityChecked="1"><Name>Roads</Name></Layer>'
    + '</Layer></Capability></WMS_Capabilities>'
  )
  const collections = generateStacCatalogueFromWms(project).catalogs?.[0]?.collections ?? []
  const identifiableOf = (title: string) => {
    const collection = collections.find((entry) => entry.title === title)
    if (!collection) throw new Error(`No Collection titled ${title}`)
    return readCollectionIdentifiable(collection)
  }

  it('publishes queryable="0" as not identifiable', () => {
    expect(identifiableOf('Glen Eira')).toBe(false)
  })

  it('publishes queryable="1" as identifiable', () => {
    expect(identifiableOf('Parcels')).toBe(true)
  })

  it('treats a layer that states nothing as identifiable', () => {
    expect(identifiableOf('Roads')).toBe(true)
  })
})
