import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { parseWmsCrsList, parseWmsPublishing } from './parseWmsPublishing.ts'

function rootOf(properties: string): Element {
  return new DOMParser().parseFromString(`<qgis><properties>${properties}</properties></qgis>`, 'text/xml').documentElement
}

describe('parseWmsPublishing', () => {
  it('reads Use layer ids as names and the layers left out of WMS, in the QGIS 3 shape', () => {
    const root = rootOf('<WMSUseLayerIDs type="bool">true</WMSUseLayerIDs><WMSRestrictedLayers type="QStringList"><value>Private notes</value></WMSRestrictedLayers>')
    expect(parseWmsPublishing(root)).toEqual({ useLayerIds: true, restrictedLayers: ['Private notes'] })
  })

  it('reads the QGIS 4 shape', () => {
    const root = rootOf('<properties name="WMSUseLayerIDs" type="bool">false</properties>')
    expect(parseWmsPublishing(root)).toEqual({ useLayerIds: false, restrictedLayers: [] })
  })

  it('is null for a project that saves neither', () => {
    expect(parseWmsPublishing(rootOf(''))).toBeNull()
  })
})

describe('parseWmsCrsList', () => {
  it('reads the CRSs the project restricts its WMS layers to, in the QGIS 3 and QGIS 4 shapes', () => {
    expect(parseWmsCrsList(rootOf('<WMSCrsList type="QStringList"><value>EPSG:28350</value><value></value><value>EPSG:4326</value></WMSCrsList>'))).toEqual(['EPSG:28350', 'EPSG:4326'])
    expect(parseWmsCrsList(rootOf('<properties name="WMSCrsList" type="QStringList"><value>EPSG:7850</value></properties>'))).toEqual(['EPSG:7850'])
  })

  it('reads the older list of EPSG codes where the project saves no CRS list', () => {
    expect(parseWmsCrsList(rootOf('<WMSEpsgList type="QStringList"><value>28350</value><value>not a code</value></WMSEpsgList>'))).toEqual(['EPSG:28350'])
  })

  it('is empty for a project that restricts none', () => {
    expect(parseWmsCrsList(rootOf(''))).toEqual([])
  })
})
