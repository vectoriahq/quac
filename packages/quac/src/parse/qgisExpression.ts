import { isFormattableQtDatePattern } from './qtDateFormat'
import { compileQtRegex } from './qtRegex'

import type { MeasureFactors } from './parseMeasurement'
import type { Filter } from 'geostyler-style'

type Comparison = '=' | '!=' | '<>' | '<' | '<=' | '>' | '>='
type Punct = '||' | '(' | ')' | '[' | ']' | ',' | ':=' | '+' | '-' | '*' | '/' | '//' | '%' | '^' | '~' | Comparison
type Arithmetic = '+' | '-' | '*' | '/' | '//' | '%' | '^'

type ExpressionToken =
  | { type: 'field'; value: string }
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'punct'; value: Punct }

export type ExpressionNode =
  | { kind: 'field'; name: string }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'call'; name: string; args: ExpressionNode[]; factor?: number }
  | { kind: 'arithmetic'; op: Arithmetic; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'negate'; arg: ExpressionNode }
  | { kind: 'compare'; op: Comparison; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'predicate'; op: 'is' | 'like' | 'ilike' | 'in' | 'between' | 'regexp'; negate: boolean; args: ExpressionNode[] }
  | { kind: 'logic'; op: 'and' | 'or'; args: ExpressionNode[] }
  | { kind: 'not'; arg: ExpressionNode }
  | { kind: 'case'; whens: Array<{ when: ExpressionNode; then: ExpressionNode }>; otherwise: ExpressionNode | null }

type Read = { node: ExpressionNode; next: number } | null

/** Words QGIS's lexer reads as keywords rather than field names, ignoring case. */
const QGIS_KEYWORDS = new Set([
  'and', 'between', 'case', 'else', 'end', 'false', 'ilike', 'in', 'is', 'like', 'not', 'null', 'or', 'then', 'true', 'when'
])

/** The one-argument QGIS functions a label expression may call, and the GeoStyler function each becomes. */
const ONE_ARGUMENT_FUNCTIONS: Record<string, 'strToUpperCase' | 'strToLowerCase' | 'strCapitalize' | 'strTrim'> = {
  upper: 'strToUpperCase',
  lower: 'strToLowerCase',
  title: 'strCapitalize',
  trim: 'strTrim'
}

/**
 * The QGIS functions with no GeoStyler function of the same meaning, and the
 * fewest and most arguments each takes by position. Each becomes a GeoStyler
 * `custom` function with the QGIS name as its `fnName`.
 */
const QGIS_ONLY_FUNCTIONS: Record<string, [min: number, max: number]> = {
  coalesce: [1, Infinity],
  if: [3, 3],
  length: [1, 1],
  round: [1, 2],
  format_number: [1, 5],
  left: [2, 2],
  right: [2, 2],
  substr: [2, 3],
  replace: [3, 3],
  current_value: [1, 1],
  to_int: [1, 1],
  to_string: [1, 1],
  lpad: [2, 3],
  maximum: [1, 1],
  minimum: [1, 1],
  format_date: [2, 3],
  now: [0, 0],
  make_interval: [0, 7],
  max: [0, Infinity],
  min: [0, Infinity],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  to_real: [1, 1],
  rpad: [2, 3],
  strpos: [2, 2],
  nullif: [2, 2],
  wordwrap: [2, 3],
  year: [1, 1],
  month: [1, 1],
  day: [1, 1],
  week: [1, 1],
  day_of_week: [1, 1],
  hour: [1, 1],
  minute: [1, 1],
  second: [1, 1],
  regexp_match: [2, 2],
  regexp_replace: [3, 3],
  regexp_substr: [2, 2],
  array_first: [1, 1],
  array_get: [2, 2],
  overlay_within: [1, 5],
  overlay_intersects: [1, 5],
  aggregate: [3, 6],
  geometry: [1, 1],
  intersects: [2, 2]
}

/** The functions whose second argument is a regular expression, which QGIS compiles with Unicode properties. */
const REGEXP_FUNCTIONS = ['regexp_match', 'regexp_replace', 'regexp_substr']

/**
 * The names of the functions that take a named value, such as
 * `make_interval(days:=14)`, in the order QGIS gives them by position, and the
 * value each takes when it is left out (`QgsExpressionFunction::Parameter`,
 * `src/core/expression/qgsexpressionfunction.cpp`, `qgis/QGIS@master`, read
 * 2026-10-27).
 */
const NAMED_PARAMETERS: Record<string, { names: string[], omitted: ExpressionNode }> = {
  make_interval: { names: ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'], omitted: { kind: 'number', value: 0 } },
  // QGIS's own lists go on (`min_overlap` and others); a value for any of
  // those leaves the expression unread.
  overlay_within: { names: ['layer', 'expression', 'filter', 'limit', 'cache'], omitted: { kind: 'null' } },
  overlay_intersects: { names: ['layer', 'expression', 'filter', 'limit', 'cache'], omitted: { kind: 'null' } },
  aggregate: { names: ['layer', 'aggregate', 'expression', 'filter', 'concatenator', 'order_by'], omitted: { kind: 'null' } }
}

/** The calls that read another layer of the project: `LayerLookup`. */
const LOOKUPS = ['overlay_within', 'overlay_intersects', 'aggregate']

/**
 * What `aggregate` reads the filter `intersects($geometry, geometry(@parent))`
 * through, which stand nowhere else.
 */
const PARENT_GEOMETRY_CALLS = ['intersects', 'geometry', '$geometry', '@parent']

/** The `aggregate` kinds Groundwork works out (`QgsAggregateCalculator::aggregates`). */
export const LOOKUP_AGGREGATES = ['count', 'min', 'max', 'concatenate'] as const

/**
 * One read of another layer of the project: the features of `layer`, named by
 * its name or its QGIS id, that the record's shape lies within or meets, kept
 * by `filter` and cut to `limit`, each giving the value of `expression`. The
 * answer is the list of those values, in the order the source gave the
 * features. `key` tells one read from another.
 */
export interface LayerLookup {
  key: string
  layer: string
  predicate: 'within' | 'intersects'
  expression: ExpressionNode
  filter: ExpressionNode | null
  limit: number | null
}

/**
 * The `fnName` of the GeoStyler `custom` function that stands for a
 * `LayerLookup`, with its `key` as its one argument. The evaluator is handed
 * the answers before it starts (`src/utils/formExpression.ts`).
 */
export const LAYER_LOOKUP = 'layer_lookup'

/** The functions that take a date as their first argument, where `now()` may stand. */
const DATE_TAKERS = ['format_date', 'year', 'month', 'day', 'week', 'day_of_week', 'hour', 'minute', 'second']

/** The aggregates Groundwork reads, which scan the records of a layer. */
const AGGREGATES = ['maximum', 'minimum']

/**
 * The values QGIS gives a feature from its geometry that Groundwork reads, and
 * the unit each is in: an area or a distance. They are written with no
 * brackets (`$area`).
 */
export const GEOMETRY_VALUES: Readonly<Record<string, 'area' | 'distance'>> = {
  $area: 'area',
  $length: 'distance',
  $perimeter: 'distance'
}

/** The GeoStyler function each comparison becomes. */
const COMPARISON_FUNCTIONS: Record<Comparison, string> = {
  '=': 'equalTo',
  '!=': 'notEqualTo',
  '<>': 'notEqualTo',
  '<': 'lessThan',
  '<=': 'lessThanOrEqualTo',
  '>': 'greaterThan',
  '>=': 'greaterThanOrEqualTo'
}

/** The GeoStyler function each arithmetic operator becomes. */
const ARITHMETIC_FUNCTIONS: Record<Arithmetic, string> = {
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
  '//': 'intdiv',
  '%': 'mod',
  '^': 'pow'
}

/**
 * The `fnName` of the GeoStyler `custom` function that wraps a condition read
 * from a QGIS rule, which `src/style/labelFunction.ts` works out with QGIS's
 * rules.
 */
export const QGIS_CONDITION = 'qgis_condition'

/** Whether a filter is a condition `qgisConditionToFilter` wrapped. */
export function isQgisConditionFilter(filter: unknown): filter is { name: 'custom', fnName: typeof QGIS_CONDITION, args: [unknown] } {
  const call = filter as { name?: unknown, fnName?: unknown, args?: unknown } | null
  return typeof call === 'object' && call !== null && call.name === 'custom' && call.fnName === QGIS_CONDITION && Array.isArray(call.args)
}

/**
 * Reads a QGIS expression into a tree: fields, text, numbers, `TRUE`, `FALSE`,
 * `NULL`, `||`, `+`, `-`, `*`, `/`, `//`, `%`, `^`, conditions, `~`, `CASE`
 * and calls to the functions below, `current_value` among them. Null for any
 * other expression, such as another function, a named argument to a function
 * outside `NAMED_PARAMETERS`, or a variable.
 *
 * A regular expression, the pattern of `~` or of a `regexp_` function, is read
 * where it is text written into the expression that `compileQtRegex` can
 * translate (`qtRegex.ts`).
 *
 * `make_interval` is read only as the right side of a `+` or `-`, where the
 * evaluator adds it to a date or takes it away. QGIS reads an interval
 * elsewhere too, which the evaluator does not.
 *
 * `overlay_within`, `overlay_intersects` and `aggregate` read another layer,
 * and are read only where the caller says `lookups`: the caller then answers
 * each `LayerLookup` before it evaluates (a default value). See
 * `areLookupsReadable` for the forms read.
 *
 * `current_value` is read only where the caller says `currentValue`: the
 * caller then supplies the form's values (a Value Relation's filter), or reads
 * the expression where there is no form, which gives NULL (a label, a style
 * rule). A constraint or a default value is not read when it calls it.
 *
 * `$area`, `$length` and `$perimeter` are read only where the caller says
 * `geometry`: `true` reads their shape alone, as the project reader does before
 * the units are known, and the project's `MeasureFactors` read them in those
 * units. A unit with no factor makes the expression unreadable. A caller that
 * does not pass `geometry` has no feature shape to measure, so the expression
 * is not read.
 *
 * `maximum` and `minimum` are read only where the caller says `aggregates`:
 * the caller then supplies the records to scan (a default value), and every
 * other caller would scan them for each feature drawn or field shown. Only
 * their first argument is read, so `group_by` and `filter` make them
 * unreadable, and so does a shape or another aggregate inside one: the records
 * scanned carry no shape.
 *
 * `format_date` is read where its pattern and any language are text written
 * into the expression, and the pattern holds no `t` (`qtDateFormat.ts`).
 * `now()`, or `$now`, is read only as the date of `format_date` or of a
 * function that takes a part of a date, such as `year`: anywhere else it would
 * be compared or added as a date, which the evaluator does not do.
 */
export function readQgisExpression(
  expression: string,
  options: { currentValue?: boolean, geometry?: true | MeasureFactors, aggregates?: boolean, lookups?: boolean } = {}
): ExpressionNode | null {
  const tokens = tokenizeExpression(expression)
  if (!tokens || tokens.length === 0) return null

  const parsed = readOr(tokens, 0)
  if (!parsed || parsed.next !== tokens.length) return null
  if (!options.currentValue && findCalls(parsed.node, 'current_value').length > 0) return null
  const aggregateCalls = findCalls(parsed.node, ...AGGREGATES)
  if (aggregateCalls.length > 0 && !options.aggregates) return null
  if (aggregateCalls.some((call) => findCalls(call.args[0]!, ...AGGREGATES, ...Object.keys(GEOMETRY_VALUES)).length > 0)) return null

  if (!findCalls(parsed.node, ...REGEXP_FUNCTIONS).every((call) => isReadableRegex(call.args[1], true))) return null
  if (!findRegexpPredicates(parsed.node).every((predicate) => isReadableRegex(predicate.args[1], false))) return null

  const formatDateCalls = findCalls(parsed.node, 'format_date')
  if (!formatDateCalls.every(isReadableFormatDate)) return null
  const datedNows = new Set(findCalls(parsed.node, ...DATE_TAKERS).map((call) => call.args[0]))
  if (findCalls(parsed.node, 'now').some((call) => !datedNows.has(call))) return null

  if (!areLookupsReadable(parsed.node, options.lookups === true)) return null

  const addedIntervals = new Set(findAddedIntervals(parsed.node))
  if (findCalls(parsed.node, 'make_interval').some((call) => !addedIntervals.has(call))) return null

  const geometryCalls = findCalls(parsed.node, ...Object.keys(GEOMETRY_VALUES))
  if (geometryCalls.length === 0) return parsed.node
  if (!options.geometry) return null
  if (options.geometry === true) return parsed.node
  for (const call of geometryCalls) {
    const factor = options.geometry[GEOMETRY_VALUES[call.name]!]
    if (factor === null) return null
    call.factor = factor
  }
  return parsed.node
}

/** A regular expression written into the expression as text, which `compileQtRegex` translates. */
function isReadableRegex(pattern: ExpressionNode | undefined, unicode: boolean): boolean {
  return pattern?.kind === 'text' && compileQtRegex(pattern.value, unicode) !== null
}

/** The `~` predicates at or under a node. */
function findRegexpPredicates(node: ExpressionNode): Array<ExpressionNode & { kind: 'predicate' }> {
  const own = node.kind === 'predicate' && node.op === 'regexp' ? [node] : []
  return [...own, ...childNodes(node).flatMap(findRegexpPredicates)]
}

/** A `format_date` call whose pattern and language are written-in text, and whose pattern Groundwork formats. */
function isReadableFormatDate(call: ExpressionNode & { kind: 'call' }): boolean {
  const [, pattern, language] = call.args
  return pattern?.kind === 'text' && isFormattableQtDatePattern(pattern.value) && (language === undefined || language.kind === 'text')
}

/**
 * A QGIS rule's condition as a GeoStyler filter: the condition's GeoStyler
 * function inside a `custom` function named `QGIS_CONDITION`, which
 * `geostyler-openlayers-parser` hands to the evaluator Groundwork gives it.
 * Null for a condition `readQgisExpression` cannot read. `measure` is the
 * project's units, which `$area` and `$length` need.
 */
export function qgisConditionToFilter(expression: string, measure?: MeasureFactors): Filter | null {
  const node = readQgisExpression(expression, { currentValue: true, geometry: measure })
  return node && ({ name: 'custom', fnName: QGIS_CONDITION, args: [expressionToGeoStylerFunction(node)] } as Filter)
}

/**
 * A string literal's text, as QGIS's `stripText` makes it: `''` becomes a
 * quote first, then a backslash and the character after it become that
 * character, `\n` and `\t` as a newline and a tab, and any character but
 * those, `\` and `'` as `?`.
 */
export function unescapeStringLiteral(text: string): string {
  const escapes: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', "'": "'" }
  return text.replace(/''/g, "'").replace(/\\(.)/gs, (_, chr: string) => escapes[chr] ?? '?')
}

/**
 * Splits an expression into field references, string literals, numbers, names
 * and punctuation, following QGIS's lexer (`src/core/qgsexpressionlexer.ll`,
 * `qgis/QGIS@master`, read 2026-10-23). A `char(n)` call is read as the text of
 * the character with that code, so `char(10)` is a line break, as `'\n'` is.
 * Null where the expression holds anything else.
 */
function tokenizeExpression(expression: string): ExpressionToken[] | null {
  const pattern = /\s+|'((?:''|\\.|[^'\\])*)'|"((?:""|[^"])*)"|[Cc][Hh][Aa][Rr]\s*\(\s*(\d+)\s*\)|(\d*\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)|([$@]?[A-Za-z_\x80-\uFFFF][A-Za-z0-9_\x80-\uFFFF]*)|(\|\||<>|!=|<=|>=|:=|\/\/|[()[\],=<>+*/%^~-])/y
  const tokens: ExpressionToken[] = []
  pattern.lastIndex = 0
  while (pattern.lastIndex < expression.length) {
    const match = pattern.exec(expression)
    if (!match) return null
    const [, text, quotedField, charCode, number, name, punct] = match
    if (text !== undefined || charCode !== undefined) {
      const code = Number(charCode)
      if (charCode !== undefined && (code < 1 || code > 0x10FFFF)) return null
      tokens.push({ type: 'text', value: text !== undefined ? unescapeStringLiteral(text) : String.fromCodePoint(code) })
    } else if (quotedField !== undefined) {
      const value = quotedField.replace(/""/g, '"')
      if (!value) return null
      tokens.push({ type: 'field', value })
    } else if (number !== undefined) {
      tokens.push({ type: 'number', value: Number(number) })
    } else if (name !== undefined) {
      tokens.push({ type: 'name', value: name })
    } else if (punct !== undefined) {
      tokens.push({ type: 'punct', value: punct as Punct })
    }
  }
  return tokens
}

function isPunct(token: ExpressionToken | undefined, value: Punct): boolean {
  return token?.type === 'punct' && token.value === value
}

function isWord(token: ExpressionToken | undefined, word: string): boolean {
  return token?.type === 'name' && token.value.toLowerCase() === word
}

// The readers below follow QGIS's operator precedence, loosest first: `OR`,
// `AND`, `NOT`, `BETWEEN`, the comparisons, `~`, `IS`, `LIKE` and `IN`, then `+` and
// `-`, `*`, `/`, `//` and `%`, then `^` (right to left), `||`, and a unary minus
// tightest of all, so `1 + 2 || 3` is `1 + (2 || 3)` and `-2 ^ 2` is 4
// (`%left` and `%right` lines of `src/core/qgsexpressionparser.yy`,
// `qgis/QGIS@master`, read 2026-10-23, and `qgis/QGIS@16eddb2`, read 2026-10-26).

function readOr(tokens: ExpressionToken[], index: number): Read {
  return readLogic(tokens, index, 'or', readAnd)
}

function readAnd(tokens: ExpressionToken[], index: number): Read {
  return readLogic(tokens, index, 'and', readNot)
}

function readLogic(tokens: ExpressionToken[], index: number, op: 'and' | 'or', readOperand: (tokens: ExpressionToken[], index: number) => Read): Read {
  const first = readOperand(tokens, index)
  if (!first) return null

  const args = [first.node]
  let next = first.next
  while (isWord(tokens[next], op)) {
    const operand = readOperand(tokens, next + 1)
    if (!operand) return null
    args.push(operand.node)
    next = operand.next
  }
  return { node: args.length === 1 ? args[0]! : { kind: 'logic', op, args }, next }
}

function readNot(tokens: ExpressionToken[], index: number): Read {
  if (!isWord(tokens[index], 'not')) return readPredicate(tokens, index)
  const operand = readNot(tokens, index + 1)
  return operand && { node: { kind: 'not', arg: operand.node }, next: operand.next }
}

/** A value, and any comparison, `IS`, `LIKE`, `ILIKE`, `IN` or `BETWEEN` after it, left to right. */
function readPredicate(tokens: ExpressionToken[], index: number): Read {
  let read = readSum(tokens, index)
  while (read) {
    const left = read.node
    let next = read.next
    const token = tokens[next]

    if (token?.type === 'punct' && Object.hasOwn(COMPARISON_FUNCTIONS, token.value)) {
      const right = readSum(tokens, next + 1)
      read = right && { node: { kind: 'compare', op: token.value as Comparison, left, right: right.node }, next: right.next }
      continue
    }
    if (isPunct(token, '~')) {
      const right = readSum(tokens, next + 1)
      read = right && { node: { kind: 'predicate', op: 'regexp', negate: false, args: [left, right.node] }, next: right.next }
      continue
    }
    if (isWord(token, 'is')) {
      const negate = isWord(tokens[next + 1], 'not')
      const right = readSum(tokens, next + (negate ? 2 : 1))
      read = right && { node: { kind: 'predicate', op: 'is', negate, args: [left, right.node] }, next: right.next }
      continue
    }

    const negate = isWord(token, 'not')
    if (negate) next += 1
    const op = ['like', 'ilike', 'in', 'between'].find((word) => isWord(tokens[next], word)) as 'like' | 'ilike' | 'in' | 'between' | undefined
    if (!op) return negate ? null : read

    if (op === 'like' || op === 'ilike') {
      const pattern = readSum(tokens, next + 1)
      read = pattern && { node: { kind: 'predicate', op, negate, args: [left, pattern.node] }, next: pattern.next }
    } else if (op === 'in') {
      const list = readList(tokens, next + 1)
      read = list && { node: { kind: 'predicate', op, negate, args: [left, ...list.nodes] }, next: list.next }
    } else {
      const low = readSum(tokens, next + 1)
      const high = low && isWord(tokens[low.next], 'and') ? readSum(tokens, low.next + 1) : null
      read = high && { node: { kind: 'predicate', op, negate, args: [left, low!.node, high.node] }, next: high.next }
    }
  }
  return null
}

/** `(a, b, …)` from `index`: the expressions, and the index after the closing bracket. */
function readList(tokens: ExpressionToken[], index: number): { nodes: ExpressionNode[]; next: number } | null {
  if (!isPunct(tokens[index], '(')) return null
  const nodes: ExpressionNode[] = []
  let next = index + 1
  while (!isPunct(tokens[next], ')')) {
    if (next >= tokens.length) return null
    if (nodes.length > 0) {
      if (!isPunct(tokens[next], ',')) return null
      next += 1
    }
    const item = readOr(tokens, next)
    if (!item) return null
    nodes.push(item.node)
    next = item.next
  }
  return { nodes, next: next + 1 }
}

/** `a + b - c …` from `index`, left to right, or a lone product, and the index after it. */
function readSum(tokens: ExpressionToken[], index: number): Read {
  return readArithmetic(tokens, index, ['+', '-'], readProduct)
}

/** `a * b / c // d % e …` from `index`, left to right, or a lone power, and the index after it. */
function readProduct(tokens: ExpressionToken[], index: number): Read {
  return readArithmetic(tokens, index, ['*', '/', '//', '%'], readPower)
}

/** `a ^ b ^ …` from `index`, right to left, so `2 ^ 3 ^ 2` is `2 ^ 9`, or a lone concatenation, and the index after it. */
function readPower(tokens: ExpressionToken[], index: number): Read {
  const base = readConcat(tokens, index)
  if (!base || !isPunct(tokens[base.next], '^')) return base
  const exponent = readPower(tokens, base.next + 1)
  return exponent && { node: { kind: 'arithmetic', op: '^', left: base.node, right: exponent.node }, next: exponent.next }
}

function readArithmetic(tokens: ExpressionToken[], index: number, ops: Arithmetic[], readOperand: (tokens: ExpressionToken[], index: number) => Read): Read {
  let read = readOperand(tokens, index)
  while (read) {
    const token = tokens[read.next]
    if (token?.type !== 'punct' || !ops.includes(token.value as Arithmetic)) return read
    const right = readOperand(tokens, read.next + 1)
    read = right && { node: { kind: 'arithmetic', op: token.value as Arithmetic, left: read.node, right: right.node }, next: right.next }
  }
  return null
}

/**
 * `a || b || …` from `index`, or a lone unary term, and the index after it. It
 * is a call named `||`, kept apart from `concat`: QGIS gives NULL when any part
 * of `||` is NULL, where `concat` skips it (`QgsExpressionNodeBinaryOperator::evalNode`,
 * `boConcat`, `src/core/expression/qgsexpressionnodeimpl.cpp`, `qgis/QGIS@master`,
 * read 2026-10-25).
 */
function readConcat(tokens: ExpressionToken[], index: number): Read {
  const first = readUnary(tokens, index)
  if (!first) return null

  const terms = [first.node]
  let next = first.next
  while (isPunct(tokens[next], '||')) {
    const term = readUnary(tokens, next + 1)
    if (!term) return null
    terms.push(term.node)
    next = term.next
  }
  return { node: terms.length === 1 ? terms[0]! : { kind: 'call', name: '||', args: terms }, next }
}

/** A term, or a minus or plus before one: a minus before a number is the negative number. */
function readUnary(tokens: ExpressionToken[], index: number): Read {
  const token = tokens[index]
  if (!isPunct(token, '-') && !isPunct(token, '+')) return readIndexed(tokens, index)

  const operand = readUnary(tokens, index + 1)
  if (!operand || isPunct(token, '+')) return operand
  const { node } = operand
  return { node: node.kind === 'number' ? { kind: 'number', value: -node.value } : { kind: 'negate', arg: node }, next: operand.next }
}

/** A term and any `[index]` after it, read as `array_get`, as QGIS's index operator works on an array. */
function readIndexed(tokens: ExpressionToken[], index: number): Read {
  let read = readTerm(tokens, index)
  while (read && isPunct(tokens[read.next], '[')) {
    const position = readOr(tokens, read.next + 1)
    if (!position || !isPunct(tokens[position.next], ']')) return null
    read = { node: { kind: 'call', name: 'array_get', args: [read.node, position.node] }, next: position.next + 1 }
  }
  return read
}

/**
 * A field reference, quoted or bare, a string literal, a number,
 * `TRUE`, `FALSE`, `NULL`, a bracketed expression, a `CASE`,
 * or a call to one of the label functions, from `index`.
 */
function readTerm(tokens: ExpressionToken[], index: number): Read {
  const token = tokens[index]
  const after = tokens[index + 1]
  if (token?.type === 'field') return { node: { kind: 'field', name: token.value }, next: index + 1 }
  if (token?.type === 'text') return { node: { kind: 'text', value: token.value }, next: index + 1 }
  if (token?.type === 'number') return { node: { kind: 'number', value: token.value }, next: index + 1 }
  if (isPunct(token, '(')) {
    const inner = readOr(tokens, index + 1)
    return inner && isPunct(tokens[inner.next], ')') ? { node: inner.node, next: inner.next + 1 } : null
  }
  if (token?.type !== 'name') return null

  if (!isPunct(after, '(')) {
    const word = token.value.toLowerCase()
    if (word.startsWith('$')) {
      if (word === '$now') return { node: { kind: 'call', name: 'now', args: [] }, next: index + 1 }
      return Object.hasOwn(GEOMETRY_VALUES, word) || word === '$geometry' ? { node: { kind: 'call', name: word, args: [] }, next: index + 1 } : null
    }
    // A variable: `@parent` alone is read, inside an `aggregate` filter.
    if (word.startsWith('@')) return word === '@parent' ? { node: { kind: 'call', name: word, args: [] }, next: index + 1 } : null
    if (word === 'true' || word === 'false') return { node: { kind: 'boolean', value: word === 'true' }, next: index + 1 }
    if (word === 'null') return { node: { kind: 'null' }, next: index + 1 }
    if (word === 'case') return readCase(tokens, index + 1)
    if (QGIS_KEYWORDS.has(word)) return null
    return { node: { kind: 'field', name: token.value }, next: index + 1 }
  }

  const name = token.value.toLowerCase()
  const argumentRange = argumentRangeOf(name)
  if (!argumentRange) return null
  const list = readArguments(tokens, index + 1, NAMED_PARAMETERS[name])
  if (!list || list.nodes.length < argumentRange[0] || list.nodes.length > argumentRange[1]) return null
  return { node: { kind: 'call', name, args: list.nodes }, next: list.next }
}

/**
 * A call's arguments from its opening bracket, each by position or as
 * `name:=value`, in the order of the function's `parameters`, with a left-out
 * one given its `omitted` value. As in QGIS, a value by position cannot follow
 * a named one, and a name must be the function's and given once
 * (`exp_list` in `src/core/qgsexpressionparser.yy` and
 * `QgsExpressionNodeFunction::validateParams` in `qgsexpressionnodeimpl.cpp`,
 * `qgis/QGIS@master`, read 2026-10-27). Null for a named value where the
 * function has no `parameters`.
 */
function readArguments(
  tokens: ExpressionToken[],
  index: number,
  parameters: { names: string[], omitted: ExpressionNode } | undefined
): { nodes: ExpressionNode[]; next: number } | null {
  if (!isPunct(tokens[index], '(')) return null
  const positional: ExpressionNode[] = []
  const named = new Map<string, ExpressionNode>()
  let next = index + 1
  while (!isPunct(tokens[next], ')')) {
    if (next >= tokens.length) return null
    if (positional.length + named.size > 0) {
      if (!isPunct(tokens[next], ',')) return null
      next += 1
    }
    const nameToken = tokens[next]
    const isNamed = nameToken?.type === 'name' && isPunct(tokens[next + 1], ':=')
    const item = readOr(tokens, isNamed ? next + 2 : next)
    if (!item) return null
    if (isNamed) {
      const position = parameters?.names.indexOf(nameToken.value.toLowerCase()) ?? -1
      if (position < 0 || position < positional.length || named.has(parameters!.names[position]!)) return null
      named.set(parameters!.names[position]!, item.node)
    } else {
      if (named.size > 0) return null
      positional.push(item.node)
    }
    next = item.next
  }
  if (named.size === 0) return { nodes: positional, next: next + 1 }
  const nodes = parameters!.names.map((parameter, position) => positional[position] ?? named.get(parameter) ?? parameters!.omitted)
  return { nodes, next: next + 1 }
}

/** `WHEN … THEN …`, one or more, an optional `ELSE …`, and `END`, from just after `CASE`. */
function readCase(tokens: ExpressionToken[], index: number): Read {
  const whens: Array<{ when: ExpressionNode; then: ExpressionNode }> = []
  let next = index
  while (isWord(tokens[next], 'when')) {
    const when = readOr(tokens, next + 1)
    if (!when || !isWord(tokens[when.next], 'then')) return null
    const then = readOr(tokens, when.next + 1)
    if (!then) return null
    whens.push({ when: when.node, then: then.node })
    next = then.next
  }
  if (whens.length === 0) return null

  let otherwise: ExpressionNode | null = null
  if (isWord(tokens[next], 'else')) {
    const read = readOr(tokens, next + 1)
    if (!read) return null
    otherwise = read.node
    next = read.next
  }
  return isWord(tokens[next], 'end') ? { node: { kind: 'case', whens, otherwise }, next: next + 1 } : null
}

/** The fewest and most arguments a label function takes, or null for a function Groundwork does not read. */
function argumentRangeOf(name: string): [min: number, max: number] | null {
  if (name === 'concat') return [1, Infinity]
  if (Object.hasOwn(ONE_ARGUMENT_FUNCTIONS, name)) return [1, 1]
  return Object.hasOwn(QGIS_ONLY_FUNCTIONS, name) ? QGIS_ONLY_FUNCTIONS[name]! : null
}

/** The nodes directly under a node. */
function childNodes(node: ExpressionNode): ExpressionNode[] {
  switch (node.kind) {
    case 'call':
    case 'predicate':
    case 'logic':
      return node.args
    case 'arithmetic':
    case 'compare':
      return [node.left, node.right]
    case 'negate':
    case 'not':
      return [node.arg]
    case 'case':
      return [...node.whens.flatMap(({ when, then }) => [when, then]), ...(node.otherwise ? [node.otherwise] : [])]
    default:
      return []
  }
}

/** The `make_interval` calls that are the right side of a `+` or `-` at or under a node. */
function findAddedIntervals(node: ExpressionNode): ExpressionNode[] {
  const own = node.kind === 'arithmetic' && (node.op === '+' || node.op === '-') && node.right.kind === 'call' && node.right.name === 'make_interval'
    ? [node.right]
    : []
  return [...own, ...childNodes(node).flatMap(findAddedIntervals)]
}

/**
 * Whether an expression's reads of other layers are ones Groundwork answers.
 * With `allowed` false, it holds none. Otherwise each `overlay_within` or
 * `overlay_intersects` gives an expression and is the array that
 * `array_first` or a whole-number `[index]` reads; each `aggregate` is a
 * `count`, `min`, `max` or `concatenate` of the features its filter
 * `intersects($geometry, geometry(@parent))` keeps, with no `order_by`; the
 * layer is named in text; the target's expression and filter read only the
 * target's fields; and `array_first`, `array_get` and the calls of that filter
 * stand nowhere else.
 */
function areLookupsReadable(root: ExpressionNode, allowed: boolean): boolean {
  const lookups = findCalls(root, ...LOOKUPS)
  if (lookups.length === 0) {
    return findCalls(root, 'array_first', 'array_get', ...PARENT_GEOMETRY_CALLS).length === 0
  }
  if (!allowed || !lookups.every(isReadableLookup)) return false
  const overlays: ExpressionNode[] = lookups.filter((call) => call.name !== 'aggregate')
  const readers = findCalls(root, 'array_first', 'array_get')
  if (readers.length !== overlays.length) return false
  if (!readers.every((reader) => overlays.includes(reader.args[0]!))) return false
  if (readers.some((reader) => reader.name === 'array_get' && !isWholeNumber(reader.args[1]))) return false
  const filterCalls = lookups.filter((call) => call.name === 'aggregate').length * PARENT_GEOMETRY_CALLS.length
  return findCalls(root, ...PARENT_GEOMETRY_CALLS).length === filterCalls
}

function isWholeNumber(node: ExpressionNode | undefined): boolean {
  return node?.kind === 'number' && Number.isInteger(node.value)
}

/** The arguments a lookup was given, by name, a left-out one read as NULL. */
function lookupArguments(call: ExpressionNode & { kind: 'call' }): Record<string, ExpressionNode> {
  const names = NAMED_PARAMETERS[call.name]!.names
  return Object.fromEntries(names.map((name, position) => [name, call.args[position] ?? { kind: 'null' }]))
}

/** An expression over the target's own fields: no read of another layer, form or shape. */
function readsTargetFieldsOnly(node: ExpressionNode): boolean {
  return findCalls(node, ...LOOKUPS, ...PARENT_GEOMETRY_CALLS, 'array_first', 'array_get', 'current_value', ...AGGREGATES, ...Object.keys(GEOMETRY_VALUES)).length === 0
}

function isParentIntersectsFilter(node: ExpressionNode): boolean {
  if (node.kind !== 'call' || node.name !== 'intersects') return false
  const isRecordShape = (arg: ExpressionNode | undefined) => arg?.kind === 'call' && arg.name === '$geometry'
  const isParentShape = (arg: ExpressionNode | undefined) => arg?.kind === 'call' && arg.name === 'geometry'
    && arg.args[0]?.kind === 'call' && arg.args[0].name === '@parent'
  const [first, second] = node.args
  return (isRecordShape(first) && isParentShape(second)) || (isParentShape(first) && isRecordShape(second))
}

function isReadableLookup(call: ExpressionNode & { kind: 'call' }): boolean {
  const args = lookupArguments(call)
  const layer = args.layer!
  const expression = args.expression!
  if (layer.kind !== 'text' || !layer.value.trim()) return false
  if (expression.kind === 'null' || !readsTargetFieldsOnly(expression)) return false
  if (call.name === 'aggregate') {
    const aggregate = args.aggregate!
    return aggregate.kind === 'text'
      && (LOOKUP_AGGREGATES as readonly string[]).includes(aggregate.value.toLowerCase())
      && isParentIntersectsFilter(args.filter!)
      && (args.concatenator!.kind === 'null' || args.concatenator!.kind === 'text')
      && args.order_by!.kind === 'null'
  }
  return (args.filter!.kind === 'null' || readsTargetFieldsOnly(args.filter!))
    && (args.limit!.kind === 'null' || isWholeNumber(args.limit))
    && (args.cache!.kind === 'null' || args.cache!.kind === 'boolean')
}

/** The `LayerLookup` a readable lookup call makes. */
function toLayerLookup(call: ExpressionNode & { kind: 'call' }): LayerLookup {
  const args = lookupArguments(call)
  const isAggregate = call.name === 'aggregate'
  const layer = args.layer!
  const limit = args.limit
  const lookup = {
    layer: layer.kind === 'text' ? layer.value.trim() : '',
    predicate: call.name === 'overlay_within' ? 'within' as const : 'intersects' as const,
    expression: args.expression!,
    filter: isAggregate || args.filter!.kind === 'null' ? null : args.filter!,
    limit: !isAggregate && limit?.kind === 'number' && limit.value >= 0 ? limit.value : null
  }
  return { key: JSON.stringify(lookup), ...lookup }
}

/**
 * The reads of other layers in an expression `readQgisExpression` read with
 * `lookups`, one per distinct read.
 */
export function readLayerLookups(node: ExpressionNode): LayerLookup[] {
  const lookups = new Map<string, LayerLookup>()
  for (const call of findCalls(node, ...LOOKUPS)) {
    const lookup = toLayerLookup(call)
    lookups.set(lookup.key, lookup)
  }
  return [...lookups.values()]
}

/** The calls to any of the named functions at or under a node. */
function findCalls(node: ExpressionNode, ...names: string[]): Array<ExpressionNode & { kind: 'call' }> {
  const own = node.kind === 'call' && names.includes(node.name) ? [node] : []
  return [...own, ...childNodes(node).flatMap((child) => findCalls(child, ...names))]
}

/**
 * The form fields an expression reads through `current_value`, or null where
 * QGIS could not tell. QGIS names them by evaluating each call's argument with
 * no feature (`expressionFormAttributes`,
 * `src/core/fieldformatter/qgsvaluerelationfieldformatter.cpp`,
 * `qgis/QGIS@master`, read 2026-10-24), so an argument that reads a field
 * gives a blank name and the filter is not used. Groundwork takes a text
 * literal as the one constant argument. An empty list is an expression that
 * reads no form value.
 */
export function readCurrentValueFields(node: ExpressionNode): string[] | null {
  const fields: string[] = []
  for (const call of findCalls(node, 'current_value')) {
    const arg = call.args[0]
    if (arg?.kind !== 'text' || !arg.value) return null
    fields.push(arg.value)
  }
  return fields
}

/**
 * The `{{field}}` template of a label made only of fields, text and joins, or
 * null where it holds anything else. A template draws a field with no value as
 * blank, which is what `concat` does, so a `||` join is a template only when
 * none of its parts can be NULL.
 */
export function expressionToTemplate(node: ExpressionNode): string | null {
  switch (node.kind) {
    case 'field':
      return `{{${node.name}}}`
    case 'text':
      return node.value
    case 'number':
    case 'boolean':
      return String(node.value)
    case 'null':
      return ''
    case 'call': {
      if (node.name === '||' && !node.args.every((arg) => arg.kind === 'text' || arg.kind === 'number' || arg.kind === 'boolean')) return null
      if (node.name !== 'concat' && node.name !== '||') return null
      const parts = node.args.map(expressionToTemplate)
      return parts.every((part) => part !== null) ? parts.join('') : null
    }
    default:
      return null
  }
}

/**
 * The GeoStyler function for a label. A comparison, `AND`, `OR`, `NOT`, `IN`,
 * `BETWEEN`, `CASE` and the four arithmetic operators take GeoStyler's own
 * names (`add`, `sub`, `mul`, `div`); `IS`, `LIKE`, `ILIKE` and
 * `QGIS_ONLY_FUNCTIONS` are `custom` functions with the QGIS name.
 */
export function expressionToGeoStylerFunction(node: ExpressionNode): unknown {
  const negated = (fn: unknown, negate: boolean) => (negate ? { name: 'not', args: [fn] } : fn)
  switch (node.kind) {
    case 'field':
      return { name: 'property', args: [node.name] }
    case 'null':
      return null
    case 'text':
    case 'number':
    case 'boolean':
      return node.value
    case 'compare':
      return { name: COMPARISON_FUNCTIONS[node.op], args: [expressionToGeoStylerFunction(node.left), expressionToGeoStylerFunction(node.right)] }
    case 'logic':
      return { name: node.op === 'and' ? 'all' : 'any', args: node.args.map(expressionToGeoStylerFunction) }
    case 'not':
      return { name: 'not', args: [expressionToGeoStylerFunction(node.arg)] }
    case 'arithmetic':
      return { name: ARITHMETIC_FUNCTIONS[node.op], args: [expressionToGeoStylerFunction(node.left), expressionToGeoStylerFunction(node.right)] }
    case 'negate':
      return { name: 'custom', fnName: 'negate', args: [expressionToGeoStylerFunction(node.arg)] }
    case 'predicate': {
      const args = node.args.map(expressionToGeoStylerFunction)
      const fn = node.op === 'in' || node.op === 'between' ? { name: node.op, args } : { name: 'custom', fnName: node.op, args }
      return negated(fn, node.negate)
    }
    case 'case':
      return {
        name: 'case',
        args: [
          node.otherwise ? expressionToGeoStylerFunction(node.otherwise) : null,
          ...node.whens.map(({ when, then }) => ({ case: expressionToGeoStylerFunction(when), value: expressionToGeoStylerFunction(then) }))
        ]
      }
    case 'call': {
      const args = node.args.map(expressionToGeoStylerFunction)
      if (node.name === 'concat') return { name: 'strConcat', args }
      if (node.name === '||') return { name: 'custom', fnName: '||', args }
      if (Object.hasOwn(GEOMETRY_VALUES, node.name)) return { name: 'custom', fnName: node.name, args: [node.factor ?? null] }
      if (node.name === 'overlay_within' || node.name === 'overlay_intersects') return { name: 'custom', fnName: LAYER_LOOKUP, args: [toLayerLookup(node).key] }
      if (node.name === 'aggregate') {
        const { aggregate, concatenator } = lookupArguments(node)
        return {
          name: 'custom',
          fnName: 'aggregate',
          args: [
            aggregate!.kind === 'text' ? aggregate!.value.toLowerCase() : null,
            concatenator!.kind === 'text' ? concatenator!.value : '',
            { name: 'custom', fnName: LAYER_LOOKUP, args: [toLayerLookup(node).key] }
          ]
        }
      }
      if (Object.hasOwn(QGIS_ONLY_FUNCTIONS, node.name)) return { name: 'custom', fnName: node.name, args }
      return { name: ONE_ARGUMENT_FUNCTIONS[node.name]!, args }
    }
  }
}
