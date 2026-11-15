import '../tests/xmlParser.ts'

import { describe, expect, it } from 'vitest'

import { parseQgsXml } from './parseQgsXml.ts'
import { generateStacCatalogue } from '../generate/stacCatalogue.ts'
import graffitiXml from '../tests/fixtures/qgis/graffiti/graffiti.qgs?raw'

import type { StacCollection } from '../model/Stac.ts'

const widget = (field: string, type: string, options = '') => `
  <field name="${field}" configurationFlags="NoFlag">
    <editWidget type="${type}"><config><Option type="Map">${options}</Option></config></editWidget>
  </field>`

const option = (name: string, value: string) => `<Option type="QString" name="${name}" value="${value}"/>`

const filters = JSON.stringify([
  { filter_name: 'Notes', layer_id: 'sites', field_name: 'note', filter_type: 'Text', sql_expression: '"note" ILIKE @@value@@' },
  { filter_name: 'Kind', layer_id: 'sites', field_name: 'no_such_field', filter_type: 'Single select', sql_expression: '"kind" IS @@value@@' },
  { filter_name: 'Kind', layer_id: 'sites', field_name: 'kind', filter_type: 'Single select', sql_expression: '"kind" IS @@value@@' }
]).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

/** A made-up project holding one setting the catalogue does not carry for each reason, beside ones it does. */
const projectXml = `<qgis version="3.44.0" projectname="Notes">
  <title>Notes</title>
  <projectlayers>
    <maplayer type="vector" geometry="Point">
      <id>sites</id>
      <layername>Sites</layername>
      <datasource>./sites.geojson</datasource>
      <provider>ogr</provider>
      <fieldConfiguration>
        ${widget('kind', 'ValueRelation', option('Layer', 'kinds') + option('Key', 'code') + option('Value', 'label'))}
        ${widget('parent', 'RelationReference')}
        ${widget('folder', 'ExternalResource', '<Option type="int" name="StorageMode" value="1"/>')}
        ${widget('owner', 'ValueRelation', option('Layer', 'owners') + option('LayerName', 'Owners') + option('Key', 'id') + option('Value', 'name'))}
        ${widget('note', 'TextEdit')}
        ${widget('surveyed', 'DateTime')}
      </fieldConfiguration>
      <defaults>
        <default field="note" expression="'none'" applyOnUpdate="0"/>
        <default field="surveyed" expression="my_python_function(&quot;kind&quot;)" applyOnUpdate="0"/>
      </defaults>
      <constraints>
        <constraint field="kind" constraints="4" exp_strength="1"/>
        <constraint field="note" constraints="4" exp_strength="2"/>
      </constraints>
      <constraintExpressions>
        <constraint field="kind" exp="&quot;kind&quot; IS NOT NULL" desc=""/>
        <constraint field="note" exp="my_python_function(&quot;note&quot;)" desc=""/>
      </constraintExpressions>
    </maplayer>
    <maplayer type="vector" geometry="NoGeometry">
      <id>kinds</id>
      <layername>Kinds</layername>
      <datasource>dbname='survey' host=db.example.test user='reader' password='secret' table="public"."kinds"</datasource>
      <provider>postgres</provider>
      <fieldConfiguration>${widget('code', 'TextEdit')}${widget('label', 'TextEdit')}</fieldConfiguration>
    </maplayer>
  </projectlayers>
  <relations>
    <relation id="sites_kinds" name="Kind of site" referencedLayer="kinds" referencingLayer="sites" strength="Association">
      <fieldRef referencedField="code" referencingField="kind"/>
    </relation>
    <relation id="sites_parcels" name="Parcel of site" referencedLayer="parcels" referencingLayer="sites" strength="Association">
      <fieldRef referencedField="id" referencingField="parent"/>
    </relation>
  </relations>
  <properties>
    <Mergin>
      <Filtering>
        <Enabled type="bool">true</Enabled>
        <Filters type="QString">${filters}</Filters>
      </Filtering>
    </Mergin>
  </properties>
</qgis>`

describe('parseQgsXml notes', () => {
  const project = parseQgsXml(projectXml)

  it('notes each setting the catalogue does not carry, and none it does', () => {
    expect(project.notes).toEqual([
      { layerId: 'sites', layerName: 'Sites', field: 'parent', reason: 'widget', text: 'RelationReference' },
      { layerId: 'sites', layerName: 'Sites', field: 'folder', reason: 'widget', text: 'ExternalResource' },
      { layerId: 'sites', layerName: 'Sites', field: 'surveyed', reason: 'default', text: 'my_python_function("kind")' },
      { layerId: 'sites', layerName: 'Sites', field: 'note', reason: 'constraint', text: 'my_python_function("note")' },
      { layerId: 'kinds', layerName: 'Kinds', field: null, reason: 'source', text: 'postgres' },
      { layerId: 'sites', layerName: 'Sites', field: 'owner', reason: 'value-relation', text: 'Owners' },
      { layerId: 'sites', layerName: 'Sites', field: null, reason: 'relation', text: 'Parcel of site' },
      { layerId: 'sites', layerName: 'Sites', field: 'no_such_field', reason: 'filter', text: null },
      { layerId: 'sites', layerName: 'Sites', field: 'note', reason: 'filter', text: 'Text' }
    ])
  })

  it('gives no part of a data source address, which can hold a password', () => {
    expect(JSON.stringify(project.notes)).not.toMatch(/secret|reader|db\.example\.test/)
  })

  it('leaves the catalogue without each noted setting and with each one it carries', () => {
    const catalogue = generateStacCatalogue(project)
    const sites = catalogue.collections?.find((collection) => collection.id === 'sites') as StacCollection
    const columns = Object.fromEntries((sites['table:columns'] as Array<Record<string, unknown>>).map((column) => [column.name, column]))
    expect(columns.kind!['quac:value_relation']).toEqual({ collection: 'kinds', key: 'code', value: 'label' })
    expect(columns.kind!['quac:constraints']).toEqual({ expression: { expression: '"kind" IS NOT NULL', strength: 'enforced' } })
    expect(columns.owner!['quac:value_relation']).toBeUndefined()
    expect(columns.note!['quac:default']).toEqual({ kind: 'fixed', value: 'none', on_update: false })
    expect(columns.note!['quac:constraints']).toBeUndefined()
    expect(columns.surveyed!['quac:default']).toBeUndefined()
    expect(columns.folder!['quac:attachment']).toBeUndefined()
    expect(sites['quac:related_to']).toEqual([expect.objectContaining({ id: 'sites_kinds' })])
    expect(sites['quac:filters']).toEqual([{ field: 'kind', name: 'Kind' }])
    // STAC requires an asset's href, so the layer whose source has no address has no data asset.
    const kinds = catalogue.collections?.find((collection) => collection.id === 'kinds') as StacCollection
    expect(kinds.assets?.data).toBeUndefined()
    expect(JSON.stringify(catalogue)).not.toMatch(/"notes":|"reason":/)
  })

  it('writes no notes for a project whose settings the catalogue all carries', () => {
    expect(parseQgsXml(graffitiXml).notes).toEqual([])
  })
})
