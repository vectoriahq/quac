// @vitest-environment jsdom
// jsdom, not linkedom: linkedom leaves `&gt;` undecoded in an attribute value,
// so a constraint with `>` would not reach the reader as QGIS wrote it.
import { describe, expect, it } from 'vitest'

import { readCollectionFieldEditRules } from './normalizedProject'
import { generateStacCatalogue } from './stacCatalogue'
import { parseQgsXml } from '../parse/parseQgsXml'

import type { FieldEditRule } from '../model/QgsProject'
import type { StacCollection, TableColumn } from '../model/Stac'

/**
 * A QGIS constraint expression (`<constraintExpressions>`, with its strength as
 * `exp_strength` and bit 4 of `constraints`) through to
 * `quac:constraints.expression` on the field's `table:columns` entry and
 * back out again.
 */

const NO_RULE: FieldEditRule = { readOnly: false, defaultValue: null, notNull: null, unique: null, hidden: false, reuseLastValue: false, duplicatePolicy: null }

function collectionFor(formXml: string): StacCollection {
  const project = parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Rules">'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + '<projectlayers><maplayer type="vector" geometry="Point">'
    + '<id>assets_1</id><layername>Assets</layername>'
    + '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + '<fieldConfiguration><field name="notes" configurationFlags="NoFlag"><editWidget type="TextEdit"><config><Option/></config></editWidget></field></fieldConfiguration>'
    + formXml
    + '</maplayer></projectlayers>'
    + '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'
    + '</qgis>'
  )
  return generateStacCatalogue(project).collections![0]!
}

function column(collection: StacCollection, name: string): TableColumn | undefined {
  return (collection['table:columns'] as TableColumn[]).find((entry) => entry.name === name)
}

describe('a constraint expression', () => {
  const EXPRESSION = '"last_inspected" IS NULL OR "last_inspected" >= "installed"'

  function constraintFor(mask: string, exp: string, desc: string, strength = '1') {
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const collection = collectionFor(
      `<constraints><constraint field="notes" constraints="${mask}" notnull_strength="1" unique_strength="0" exp_strength="${strength}"/></constraints>`
      + `<constraintExpressions><constraint field="notes" exp="${escape(exp)}" desc="${escape(desc)}"/></constraintExpressions>`
    )
    return { column: column(collection, 'notes'), rule: readCollectionFieldEditRules(collection).notes }
  }

  it('writes the expression, its description and its strength under quac:constraints, and reads them back', () => {
    const { column: written, rule } = constraintFor('4', EXPRESSION, "Last inspected can't be before installed")

    expect(written?.['quac:constraints']).toEqual({
      expression: { expression: EXPRESSION, description: "Last inspected can't be before installed", strength: 'enforced' }
    })
    expect(rule).toEqual({
      ...NO_RULE,
      constraintExpression: { expression: EXPRESSION, description: "Last inspected can't be before installed", strength: 'enforced' }
    })
  })

  it('keeps an expression that measures, whatever the project\'s units', () => {
    const { column: written, rule } = constraintFor('4', '$area < 500', 'Too big', '1')

    expect(written?.['quac:constraints']).toEqual({ expression: { expression: '$area < 500', description: 'Too big', strength: 'enforced' } })
    expect(rule?.constraintExpression?.expression).toBe('$area < 500')
  })

  it('reads a soft strength as warn and leaves the description out where the project gives none', () => {
    const { column: written, rule } = constraintFor('4', '"a" > 1', '', '2')

    expect(written?.['quac:constraints']).toEqual({ expression: { expression: '"a" > 1', strength: 'warn' } })
    expect(rule?.constraintExpression).toEqual({ expression: '"a" > 1', strength: 'warn' })
  })

  it('sits beside Not null in the same object', () => {
    const { column: written, rule } = constraintFor('5', '"a" > 1', 'Too small')

    expect(written?.['quac:constraints']).toEqual({
      not_null: 'enforced',
      expression: { expression: '"a" > 1', description: 'Too small', strength: 'enforced' }
    })
    expect(rule).toEqual({ ...NO_RULE, notNull: 'enforced', constraintExpression: { expression: '"a" > 1', description: 'Too small', strength: 'enforced' } })
  })

  it.each([
    ['an expression the reader cannot read', '4', '$x > 1', '1'],
    ['an expression with a function it does not know', '4', 'to_date("a") IS NULL', '1'],
    ['a mask without the expression bit', '1', '"a" > 1', '1'],
    ['a strength of 0', '4', '"a" > 1', '0'],
    ['no expression text', '4', '  ', '1']
  ])('leaves out %s', (_name, mask, exp, strength) => {
    const { rule } = constraintFor(mask, exp, 'Message', strength)

    expect(rule?.constraintExpression).toBeUndefined()
    expect(rule?.notNull ?? null).toBe(mask === '1' ? 'enforced' : null)
  })

  it('reads a hand-written column, and leaves out one with a missing expression or a strength it does not know', () => {
    const rules = readCollectionFieldEditRules({
      'table:columns': [
        { name: 'a', 'quac:constraints': { expression: { expression: '"b" > 1', strength: 'warn' } } },
        { name: 'c', 'quac:constraints': { expression: { strength: 'enforced' } } },
        { name: 'd', 'quac:constraints': { expression: { expression: '"b" > 1', strength: 'maybe' } } }
      ]
    } as unknown as StacCollection)

    expect(rules).toEqual({ a: { ...NO_RULE, constraintExpression: { expression: '"b" > 1', strength: 'warn' } } })
  })
})
