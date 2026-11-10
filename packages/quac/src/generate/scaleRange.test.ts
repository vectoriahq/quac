import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { readCollectionScaleRange } from './normalizedProject.ts'
import { generateStacCatalogue } from './stacCatalogue.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'

import type { StacCollection } from '../model/Stac.ts'

/**
 * QGIS's scale-dependent visibility, from the `<maplayer>` attributes through
 * to `quac:min_scale` and `quac:max_scale` on the Collection and back out again.
 *
 * Every `.qgs` in this repo has the flag off, so the attributes are authored
 * here. Their names and the off-by-default `minScale="100000000"` are the ones
 * QGIS writes on every `<maplayer>` in `packages/quac/src/tests/fixtures/qgis/simple-styles/sample.qgs`.
 */

const LAYER_TREE =
  '<layer-tree-group><layer-tree-layer id="parcels_1" checked="Qt::Checked" name="Parcels"/></layer-tree-group>'

function projectWithScaleAttributes(attributes: string) {
  return parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Scales">'
    + '<title>Scales</title>'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + `<projectlayers><maplayer type="vector" geometry="Polygon" ${attributes}>`
    + '<id>parcels_1</id><layername>Parcels</layername>'
    + '<datasource>./parcels.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + '</maplayer></projectlayers>'
    + LAYER_TREE
    + '</qgis>'
  )
}

function collectionFor(attributes: string): StacCollection {
  return generateStacCatalogue(projectWithScaleAttributes(attributes)).collections![0]!
}

describe('QGIS scale-dependent visibility', () => {
  it('carries both limits when the flag is on', () => {
    const attributes = 'hasScaleBasedVisibilityFlag="1" minScale="25000" maxScale="1000"'
    expect(projectWithScaleAttributes(attributes).layers[0]!.scaleRange).toEqual({ minScale: 25000, maxScale: 1000 })

    const collection = collectionFor(attributes)
    expect(collection['quac:min_scale']).toBe(25000)
    expect(collection['quac:max_scale']).toBe(1000)
    expect(readCollectionScaleRange(collection)).toEqual({ minScale: 25000, maxScale: 1000 })
  })

  it('ignores the scales QGIS writes while the flag is off', () => {
    const attributes = 'hasScaleBasedVisibilityFlag="0" minScale="100000000" maxScale="0"'
    expect(projectWithScaleAttributes(attributes).layers[0]!.scaleRange).toBeNull()

    const collection = collectionFor(attributes)
    expect(collection['quac:min_scale']).toBeUndefined()
    expect(collection['quac:max_scale']).toBeUndefined()
    expect(readCollectionScaleRange(collection)).toBeNull()
  })

  it('reads 0 as no limit on that side', () => {
    const collection = collectionFor('hasScaleBasedVisibilityFlag="1" minScale="10000" maxScale="0"')
    expect(collection['quac:min_scale']).toBe(10000)
    expect(collection['quac:max_scale']).toBeUndefined()
    expect(readCollectionScaleRange(collection)).toEqual({ minScale: 10000, maxScale: null })
  })

  it('treats a flag with no limit on either side as no range', () => {
    expect(projectWithScaleAttributes('hasScaleBasedVisibilityFlag="1" minScale="0" maxScale="0"').layers[0]!.scaleRange)
      .toBeNull()
  })

  it('reads only positive numbers from a Collection', () => {
    const collection = { 'quac:min_scale': '25000', 'quac:max_scale': -5 } as unknown as StacCollection
    expect(readCollectionScaleRange(collection)).toBeNull()
  })
})
