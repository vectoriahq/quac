import { declaredColumns, readCollectionFieldEditRules, readCollectionFieldTypes, readCollectionFieldValues } from './normalizedProject.ts'

import type { FieldRange, FieldUuidFormat } from '../model/QgsProject.ts'
import type { StacCollection } from '../model/Stac.ts'

/**
 * Why a new feature's field is refused:
 *
 * - `unknown-field`: the layer has no such field;
 * - `not-fillable`: the field is read-only, the form never shows it, or the
 *   form layout does not place it, so nobody filling in the form could set it;
 * - `required`: the field enforces Not null and is blank;
 * - `wrong-type`: the value is not of the field's type;
 * - `not-a-choice`: the field restricts its values to a list, or is a
 *   Checkbox with its own spelling, and the value is not one of them;
 * - `out-of-range`: the value is a number outside the field's range.
 */
export type NewFeatureProblem = 'unknown-field' | 'not-fillable' | 'required' | 'wrong-type' | 'not-a-choice' | 'out-of-range'

/**
 * A rule a fillable field has that the layer's Collection alone cannot check:
 *
 * - `constraint-expression`: an enforced constraint expression, which needs an
 *   expression evaluator;
 * - `visible-when` / `editable-when`: an expression that hides or locks the
 *   field in the form, so whether it is filled in depends on the other values;
 * - `value-relation`: its choices are another layer's records;
 * - `unique`: an enforced Unique constraint, which needs the layer's other features;
 * - `date-format`: it stores dates in a format of its own;
 * - `attachment`: it holds a file's path, and the file is not part of the feature;
 * - `type`: its type is one this does not know.
 */
export type UncheckedFieldRule = 'constraint-expression' | 'visible-when' | 'editable-when' | 'value-relation' | 'unique' | 'date-format' | 'attachment' | 'type'

export interface NewFeatureCheck {
  /** The fields refused, in the layer's field order, then the fields the layer does not have. */
  problems: { field: string, problem: NewFeatureProblem }[]
  /**
   * The rules not checked, for every fillable field that has one, whatever
   * the feature's values. A caller that must not accept a feature unchecked
   * refuses it, or the layer, where this is not empty.
   */
  unchecked: { field: string, rule: UncheckedFieldRule }[]
}

type Properties = Readonly<Record<string, unknown>>

/**
 * Checks a new feature's values against the field rules a layer's Collection
 * states (`table:columns`), for an application that adds features to a layer
 * from a form it does not draw itself, such as a server taking features from
 * the public. Each field is checked on its own: whether the layer has it,
 * whether a form could fill it, Not null, its type, its list of values or
 * Checkbox spelling, and its range. A rule that needs more than the Collection
 * to check is listed in `unchecked`, not passed.
 *
 * It checks only what the Collection carries. A catalogue generated from a
 * QGIS project leaves out a setting it cannot read, such as a constraint
 * expression `readQgisExpression` cannot read, and lists it in the project's
 * `notes`, which a caller reads as well.
 *
 * A Collection that declares no fields refuses every value. A warning
 * (`warn`) constraint refuses nothing, as QGIS saves past it. Values are
 * checked as stored, with no conversion: a number field takes a number, not
 * text holding one.
 */
export function validateNewFeature(collection: StacCollection, properties: Properties | null | undefined): NewFeatureCheck {
  const values: Properties = properties ?? {}
  const rules = readCollectionFieldEditRules(collection)
  const types = readCollectionFieldTypes(collection)
  const choices = readCollectionFieldValues(collection)
  const problems: NewFeatureCheck['problems'] = []
  const unchecked: NewFeatureCheck['unchecked'] = []
  const known = new Set<string>()

  const fillable = new Set(readNewFeatureFields(collection))
  for (const [field, column] of declaredColumns(collection)) {
    known.add(field)
    const rule = rules[field]
    const value = values[field]
    const blank = isBlankFieldValue(value)
    if (!fillable.has(field)) {
      if (!blank) problems.push({ field, problem: 'not-fillable' })
      continue
    }

    const type = types[field]
    for (const ruleName of uncheckedRules(column, type, rule?.unique === 'enforced', rule?.dateFormat)) unchecked.push({ field, rule: ruleName })

    if (blank) {
      if (rule?.notNull === 'enforced') problems.push({ field, problem: 'required' })
      continue
    }
    const problem = !hasType(value, type, rule?.dateFormat)
      ? 'wrong-type'
      : !isAChoice(value, choices[field], rule?.checkbox)
        ? 'not-a-choice'
        : rule?.range && isOutsideFieldRange(value, rule.range)
          ? 'out-of-range'
          : null
    if (problem) problems.push({ field, problem })
  }

  for (const field of Object.keys(values)) {
    if (!known.has(field)) problems.push({ field, problem: 'unknown-field' })
  }
  return { problems, unchecked }
}

/**
 * The fields a form for a new feature can fill, in the layer's field order:
 * each declared field that is not read-only, is shown by the form, and is
 * placed by the form layout where the layer has one.
 */
export function readNewFeatureFields(collection: StacCollection): string[] {
  const rules = readCollectionFieldEditRules(collection)
  return Array.from(declaredColumns(collection))
    .filter(([field, column]) => !rules[field]?.readOnly && !rules[field]?.hidden && column['quac:in_form'] !== false)
    .map(([field]) => field)
}

/** A field with no value: null, absent, or text that is only spaces. Not null refuses one. */
export function isBlankFieldValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * Whether a value is a number outside a field's range. A blank value, a
 * boolean and text that is not a number are not: Not null and the field's
 * type deal with those. Text holding a number is read as that number.
 */
export function isOutsideFieldRange(value: unknown, range: Pick<FieldRange, 'min' | 'max'>): boolean {
  if (isBlankFieldValue(value) || typeof value === 'boolean') return false
  const number = Number(typeof value === 'string' ? value.trim() : value)
  if (!Number.isFinite(number)) return false
  return (range.min !== undefined && number < range.min) || (range.max !== undefined && number > range.max)
}

/**
 * A new identifier written as QGIS's `uuid()` writes it, for a field whose
 * default is one: `{…}` with hyphens (`with_braces`), hyphens alone
 * (`without_braces`), or 32 hex digits (`id128`), as QGIS's `fcnUuid`
 * (`QgsExpressionFunction`) writes them.
 */
export function newQgisUuid(format: FieldUuidFormat): string {
  const uuid = crypto.randomUUID()
  if (format === 'without_braces') return uuid
  if (format === 'id128') return uuid.replaceAll('-', '')
  return `{${uuid}}`
}

const KNOWN_TYPES = new Set(['string', 'int', 'long', 'double', 'boolean', 'date', 'time', 'timestamp'])
const DATE_TYPES = new Set(['date', 'time', 'timestamp'])

function uncheckedRules(column: Record<string, unknown>, type: string | undefined, unique: boolean, dateFormat: string | null | undefined): UncheckedFieldRule[] {
  const found: UncheckedFieldRule[] = []
  const constraints = column['quac:constraints']
  const expression = constraints && typeof constraints === 'object' ? (constraints as { expression?: { strength?: unknown } }).expression : undefined
  // Read from the column, not the field's rule, which leaves out an expression it cannot read.
  if (expression && expression.strength !== 'warn') found.push('constraint-expression')
  if (Array.isArray(column['quac:visible_when']) && column['quac:visible_when'].length > 0) found.push('visible-when')
  if (typeof column['quac:editable_when'] === 'string' && column['quac:editable_when'].trim()) found.push('editable-when')
  if (column['quac:value_relation']) found.push('value-relation')
  if (unique) found.push('unique')
  if (dateFormat) found.push('date-format')
  if (column['quac:attachment']) found.push('attachment')
  if (type !== undefined && !KNOWN_TYPES.has(type)) found.push('type')
  return found
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/

/**
 * Whether a value that is not blank is of the field's type. A field of no
 * type, or one this does not know, takes text, a number or true or false.
 * A date in a format of the field's own is not checked here.
 */
function hasType(value: unknown, type: string | undefined, dateFormat: string | null | undefined): boolean {
  const scalar = typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
  if (!scalar) return false
  if (type === undefined || !KNOWN_TYPES.has(type)) return true
  if (DATE_TYPES.has(type) && dateFormat) return typeof value === 'string'
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'int':
    case 'long': return Number.isInteger(value)
    case 'double': return typeof value === 'number'
    case 'boolean': return typeof value === 'boolean'
    case 'date': return typeof value === 'string' && ISO_DATE.test(value)
    case 'time': return typeof value === 'string' && ISO_TIME.test(value)
    default: return typeof value === 'string' && ISO_TIMESTAMP.test(value)
  }
}

/** Whether a value is one of the field's listed values, or one of its Checkbox's spellings; true where it has neither. */
function isAChoice(
  value: unknown,
  listed: readonly { value: string | number }[] | undefined,
  checkbox: { checkedValue: string | null, uncheckedValue: string | null } | null | undefined
): boolean {
  if (listed && listed.length > 0) return listed.some((choice) => String(choice.value) === String(value))
  if (checkbox?.checkedValue != null && checkbox.uncheckedValue != null && typeof value !== 'boolean') {
    return String(value) === checkbox.checkedValue || String(value) === checkbox.uncheckedValue
  }
  return true
}
