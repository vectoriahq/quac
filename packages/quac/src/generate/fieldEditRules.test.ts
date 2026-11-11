import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { readCollectionFieldEditRules, readCollectionIcon } from './normalizedProject.ts'
import { generateStacCatalogue } from './stacCatalogue.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'

import type { FieldEditRule } from '../model/QgsProject.ts'
import type { StacCollection, TableColumn } from '../model/Stac.ts'

/**
 * QGIS's Attributes Form settings, through to `quac:editable`,
 * `quac:default`, `quac:constraints`, `quac:hidden`, `quac:color` and
 * `quac:reuse_last_value` on the field's `table:columns` entry and back
 * out again. The `<defaults>`, `<editable>`, `<constraints>` and widget
 * shapes are the ones `packages/quac/src/tests/fixtures/qgis/graffiti/graffiti.qgs` writes.
 */

const LAYER_TREE =
  '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'

const NO_RULE: FieldEditRule = { readOnly: false, defaultValue: null, notNull: null, unique: null, hidden: false, reuseLastValue: false, duplicatePolicy: null }

function widget(name: string, type: string): string {
  return `<field name="${name}" configurationFlags="NoFlag"><editWidget type="${type}"><config><Option/></config></editWidget></field>`
}

const FIELDS = '<fieldConfiguration>' + widget('notes', 'TextEdit') + widget('last_edited', 'DateTime') + '</fieldConfiguration>'

function collectionFor(formXml: string, fieldsXml = FIELDS): StacCollection {
  const project = parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Rules">'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + '<projectlayers><maplayer type="vector" geometry="Point">'
    + '<id>assets_1</id><layername>Assets</layername>'
    + '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + fieldsXml
    + formXml
    + '</maplayer></projectlayers>'
    + LAYER_TREE
    + '</qgis>'
  )
  return generateStacCatalogue(project).collections![0]!
}

function column(collection: StacCollection, name: string): TableColumn | undefined {
  return (collection['table:columns'] as TableColumn[]).find((entry) => entry.name === name)
}

const LAST_EDITED_FORM = '<defaults>'
  + '<default field="notes" expression="" applyOnUpdate="0"/>'
  + '<default field="last_edited" expression="now()" applyOnUpdate="1"/>'
  + '</defaults>'
  + '<editable><field editable="1" name="notes"/><field editable="0" name="last_edited"/></editable>'

describe('quac:editable and quac:default on a table:columns entry', () => {
  it('writes an unticked Editable box and a now() default applied on update', () => {
    const collection = collectionFor(LAST_EDITED_FORM)

    expect(column(collection, 'last_edited')).toMatchObject({
      'quac:editable': false,
      'quac:default': { kind: 'now', on_update: true }
    })
    expect(column(collection, 'notes')).not.toHaveProperty('quac:editable')
    expect(column(collection, 'notes')).not.toHaveProperty('quac:default')
    expect(readCollectionFieldEditRules(collection)).toEqual({
      last_edited: { ...NO_RULE, readOnly: true, defaultValue: { kind: 'now', onUpdate: true } }
    })
  })

  it('keeps a default filled only on create, and an editable field with one', () => {
    const collection = collectionFor('<defaults><default field="last_edited" expression="$now" applyOnUpdate="0"/></defaults>')

    expect(readCollectionFieldEditRules(collection)).toEqual({
      last_edited: { ...NO_RULE, defaultValue: { kind: 'now', onUpdate: false } }
    })
  })

  it.each(['now()', ' NOW ( ) ', '$now', 'to_date(now())', 'to_datetime( now() )'])('reads %j as now', (expression) => {
    const collection = collectionFor(`<defaults><default field="last_edited" expression="${expression}" applyOnUpdate="1"/></defaults>`)

    expect(readCollectionFieldEditRules(collection).last_edited?.defaultValue).toEqual({ kind: 'now', onUpdate: true })
  })

  it('leaves out an expression a reader cannot fill', () => {
    const collection = collectionFor('<defaults><default field="last_edited" expression="@user_account_name" applyOnUpdate="1"/></defaults>')

    expect(column(collection, 'last_edited')).not.toHaveProperty('quac:default')
    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })

  it('ignores the form of a saved alternate style', () => {
    const collection = collectionFor(
      '<map-layer-style-manager current="default"><map-layer-style name="other"><qgis>'
      + '<fieldConfiguration>' + widget('notes', 'Hidden') + widget('last_edited', 'UuidGenerator') + '</fieldConfiguration>'
      + '<defaults><default field="notes" expression="\'x\'" applyOnUpdate="0"/></defaults>'
      + '<constraints><constraint field="notes" constraints="1" notnull_strength="1" unique_strength="0" exp_strength="0"/></constraints>'
      + '<editable><field editable="0" name="notes"/></editable>'
      + '<reuseLastValuePolicy><field name="notes" reuseLastValuePolicy="AllowedDefaultOn"/></reuseLastValuePolicy>'
      + '</qgis></map-layer-style></map-layer-style-manager>'
    )

    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })
})

function defaultFor(expression: string, applyOnUpdate = '0') {
  const escaped = expression.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const collection = collectionFor(`<defaults><default field="notes" expression="${escaped}" applyOnUpdate="${applyOnUpdate}"/></defaults>`)
  return { column: column(collection, 'notes'), rule: readCollectionFieldEditRules(collection).notes }
}

describe('a fixed default', () => {
  it('writes a string literal and reads it back', () => {
    const { column: written, rule } = defaultFor("'Good'", '1')

    expect(written?.['quac:default']).toEqual({ kind: 'fixed', value: 'Good', on_update: true })
    expect(rule).toEqual({ ...NO_RULE, defaultValue: { kind: 'fixed', value: 'Good', onUpdate: true } })
  })

  it.each([
    ["'it''s'", "it's"],
    ["'it\\'s'", "it's"],
    ["'a\\nb\\tc\\\\d'", 'a\nb\tc\\d'],
    ["'\\q'", '?'],
    ["''", ''],
    ['  42 ', 42],
    ['-7', -7],
    ['- 7', -7],
    ['3.25', 3.25],
    ['.5', 0.5],
    ['1e3', 1000],
    ['TRUE', true],
    ['false', false],
    ['Null', null]
  ])('reads %s as %j', (expression, value) => {
    expect(defaultFor(expression).rule?.defaultValue).toEqual({ kind: 'fixed', value, onUpdate: false })
  })

  it.each([
    '@user_account_name',
    "'unterminated",
    "'Good' -- a comment",
    '5.',
    '$x',
    'to_date("a")'
  ])('leaves out %s', (expression) => {
    const { column: written, rule } = defaultFor(expression)

    expect(written).not.toHaveProperty('quac:default')
    expect(rule).toBeUndefined()
  })
})

describe('a uuid() default', () => {
  it.each([
    ['uuid()', 'with_braces'],
    ['$uuid', 'with_braces'],
    [' UUID ( ) ', 'with_braces'],
    ["uuid('WithBraces')", 'with_braces'],
    ["uuid('withoutbraces')", 'without_braces'],
    ["uuid('Id128')", 'id128'],
    ["uuid(format:='WithoutBraces')", 'without_braces'],
    ["uuid( format := 'Id128', version := 4 )", 'id128'],
    ["uuid('Id128', 4)", 'id128'],
    ["uuid(version:=4, format:='Id128')", 'id128'],
    ["uuid('anything else')", 'with_braces']
  ])('reads %s with format %s', (expression, format) => {
    const { column: written, rule } = defaultFor(expression)

    expect(written?.['quac:default']).toEqual({ kind: 'uuid', format, on_update: false })
    expect(rule?.defaultValue).toEqual({ kind: 'uuid', format, onUpdate: false })
  })

  it.each(["uuid('WithBraces', 7)", 'uuid(version:=7)', "uuid('a', 4, 1)", 'uuid(1)', "uuid(colour:='x')", "uuid('a'", '$uuid()'])(
    'leaves out %s',
    (expression) => {
      expect(defaultFor(expression).rule).toBeUndefined()
    }
  )
})

describe('the UUID Generator widget', () => {
  it('fills an identifier with braces and locks the field', () => {
    const collection = collectionFor('', '<fieldConfiguration>' + widget('notes', 'UuidGenerator') + '</fieldConfiguration>')

    expect(column(collection, 'notes')).toMatchObject({
      'quac:editable': false,
      'quac:default': { kind: 'uuid', format: 'with_braces', on_update: false }
    })
    expect(readCollectionFieldEditRules(collection).notes).toEqual({
      ...NO_RULE,
      readOnly: true,
      defaultValue: { kind: 'uuid', format: 'with_braces', onUpdate: false }
    })
  })

  it('gives way to a default expression, which fills the field first', () => {
    const fields = '<fieldConfiguration>' + widget('notes', 'UuidGenerator') + '</fieldConfiguration>'
    const fixed = collectionFor('<defaults><default field="notes" expression="\'A-1\'" applyOnUpdate="0"/></defaults>', fields)
    const unreadable = collectionFor('<defaults><default field="notes" expression="@layer_name" applyOnUpdate="0"/></defaults>', fields)

    expect(readCollectionFieldEditRules(fixed).notes).toEqual({
      ...NO_RULE,
      readOnly: true,
      defaultValue: { kind: 'fixed', value: 'A-1', onUpdate: false }
    })
    expect(readCollectionFieldEditRules(unreadable).notes).toEqual({ ...NO_RULE, readOnly: true })
  })
})

describe('quac:constraints', () => {
  function constraint(attributes: string) {
    const collection = collectionFor(`<constraints><constraint field="notes" ${attributes}/></constraints>`)
    return { column: column(collection, 'notes'), rule: readCollectionFieldEditRules(collection).notes }
  }

  it('writes an enforced Not null and reads it back', () => {
    const { column: written, rule } = constraint('constraints="1" notnull_strength="1" unique_strength="0" exp_strength="0"')

    expect(written?.['quac:constraints']).toEqual({ not_null: 'enforced' })
    expect(rule).toEqual({ ...NO_RULE, notNull: 'enforced' })
  })

  it('writes an unenforced Not null as warn', () => {
    expect(constraint('constraints="1" notnull_strength="2"').rule?.notNull).toBe('warn')
  })

  it('reads a missing strength as enforced, as QGIS does', () => {
    expect(constraint('constraints="1"').rule?.notNull).toBe('enforced')
  })

  it('reads Not null from a mask that also holds Unique and expression constraints', () => {
    expect(constraint('constraints="7" notnull_strength="2" unique_strength="1" exp_strength="1"').rule?.notNull).toBe('warn')
  })

  it.each([
    'constraints="0" notnull_strength="1" unique_strength="1"',
    'constraints="2" notnull_strength="1" unique_strength="0"',
    'constraints="1" notnull_strength="0"'
  ])('leaves out %s', (attributes) => {
    const { column: written, rule } = constraint(attributes)

    expect(written).not.toHaveProperty('quac:constraints')
    expect(rule).toBeUndefined()
  })

  it('writes an enforced Unique and reads it back', () => {
    const { column: written, rule } = constraint('constraints="2" notnull_strength="0" unique_strength="1" exp_strength="0"')

    expect(written?.['quac:constraints']).toEqual({ unique: 'enforced' })
    expect(rule).toEqual({ ...NO_RULE, unique: 'enforced' })
  })

  it('writes an unenforced Unique as warn', () => {
    const { column: written, rule } = constraint('constraints="2" unique_strength="2"')

    expect(written?.['quac:constraints']).toEqual({ unique: 'warn' })
    expect(rule?.unique).toBe('warn')
  })

  it('reads a missing Unique strength as enforced, as QGIS does', () => {
    expect(constraint('constraints="2"').rule?.unique).toBe('enforced')
  })

  it('keeps Not null and Unique apart in one mask', () => {
    const { column: written, rule } = constraint('constraints="3" notnull_strength="2" unique_strength="1" exp_strength="1"')

    expect(written?.['quac:constraints']).toEqual({ not_null: 'warn', unique: 'enforced' })
    expect(rule).toEqual({ ...NO_RULE, notNull: 'warn', unique: 'enforced' })
  })

  it('reads the Unique bit by its own strength, not the Not null one', () => {
    expect(constraint('constraints="3" notnull_strength="0" unique_strength="2"').rule).toEqual({ ...NO_RULE, unique: 'warn' })
    expect(constraint('constraints="3" notnull_strength="2" unique_strength="0"').rule).toEqual({ ...NO_RULE, notNull: 'warn' })
  })
})

describe('quac:duplicate_policy', () => {
  function policies(...entries: string[]) {
    const collection = collectionFor(`<duplicatePolicies>${entries.join('')}</duplicatePolicies>`)
    return { collection, rules: readCollectionFieldEditRules(collection) }
  }

  it('writes Use default value as default and Remove value as unset, and reads them back', () => {
    const { collection, rules } = policies(
      '<policy field="notes" policy="DefaultValue"/>',
      '<policy field="last_edited" policy="UnsetField"/>'
    )

    expect(column(collection, 'notes')?.['quac:duplicate_policy']).toBe('default')
    expect(column(collection, 'last_edited')?.['quac:duplicate_policy']).toBe('unset')
    expect(rules).toEqual({
      notes: { ...NO_RULE, duplicatePolicy: 'default' },
      last_edited: { ...NO_RULE, duplicatePolicy: 'unset' }
    })
  })

  it.each([
    '<policy field="notes" policy="Duplicate"/>',
    '<policy field="notes" policy="Something"/>',
    '<policy field="notes" policy=""/>',
    '<policy field="notes"/>'
  ])('leaves out %s: it reads as Duplicate', (entry) => {
    const { collection, rules } = policies(entry)

    expect(column(collection, 'notes')).not.toHaveProperty('quac:duplicate_policy')
    expect(rules).toEqual({})
  })

  it('reads a layer with no duplicatePolicies block, or an empty one, as Duplicate for every field', () => {
    expect(readCollectionFieldEditRules(collectionFor(''))).toEqual({})
    expect(readCollectionFieldEditRules(collectionFor('<duplicatePolicies/>'))).toEqual({})
  })

  it('ignores the policies of a saved alternate style', () => {
    const collection = collectionFor(
      '<map-layer-style-manager current="default"><map-layer-style name="other"><qgis>'
      + '<duplicatePolicies><policy field="notes" policy="UnsetField"/></duplicatePolicies>'
      + '<constraints><constraint field="notes" constraints="2" unique_strength="1"/></constraints>'
      + '</qgis></map-layer-style></map-layer-style-manager>'
    )

    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })

  it('sits beside Unique and the other settings of one field', () => {
    const collection = collectionFor(
      '<constraints><constraint field="notes" constraints="2" unique_strength="1"/></constraints>'
      + '<duplicatePolicies><policy field="notes" policy="DefaultValue"/></duplicatePolicies>'
    )

    expect(readCollectionFieldEditRules(collection)).toEqual({ notes: { ...NO_RULE, unique: 'enforced', duplicatePolicy: 'default' } })
  })
})

describe('quac:color', () => {
  it('writes the Color widget and reads it back', () => {
    const collection = collectionFor('', '<fieldConfiguration>' + widget('notes', 'Color') + widget('last_edited', 'DateTime') + '</fieldConfiguration>')

    expect(column(collection, 'notes')?.['quac:color']).toBe(true)
    expect(column(collection, 'last_edited')).not.toHaveProperty('quac:color')
    expect(readCollectionFieldEditRules(collection)).toEqual({ notes: { ...NO_RULE, colour: true } })
  })

  it('reads no colour from a value other than true', () => {
    const collection = { ...collectionFor(''), 'table:columns': [{ name: 'notes', 'quac:color': 'true' }] } as unknown as StacCollection

    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })
})

describe('quac:icon', () => {
  function variables(names: string[], values: string[]): string {
    const list = (key: string, entries: string[]) => `<Option name="${key}" type="StringList">`
      + entries.map((entry) => `<Option type="QString" value="${entry}"/>`).join('')
      + '</Option>'
    return `<customproperties><Option type="Map">${list('variableNames', names)}${list('variableValues', values)}</Option></customproperties>`
  }

  it('writes the address a layer variable names and reads it back', () => {
    const collection = collectionFor(variables(['quac_icon_notes', 'other_variable'], ['tabler:note', 'tree']))

    expect(column(collection, 'notes')?.['quac:icon']).toBe('https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/note.svg')
    expect(column(collection, 'last_edited')).not.toHaveProperty('quac:icon')
    expect(readCollectionFieldEditRules(collection)).toEqual({
      notes: { ...NO_RULE, icon: 'https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/note.svg' }
    })
  })

  it('reads the form a project saved before QGIS 3.20', () => {
    const collection = collectionFor('<customproperties>'
      + '<property key="variableNames"><value>quac_icon_notes</value></property>'
      + '<property key="variableValues"><value>https://example.com/note.svg</value></property>'
      + '</customproperties>')

    expect(column(collection, 'notes')?.['quac:icon']).toBe('https://example.com/note.svg')
  })

  it('reads a single variable held as one value', () => {
    const collection = collectionFor('<customproperties>'
      + '<property key="variableNames" value="quac_icon_notes"/>'
      + '<property key="variableValues" value="note"/>'
      + '</customproperties>')

    expect(column(collection, 'notes')?.['quac:icon']).toBe('https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/note.svg')
  })

  it('writes nothing for a field the layer lacks or a value that names no icon', () => {
    const collection = collectionFor(variables(['quac_icon_species', 'quac_icon_notes'], ['tree', 'http://example.com/note.svg']))

    expect(column(collection, 'species')).toBeUndefined()
    expect(column(collection, 'notes')).not.toHaveProperty('quac:icon')
    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })

  it('writes nothing where the layer has no variables', () => {
    const collection = collectionFor('<customproperties><Option type="Map"><Option name="variableNames"/><Option name="variableValues"/></Option></customproperties>')

    expect(column(collection, 'notes')).not.toHaveProperty('quac:icon')
  })

  it('reads no icon from an address that is not https', () => {
    const collection = { ...collectionFor(''), 'table:columns': [{ name: 'notes', 'quac:icon': 'http://example.com/note.svg' }] } as unknown as StacCollection

    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })
})

describe('quac:control', () => {
  function variables(names: string[], values: string[]): string {
    const list = (key: string, entries: string[]) => `<Option name="${key}" type="StringList">`
      + entries.map((entry) => `<Option type="QString" value="${entry}"/>`).join('')
      + '</Option>'
    return `<customproperties><Option type="Map">${list('variableNames', names)}${list('variableValues', values)}</Option></customproperties>`
  }

  it('writes the control a layer variable asks for and reads it back', () => {
    const collection = collectionFor(variables(['quac_control_notes', 'quac_icon_notes'], ['buttons', 'tabler:note']))

    expect(column(collection, 'notes')?.['quac:control']).toBe('buttons')
    expect(column(collection, 'last_edited')).not.toHaveProperty('quac:control')
    expect(readCollectionFieldEditRules(collection)).toEqual({
      notes: { ...NO_RULE, icon: 'https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/note.svg', control: 'buttons' }
    })
  })

  it('reads the value without regard to case or surrounding spaces', () => {
    const collection = collectionFor(variables(['quac_control_notes', 'quac_control_last_edited'], [' Buttons ', 'DROPDOWN']))

    expect(column(collection, 'notes')?.['quac:control']).toBe('buttons')
    expect(column(collection, 'last_edited')?.['quac:control']).toBe('dropdown')
  })

  it('writes nothing for a value that names no control', () => {
    const collection = collectionFor(variables(['quac_control_notes'], ['radio']))

    expect(column(collection, 'notes')).not.toHaveProperty('quac:control')
    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })

  it('reads no control from a catalogue value other than buttons or dropdown', () => {
    const collection = { ...collectionFor(''), 'table:columns': [{ name: 'notes', 'quac:control': 'Buttons' }] } as unknown as StacCollection

    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })
})

describe('quac:hidden', () => {
  it('writes the Hidden widget and reads it back', () => {
    const collection = collectionFor('', '<fieldConfiguration>' + widget('notes', 'Hidden') + widget('last_edited', 'DateTime') + '</fieldConfiguration>')

    expect(column(collection, 'notes')?.['quac:hidden']).toBe(true)
    expect(column(collection, 'last_edited')).not.toHaveProperty('quac:hidden')
    expect(readCollectionFieldEditRules(collection)).toEqual({ notes: { ...NO_RULE, hidden: true } })
  })
})

describe('quac:reuse_last_value', () => {
  it('reads AllowedDefaultOn and leaves out the other policies', () => {
    const collection = collectionFor('<reuseLastValuePolicy>'
      + '<field name="notes" reuseLastValuePolicy="AllowedDefaultOn"/>'
      + '<field name="last_edited" reuseLastValuePolicy="AllowedDefaultOff"/>'
      + '</reuseLastValuePolicy>')

    expect(column(collection, 'notes')?.['quac:reuse_last_value']).toBe(true)
    expect(column(collection, 'last_edited')).not.toHaveProperty('quac:reuse_last_value')
    expect(readCollectionFieldEditRules(collection)).toEqual({ notes: { ...NO_RULE, reuseLastValue: true } })
  })

  it('reads the older reuseLastValue block', () => {
    const collection = collectionFor('<reuseLastValue>'
      + '<field name="notes" reuseLastValue="1"/>'
      + '<field name="last_edited" reuseLastValue="0"/>'
      + '</reuseLastValue>')

    expect(readCollectionFieldEditRules(collection)).toEqual({ notes: { ...NO_RULE, reuseLastValue: true } })
  })

  it('lets the newer block override the older one, as QGIS reads them', () => {
    const collection = collectionFor('<reuseLastValue><field name="notes" reuseLastValue="1"/></reuseLastValue>'
      + '<reuseLastValuePolicy><field name="notes" reuseLastValuePolicy="NotAllowed"/></reuseLastValuePolicy>')

    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })
})

describe('readCollectionFieldEditRules on a hand-written Collection', () => {
  function rulesFor(columnJson: Record<string, unknown>) {
    return readCollectionFieldEditRules({ 'table:columns': [{ name: 'notes', ...columnJson }] } as unknown as StacCollection).notes
  }

  it('reads a unique and a duplicate policy it recognises, and leaves out any other', () => {
    expect(rulesFor({ 'quac:constraints': { unique: 'warn' }, 'quac:duplicate_policy': 'unset' }))
      .toEqual({ ...NO_RULE, unique: 'warn', duplicatePolicy: 'unset' })
    expect(rulesFor({ 'quac:constraints': { unique: 'always' }, 'quac:duplicate_policy': 'duplicate' })).toBeUndefined()
  })

  it('reads an omitted or unrecognised uuid format as with braces', () => {
    expect(rulesFor({ 'quac:default': { kind: 'uuid', on_update: false } })?.defaultValue)
      .toEqual({ kind: 'uuid', format: 'with_braces', onUpdate: false })
    expect(rulesFor({ 'quac:default': { kind: 'uuid', format: 'v7', on_update: true } })?.defaultValue)
      .toEqual({ kind: 'uuid', format: 'with_braces', onUpdate: true })
  })

  it('keeps a fixed null and leaves out a fixed default without a value', () => {
    expect(rulesFor({ 'quac:default': { kind: 'fixed', value: null, on_update: false } })?.defaultValue)
      .toEqual({ kind: 'fixed', value: null, onUpdate: false })
    expect(rulesFor({ 'quac:default': { kind: 'fixed', on_update: false } })).toBeUndefined()
    expect(rulesFor({ 'quac:default': { kind: 'fixed', value: { a: 1 }, on_update: false } })).toBeUndefined()
  })

  it('leaves out an unrecognised kind, Not null strength, or a hidden or reuse flag other than true', () => {
    expect(rulesFor({ 'quac:default': { value: 'now', on_update: true } })).toBeUndefined()
    expect(rulesFor({ 'quac:constraints': { not_null: 'yes' } })).toBeUndefined()
    expect(rulesFor({ 'quac:hidden': 'true', 'quac:reuse_last_value': 1 })).toBeUndefined()
  })
})

describe('an expression default', () => {
  it.each([
    ['upper("suburb")', '1', true],
    ['"condition"', '0', false],
    ["'a' || 'b'", '0', false],
    ['1 + 1', '0', false],
    ["('Good')", '0', false],
    ['round($area, 2)', '1', true],
    ['$length / 1000', '0', false],
    ["'A' || lpad(to_string(coalesce(maximum(to_int(substr(\"asset_id\", 2))), 100) + 1), 3, '0')", '0', false],
    ['"inspected" + make_interval(days:="days")', '1', true]
  ])('writes %s as kind expression and reads it back', (expression, applyOnUpdate, onUpdate) => {
    const { column: written, rule } = defaultFor(expression, applyOnUpdate)

    expect(written?.['quac:default']).toEqual({ kind: 'expression', expression, on_update: onUpdate })
    expect(rule).toEqual({ ...NO_RULE, defaultExpression: { expression, onUpdate } })
  })

  it('keeps now(), uuid() and a literal as the kinds they were', () => {
    expect(defaultFor('now()').rule?.defaultValue).toEqual({ kind: 'now', onUpdate: false })
    expect(defaultFor('uuid()').rule?.defaultValue).toMatchObject({ kind: 'uuid' })
    expect(defaultFor("'Good'").rule?.defaultValue).toEqual({ kind: 'fixed', value: 'Good', onUpdate: false })
    expect(defaultFor("'Good'").rule).not.toHaveProperty('defaultExpression')
  })

  it('reads a hand-written column and leaves out one with no expression text', () => {
    const rules = readCollectionFieldEditRules({
      'table:columns': [
        { name: 'a', 'quac:default': { kind: 'expression', expression: 'upper("b")', on_update: true } },
        { name: 'c', 'quac:default': { kind: 'expression', expression: '  ' } },
        { name: 'd', 'quac:default': { kind: 'expression' } }
      ]
    } as unknown as StacCollection)

    expect(rules).toEqual({ a: { ...NO_RULE, defaultExpression: { expression: 'upper("b")', onUpdate: true } } })
  })
})

describe('quac:icon on a layer', () => {
  function variables(names: string[], values: string[]): string {
    const list = (key: string, entries: string[]) => `<Option name="${key}" type="StringList">`
      + entries.map((entry) => `<Option type="QString" value="${entry}"/>`).join('')
      + '</Option>'
    return `<customproperties><Option type="Map">${list('variableNames', names)}${list('variableValues', values)}</Option></customproperties>`
  }

  it('writes the icon the layer variable names and reads it back, apart from the field icons', () => {
    const collection = collectionFor(variables(['quac_icon_notes', 'quac_icon'], ['note', 'tabler:tree']))

    expect(collection['quac:icon']).toBe('https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/tree.svg')
    expect(readCollectionIcon(collection)).toBe('https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/tree.svg')
    expect(column(collection, 'notes')?.['quac:icon']).toBe('https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/note.svg')
  })

  it('writes nothing where the layer has no such variable or its value names no icon', () => {
    expect(collectionFor(variables(['quac_icon_notes'], ['note']))).not.toHaveProperty('quac:icon')
    expect(collectionFor(variables(['quac_icon'], ['http://example.com/tree.svg']))).not.toHaveProperty('quac:icon')
  })

  it('reads no icon from an address that is not https', () => {
    const collection = { ...collectionFor(''), 'quac:icon': 'http://example.com/tree.svg' } as StacCollection

    expect(readCollectionIcon(collection)).toBeNull()
  })
})
