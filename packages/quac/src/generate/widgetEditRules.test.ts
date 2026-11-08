import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { readCollectionFieldEditRules } from './normalizedProject'
import { generateStacCatalogue } from './stacCatalogue'
import { parseQgsXml } from '../parse/parseQgsXml'

import type { StacCollection, TableColumn } from '../model/Stac'

/**
 * QGIS's Checkbox, Range and Date/Time widgets, through to
 * `quac:checkbox`, `quac:range` and `quac:date_format` on the
 * field's `table:columns` entry and back out again. The `<Option>` shapes are
 * the ones `packages/quac/src/tests/fixtures/qgis/graffiti/graffiti.qgs` writes.
 */

const LAYER_TREE =
  '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'

type OptionType = 'bool' | 'int' | 'double' | 'QString'

/** An `<Option>` map entry; a null value is the value-less `type="invalid"` QGIS writes for an unset one. */
function option(name: string, value: string | number | boolean | null, type?: OptionType): string {
  if (value === null) return `<Option type="invalid" name="${name}"/>`
  const kind = type ?? (typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'QString')
  return `<Option type="${kind}" value="${value}" name="${name}"/>`
}

function widget(name: string, type: string, options: string[] | null): string {
  const config = options === null ? '<Option/>' : `<Option type="Map">${options.join('')}</Option>`
  return `<field name="${name}" configurationFlags="NoFlag"><editWidget type="${type}"><config>${config}</config></editWidget></field>`
}

function collectionFor(fieldsXml: string, formXml = ''): StacCollection {
  const project = parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Widgets">'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + '<projectlayers><maplayer type="vector" geometry="Point">'
    + '<id>assets_1</id><layername>Assets</layername>'
    + '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + `<fieldConfiguration>${fieldsXml}</fieldConfiguration>`
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

function notNullForm(field: string, strength: number): string {
  return `<constraints><constraint field="${field}" constraints="1" notnull_strength="${strength}" unique_strength="0" exp_strength="0"/></constraints>`
}

describe('quac:checkbox', () => {
  it('writes the states, the stored-value display and the blank state, and reads them back', () => {
    const collection = collectionFor(widget('approved', 'CheckBox', [
      option('AllowNullState', true),
      option('CheckedState', 'Y'),
      option('TextDisplayMethod', 1),
      option('UncheckedState', 'N')
    ]))

    expect(column(collection, 'approved')?.['quac:checkbox']).toEqual({
      checked: 'Y', unchecked: 'N', show_stored: true, allow_null: true
    })
    expect(readCollectionFieldEditRules(collection).approved?.checkbox).toEqual({
      checkedValue: 'Y', uncheckedValue: 'N', showStoredValue: true, allowNull: true
    })
  })

  it('keeps 1 and 0 as the text they are', () => {
    const collection = collectionFor(widget('flag', 'CheckBox', [option('CheckedState', '1'), option('UncheckedState', '0')]))

    expect(readCollectionFieldEditRules(collection).flag?.checkbox).toMatchObject({ checkedValue: '1', uncheckedValue: '0' })
  })

  it.each([
    ['an empty config', null],
    ['unset states, as QGIS writes them for a boolean field', [
      option('AllowNullState', false), option('CheckedState', null), option('TextDisplayMethod', 0), option('UncheckedState', null)
    ]]
  ])('reads %s as a checkbox with every default', (_label, options) => {
    const collection = collectionFor(widget('accessible', 'CheckBox', options))

    expect(column(collection, 'accessible')?.['quac:checkbox']).toEqual({})
    expect(readCollectionFieldEditRules(collection).accessible?.checkbox).toEqual({
      checkedValue: null, uncheckedValue: null, showStoredValue: false, allowNull: false
    })
  })

  it('writes nothing for a field with another widget', () => {
    const collection = collectionFor(widget('notes', 'TextEdit', null))

    expect(column(collection, 'notes')).not.toHaveProperty('quac:checkbox')
    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })

  it('reads a checkbox object with no members from a catalogue', () => {
    const collection = { 'table:columns': [{ name: 'a', 'quac:checkbox': {} }] } as unknown as StacCollection

    expect(readCollectionFieldEditRules(collection).a?.checkbox).toEqual({
      checkedValue: null, uncheckedValue: null, showStoredValue: false, allowNull: false
    })
  })
})

describe('quac:range', () => {
  it('writes every member the config sets, and reads them back', () => {
    const collection = collectionFor(widget('mow_cycle_days', 'Range', [
      option('AllowNull', false),
      option('Max', 56),
      option('Min', 7),
      option('Precision', 1),
      option('Step', 7, 'double'),
      option('Style', 'SpinBox'),
      option('Suffix', ' days')
    ]))

    const expected = { min: 7, max: 56, step: 7, precision: 1, suffix: ' days' }
    expect(column(collection, 'mow_cycle_days')?.['quac:range']).toEqual(expected)
    expect(readCollectionFieldEditRules(collection).mow_cycle_days?.range).toEqual(expected)
  })

  it('keeps Min and Max only where the config sets them', () => {
    const collection = collectionFor(widget('depth', 'Range', [option('Min', 0), option('Style', 'Slider')]))

    expect(column(collection, 'depth')?.['quac:range']).toEqual({ min: 0 })
  })

  it('keeps a negative and a decimal limit', () => {
    const collection = collectionFor(widget('offset', 'Range', [option('Min', -2.5, 'double'), option('Max', 2.5, 'double')]))

    expect(readCollectionFieldEditRules(collection).offset?.range).toEqual({ min: -2.5, max: 2.5 })
  })

  it.each([
    ['an empty config', null],
    ['no limits, step or suffix', [option('Style', 'SpinBox'), option('Suffix', '')]]
  ])('writes nothing for %s', (_label, options) => {
    const collection = collectionFor(widget('count', 'Range', options))

    expect(column(collection, 'count')).not.toHaveProperty('quac:range')
    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })

  it('leaves out a member that is not a number', () => {
    const collection = {
      'table:columns': [{ name: 'a', 'quac:range': { min: '7', max: null, step: 0.5, precision: -1, suffix: 4 } }]
    } as unknown as StacCollection

    expect(readCollectionFieldEditRules(collection).a?.range).toEqual({ step: 0.5 })
  })
})

describe('quac:date_format', () => {
  it('writes a text field\'s own format, and reads it back', () => {
    const collection = collectionFor(widget('installed', 'DateTime', [
      option('allow_null', true),
      option('display_format', 'dd/MM/yyyy'),
      option('field_format', 'dd/MM/yyyy'),
      option('field_iso_format', false)
    ]))

    expect(column(collection, 'installed')?.['quac:date_format']).toBe('dd/MM/yyyy')
    expect(readCollectionFieldEditRules(collection).installed?.dateFormat).toBe('dd/MM/yyyy')
  })

  it.each([
    ['an empty config', null],
    ['the default date format', [option('field_format', 'yyyy-MM-dd'), option('field_iso_format', false)]],
    ['ISO 8601', [option('field_format', 'dd/MM/yyyy'), option('field_iso_format', true)]]
  ])('writes nothing for %s', (_label, options) => {
    const collection = collectionFor(widget('installed', 'DateTime', options))

    expect(column(collection, 'installed')).not.toHaveProperty('quac:date_format')
    expect(readCollectionFieldEditRules(collection)).toEqual({})
  })

  it('does not take the display format for the stored one', () => {
    const collection = collectionFor(widget('installed', 'DateTime', [option('display_format', 'dd/MM/yyyy')]))

    expect(column(collection, 'installed')).not.toHaveProperty('quac:date_format')
  })
})

describe('Allow NULL off', () => {
  it.each([
    ['a Range', 'Range', 'AllowNull'],
    ['a Date/Time', 'DateTime', 'allow_null']
  ])('makes %s a required field', (_label, type, key) => {
    const collection = collectionFor(widget('f', type, [option(key, false)]))

    expect(column(collection, 'f')?.['quac:constraints']).toEqual({ not_null: 'enforced' })
    expect(readCollectionFieldEditRules(collection).f?.notNull).toBe('enforced')
  })

  it.each([
    ['a Range', 'Range', 'AllowNull'],
    ['a Date/Time', 'DateTime', 'allow_null']
  ])('leaves %s with Allow NULL on, or absent, as it is', (_label, type, key) => {
    expect(column(collectionFor(widget('f', type, [option(key, true)])), 'f')).not.toHaveProperty('quac:constraints')
    expect(column(collectionFor(widget('f', type, null)), 'f')).not.toHaveProperty('quac:constraints')
  })

  it('raises a Not null that only warns, and keeps one that is enforced', () => {
    const fields = widget('f', 'Range', [option('AllowNull', false)])

    expect(readCollectionFieldEditRules(collectionFor(fields, notNullForm('f', 2))).f?.notNull).toBe('enforced')
    expect(readCollectionFieldEditRules(collectionFor(fields, notNullForm('f', 1))).f?.notNull).toBe('enforced')
  })

  it('keeps a Unique constraint beside it', () => {
    const collection = collectionFor(
      widget('f', 'Range', [option('AllowNull', false)]),
      '<constraints><constraint field="f" constraints="2" notnull_strength="0" unique_strength="2" exp_strength="0"/></constraints>'
    )

    expect(column(collection, 'f')?.['quac:constraints']).toEqual({ not_null: 'enforced', unique: 'warn' })
  })

  it('does not make a Checkbox required', () => {
    const collection = collectionFor(widget('f', 'CheckBox', [option('AllowNullState', false)]))

    expect(readCollectionFieldEditRules(collection).f?.notNull).toBeNull()
  })
})
