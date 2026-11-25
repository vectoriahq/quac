import { afterAll, describe, expect, it, vi } from 'vitest'

import './xmlParser.ts'
import { measureFactorsOf, parseProjectMeasurement } from '../parse/parseMeasurement.ts'
import {
  expressionToGeoStylerFunction,
  expressionToTemplate,
  isQgisConditionFilter,
  qgisConditionToFilter,
  readCurrentValueFields,
  readExpressionFields,
  readLayerLookups,
  readQgisExpression,
  unescapeStringLiteral
} from '../parse/qgisExpression.ts'
import { formatQtDateTime, isFormattableQtDatePattern, qtDatePart, readQtDateTime, splitQtDatePattern } from '../parse/qtDateFormat.ts'
import { compileQtRegex, replaceQtRegex } from '../parse/qtRegex.ts'
import { readSqlFeatureTest } from '../parse/sqlFeatureFilter.ts'

import type { FeatureFilterDialect } from '../model/featureFilter.ts'
import type { MeasureFactors } from '../parse/parseMeasurement.ts'

/**
 * The answers the expression modules give for a list of inputs, saved as
 * `answers/<module>.json`: the inputs and the JavaScript's outputs, which the
 * Python port's tests in `packages/quac-qgis-server/tests/` read and match.
 * The inputs hold every case of the modules' own tests (`qgisExpression.test.ts`,
 * `layerLookups.test.ts`, `sqlFeatureFilter.test.ts` and the expression in
 * `formLayout.test.ts`), and further ones for each form the modules' comments
 * name. A change that moves an answer shows as a diff of the file; the
 * Python's tests then fail until the Python gives the same answer.
 *
 * The dates are worked out in `Australia/Sydney`, which has a change of clock,
 * and the Python's test reads them in the same zone.
 */

const TIME_ZONE = 'Australia/Sydney'
vi.stubEnv('TZ', TIME_ZONE)
afterAll(() => {
  vi.unstubAllEnvs()
})

function saved(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** A match as the Python's compares it: the index in code points, the text matched and each group, null for one that took no part. */
function matchOf(text: string, regex: RegExp): unknown {
  const match = regex.exec(text)
  return match && { index: [...text.slice(0, match.index)].length, groups: [...match].map((group) => group ?? null) }
}

describe('parseMeasurement', () => {
  const projects = [
    '<qgis/>',
    '<qgis><properties/></qgis>',
    '<qgis><properties><Measurement/></properties></qgis>',
    '<qgis><properties><Measurement><AreaUnits type="QString">ha</AreaUnits><DistanceUnits type="QString">km</DistanceUnits></Measurement></properties></qgis>',
    '<qgis><properties><Measurement><AreaUnits type="QString">ac</AreaUnits></Measurement></properties></qgis>',
    '<qgis><properties><Measurement><DistanceUnits type="QString">feet</DistanceUnits></Measurement></properties></qgis>',
    '<qgis><properties><Measurement><AreaUnits type="QString">  </AreaUnits><DistanceUnits type="QString"> mi </DistanceUnits></Measurement></properties></qgis>',
    '<qgis><properties><Measurement><AreaUnits type="QString"></AreaUnits><DistanceUnits type="QString"></DistanceUnits></Measurement></properties></qgis>',
    '<qgis><properties><Measurement><AreaUnits type="QString">deg2</AreaUnits><DistanceUnits type="QString">degrees</DistanceUnits></Measurement></properties></qgis>',
    '<qgis><properties><properties name="Measurement"><properties name="AreaUnits" type="QString">km2</properties><properties name="DistanceUnits" type="QString">nautical miles</properties></properties></properties></qgis>',
    '<qgis><properties><properties name="Measurement"><properties name="DistanceUnits" type="QString">yd</properties></properties></properties></qgis>',
    '<qgis><properties><properties name="Measure"><properties name="Ellipsoid" type="QString">EPSG:7019</properties></properties></properties></qgis>',
    '<qgis><Measurement><AreaUnits>ha</AreaUnits></Measurement></qgis>'
  ]
  const units: Array<[string, string]> = [
    ['m2', 'meters'], ['km2', 'km'], ['ft2', 'feet'], ['y2', 'yd'], ['mi2', 'mi'], ['ha', 'nautical miles'], ['ac', 'cm'],
    ['nm2', 'mm'], ['cm2', 'in'], ['mm2', 'meters'], ['in2', 'meters'], ['deg2', 'degrees'], ['HA', 'Meters'], ['constructor', 'toString']
  ]

  it('saves its answers', async () => {
    const parsed = projects.map((project) => {
      const root = new DOMParser().parseFromString(project, 'application/xml').documentElement
      const measurement = parseProjectMeasurement(root)
      return { project, measurement, factors: measureFactorsOf(measurement) }
    })
    const factors = units.map(([areaUnit, distanceUnit]) => ({ measurement: { areaUnit, distanceUnit }, factors: measureFactorsOf({ areaUnit, distanceUnit }) }))
    await expect(saved({ parsed, factors, defaults: [measureFactorsOf(null), measureFactorsOf(undefined)] })).toMatchFileSnapshot('./answers/parseMeasurement.json')
  })
})

describe('qtDateFormat', () => {
  const patterns = [
    'yyyy-MM-dd', 'd/M/yy', 'dd/MM/yyyy', 'ddd d MMM yyyy', 'dddd d MMMM', 'HH:mm:ss', 'H:m:s', 'hh:mm', 'h:mm AP', 'h:mm ap',
    'h:mm A', 'h:mm a', 'h:mm Ap', 'h:mm aP', 'zzz', 'z', 'zz', 'zzzz', 'yyyyMMddhhmmsszzz', "'Surveyed' d MMMM", "h 'o''clock'",
    'yyyy-MM-ddTHH:mm', 'y', 'yyy', 'yyyyy', 'MMMMM', 'ddddd', 'HHH', 'hhh AP', 'hAPP', 'AAp', 'APp', 'aaP', 'AP', 'ap', 'h AP',
    "'quoted'yyyy''", "yyyy'unclosed", "''", "''''", "'it''s' yyyy", 'yyyy-MM-ddTHH:mm:ssZ', 'Zyyyy', 'yyyyZ HH', 't', 'yyyy t',
    "'t'yyyy", "HH:mm 't'",'Q W x', 'é yyyy', '', 'dd.MM.yyyy HH:mm', 'MMM', 'MMMM', 'ddd', 'dddd'
  ]
  const values: unknown[] = [
    '2026-10-26', '2026-10-26T04:30:00Z', '2026-10-26T04:30:00', '2026-10-26 04:30', '2026-10-26t04:30:00.5+10:00',
    '2026-10-26T04:30:00,123456-05:30', '2026-10-26T04:30+1030', '2026-10-26T04:30:00+10', '2026-10-26T04:30:00z',
    '2026-10-26T24:00:00', '2026-10-26T24:00:01', '2026-10-26T23:59:59.9999', '2026-10-26T23:59:59.0005', '2026-10-26T10:00:00.0015',
    '2026-02-29', '2024-02-29', '1900-02-29', '2000-02-29', '2026-13-01', '2026-04-31', '2026-00-10', '2026-10-00',
    '2026-10-26X04:30', '2026-10-26T4:30', '2026-10-26T04:30:00+1', '2026-10-26T04:30:00+10:00Z', '2026-10-26T04:30:00 ',
    '2026-10-26T04:30:00-00:00', '2026-10-26T04:30:61', '2026-10-26T04:60', '2026-10-26T', '2026-10-26T04', '2026-10-2',
    '14:05', '14:05:30.25', '14', '24:00', '25:00', '1405', '14:5', 'abc', '', '2026', '06/10/2026', '2026-10-06T14:05:09.042',
    '2026-10-04T02:30:00', '2026-10-04T01:59:59', '2026-10-04T03:00:00', '2026-04-05T02:30:00', '2026-04-05T03:30:00', '2026-10-04', '2026-04-05',
    '0001-01-01', '0001-01-01T00:00:00+14:00', '0099-06-15T12:00:00', '1969-12-31T23:59:59.999', '9999-12-31T23:59:59.999Z',
    '2026-01-01', '2027-01-01', '2024-12-30', '2021-01-03', '2020-12-31', '2026-12-28',
    5, null, true, { date: Date.UTC(2026, 9, 26, 4, 30, 0, 42) }, { date: Date.UTC(1950, 0, 1) }
  ]
  const parts = ['year', 'month', 'day', 'week', 'day_of_week', 'hour', 'minute', 'second', 'quarter']
  const moments = [
    '2026-10-06T14:05:09.042', '2026-10-06T14:05:09.200', '2026-10-06T00:30:00', '2026-10-06T12:30:00', '2026-10-06T00:05:07.040',
    '2026-10-06', '2026-10-06T04:30:00Z', '2026-10-06T14:30:00+10:00', '2026-10-06T23:59:59.999-03:00', '0001-01-01T00:00:00+14:00',
    '14:05', '2026-04-05T02:30:00', '2026-10-04T02:30:00', { date: Date.UTC(2026, 9, 26, 4, 30, 0, 42) }
  ]
  const languages = [null, 'en_AU', 'en-AU', 'EN-au', '', 'fr', 'de_DE', 'not a language']
  const readValue = (value: unknown) => (value !== null && typeof value === 'object' ? new Date((value as { date: number }).date) : value)

  it('saves its answers', async () => {
    const split = patterns.map((pattern) => ({ pattern, pieces: splitQtDatePattern(pattern), formattable: isFormattableQtDatePattern(pattern) }))
    const read = values.map((value) => ({ value, moment: readQtDateTime(readValue(value)) }))
    const datePart = values.map((value) => ({ value, parts: Object.fromEntries(parts.map((part) => [part, qtDatePart(part, readValue(value))])) }))
    const formatted = moments.flatMap((value) => {
      const moment = readQtDateTime(readValue(value))!
      expect(moment).not.toBeNull()
      return languages.map((language) => ({ value, language, texts: patterns.map((pattern) => formatQtDateTime(moment, pattern, language)) }))
    })
    await expect(saved({ timeZone: TIME_ZONE, patterns, parts, split, read, datePart, formatted })).toMatchFileSnapshot('./answers/qtDateFormat.json')
  })
})

describe('qtRegex', () => {
  /** A pattern, the texts each translation of it is run on, and the replacements made with it as `[text, replacement]`. */
  const cases: Array<{ pattern: string, texts?: string[], replacements?: Array<[string, string]> }> = [
    { pattern: 'll', texts: ['hello', 'HELLO'] },
    { pattern: '^ll', texts: ['hello', 'llama'] },
    { pattern: 'llo$', texts: ['hello', 'hello\n', 'hello\n\n', 'hellos'] },
    { pattern: '[eL]+', replacements: [['HeLLo', '-']] },
    { pattern: '(?<=H).*L', replacements: [['HeLLo', '-']] },
    { pattern: '(?<=H).*?L', replacements: [['HeLLo', '-']] },
    { pattern: '(eL)', replacements: [['HeLLo', 'x\\1x'], ['HeLLo', '\\0\\2\\11'], ['HeLLo', '\\']] },
    { pattern: '(\\d+)', texts: ['abc123', 'abcdef', 'abc١٢٣'] },
    { pattern: '(\\d+?)', texts: ['abc123'] },
    { pattern: 'c(.)', texts: ['abc123', 'abc\n1'] },
    { pattern: 'c\\d', texts: ['abc123'] },
    { pattern: '.b.', texts: ['abc', 'b', '\nb\n'] },
    { pattern: 'Buda\\b', texts: ['Budač', 'Buda', 'Buda '] },
    { pattern: 'Budač\\b', texts: ['Budač', 'Budačx'] },
    { pattern: '\\s[A-Z]+', texts: ['abc DEF', 'abc DEF', 'abc DEF', 'abc\u0085DEF'] },
    { pattern: '\\s[a-z]+', texts: ['abc DEF'] },
    { pattern: '({[a-zA-Z\\d]{8}\\-[a-zA-Z\\d]{4}\\-[a-zA-Z\\d]{4}\\-[a-zA-Z\\d]{4}\\-[a-zA-Z\\d]{12}})', texts: ['{6f1e2a9c-8b4d-4c3e-9a17-5d2f0b7e4c61}', '6f1e2a9c'] },
    { pattern: '[[[' },
    { pattern: 'a.b', texts: ['a\rb', 'a\nb', 'a b', 'a😀b'] },
    { pattern: 'end$', texts: ['end\n', 'end', 'end\n\n', 'end\r\n'] },
    { pattern: '^\\w$', texts: ['é', 'e', '_', '٣', '-', 'ǅ'] },
    { pattern: '^\\d$', texts: ['٣', '3', '²', 'Ⅳ'] },
    { pattern: '(?i)hello', texts: ['HELLO', 'HeLLo', 'help'] },
    { pattern: 'a\\-b', texts: ['a-b'] },
    { pattern: '^{x}$', texts: ['{x}'] },
    { pattern: 'a]', texts: ['a]'] },
    { pattern: '[]a]', texts: [']', 'a', 'b'] },
    { pattern: '[^]a]', texts: [']', 'a', 'b'] },
    { pattern: '\\x{e9}', texts: ['é', 'e'] },
    { pattern: '\\x{1F600}', texts: ['a😀'] },
    { pattern: '\\x{110000}' },
    { pattern: '\\x41\\x{42}', texts: ['AB'] },
    { pattern: '(\\d+)-(\\d+)-(\\d+)', replacements: [['2026-10-26', '\\3/\\2/\\1'], ['2026-10-26 and 2027-01-02', '\\3/\\2/\\1']] },
    { pattern: 'a', replacements: [['ab', '\\1$1'], ['aaa', '$&'], ['', 'x']] },
    { pattern: '\\D', replacements: [['0412 345 678', '']] },
    { pattern: '(x)?b', texts: ['ab'] },
    { pattern: '(x)?(b)', texts: ['ab'] },
    { pattern: '(a*)?b', texts: ['b', 'aab'] },
    { pattern: '(?:(a*))?b', texts: ['b'] },
    { pattern: '(x|){0,1}b', texts: ['b'] },
    { pattern: '(a)??b', texts: ['ab'] },
    { pattern: '(a)??ab', texts: ['ab'] },
    { pattern: '(?:|a)?', texts: ['a'] },
    { pattern: '(?:\\d*|N/A)?', texts: ['N/A'] },
    { pattern: '(?:|a)??a', texts: ['a'] },
    { pattern: '^A\\d{3}$', texts: ['A102', 'A1023', 'a102'] },
    { pattern: '.*?', replacements: [['ab', '-'], ['', '-'], ['😀a', '-']] },
    { pattern: 'a??', replacements: [['ab', '-'], ['😀a', '-']] },
    { pattern: 'x*', replacements: [['ab', '-']] },
    { pattern: 'a*', replacements: [['baac', '-']] },
    { pattern: '\\b', replacements: [['ab cd', '|'], ['é a', '|']] },
    { pattern: '(?:ab)+', texts: ['abab', 'aba'] },
    { pattern: '(?:(a)|b)?', texts: ['a', 'b', ''] },
    { pattern: '(?<=a{2}|bcd)e', texts: ['aae', 'bcde', 'abe', 'cde'] },
    { pattern: '(?<!a|bc)d', texts: ['ad', 'bcd', 'xd', 'd'] },
    { pattern: '(?<=|a)b', texts: ['b', 'ab'] },
    { pattern: '(?<=a$)', texts: ['a', 'ba\n', 'b'] },
    { pattern: '(?<=\\bfo)o', texts: ['foo', 'xfoo'] },
    { pattern: '(?i)^\\w$', texts: ['A', 'ſ'] },
    { pattern: '[\\w-]', texts: ['-', 'é', '!'] },
    { pattern: '[-\\d]', texts: ['-', '5', 'x'] },
    { pattern: '[\\s-z]' },
    { pattern: '^\\d+(?=m$)', texts: ['12m', '12mm'] },
    { pattern: '^a(?!b)', texts: ['ab', 'ac'] },
    { pattern: '^a{2,}$', texts: ['aaa', 'a'] },
    { pattern: 'a{1,3}?', texts: ['aaa'] },
    { pattern: '\\x41', texts: ['A'] },
    { pattern: '(?:-\\d{2})+', texts: ['-12-34', '-1'] },
    { pattern: '(?s).' },
    { pattern: '[\\D]', texts: ['٣', '5', 'a'] },
    { pattern: '[^\\D]', texts: ['٣', '5', 'a'] },
    { pattern: '[a\\W]', texts: ['a', '-', 'b', 'é'] },
    { pattern: '[^a\\W]', texts: ['a', '-', 'b', 'é'] },
    { pattern: '[\\D\\W]', texts: ['5', 'a', '-'] },
    { pattern: '[^\\D\\W]', texts: ['5', 'a', '-', '٣'] },
    { pattern: '[^\\d]', texts: ['5', '٣', 'a'] },
    { pattern: '\\w+', texts: ['naïve café 東京', '___', 'ǅx'] },
    { pattern: '\\W+', texts: ['naïve café', 'a-b'] },
    { pattern: '\\S+', texts: ['  x᠎y', '　z'] },
    { pattern: '\\s+', texts: ['a᠎\u0085b', 'a　 b', 'a​b'] },
    { pattern: '\\B', replacements: [['ab cd', '|']] },
    { pattern: '\\Bé', texts: ['aé', 'é'] },
    { pattern: '\\d+', texts: ['١٢٣4', '٣'] },
    { pattern: '(?i)s', texts: ['S', 'ß'] },
    { pattern: '(?i)[a-z]+', texts: ['ABC'] },
    { pattern: '(?i)[^s]', texts: ['S', 's', 't'] },
    { pattern: '(?i)\\d', texts: ['5'] },
    { pattern: '[\\x{10000}-\\x{10FFFF}]', texts: ['a😀'] },
    { pattern: '[z-a]' },
    { pattern: 'a{3,2}' },
    { pattern: 'a{2}', texts: ['aaa'] },
    { pattern: 'a{65535}' },
    { pattern: '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', replacements: [['abcdefghijk', '\\11|\\10|\\1|\\12|\\111']] },
    { pattern: '\\\\', texts: ['a\\b'] },
    { pattern: '\\/', texts: ['a/b'] },
    { pattern: '/', texts: ['a/b'] },
    { pattern: '\\.\\$\\^\\(\\)\\[\\]\\{\\}\\|\\*\\+\\?', texts: ['.$^()[]{}|*+?'] },
    { pattern: '[.$^()[{}|*+?/]+', texts: ['x.$^()[{}|*+?/y'] },
    { pattern: '[a-]', texts: ['-'] },
    { pattern: '[\\-a]', texts: ['-'] },
    { pattern: '[\\]]', texts: [']'] },
    { pattern: '[\\n\\t]', texts: ['\t'] },
    { pattern: '\\n\\r\\t\\f', texts: ['\n\r\t\f'] },
    { pattern: '\\#\\ \\&', texts: ['# &'] },
    { pattern: '()', texts: ['x'] },
    { pattern: '(|a)', texts: ['a'] },
    { pattern: 'a|', texts: ['b'] },
    { pattern: '', texts: ['abc'], replacements: [['ab', '-']] },
    { pattern: '[&&]+', texts: ['a&&b'] },
    { pattern: '[--]', texts: ['-'] },
    { pattern: '[~~]', texts: ['~'] },
    { pattern: 'a{', texts: ['a{'] },
    { pattern: 'a{x}', texts: ['a{x}'] },
    { pattern: 'a{2,x}', texts: ['a{2,x}'] },
    { pattern: '}', texts: ['}'] },
    { pattern: '(?:a|bc)d', texts: ['bcd'] },
    { pattern: '(?:a?)?', texts: ['a'] },
    { pattern: '(?=a)?' },
    { pattern: '(?<=a)*b' },
    { pattern: '(?<=a{1})b', texts: ['ab'] },
    { pattern: '(?<=[ab]{2})c', texts: ['abc', 'ac'] },
    { pattern: '(?<=\\x{1F600})a', texts: ['😀a'] },
    { pattern: '(?<=\\s)\\S', texts: ['a b'] },
    { pattern: '(?!$)', replacements: [['ab', '-']] },
    { pattern: '$', replacements: [['ab\n', '-'], ['ab', '-']] },
    { pattern: '^', replacements: [['ab\nc', '-']] },
    { pattern: '\\xZZ' },
    { pattern: '\\x4' },
    { pattern: '\\' },
    { pattern: '\\v' },
    // The patterns the reader refuses, as its comment lists them.
    ...[
      '\\Qa.b\\E', '\\A', '\\z', '\\e', '\\cA', '\\p{L}', '[\\b]', '(?<x>a)', "(?'x'a)", '(?P<x>a)', '(?=(a))', '(?<=(?:a))b', 'a)', '(a', '[a',
      'a{70000}', '\\x{d800}', '(?s)a.b', 'a(?i)b', 'a++', 'a?+', 'a{2}+', '(?>a)', '[[:alpha:]]', '\\h', '\\R', '\\g1', '\\10', '[\\W]',
      'a{,3}', '(?(1)a|b)', '(?R)', '(a)?\\1b', '(?<x>a)\\k<x>', '[\\w-z]', '[a-\\d]', '(?:(a)|b)+', '((a)|b){2}', '(a?)+', '(a|b)+',
      '(?<=a+)b', '(?<!a{1,2})b', '(?<=(a|bc))d', '(?<n>x)|(?<n>y)', '(?:(a)|b)\\E+', '(?:(a)|b)\\Q\\E+', '[\\s\\E-z]', '(?:(a)|b)(?#x)+',
      '(?:(a)|b){2,3}', '(a)?*', '(a)?{2}', '(a)??*', 'x(?:|a)*', 'x(?:|a)+', 'x(?:(?=a)|a)*', 'x(?:(?<!b)|a)+', '(?:a?)*', '(?:a*|b){2}',
      'a{ 2}', 'a{2 }', 'a{1 , 3}', 'a{ ,3}', '^(?:a+)+$', '^(?:[A-Za-z]+ ?)*$', '(?:a|b)+', '(?:a?a)+', '(?:(?:a|b)c)+',
      '^[A-Za-z]+(?: [A-Za-z]+)*$', '^*', '$?', '(a)?+', '(a){0,1}+', '\\b?a', '\\b*a', '\\B{2}a', '(?i)\\bx', '(?i)\\W', '(?i)\\B',
      '[\\S]', '[\\D-z]', '[a-\\s]', '[\\d-]', '[\\s]', '[a\\-\\d]', '[\\w\\-z]', '[=x]', '[.x]', '[[=x=]]', '[[.x.]]', '[x[:y]'
    ].map((pattern) => ({ pattern }))
  ]

  it('saves its answers', async () => {
    const answers = cases.map(({ pattern, texts = [], replacements = [] }) => ({
      pattern,
      ...Object.fromEntries([true, false].map((unicode) => {
        const regex = compileQtRegex(pattern, unicode)
        return [unicode ? 'unicode' : 'ascii', regex && {
          matches: texts.map((text) => ({ text, match: matchOf(text, regex) })),
          replaced: replacements.map(([text, after]) => ({ text, after, result: replaceQtRegex(text, regex, after) }))
        }]
      }))
    }))
    await expect(saved(answers)).toMatchFileSnapshot('./answers/qtRegex.json')
  })
})

describe('qgisExpression', () => {
  const ha: MeasureFactors = measureFactorsOf({ areaUnit: 'ha', distanceUnit: 'km' })
  const noArea: MeasureFactors = measureFactorsOf({ areaUnit: 'deg2', distanceUnit: 'feet' })
  /** The options each expression is read with: none, what each caller in the package passes, and every option. */
  const OPTIONS: Record<string, Parameters<typeof readQgisExpression>[1]> = {
    none: {},
    currentValue: { currentValue: true },
    geometry: { geometry: true },
    hectares: { geometry: ha },
    noAreaUnit: { geometry: noArea, aggregates: true },
    lookups: { lookups: true },
    defaults: { geometry: true, aggregates: true, lookups: true, variables: true, coordinates: true },
    noVariables: { geometry: true, aggregates: true, lookups: true },
    all: { currentValue: true, geometry: true, aggregates: true, lookups: true, variables: true, coordinates: true }
  }

  const expressions = [
    // qgisExpression.test.ts
    '@cloud_useremail', "'x' || @mm_user_email", '@mm_user_email', '@Cloud_UserEmail', "coalesce(@cloud_useremail, 'unknown')",
    "array_first(overlay_within('zones', \"name\", filter:=\"owner\" = @cloud_useremail))", "array_first(overlay_within('zones', @cloud_useremail))",
    '@parent', 'x(@position_coordinate)', 'round(y(@position_coordinate), 6)', 'z(@position_coordinate)', 'x($geometry)', 'x("location")',
    '$x', '$y', 'round($y, 2)', 'z($geometry)', "x(transform($geometry, 'EPSG:28355', 'EPSG:4326'))", "y(transform($geometry, @layer_crs, 'EPSG:4326'))",
    "y(transform($geometry, layer_property(@layer, 'crs'), 'EPSG:7844'))", "x(transform($geometry, @project_crs, 'EPSG:4326'))",
    "x(transform(geometry(@parent), 'EPSG:28355', 'EPSG:4326'))", "x(transform($geometry, '', 'EPSG:4326'))", "transform($geometry, 'EPSG:28355', 'EPSG:4326')",
    "layer_property(@layer, 'crs')", '$geometry', "array_first(overlay_within('zones', \"name\" || $x))",
    '"approved" = 1 AND ("status" IN (\'a\', \'b\') OR "approved" IS NULL)', 'CASE WHEN "a" > 1 THEN upper("b") ELSE -"c" END',
    // layerLookups.test.ts
    "array_first(overlay_nearest('depots', \"name\"))", "array_first(overlay_nearest('depots', \"name\", limit:=3))",
    "array_first(overlay_nearest('depots', \"name\", limit:=-1))", "array_first(overlay_nearest(layer:='depots', expression:=\"name\", max_distance:=250))",
    "array_first(overlay_nearest('depots', \"name\", NULL, 2, 100))", "array_first(overlay_nearest('depots', \"name\", filter:=\"open\" = 'yes'))",
    "array_first(overlay_nearest('depots', \"name\", filter:=\"open\" = @cloud_useremail))", "array_first(overlay_nearest('depots'))",
    'array_first(overlay_nearest("layer", "name"))', "array_first(overlay_nearest('depots', \"name\", max_distance:=-5))",
    "array_first(overlay_nearest('depots', \"name\", limit:=1.5))", "overlay_nearest('depots', \"name\")", "array_get(overlay_nearest('depots', \"name\", limit:=2), 1)",
    "array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:='des'))", "array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:='ASC'))",
    "array_first(overlay_intersects('zones', \"name\", NULL, NULL, NULL, NULL, NULL, NULL, 'des'))", "array_first(overlay_intersects('zones', \"name\"))",
    "array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:='largest'))", "array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:=\"order\"))",
    "array_first(overlay_intersects('zones', \"name\", min_overlap:=10))", "array_first(overlay_intersects('zones', \"name\", min_inscribed_circle_radius:=2))",
    "array_first(overlay_intersects('zones', \"name\", return_details:=true))", "array_first(overlay_within('zones', \"name\", sort_by_intersection_size:='des'))",
    "array_first(overlay_within('a', \"x\")) || array_first(overlay_intersects('b', \"x\")) || array_first(overlay_nearest('c', \"x\"))",
    // formLayout.test.ts
    "geom_to_wkt($geometry) = 'POINT(0 0)'",
    // sqlFeatureFilter.test.ts
    'lower("status") = \'approved\'', '"area" + 1 > 500', '"name" || \'x\' = \'ax\'', '"flag" = TRUE', '"status" IS \'approved\'',
    'SELECT * FROM properties WHERE "status" = \'approved\'', '"status" = \'approved', '$area > 500', '"name" ~ \'^A\'',
    // The lexer: text, escapes, fields, numbers, names, char() and what it refuses.
    "'it''s'", "'a\\'b'", "'a\\nb\\tc\\\\d\\qe'", "'line\nbreak'", "'back\\\nslash'", "'\\😀'", "''", '""', '"a""b"', '"field with space"',
    'name', 'Name_2', 'NULL', 'null', 'True', 'FALSE', '1', '1.5', '.5', '1.', '1e3', '1E-2', '2.5e+1', '007', '12345678901234567890', '1e400', '-0',
    "char(10)", "CHAR ( 65 )", "char(0)", "char(1114111)", "char(1114112)", "concat('a', char(9), 'b')", 'résumé', '東京', '"a" # comment',
    '"a" -- comment', "'unclosed", '"unclosed', '{', '"a" & "b"', '!', '"a" ! "b"', '  "a"  ', '\t"a" = 1', '"a"​', '"a" ;',
    // Precedence and operators.
    '1 + 2 * 3', '(1 + 2) * 3', '1 - 2 - 3', '2 ^ 3 ^ 2', '-2 ^ 2', '- - 2', '+ 2', '-"a"', '- "a" + 1', '1 + 2 || 3', '"a" || "b" || \'c\'',
    '6.1 % 2.5', '"area_m2" // 10000', '7 / 2', 'NOT "a" = 1', 'NOT NOT "a"', '"a" = 1 OR "b" = 2 AND "c" = 3', '"a" AND "b" OR "c"',
    '"a" = 1 = 2', '"a" < 1 < 2', '"a" <> 1', '"a" != 1', '"a" <= 1', '"a" >= 1', '"a" ~ \'^A\' AND "b" ~ \'b$\'', '"a" ~ "b"',
    '"a" ~ \'(?s).\'', '"a" ~ \'\\\\w\'', '"a" ~ \'(?i)\\\\w\'', '"a" IS NULL', '"a" IS NOT NULL', '"a" IS NOT 1', '"a" IS', '"a" LIKE \'A%\'',
    '"a" NOT LIKE \'A%\'', '"a" ILIKE \'a_\'', '"a" NOT ILIKE \'a_\'', '"a" IN (1, 2, 3)', '"a" NOT IN (\'x\')', '"a" IN ()', '"a" IN (1,)',
    '"a" IN 1', '"a" BETWEEN 1 AND 5', '"a" NOT BETWEEN 1 AND 5', '"a" BETWEEN 1', '"a" BETWEEN 1 OR 5', '"a" NOT', '"a" NOT = 1',
    '"a" = 1 AND', 'AND', '()', '(("a"))', '("a"', '"a")', '"a"[0]', '"a"[0][1]', '"a"[', '"a"[0', 'array_get("a", 0)', 'array_first("a")',
    // CASE.
    "CASE WHEN \"height_m\" > 20 THEN 'tall' END", "CASE WHEN \"name\" IS NULL THEN 'none' WHEN \"name\" = '' THEN 'blank' ELSE \"name\" END",
    'CASE END', 'CASE WHEN 1 THEN 2', 'CASE WHEN 1 2 END', 'CASE ELSE 1 END', 'case when "a" then "b" else "c" end', 'CASE WHEN THEN 1 END',
    // Functions, their argument counts and named arguments.
    'upper("name")', 'lower("name")', 'title("name")', 'trim("name")', 'UPPER("name")', 'upper()', 'upper("a", "b")', 'concat()',
    "concat(upper(\"name\"), ' (', \"code\", ')')", "concat('a', 1, TRUE, NULL)", 'coalesce()', "coalesce(\"a\", \"b\", 'c')",
    "if(\"status\" = 'open', 'Open', 'Closed')", 'if("a", "b")', 'length("name") + 1', 'round("value")', 'round("value", 1)', 'round("value", 1, 2)',
    'format_number("area", 2)', "format_number(\"area\", 2, 'de')", "left(\"name\", 3)", "right(\"name\", -1)", 'substr("name", 1, "length")',
    "replace(\"name\", 'a', 'b')", 'to_int("a")', 'to_string(1.23)', 'to_real("a")', "lpad(\"a\", 3, '0')", "rpad(\"a\", 3)", 'abs("a") < 5',
    'floor("a")', 'ceil("a")', "strpos(\"a\", 'b')", "nullif(\"a\", '')", 'wordwrap("a", 10)', 'max("a", "b")', 'min()', 'unknown_function("a")',
    "uuid()", '$uuid', '$id', '$feature', 'geom_to_wkt($geometry)', 'f("a")', '"a"("b")', "replace(\"a\", string:='b')", "upper(string:=\"a\")",
    // current_value.
    "current_value('name')", "coalesce(current_value('name'), 'none')", "current_value('name') = \"name\"", "current_value('name') IS NULL",
    'current_value("name")', "current_value('')", "current_value('a', 'b')", 'current_value()', "current_value('a') || current_value('b')",
    // Aggregates and the shape's measures.
    'maximum("n")', 'minimum("n")', 'minimum(maximum("n"))', 'maximum($area)', 'maximum("n", "group")', 'maximum("n") > 1', '$area', '$Area',
    '$area()', '$length', '$perimeter', '$area / 10', 'round($area, 2)', 'round($length, 1)', '$area > 1 AND $length < 2', '$volume',
    // Dates.
    "format_date(\"when\", 'yyyy-MM-dd')", "format_date(\"when\", 'dddd d MMMM', 'fr')", "format_date('2026-10-06', NULL)",
    "format_date(\"when\", 'HH:mm t')", 'format_date("when", "pattern")', "format_date(\"when\", 'yyyy', \"language\")",
    "format_date(\"when\", 'HH:mm ''t''')", "format_date(now(), 'yyyy')", "format_date($now, 'yyyy')", "format_date(\"when\")",
    'year(now())', 'hour($now)', 'now()', '$now', 'now() - 1', 'year(now()) - 10', '"planted" < year(now()) - 10', 'month("d")', 'day("d")',
    'week("d")', 'day_of_week("d")', 'minute("d")', 'second("d")', 'year(now(), 1)', 'now(1)',
    '"d" + make_interval(days:=14)', '"d" - make_interval(hours:=1)', '"d" + make_interval(days:="days")', '"d" + make_interval(1, 2)',
    '"due" <= "d" + make_interval(days:=14)', 'make_interval(days:=1)', 'make_interval(days:=1) + "d"', '"d" * make_interval(days:=1)',
    '"d" + make_interval(days:=1, days:=2)', '"d" + make_interval(1, days:=2)', '"d" + make_interval(days:=2, 1)', '"d" + make_interval(day:=2)',
    '"d" + make_interval(years:=1, Months:=2, seconds:=3)', '"d" + make_interval()',
    // Regular expressions in functions.
    "regexp_match(\"a\", '^A')", 'regexp_match("a", "pattern")', "regexp_match(\"a\", '(?s).')", "regexp_replace(\"a\", '(\\\\d+)', '<\\\\1>')",
    "regexp_substr(\"a\", '[[[')", "regexp_match(\"a\", '\\\\w', 1)", "regexp_match(\"a\", '(?i)\\\\bx')", "\"a\" ~ '(?i)\\\\bx'",
    // aggregate().
    "aggregate('parcels', 'count', \"id\", intersects($geometry, geometry(@parent)))", "aggregate('parcels', 'concatenate', \"name\", intersects(geometry(@parent), $geometry), ', ')",
    "aggregate(layer:='parcels', aggregate:='MAX', expression:=\"area\", filter:=intersects($geometry, geometry(@parent)))",
    "aggregate('parcels', 'sum', \"area\", intersects($geometry, geometry(@parent)))", "aggregate('parcels', 'count', \"id\")",
    "aggregate('parcels', 'count', \"id\", \"a\" = 1)", "aggregate('parcels', 'count', \"id\", intersects($geometry, geometry(@parent)), order_by:=\"id\")",
    "aggregate('parcels', 'concatenate', \"name\", intersects($geometry, geometry(@parent)), \"sep\")", "aggregate(\"layer\", 'count', \"id\", intersects($geometry, geometry(@parent)))",
    "aggregate(' ', 'count', \"id\", intersects($geometry, geometry(@parent)))", "aggregate('parcels', 'count', $area, intersects($geometry, geometry(@parent)))",
    "aggregate('parcels', 'count', \"id\", intersects($geometry, geometry(@parent))) + aggregate('parcels', 'count', \"id\", intersects($geometry, geometry(@parent)))",
    "intersects($geometry, geometry(@parent))", "geometry(@parent)", "array_first(overlay_within(' zones ', \"name\", cache:=true, limit:=2))",
    "array_first(overlay_within('zones', \"name\", cache:='yes'))", "array_first(overlay_within('zones', \"name\", filter:=current_value('a') = 1))",
    "array_first(overlay_within('zones', \"name\")) || array_first(overlay_within('zones', \"name\"))", "array_get(overlay_within('zones', \"name\"), \"n\")",
    "array_first(overlay_within('zones', NULL))", "array_first(overlay_within('zones', expression:=\"name\", layer:='z'))",
    "array_first(overlay_within('zones', \"name\", nonsense:=1))", "array_first(\"list\")", "array_first(overlay_within('zones', maximum(\"n\")))",
    // Templates.
    '"name"', "'Lot ' || 5", "'a' || TRUE || 1.5", "'a' || \"name\"", "concat('Lot ', \"lot\", ' DP', \"dp\")", "concat('x', upper(\"a\"))",
    "concat('a', 1e21, 1e-7, 0.1)", "concat(-0, 100, 2.50)"
  ]

  const unescaped = ["it''s", "a\\'b", "a\\nb\\tc\\\\d\\qe", 'a\\', '\\\\\\', "''''", 'plain', '\\\n', '\\😀']

  /** The reads of an expression under each set of options, those that read it alike given once with the names of their options. */
  function readsOf(expression: string): Array<{ options: string[], read: unknown }> {
    const reads: Array<{ options: string[], read: unknown, text: string }> = []
    for (const [name, options] of Object.entries(OPTIONS)) {
      const node = readQgisExpression(expression, options)
      const read = node && {
        node,
        geoStyler: expressionToGeoStylerFunction(node),
        template: expressionToTemplate(node),
        fields: readExpressionFields(node),
        currentValueFields: readCurrentValueFields(node),
        lookups: readLayerLookups(node)
      }
      const text = JSON.stringify(read)
      const same = reads.find((entry) => entry.text === text)
      if (same) same.options.push(name)
      else reads.push({ options: [name], read, text })
    }
    return reads.map(({ options, read }) => ({ options, read }))
  }

  it('saves its answers', async () => {
    const answers = expressions.map((expression) => ({
      expression,
      reads: readsOf(expression),
      condition: qgisConditionToFilter(expression),
      conditionInHectares: qgisConditionToFilter(expression, ha)
    }))
    const conditionFilters = [
      qgisConditionToFilter('"a" = 1'), { name: 'custom', fnName: 'qgis_condition', args: 'x' }, { name: 'custom', fnName: 'other', args: [] },
      { name: 'other', fnName: 'qgis_condition', args: [] }, null, 'qgis_condition', [], { name: 'custom', fnName: 'qgis_condition', args: [] }
    ].map((filter) => ({ filter, isCondition: isQgisConditionFilter(filter) }))
    const literals = unescaped.map((text) => ({ text, unescaped: unescapeStringLiteral(text) }))
    await expect(saved({ options: OPTIONS, expressions: answers, conditionFilters, literals })).toMatchFileSnapshot('./answers/qgisExpression.json')
  })
})

describe('sqlFeatureFilter', () => {
  /** A filter and the properties of the features it is tried on. */
  const cases: Array<{ expression: string, dialect?: FeatureFilterDialect, features: Array<Record<string, unknown> | null> }> = [
    // sqlFeatureFilter.test.ts
    { expression: '"status" = \'approved\'', features: [{ status: 'Approved' }, { status: 'APPROVED' }, { status: 'proposed' }, null, { status: null }, {}] },
    { expression: '"status" <> \'approved\'', features: [{ status: 'Approved' }, { status: 'proposed' }] },
    { expression: '"status" != \'approved\'', features: [{ status: 'proposed' }, { status: 'APPROVED' }] },
    { expression: '"status" IN (\'approved\', \'lodged\')', features: [{ status: 'Lodged' }, { status: 'x' }] },
    { expression: '"status" NOT IN (\'approved\', \'lodged\')', features: [{ status: 'Lodged' }, { status: 'x' }, { status: null }] },
    { expression: '"lot" LIKE \'Lot%\'', features: [{ lot: 'Lot 5' }, { lot: 'lot 5' }, { lot: null }] },
    { expression: '"lot" ILIKE \'Lot%\'', features: [{ lot: 'lot 5' }, { lot: 'LOT' }, { lot: 'Lo' }] },
    { expression: '"area" > 500', features: [{ area: 600 }, { area: null }, { area: '600' }, { area: 'big' }, { area: true }, { area: 500 }] },
    { expression: '"area" BETWEEN 100 AND 500', features: [{ area: 600 }, { area: 100 }, { area: 500 }, { area: null }, { area: '300' }] },
    { expression: 'NOT ("status" = \'approved\')', features: [{ status: null }, { status: 'approved' }, { status: 'x' }] },
    { expression: '"status" IS NULL', features: [{ status: null }, {}, { status: 'x' }, { status: 0 }] },
    { expression: '"status" IS NOT NULL', features: [{}, { status: '' }] },
    { expression: '"status" = \'approved\' OR "area" > 500', features: [{ status: 'proposed', area: 600 }, { status: null, area: null }] },
    { expression: '"status" = \'approved\' AND "area" > 500', features: [{ status: 'Approved', area: 100 }, { status: 'Approved', area: 600 }] },
    { expression: '"approved" = 1', features: [{ approved: '1' }, { approved: '1.0' }, { approved: ' 1 ' }, { approved: 1 }, { approved: true }, { comment: 'x' }, { approved: '1e0' }, { approved: '0x1' }, { approved: 1.0000000000000002 }] },
    { expression: '"code" = \'10\'', features: [{ code: '10.0' }, { code: '10' }, { code: 10 }, { code: 10.0 }] },
    { expression: '"approved" = 1 OR "status" = \'urgent\'', features: [{ approved: 1, status: null }] },
    { expression: '"approved" = 1 AND "status" = \'urgent\'', features: [{ approved: 0, status: null }, { approved: 1, status: null }] },
    { expression: '"n" IN (1, NULL)', features: [{ n: 1 }, { n: 2 }] },
    { expression: '"n" IN (2, NULL)', features: [{ n: 1 }] },
    { expression: 'NOT ("n" IN (2, NULL))', features: [{ n: 1 }] },
    ...['"n" = 2', '"n" <> 2', '"n" != 2', '"n" < 3', '"n" > 3', '"n" <= 2', '"n" >= 3', '"n" IN (1, 2)', '"s" LIKE \'a%\'', '"s" ILIKE \'A%\'',
      '"n" BETWEEN 1 AND 2', '"n" NOT BETWEEN 1 AND 2', '"s" IS NULL', '"s" IS NOT NULL', '"n" = 2 AND NOT ("s" = \'b\' OR "n" = 3)']
      .map((expression) => ({ expression, features: [{ n: 2, s: 'abc' }] })),
    { expression: 'STATUS = \'approved\'', features: [{ status: 'approved' }] },
    { expression: '"Status" = \'approved\'', features: [{ Status: 'proposed', status: 'approved' }, { status: 'approved' }, { STATUS: 'approved', status: 'x' }] },
    { expression: '"approved"', features: [{ approved: 1 }, { approved: 0 }, { approved: '1' }, { approved: 'yes' }, { approved: '' }, { approved: null }, { approved: 0.0000000000000001 }] },
    ...['lower("status") = \'approved\'', '"area" + 1 > 500', '"name" || \'x\' = \'ax\'', '"flag" = TRUE', '"status" IS \'approved\'',
      'SELECT * FROM properties WHERE "status" = \'approved\'', '"status" = \'approved', '$area > 500', '"name" ~ \'^A\''].map((expression) => ({ expression, features: [] })),
    ...(['qgis_expression', 'wfs_sql', 'ogc_filter'] as FeatureFilterDialect[]).map((dialect) => ({ expression: '"n" = 1', dialect, features: [] })),
    // Further comparisons.
    { expression: '"code" = \'123\'', features: [{ code: '123' }, { code: 123 }, { code: ' 123' }] },
    { expression: '"name" = \'ÉTÉ\'', features: [{ name: 'été' }, { name: 'ete' }] },
    { expression: '"name" = \'123\'', features: [{ name: 123 }] },
    { expression: '"name" > \'b\'', features: [{ name: 'c' }, { name: 'B' }, { name: 'b' }, { name: '😀' }, { name: '￿' }] },
    { expression: '"name" < \'😀\'', features: [{ name: '￿' }, { name: 'a' }] },
    { expression: '"n" > \'10\'', features: [{ n: 9 }, { n: '9' }, { n: 11 }] },
    { expression: '"flag" = 1', features: [{ flag: true }, { flag: false }, { flag: 'true' }] },
    { expression: '"flag" = \'true\'', features: [{ flag: true }, { flag: false }] },
    { expression: '"flag" > 0', features: [{ flag: true }, { flag: false }] },
    { expression: '"list" = \'1,2\'', features: [{ list: [1, 2] }, { list: { a: 1 } }] },
    { expression: '"obj" = \'[object Object]\'', features: [{ obj: { a: 1 } }] },
    { expression: '"n" = 1e21', features: [{ n: 1e21 }, { n: '1e21' }, { n: '1e+21' }] },
    { expression: '"t" = \'1e+21\'', features: [{ t: 1e21 }] },
    { expression: '"t" = \'0.0000001\'', features: [{ t: 0.0000001 }, { t: '0.0000001' }] },
    { expression: '"n" IN (\'1\', 2)', features: [{ n: '1' }, { n: 1 }, { n: '2' }, { n: '2.0' }] },
    { expression: '"n" IN (\'A\')', features: [{ n: 'a' }] },
    { expression: '"n" IN (\'1\')', features: [{ n: '1.0' }, { n: 1 }] },
    { expression: '"s" LIKE \'a\\%b\'', features: [{ s: 'a%b' }, { s: 'axb' }] },
    { expression: '"s" LIKE \'a\\_b\'', features: [{ s: 'a_b' }, { s: 'axb' }] },
    { expression: '"s" LIKE \'a_c\'', features: [{ s: 'a\nc' }, { s: 'a😀c' }, { s: 'abbc' }] },
    { expression: '"s" LIKE \'%.*+?^$()[]{}|/\\\'', features: [{ s: 'x.*+?^$()[]{}|/\\' }] },
    { expression: '"s" LIKE \'ab\'', features: [{ s: 'ab\n' }, { s: 'ab' }] },
    { expression: '"s" LIKE 5', features: [{ s: 5 }, { s: '5' }, { s: 55 }] },
    { expression: '"s" ILIKE \'STRASSE\'', features: [{ s: 'straße' }, { s: 'strasse' }] },
    { expression: '"n" BETWEEN \'a\' AND \'c\'', features: [{ n: 'b' }, { n: 'd' }] },
    { expression: '"n" BETWEEN NULL AND 5', features: [{ n: 3 }, { n: 9 }] },
    { expression: '"a" OR "b"', features: [{ a: null, b: 1 }, { a: null, b: 0 }, { a: 'x', b: 0 }] },
    { expression: 'NULL', features: [{}] },
    { expression: '\'text\'', features: [{}] },
    { expression: '1', features: [{}] },
    { expression: '"n" = NULL', features: [{ n: null }] },
    { expression: '"n" IS NOT NULL AND "n" <> \'\'', features: [{ n: '' }, { n: 'x' }] },
    { expression: '"n" = 0.1 + 0.2', features: [{ n: 0.3 }] },
    { expression: '"n" = 0.3', features: [{ n: 0.30000000000000004 }, { n: 0.3000001 }] },
    { expression: '"n" <> -1', features: [{ n: -1 }, { n: '-1' }, { n: '- 1' }] },
    { expression: '"n" = 5', features: [{ n: '5.' }, { n: '.5e1' }, { n: '+5' }, { n: ' 5 ' }, { n: 'Infinity' }, { n: '5e999' }] },
    { expression: '"n" > 1e308', features: [{ n: '1e309' }, { n: 'Infinity' }] }
  ]

  it('saves its answers', async () => {
    const answers = cases.map(({ expression, dialect = 'ogr_sql', features }) => {
      const test = readSqlFeatureTest({ expression, dialect })
      return {
        expression,
        dialect,
        kind: test.kind,
        kept: features.map((properties) => ({ properties, kept: test.kind === 'readable' ? test.keeps(properties) : null }))
      }
    })
    await expect(saved(answers)).toMatchFileSnapshot('./answers/sqlFeatureFilter.json')
  })
})
