import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { readCollectionFieldValues } from './normalizedProject.ts'
import { generateStacCatalogue } from './stacCatalogue.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'

import type { StacCollection } from '../model/Stac.ts'

/**
 * A QGIS Value Map widget through to `values` on the field's `table:columns`
 * entry and back out. The list form is the one `qgsMetadata.test.ts` authors;
 * the flat form and the blank code are read by
 * `QgsValueMapFieldFormatter::representValue`
 * (`src/core/fieldformatter/qgsvaluemapfieldformatter.cpp`, `qgis/QGIS@master`,
 * read 2026-10-23).
 */

const LAYER_TREE =
  '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'

function collectionFor(configXml: string): StacCollection {
  const project = parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Maps">'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + '<projectlayers><maplayer type="vector" geometry="Point">'
    + '<id>assets_1</id><layername>Assets</layername>'
    + '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + '<fieldConfiguration><field name="condition" configurationFlags="NoFlag">'
    + `<editWidget type="ValueMap"><config><Option type="Map">${configXml}</Option></config></editWidget>`
    + '</field></fieldConfiguration>'
    + '</maplayer></projectlayers>'
    + LAYER_TREE
    + '</qgis>'
  )
  return generateStacCatalogue(project).collections![0]!
}

const entry = (label: string, value: string) => `<Option type="Map"><Option type="QString" name="${label}" value="${value}"/></Option>`

describe('a Value Map widget on a table:columns entry', () => {
  it('reads the blank code as a blank entry', () => {
    const collection = collectionFor(
      '<Option type="List" name="map">'
      + entry('Good', 'G')
      + entry('Not assessed', '{2839923C-8B7D-419E-B84B-CA2FE9B80EC7}')
      + '</Option>'
    )

    expect(readCollectionFieldValues(collection)).toEqual({
      condition: [{ value: 'G', label: 'Good' }, { value: '', label: 'Not assessed' }]
    })
  })

  it('reads the older flat form, one entry per child', () => {
    const collection = collectionFor(
      '<Option type="Map" name="map">'
      + '<Option type="QString" name="Good" value="G"/>'
      + '<Option type="QString" name="Poor" value="P"/>'
      + '</Option>'
    )

    expect(readCollectionFieldValues(collection)).toEqual({
      condition: [{ value: 'G', label: 'Good' }, { value: 'P', label: 'Poor' }]
    })
  })
})
