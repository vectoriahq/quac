import '../tests/linkedomDomParser.ts'

import { describe, expect, it, vi } from 'vitest'

import { parseQgsXml } from './parseQgsXml.ts'

// Reading a layer's styles fails for the layer named `broken`, standing for any
// failure part way through reading a layer.
vi.mock('./parseStyle.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./parseStyle.ts')>()
  return {
    ...original,
    parseLayerStyles: (maplayer: Element) => {
      if (maplayer.querySelector('id')?.textContent === 'broken') throw new Error('unreadable')
      return original.parseLayerStyles(maplayer)
    }
  }
})

const layer = (id: string, datasource: string) => `<maplayer type="vector" geometry="Point">
  <id>${id}</id><layername>${id} layer</layername><datasource>${datasource}</datasource><provider>ogr</provider>
  <fieldConfiguration><field name="kind"><editWidget type="Classification"/></field></fieldConfiguration>
</maplayer>`

describe('parseQgsXml notes for a layer it cannot read', () => {
  it('notes the layer once, without the notes it had gathered before failing', () => {
    const project = parseQgsXml(`<qgis><title>Broken</title><projectlayers>
      ${layer('broken', 'mssql:dbname=survey')}
      ${layer('sites', './sites.geojson')}
    </projectlayers></qgis>`)
    expect(project.layers.map((entry) => entry.id)).toEqual(['sites'])
    expect(project.notes).toEqual([
      { layerId: 'broken', layerName: 'broken layer', field: null, reason: 'layer', text: null },
      { layerId: 'sites', layerName: 'sites layer', field: 'kind', reason: 'widget', text: 'Classification' }
    ])
  })
})
