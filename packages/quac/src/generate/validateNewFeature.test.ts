import { describe, expect, it } from 'vitest'

import { isBlankFieldValue, isOutsideFieldRange, readNewFeatureFields, validateNewFeature } from './validateNewFeature.ts'

import type { StacCollection, TableColumn } from '../model/Stac.ts'

function layer(...columns: TableColumn[]): StacCollection {
  return {
    type: 'Collection',
    stac_version: '1.1.0',
    id: 'submissions',
    description: 'Submissions',
    license: 'other',
    extent: { spatial: { bbox: [[0, 0, 1, 1]] }, temporal: { interval: [[null, null]] } },
    links: [],
    'table:columns': columns
  } as StacCollection
}

describe('validateNewFeature', () => {
  it('passes a feature whose values fit every field', () => {
    const collection = layer(
      { name: 'comment', type: 'string', 'quac:constraints': { not_null: 'enforced' } },
      { name: 'rating', type: 'int', 'quac:range': { min: 1, max: 5 } },
      { name: 'topic', type: 'string', 'quac:values': [{ value: 'parks', label: 'Parks' }, { value: 'roads', label: 'Roads' }] }
    )
    expect(validateNewFeature(collection, { comment: 'More shade', rating: 4, topic: 'parks' })).toEqual({ problems: [], unchecked: [] })
  })

  it('refuses a field the layer does not have, after the layer\'s own fields', () => {
    const collection = layer({ name: 'comment', type: 'string', 'quac:constraints': { not_null: 'enforced' } })
    expect(validateNewFeature(collection, { approved: 1, comment: '' }).problems).toEqual([
      { field: 'comment', problem: 'required' },
      { field: 'approved', problem: 'unknown-field' }
    ])
  })

  it('refuses every value where the layer declares no fields', () => {
    expect(validateNewFeature(layer(), { comment: 'x' }).problems).toEqual([{ field: 'comment', problem: 'unknown-field' }])
  })

  it('refuses a value in a field no form could fill, and skips its other rules', () => {
    const collection = layer(
      { name: 'created', type: 'string', 'quac:editable': false, 'quac:constraints': { not_null: 'enforced', expression: { expression: '"created" <> \'\'', strength: 'enforced' } } },
      { name: 'internal', type: 'string', 'quac:hidden': true },
      { name: 'unplaced', type: 'string', 'quac:in_form': false }
    )
    expect(validateNewFeature(collection, {})).toEqual({ problems: [], unchecked: [] })
    expect(validateNewFeature(collection, { created: '2026-01-01', internal: 'x', unplaced: 'y' }).problems).toEqual([
      { field: 'created', problem: 'not-fillable' },
      { field: 'internal', problem: 'not-fillable' },
      { field: 'unplaced', problem: 'not-fillable' }
    ])
  })

  it('refuses a blank field that enforces Not null, and lets a warning pass', () => {
    const collection = layer(
      { name: 'name', 'quac:constraints': { not_null: 'enforced' } },
      { name: 'phone', 'quac:constraints': { not_null: 'warn' } }
    )
    expect(validateNewFeature(collection, { name: '  ', phone: null }).problems).toEqual([{ field: 'name', problem: 'required' }])
    expect(validateNewFeature(collection, { phone: null }).problems).toEqual([{ field: 'name', problem: 'required' }])
  })

  it.each([
    ['string', 5, false],
    ['string', 'five', true],
    ['int', 5, true],
    ['int', 5.5, false],
    ['int', '5', false],
    ['long', 5, true],
    ['double', 5.5, true],
    ['double', '5.5', false],
    ['boolean', true, true],
    ['boolean', 'true', false],
    ['date', '2026-11-23', true],
    ['date', '23/11/2026', false],
    ['time', '09:30', true],
    ['time', '9.30am', false],
    ['timestamp', '2026-11-23T09:30:00Z', true],
    ['timestamp', '2026-11-23', false],
    [undefined, 'any', true],
    [undefined, 5, true],
    [undefined, { nested: true }, false],
    ['string', ['a'], false]
  ] as const)('checks a %s field\'s value %j as stored (fits: %s)', (type, value, fits) => {
    const collection = layer(type ? { name: 'field', type } : { name: 'field' })
    const problems = validateNewFeature(collection, { field: value }).problems
    expect(problems).toEqual(fits ? [] : [{ field: 'field', problem: 'wrong-type' }])
  })

  it('refuses a value not in the field\'s list, comparing as text', () => {
    const collection = layer({ name: 'code', 'quac:values': [{ value: 1, label: 'One' }, { value: 'b', label: 'Bee' }] })
    expect(validateNewFeature(collection, { code: 1 }).problems).toEqual([])
    expect(validateNewFeature(collection, { code: '1' }).problems).toEqual([])
    expect(validateNewFeature(collection, { code: 'B' }).problems).toEqual([{ field: 'code', problem: 'not-a-choice' }])
  })

  it('refuses text that is not a Checkbox\'s spelling', () => {
    const collection = layer({ name: 'agree', type: 'string', 'quac:checkbox': { checked: 'Y', unchecked: 'N' } })
    expect(validateNewFeature(collection, { agree: 'Y' }).problems).toEqual([])
    expect(validateNewFeature(collection, { agree: 'yes' }).problems).toEqual([{ field: 'agree', problem: 'not-a-choice' }])
  })

  it('refuses a number outside the field\'s range', () => {
    const collection = layer({ name: 'rating', type: 'int', 'quac:range': { min: 1, max: 5 } })
    expect(validateNewFeature(collection, { rating: 6 }).problems).toEqual([{ field: 'rating', problem: 'out-of-range' }])
    expect(validateNewFeature(collection, { rating: 1 }).problems).toEqual([])
  })

  it('lists the rules it cannot check on a fillable field, whatever the values', () => {
    const collection = layer(
      { name: 'email', type: 'string', 'quac:constraints': { expression: { expression: 'regexp_match("email", \'@\')', strength: 'enforced' } } },
      { name: 'note', type: 'string', 'quac:constraints': { expression: { expression: 'length("note") < 10', strength: 'warn' } } },
      { name: 'other', type: 'string', 'quac:visible_when': ['"topic" = \'other\''] },
      { name: 'reason', type: 'string', 'quac:editable_when': '"topic" IS NOT NULL' },
      { name: 'suburb', type: 'string', 'quac:value_relation': { collection: 'suburbs', key: 'id', value: 'name' } },
      { name: 'ref', type: 'string', 'quac:constraints': { unique: 'enforced' } },
      { name: 'ref_warn', type: 'string', 'quac:constraints': { unique: 'warn' } },
      { name: 'seen', type: 'string', 'quac:date_format': 'dd/MM/yyyy' },
      { name: 'photo', type: 'string', 'quac:attachment': { relative_storage: 'project' } },
      { name: 'shape', type: 'geometry' }
    )
    expect(validateNewFeature(collection, {}).unchecked).toEqual([
      { field: 'email', rule: 'constraint-expression' },
      { field: 'other', rule: 'visible-when' },
      { field: 'reason', rule: 'editable-when' },
      { field: 'suburb', rule: 'value-relation' },
      { field: 'ref', rule: 'unique' },
      { field: 'seen', rule: 'date-format' },
      { field: 'photo', rule: 'attachment' },
      { field: 'shape', rule: 'type' }
    ])
  })

  it('lists a constraint expression it cannot even read', () => {
    const collection = layer({ name: 'email', 'quac:constraints': { expression: { expression: '"email" ~~ broken(', strength: 'enforced' } } })
    expect(validateNewFeature(collection, { email: 'a@example.test' }).unchecked).toEqual([{ field: 'email', rule: 'constraint-expression' }])
  })

  it('takes text in a date field that stores its own format, and lists the format unchecked', () => {
    const collection = layer({ name: 'seen', type: 'date', 'quac:date_format': 'dd/MM/yyyy' })
    expect(validateNewFeature(collection, { seen: '23/11/2026' })).toEqual({ problems: [], unchecked: [{ field: 'seen', rule: 'date-format' }] })
  })

  it('reads a feature with no properties as all blank', () => {
    const collection = layer({ name: 'comment', 'quac:constraints': { not_null: 'enforced' } })
    expect(validateNewFeature(collection, null).problems).toEqual([{ field: 'comment', problem: 'required' }])
  })
})

describe('readNewFeatureFields', () => {
  it('lists the fields a form for a new feature can fill, in the layer\'s order', () => {
    const collection = layer(
      { name: 'comment' },
      { name: 'created', 'quac:editable': false },
      { name: 'internal', 'quac:hidden': true },
      { name: 'unplaced', 'quac:in_form': false },
      { name: 'rating', type: 'int' }
    )
    expect(readNewFeatureFields(collection)).toEqual(['comment', 'rating'])
  })
})

describe('isBlankFieldValue', () => {
  it.each([[null, true], [undefined, true], ['', true], ['  ', true], [0, false], [false, false], ['x', false]] as const)('reads %j as blank: %s', (value, blank) => {
    expect(isBlankFieldValue(value)).toBe(blank)
  })
})

describe('isOutsideFieldRange', () => {
  it('reads numbers and text holding one, and leaves blanks, booleans and other text to the other checks', () => {
    expect(isOutsideFieldRange(6, { min: 1, max: 5 })).toBe(true)
    expect(isOutsideFieldRange(' 0 ', { min: 1 })).toBe(true)
    expect(isOutsideFieldRange(5, { max: 5 })).toBe(false)
    expect(isOutsideFieldRange(null, { min: 1 })).toBe(false)
    expect(isOutsideFieldRange(true, { max: 0 })).toBe(false)
    expect(isOutsideFieldRange('many', { max: 0 })).toBe(false)
  })
})
