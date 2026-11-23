import '../tests/xmlParser.ts'

import { describe, expect, it } from 'vitest'

import { publishLayerFeatures } from './publishLayer.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'
import fixtureXml from '../tests/fixtures/qgis/related-datasets/street-trees.qgs?raw'

import type { FeatureCollection, Point } from 'geojson'

const TREES_ID = 'street_trees_5b1d0a72_4e33_4c1a_9f6d_2c8b7a1e4d90'

/** The fixture with the layers left out of WMS, a Provider Feature Filter on the trees layer, and any other edit. */
function project(options: { restricted?: string[], subset?: string, edit?: (xml: string) => string } = {}) {
  const restricted = (options.restricted ?? []).map((name) => `<value>${name}</value>`).join('')
  let xml = fixtureXml.replace('</qgis>', `<properties><WMSRestrictedLayers type="QStringList">${restricted}</WMSRestrictedLayers></properties></qgis>`)
  if (options.subset) {
    const escaped = options.subset.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    xml = xml.replace('<datasource>./street-trees.geojson</datasource>', `<datasource>./street-trees.geojson|subset=${escaped}</datasource>`)
  }
  return parseQgsXml(options.edit ? options.edit(xml) : xml)
}

/** Sets a field's configurationFlags in the layer whose block holds it. */
function flag(field: string, flags: string): (xml: string) => string {
  return (xml) => xml.replace(`<field configurationFlags="NoFlag" name="${field}"/>`, `<field configurationFlags="${flags}" name="${field}"/>`)
}

const TREES: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 't1', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { tree_id: 'T1', species: 'Elm', planted: '2001-05-01' } },
    { type: 'Feature', id: 't2', geometry: { type: 'Point', coordinates: [3, 4] }, properties: { tree_id: 'T2', species: 'Oak', planted: null } }
  ]
}

function published(result: ReturnType<typeof publishLayerFeatures<Point>>): FeatureCollection<Point> {
  if (result.kind !== 'published') throw new Error(`refused: ${result.reason}`)
  return result.features
}

describe('publishLayerFeatures', () => {
  it('publishes every feature and field of a layer the project serves with no filter and nothing hidden', () => {
    expect(published(publishLayerFeatures(project(), TREES_ID, TREES))).toEqual(TREES)
  })

  it('keeps only the features the layer\'s Provider Feature Filter keeps', () => {
    const features = published(publishLayerFeatures(project({ subset: '"species" = \'elm\'' }), TREES_ID, TREES))
    expect(features.features.map((feature) => feature.id)).toEqual(['t1'])
  })

  it('leaves out the fields hidden from WFS or from WMS, keeping the geometry and id', () => {
    const hidden = project({ edit: (xml) => flag('species', 'HideFromWms')(flag('planted', 'HideFromWfs')(xml)) })
    const [first] = published(publishLayerFeatures(hidden, TREES_ID, TREES)).features
    expect(first).toEqual({ type: 'Feature', id: 't1', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { tree_id: 'T1' } })
  })

  it('does not change the collection it was given', () => {
    const copy = structuredClone(TREES)
    publishLayerFeatures(project({ edit: flag('planted', 'HideFromWfs') }), TREES_ID, TREES)
    expect(TREES).toEqual(copy)
  })

  it('refuses a layer the project leaves out of what QGIS Server serves', () => {
    expect(publishLayerFeatures(project({ restricted: ['Street trees'] }), TREES_ID, TREES)).toEqual({ kind: 'refused', reason: 'excluded' })
  })

  it('refuses a layer whose filter it cannot read, rather than publish it whole', () => {
    expect(publishLayerFeatures(project({ subset: 'lower("species") = \'elm\'' }), TREES_ID, TREES)).toEqual({ kind: 'refused', reason: 'unreadable-filter' })
  })

  it('refuses a layer the project does not have', () => {
    expect(publishLayerFeatures(project(), 'no_such_layer', TREES)).toEqual({ kind: 'refused', reason: 'unknown-layer' })
  })
})
