import { readQgisExpression } from './qgisExpression.ts'

import type { ExpressionNode } from './qgisExpression.ts'
import type { FeatureFilter } from '../model/featureFilter.ts'

/**
 * A layer's feature filter as a test of a feature's properties: `keeps` says
 * whether the layer holds a feature. Unreadable where the filter holds
 * something this does not read, so a caller leaves the layer out rather than
 * show it whole.
 */
export type FeatureTest =
  | { kind: 'readable', filter: FeatureFilter, keeps: (properties: Readonly<Record<string, unknown>> | null | undefined) => boolean }
  | { kind: 'unreadable', expression: string }

/**
 * A GDAL SQL filter (`ogr_sql`, the Provider Feature Filter of a layer QGIS
 * reads through OGR, such as a GeoJSON file) as a feature test.
 *
 * It reads the part of GDAL's SQL that a QGIS expression writes and means
 * alike: fields, text, numbers, `NULL`, the comparisons, `IS [NOT] NULL`,
 * `LIKE`, `ILIKE`, `IN`, `BETWEEN`, `AND`, `OR` and `NOT`. A function,
 * arithmetic, a boolean literal, `~` or a whole `SELECT` makes it unreadable,
 * as does any other dialect. `=`, `<>`, `!=` and `IN` against text with case
 * ignore case, as GDAL's string equality does (`ogr_sql_dialect.html` §
 * "WHERE", gdal.org, read 2026-10-26).
 *
 * Values compare as a QGIS expression compares them: a comparison with a NULL
 * is unknown, numbers compare as numbers unless both sides are text, and
 * `AND`, `OR` and `NOT` follow three-valued logic. A feature is kept where the
 * filter comes out true. A field is found by its name, then by its name
 * ignoring case.
 */
export function readSqlFeatureTest(filter: FeatureFilter): FeatureTest {
  const unreadable: FeatureTest = { kind: 'unreadable', expression: filter.expression }
  if (filter.dialect !== 'ogr_sql') return unreadable
  const node = readQgisExpression(filter.expression)
  if (!node || !isSharedSql(node)) return unreadable
  return {
    kind: 'readable',
    filter,
    keeps: (properties) => {
      const value = evaluate(node, properties ?? {})
      return value !== null && toBoolean(value)
    }
  }
}

const SHARED_PREDICATES = new Set(['is', 'like', 'ilike', 'in', 'between'])

/** Whether a node holds only what GDAL's SQL and a QGIS expression write and mean alike. */
function isSharedSql(node: ExpressionNode): boolean {
  switch (node.kind) {
    case 'field':
    case 'text':
    case 'number':
    case 'null':
      return true
    case 'compare':
      return isSharedSql(node.left) && isSharedSql(node.right)
    case 'logic':
      return node.args.every(isSharedSql)
    case 'not':
      return isSharedSql(node.arg)
    case 'predicate':
      // GDAL's SQL has no `~`, so only these predicates mean the same in both.
      if (!SHARED_PREDICATES.has(node.op)) return false
      if (node.op === 'is' && node.args[1]?.kind !== 'null') return false
      return node.args.every(isSharedSql)
    default:
      return false
  }
}

type Properties = Readonly<Record<string, unknown>>
type Truth = boolean | null

/** A field's value: by its name, then by its name ignoring case; null where the feature has neither. */
function fieldValue(properties: Properties, name: string): unknown {
  if (Object.hasOwn(properties, name)) return properties[name] ?? null
  const lower = name.toLowerCase()
  const match = Object.keys(properties).find((key) => key.toLowerCase() === lower)
  return match === undefined ? null : properties[match] ?? null
}

/** Text whose upper and lower case differ, which is all that ignoring case changes. */
function isCasedText(node: ExpressionNode): boolean {
  return node.kind === 'text' && node.value.toLowerCase() !== node.value.toUpperCase()
}

/** A value in lower case, as text; null stays null. */
function lowered(value: unknown): unknown {
  return isNull(value) ? null : toText(value).toLowerCase()
}

/** A node's value: a condition gives 1, 0 or null, as QGIS gives one. */
function evaluate(node: ExpressionNode, properties: Properties): unknown {
  switch (node.kind) {
    case 'field':
      return fieldValue(properties, node.name)
    case 'text':
    case 'number':
      return node.value
    case 'null':
      return null
    case 'compare': {
      const caseless = (node.op === '=' || node.op === '<>' || node.op === '!=') && (isCasedText(node.left) || isCasedText(node.right))
      const read = (side: ExpressionNode) => (caseless ? lowered(evaluate(side, properties)) : evaluate(side, properties))
      return fromTruth(compareValues(node.op, read(node.left), read(node.right)))
    }
    case 'logic':
      return fromTruth(combineTruths(node.args.map((arg) => toTruth(evaluate(arg, properties))), node.op === 'or'))
    case 'not': {
      const truth = toTruth(evaluate(node.arg, properties))
      return fromTruth(truth === null ? null : !truth)
    }
    case 'predicate': {
      const truth = predicateTruth(node, properties)
      return fromTruth(node.negate && truth !== null ? !truth : truth)
    }
    default:
      return null
  }
}

function predicateTruth(node: Extract<ExpressionNode, { kind: 'predicate' }>, properties: Properties): Truth {
  if (node.op === 'in') {
    const caseless = node.args.slice(1).some(isCasedText)
    const [value, ...list] = node.args.map((arg) => (caseless ? lowered(evaluate(arg, properties)) : evaluate(arg, properties)))
    return isIn(value, list)
  }
  const [value, second, third] = node.args.map((arg) => evaluate(arg, properties))
  switch (node.op) {
    case 'is':
      // Only `IS NULL` is read, so the other side is always null.
      return isNull(value)
    case 'like':
    case 'ilike':
      if (isNull(value) || isNull(second)) return null
      return likePattern(toText(second), node.op === 'ilike').test(toText(value))
    case 'between':
      if (isNull(value)) return null
      return combineTruths([compareValues('>=', value, second), compareValues('<=', value, third)], false)
    default:
      return null
  }
}

function isNull(value: unknown): boolean {
  return value === null || value === undefined
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

/** Text that Qt's `QString::toDouble` reads as a number: decimal digits, an optional exponent, and spaces at either end. */
const NUMBER_TEXT = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/

/** QGIS's `qgsDoubleNear` tolerance: four times the gap between 1 and the next double. */
const DOUBLE_NEAR = 4 * Number.EPSILON

/** A number as QGIS reads one: a number, or text that is one. Null for anything else. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !NUMBER_TEXT.test(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** A value as QGIS's `toBool` reads it: false for null, 0, and for blank text, `0` and `false` in any case. */
function toBoolean(value: unknown): boolean {
  if (typeof value === 'string') return !['', '0', 'false'].includes(value.toLowerCase())
  return Boolean(value)
}

/** A value as QGIS's `getTVLValue` reads it for a condition: unknown for null, and for text that is not a number. */
function toTruth(value: unknown): Truth {
  if (isNull(value)) return null
  if (typeof value === 'boolean') return value
  const number = toNumber(value)
  return number === null ? null : Math.abs(number) > DOUBLE_NEAR
}

function fromTruth(truth: Truth): number | null {
  return truth === null ? null : truth ? 1 : 0
}

/** `AND` (deciding false) or `OR` (deciding true) over three-valued truths. */
function combineTruths(truths: Truth[], deciding: boolean): Truth {
  if (truths.includes(deciding)) return deciding
  return truths.includes(null) ? null : !deciding
}

/**
 * QGIS's `compareNonNullValues` for two values that are not null, as a
 * difference: as numbers when both read as numbers and they are not both text,
 * as true and false when either is a boolean, and otherwise as text.
 */
function compareNonNull(left: unknown, right: unknown): { diff: number, numeric: boolean } {
  const leftNumber = toNumber(left)
  const rightNumber = toNumber(right)
  if (!(typeof left === 'string' && typeof right === 'string') && leftNumber !== null && rightNumber !== null) {
    return { diff: leftNumber - rightNumber, numeric: true }
  }
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return { diff: Number(toBoolean(left)) - Number(toBoolean(right)), numeric: false }
  }
  const leftText = toText(left)
  const rightText = toText(right)
  return { diff: leftText < rightText ? -1 : leftText > rightText ? 1 : 0, numeric: false }
}

const COMPARISONS: Record<string, (diff: number, numeric: boolean) => boolean> = {
  '=': (diff, numeric) => (numeric ? Math.abs(diff) <= DOUBLE_NEAR : diff === 0),
  '<>': (diff, numeric) => (numeric ? Math.abs(diff) > DOUBLE_NEAR : diff !== 0),
  '!=': (diff, numeric) => (numeric ? Math.abs(diff) > DOUBLE_NEAR : diff !== 0),
  '<': (diff) => diff < 0,
  '<=': (diff) => diff <= 0,
  '>': (diff) => diff > 0,
  '>=': (diff) => diff >= 0
}

/** A comparison of two values: unknown when either is null. */
function compareValues(op: string, left: unknown, right: unknown): Truth {
  if (isNull(left) || isNull(right)) return null
  const { diff, numeric } = compareNonNull(left, right)
  return COMPARISONS[op]!(diff, numeric)
}

/**
 * QGIS's `IN`: unknown for a null value, true when a list item equals it, as
 * numbers when both read as numbers and are not both text and as text
 * otherwise, and unknown rather than false when the list holds a null.
 */
function isIn(value: unknown, list: unknown[]): Truth {
  if (isNull(value)) return null
  let listHasNull = false
  for (const item of list) {
    if (isNull(item)) {
      listHasNull = true
      continue
    }
    const valueNumber = toNumber(value)
    const itemNumber = toNumber(item)
    const equal = !(typeof value === 'string' && typeof item === 'string') && valueNumber !== null && itemNumber !== null
      ? Math.abs(valueNumber - itemNumber) <= DOUBLE_NEAR
      : toText(value) === toText(item)
    if (equal) return true
  }
  return listHasNull ? null : false
}

/** A `LIKE` pattern as a regular expression: `%` any run, `_` one character, and `\%` or `\_` the character itself. */
function likePattern(pattern: string, caseInsensitive: boolean): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!
    const following = pattern[index + 1]
    if (char === '\\' && (following === '%' || following === '_')) {
      source += following
      index += 1
    } else if (char === '%') {
      source += '[\\s\\S]*'
    } else if (char === '_') {
      source += '[\\s\\S]'
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
    }
  }
  return new RegExp(`^(?:${source})$`, caseInsensitive ? 'iu' : 'u')
}
