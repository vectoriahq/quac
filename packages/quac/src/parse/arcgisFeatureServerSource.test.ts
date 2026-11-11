import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { parseDataSource } from './parseDataSource.ts'
import { parseQgsXml } from './parseQgsXml.ts'
import { readArcgisNotShownReason, resolveArcgisCollectionSource } from '../generate/arcgisStacCatalogue.ts'
import { generateStacCatalogue } from '../generate/stacCatalogue.ts'
import { readDataAsset } from '../model/stacAssetRoles.ts'
import { collectCatalogueCollections } from '../model/stacTreeWalk.ts'
import kindersXml from '../tests/fixtures/qgis/arcgis-feature-service/kinders.qgs?raw'

const KINDERS_URL = 'https://gis.example.test/arcgis/rest/services/Kinders/FeatureServer/0'

describe('a QGIS layer read through the arcgisfeatureserver provider', () => {
  it('reads the Kinders fixture\'s layer as an ArcGIS service layer with no filter', () => {
    const [layer] = parseQgsXml(kindersXml).layers
    expect(layer?.dataSource).toMatchObject({ kind: 'arcgis', url: KINDERS_URL, where: null })
  })

  it('reads the source\'s sql= as the where clause QGIS sends', () => {
    const source = parseDataSource(`crs='EPSG:3857' url='${KINDERS_URL}' sql="LOCALITY" = 'Northvale'`, 'arcgisfeatureserver')
    expect(source).toMatchObject({ kind: 'arcgis', url: KINDERS_URL, where: '"LOCALITY" = \'Northvale\'' })
  })

  it('reads a MapServer layer too', () => {
    const url = 'https://example.org/arcgis/rest/services/Parks/MapServer/3'
    expect(parseDataSource(`url='${url}'`, 'arcgisfeatureserver')).toMatchObject({ kind: 'arcgis', url })
  })

  it.each([
    ['a sign-in', `authcfg='abc1234' url='${KINDERS_URL}'`],
    ['a referer', `referer='https://example.org' url='${KINDERS_URL}'`],
    ['an HTTP header', `http-header:referer='https://example.org' url='${KINDERS_URL}'`],
    ['a URL prefix', `urlprefix='https://proxy.example.org/?' url='${KINDERS_URL}'`],
    ['a box limiting its features', `bbox='16182127,-4617048,16221681,-4567207' url='${KINDERS_URL}'`],
    ['an address that is the whole service', "url='https://gis.example.test/arcgis/rest/services/Kinders/FeatureServer'"],
    ['a token in its address', `url='${KINDERS_URL}?token=abc'`]
  ])('leaves a source with %s unsupported', (_case, raw) => {
    expect(parseDataSource(raw, 'arcgisfeatureserver')).toMatchObject({ kind: 'unsupported', hint: 'arcgisfeatureserver' })
  })

  it('reads a header key QGIS writes with no value as no header', () => {
    expect(parseDataSource(`http-header:referer='' url='${KINDERS_URL}'`, 'arcgisfeatureserver')).toMatchObject({ kind: 'arcgis' })
  })

  it('publishes the layer as an ArcGIS Online layer\'s Collection is published, keeping the project\'s Read-only tick', () => {
    const [collection] = collectCatalogueCollections(generateStacCatalogue(parseQgsXml(kindersXml)))
    expect(resolveArcgisCollectionSource(collection!)).toEqual({ layerUrl: KINDERS_URL, where: null })
    expect(readArcgisNotShownReason(collection!)).toBeNull()
    expect(readDataAsset(collection!)?.href).toBe(`${KINDERS_URL}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`)
    // Not read-only in the project: whether edits are written back to the
    // service is left to the application reading the catalogue.
    expect(collection!['quac:editable']).toBe(true)
    const ticked = kindersXml.replace(/(<maplayer[^>]*?)readOnly="0"/, '$1readOnly="1"')
    const [readOnly] = collectCatalogueCollections(generateStacCatalogue(parseQgsXml(ticked)))
    expect(readOnly!['quac:editable']).toBe(false)
  })

  it('publishes the filter as the Collection\'s where clause and in its query', () => {
    const filtered = kindersXml.replaceAll(`url='${KINDERS_URL}'`, `url='${KINDERS_URL}' sql=&quot;LOCALITY&quot; = 'Northvale'`)
    const [collection] = collectCatalogueCollections(generateStacCatalogue(parseQgsXml(filtered)))
    expect(resolveArcgisCollectionSource(collection!)).toEqual({ layerUrl: KINDERS_URL, where: '"LOCALITY" = \'Northvale\'' })
    expect(new URL(readDataAsset(collection!)!.href).searchParams.get('where')).toBe('"LOCALITY" = \'Northvale\'')
  })
})
