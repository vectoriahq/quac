import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { readCollectionLegendImage } from './normalizedProject'
import { generateStacCatalogue } from './stacCatalogue'
import { parseQgsXml } from '../parse/parseQgsXml'

import type { StacCollection } from '../model/Stac'

/** A QGIS layer's legend placeholder image, through to `quac:legend_image` on its Collection and back out again. */

const LAYER_TREE =
  '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'
const FIELDS = '<fieldConfiguration><field name="notes" configurationFlags="NoFlag"><editWidget type="TextEdit"><config><Option/></config></editWidget></field></fieldConfiguration>'

describe('quac:legend_image', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='

  function collectionWith(placeholder: string): StacCollection {
    const project = parseQgsXml(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<qgis version="3.44.8-Solothurn" projectname="Legend">'
      + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
      + `<projectlayers><maplayer type="vector" geometry="Point" legendPlaceholderImage="${placeholder}">`
      + '<id>assets_1</id><layername>Assets</layername>'
      + '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
      + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
      + FIELDS
      + '</maplayer></projectlayers>'
      + LAYER_TREE
      + '</qgis>'
    )
    return generateStacCatalogue(project).collections![0]!
  }

  it('writes an image QGIS embeds, typed by its bytes, and reads it back', () => {
    const collection = collectionWith(`base64:${PNG}`)
    expect(collection['quac:legend_image']).toBe(`data:image/png;base64,${PNG}`)
    expect(readCollectionLegendImage(collection)).toBe(`data:image/png;base64,${PNG}`)
  })

  it('keeps a data URL as written', () => {
    expect(collectionWith(`data:image/png;base64,${PNG}`)['quac:legend_image']).toBe(`data:image/png;base64,${PNG}`)
  })

  it('writes nothing for no image, a file, a web address or bytes of no image type', () => {
    for (const placeholder of ['', './legend.png', 'https://example.test/legend.png', 'base64:bm90IGFuIGltYWdl']) {
      expect(collectionWith(placeholder)).not.toHaveProperty('quac:legend_image')
    }
  })
})

