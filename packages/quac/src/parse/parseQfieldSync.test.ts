import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { parseQfieldSyncLocks, parseWfsTransactionLayers } from './parseQfieldSync.ts'

const element = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml').documentElement

/** A `<maplayer>` whose custom properties are saved as QGIS 3.20 and later save them. */
const layerWith = (options: Record<string, [type: string, value: string]>) => element(`<maplayer><customproperties><Option type="Map">${
  Object.entries(options).map(([name, [type, value]]) => `<Option type="${type}" name="${name}" value="${value.replaceAll('"', '&quot;')}"/>`).join('')
}</Option></customproperties></maplayer>`)

describe('parseQfieldSyncLocks', () => {
  it('reads each ticked box, and nothing for a layer QFieldSync locks nothing on', () => {
    expect(parseQfieldSyncLocks(layerWith({
      'QFieldSync/is_feature_deletion_locked': ['bool', 'true'],
      'QFieldSync/is_geometry_editing_locked': ['bool', 'true'],
      'QFieldSync/feature_deletion_locked_expression': ['QString', ''],
      'QFieldSync/action': ['QString', 'offline']
    }))).toEqual({ delete: true, geometry: true })
    expect(parseQfieldSyncLocks(layerWith({ 'QFieldSync/feature_addition_locked_expression': ['QString', ''] }))).toEqual({})
    expect(parseQfieldSyncLocks(element('<maplayer/>'))).toEqual({})
  })

  it('takes an active expression in place of the box, and the box where the expression is blank', () => {
    expect(parseQfieldSyncLocks(layerWith({
      'QFieldSync/is_attribute_editing_locked': ['bool', 'true'],
      'QFieldSync/is_attribute_editing_locked_expression_active': ['bool', 'true'],
      'QFieldSync/attribute_editing_locked_expression': ['QString', ' "status" = \'done\' '],
      'QFieldSync/is_feature_deletion_locked': ['bool', 'true'],
      'QFieldSync/is_feature_deletion_locked_expression_active': ['bool', 'true'],
      'QFieldSync/feature_deletion_locked_expression': ['QString', ' ']
    }))).toEqual({ attributes: { expression: '"status" = \'done\'' }, delete: true })
  })

  it('leaves an expression whose switch is off', () => {
    expect(parseQfieldSyncLocks(layerWith({
      'QFieldSync/feature_addition_locked_expression': ['QString', 'true']
    }))).toEqual({})
  })

  it('reads the single lock QFieldSync saved before 4.15 as adding, geometry and deleting', () => {
    expect(parseQfieldSyncLocks(layerWith({
      'QFieldSync/is_geometry_locked': ['bool', 'true'],
      'QFieldSync/is_attribute_editing_locked': ['bool', 'true']
    }))).toEqual({ add: true, geometry: true, delete: true })
    expect(parseQfieldSyncLocks(layerWith({ 'QFieldSync/is_geometry_locked': ['bool', 'false'] }))).toEqual({})
  })

  it('reads the custom properties QGIS saved before 3.20', () => {
    expect(parseQfieldSyncLocks(element(`<maplayer><customproperties>
      <property key="QFieldSync/is_feature_addition_locked" value="true"/>
    </customproperties></maplayer>`))).toEqual({ add: true })
  })
})

describe('parseWfsTransactionLayers', () => {
  const parse = (properties: string) => parseWfsTransactionLayers(element(`<qgis><properties>${properties}</properties></qgis>`))
  const list = (ids: string[]) => ids.map((id) => `<value>${id}</value>`).join('')

  it('reads the published layers and the operations each takes', () => {
    expect(parse(`
      <WFSLayers type="QStringList">${list(['trees', 'roads'])}</WFSLayers>
      <WFSTLayers>
        <Delete type="QStringList"/>
        <Insert type="QStringList">${list(['trees'])}</Insert>
        <Update type="QStringList">${list(['trees', 'roads'])}</Update>
      </WFSTLayers>`)).toEqual({ published: ['trees', 'roads'], insert: ['trees'], update: ['trees', 'roads'], delete: [] })
  })

  it('reads nothing from a project that saves no WFS publishing', () => {
    expect(parse('<Measurement/>')).toBeNull()
    expect(parseWfsTransactionLayers(element('<qgis/>'))).toBeNull()
  })
})
