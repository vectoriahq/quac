import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { generateStacCatalogue } from './stacCatalogue'
import { parseQgsXml } from '../parse/parseQgsXml'
import graffitiFixtureXml from '../tests/fixtures/qgis/graffiti/graffiti.qgs?raw'

/**
 * The QGIS project and layer metadata QGIS's Metadata dialog writes
 * (`<projectMetadata>`, `<resourceMetadata>`, `<attribution>`), and a
 * ValueMap edit widget's picklist — package 6 of the Portolan alignment plan.
 * Element names verified against `src/data/sample/graffiti/graffiti.qgs`
 * (resourceMetadata, attribution) and, for the license and ValueMap shapes no
 * fixture in this repo populates, against QGIS's own source
 * (`qgis/QGIS@master`, read 2026-08-12 — cited beside the parser functions in
 * `packages/quac/src/parse/parseLayers.ts`).
 */

const METADATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qgis version="3.44.8-Solothurn" projectname="Metadata test">
  <title>Metadata test</title>
  <projectCrs>
    <spatialrefsys>
      <authid>EPSG:4326</authid>
    </spatialrefsys>
  </projectCrs>
  <projectlayers>
    <maplayer type="vector" geometry="Point">
      <id>sites_1</id>
      <layername>Sites</layername>
      <datasource>./sites.geojson</datasource>
      <provider>ogr</provider>
      <srs>
        <spatialrefsys>
          <authid>EPSG:4326</authid>
        </spatialrefsys>
      </srs>
      <map-layer-style-manager current="default">
        <map-layer-style name="Archived">
          <qgis>
            <fieldConfiguration>
              <field name="status" configurationFlags="NoFlag">
                <editWidget type="ValueMap">
                  <config>
                    <Option type="Map">
                      <Option type="List" name="map">
                        <Option type="Map">
                          <Option type="QString" name="Decoy" value="decoy"/>
                        </Option>
                      </Option>
                    </Option>
                  </config>
                </editWidget>
              </field>
            </fieldConfiguration>
          </qgis>
        </map-layer-style>
      </map-layer-style-manager>
      <resourceMetadata>
        <identifier></identifier>
        <parentidentifier></parentidentifier>
        <language></language>
        <type>dataset</type>
        <title></title>
        <abstract>Monitoring sites visited each quarter.</abstract>
        <contact>
          <name>Jamie Lee</name>
          <organization>Coastal Catchments Authority</organization>
          <position></position>
          <voice></voice>
          <fax></fax>
          <email>jamie.lee@example.test</email>
          <role></role>
        </contact>
        <links/>
        <license>CC-BY-4.0</license>
        <keywords vocabulary="gmd:topicCategory">
          <keyword>environment</keyword>
          <keyword>monitoring</keyword>
        </keywords>
        <fees></fees>
        <encoding></encoding>
        <extent>
          <spatial crs="EPSG:4326" minx="0" miny="0" maxx="0" maxy="0" minz="0" maxz="0"/>
          <temporal>
            <period>
              <start>2026-01-01T00:00:00</start>
              <end>2026-06-30T00:00:00</end>
            </period>
          </temporal>
        </extent>
      </resourceMetadata>
      <attribution href="https://coastal.example.test">Coastal Catchments Authority</attribution>
      <fieldConfiguration>
        <field name="status" configurationFlags="NoFlag">
          <editWidget type="ValueMap">
            <config>
              <Option type="Map">
                <Option type="List" name="map">
                  <Option type="Map">
                    <Option type="QString" name="Waiting" value="waiting"/>
                  </Option>
                  <Option type="Map">
                    <Option type="QString" name="Actioned" value="actioned"/>
                  </Option>
                </Option>
              </Option>
            </config>
          </editWidget>
        </field>
      </fieldConfiguration>
    </maplayer>
  </projectlayers>
  <projectMetadata>
    <identifier></identifier>
    <parentidentifier></parentidentifier>
    <language></language>
    <type></type>
    <title></title>
    <abstract>Quarterly monitoring project for the coastal catchments region.</abstract>
    <contact>
      <name></name>
      <organization></organization>
      <position></position>
      <voice></voice>
      <fax></fax>
      <email></email>
      <role></role>
    </contact>
    <links/>
    <author>Jamie Lee</author>
    <creation>2026-01-01T00:00:00</creation>
  </projectMetadata>
  <layer-tree-group>
    <layer-tree-layer id="sites_1" checked="Qt::Checked" name="Sites"/>
  </layer-tree-group>
</qgis>`

describe('QGIS metadata flowing into the generated catalogue', () => {
  const project = parseQgsXml(METADATA_XML)
  const catalog = generateStacCatalogue(project)
  const collection = catalog.collections![0]!

  it('takes the project abstract as the Catalog description', () => {
    expect(catalog.description).toBe('Quarterly monitoring project for the coastal catchments region.')
  })

  it('takes the layer abstract as the Collection description', () => {
    expect(collection.description).toBe('Monitoring sites visited each quarter.')
  })

  it('takes the layer’s own licence over the default', () => {
    expect(collection.license).toBe('CC-BY-4.0')
  })

  it('takes the layer keywords', () => {
    expect(collection.keywords).toEqual(['environment', 'monitoring'])
  })

  it('combines the project author, the layer’s attribution and its contact into providers', () => {
    expect(collection.providers).toEqual([
      { name: 'Jamie Lee', roles: ['producer'] },
      { name: 'Coastal Catchments Authority', roles: ['licensor'], url: 'https://coastal.example.test' },
      {
        name: 'Coastal Catchments Authority',
        roles: ['producer'],
        url: 'mailto:jamie.lee@example.test'
      }
    ])
  })

  it('takes the declared temporal range over the open interval', () => {
    expect(collection.extent.temporal.interval).toEqual([
      ['2026-01-01T00:00:00', '2026-06-30T00:00:00']
    ])
  })

  // Also guards against reading a ValueMap out of a saved alternate style's
  // embedded `<fieldConfiguration>` instead of the layer's own: the fixture's
  // "Archived" style declares a decoy map for the same field, ahead of the
  // real one in document order.
  it('carries the ValueMap picklist on its field’s table:columns entry, not a saved style’s decoy', () => {
    const columns = collection['table:columns'] as { name: string, values?: unknown }[]
    const statusColumn = columns.find((c) => c.name === 'status')
    expect(statusColumn?.values).toEqual([
      { value: 'waiting', label: 'Waiting' },
      { value: 'actioned', label: 'Actioned' }
    ])
  })
})

// The elements QGIS's Metadata dialog writes on every project, empty fields
// and all — verified against `src/data/sample/graffiti/graffiti.qgs`.
const EMPTY_RESOURCE_METADATA_XML = `
      <resourceMetadata>
        <identifier></identifier>
        <parentidentifier></parentidentifier>
        <language></language>
        <type></type>
        <title></title>
        <abstract></abstract>
        <contact>
          <name></name>
          <organization></organization>
          <position></position>
          <voice></voice>
          <fax></fax>
          <email></email>
          <role></role>
        </contact>
        <links/>
        <dates/>
        <fees></fees>
        <encoding></encoding>
        <extent>
          <spatial crs="EPSG:4326" minx="0" miny="0" maxx="0" maxy="0" minz="0" maxz="0"/>
          <temporal>
            <period>
              <start></start>
              <end></end>
            </period>
          </temporal>
        </extent>
      </resourceMetadata>`

const NO_METADATA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qgis version="3.44.8-Solothurn">
  <title></title>
  <projectCrs>
    <spatialrefsys>
      <authid>EPSG:4326</authid>
    </spatialrefsys>
  </projectCrs>
  <projectlayers>
    <maplayer type="vector" geometry="Point">
      <id>sites_1</id>
      <layername>Sites</layername>
      <datasource>./sites.geojson</datasource>
      <provider>ogr</provider>
      <srs>
        <spatialrefsys>
          <authid>EPSG:4326</authid>
        </spatialrefsys>
      </srs>${EMPTY_RESOURCE_METADATA_XML}
    </maplayer>
  </projectlayers>
  <projectMetadata>
    <identifier></identifier>
    <parentidentifier></parentidentifier>
    <language></language>
    <type></type>
    <title></title>
    <abstract></abstract>
    <contact>
      <name></name>
      <organization></organization>
      <position></position>
      <voice></voice>
      <fax></fax>
      <email></email>
      <role></role>
    </contact>
    <links/>
  </projectMetadata>
  <layer-tree-group>
    <layer-tree-layer id="sites_1" checked="Qt::Checked" name="Sites"/>
  </layer-tree-group>
</qgis>`

describe('a project with no metadata filled in', () => {
  // QGIS writes both metadata blocks on every project, empty fields and all,
  // so this is what "today's output unchanged" actually exercises.
  const project = parseQgsXml(NO_METADATA_XML)
  const catalog = generateStacCatalogue(project)
  const collection = catalog.collections![0]!

  it('keeps the boilerplate Catalog description', () => {
    expect(catalog.description).toBe('STAC catalogue generated from a QGIS project.')
  })

  it('keeps the boilerplate Collection description and the default licence', () => {
    expect(collection.description).toBe('Layer "Sites" from the QGIS project.')
    expect(collection.license).toBe('other')
  })

  it('carries no keywords or providers', () => {
    expect(collection.keywords).toBeUndefined()
    expect(collection.providers).toBeUndefined()
  })

  it('keeps the open temporal interval', () => {
    expect(collection.extent.temporal.interval).toEqual([[null, null]])
  })
})

describe('the real graffiti fixture, whose project author is filled in but its layers’ metadata is not', () => {
  // Verifies the project-wide default reaches a layer with no metadata of its
  // own, distinct from the fully-empty case above.
  const project = parseQgsXml(graffitiFixtureXml)
  const catalog = generateStacCatalogue(project)
  const collection = catalog.collections!.find((c) => c.title === 'Schools')!

  it('puts the project author on a layer that declares no attribution or contact of its own', () => {
    expect(collection.providers).toEqual([{ name: 'Vectoria', roles: ['producer'] }])
  })
})
