import { describe, expect, it } from 'vitest'

import { readSqlFeatureTest } from './sqlFeatureFilter.ts'

import type { FeatureFilterDialect } from '../model/featureFilter.ts'

function ogr(expression: string, properties: Record<string, unknown> | null): boolean {
  const test = readSqlFeatureTest({ expression, dialect: 'ogr_sql' })
  if (test.kind !== 'readable') throw new Error(`unreadable: ${expression}`)
  return test.keeps(properties)
}

describe('readSqlFeatureTest', () => {
  it('compares text for equality ignoring case, as GDAL does', () => {
    expect(ogr('"status" = \'approved\'', { status: 'Approved' })).toBe(true)
    expect(ogr('"status" = \'approved\'', { status: 'APPROVED' })).toBe(true)
    expect(ogr('"status" = \'approved\'', { status: 'proposed' })).toBe(false)
    expect(ogr('"status" <> \'approved\'', { status: 'Approved' })).toBe(false)
    expect(ogr('"status" != \'approved\'', { status: 'proposed' })).toBe(true)
    expect(ogr('"status" IN (\'approved\', \'lodged\')', { status: 'Lodged' })).toBe(true)
    expect(ogr('"status" NOT IN (\'approved\', \'lodged\')', { status: 'Lodged' })).toBe(false)
  })

  it('keeps LIKE with case and ILIKE without, as GDAL 3.1 and later do', () => {
    expect(ogr('"lot" LIKE \'Lot%\'', { lot: 'Lot 5' })).toBe(true)
    expect(ogr('"lot" LIKE \'Lot%\'', { lot: 'lot 5' })).toBe(false)
    expect(ogr('"lot" ILIKE \'Lot%\'', { lot: 'lot 5' })).toBe(true)
  })

  it('compares numbers, ranges and nulls, leaving out a feature a NULL makes unknown', () => {
    expect(ogr('"area" > 500', { area: 600 })).toBe(true)
    expect(ogr('"area" BETWEEN 100 AND 500', { area: 600 })).toBe(false)
    expect(ogr('"area" > 500', { area: null })).toBe(false)
    expect(ogr('NOT ("status" = \'approved\')', { status: null })).toBe(false)
    expect(ogr('"status" IS NULL', { status: null })).toBe(true)
    expect(ogr('"status" IS NOT NULL', {})).toBe(false)
    expect(ogr('"status" = \'approved\' OR "area" > 500', { status: 'proposed', area: 600 })).toBe(true)
    expect(ogr('"status" = \'approved\' AND "area" > 500', { status: 'Approved', area: 100 })).toBe(false)
  })

  it('reads numbers held as text as numbers, unless both sides are text', () => {
    expect(ogr('"approved" = 1', { approved: '1' })).toBe(true)
    expect(ogr('"approved" = 1', { approved: '1.0' })).toBe(true)
    expect(ogr('"code" = \'10\'', { code: '10.0' })).toBe(false)
  })

  it('follows three-valued logic, so OR decides on a true side and IN is unknown past a NULL', () => {
    expect(ogr('"approved" = 1 OR "status" = \'urgent\'', { approved: 1, status: null })).toBe(true)
    expect(ogr('"approved" = 1 AND "status" = \'urgent\'', { approved: 0, status: null })).toBe(false)
    expect(ogr('"n" IN (1, NULL)', { n: 1 })).toBe(true)
    expect(ogr('"n" IN (2, NULL)', { n: 1 })).toBe(false)
    expect(ogr('NOT ("n" IN (2, NULL))', { n: 1 })).toBe(false)
  })

  it.each([
    ['"n" = 2', true],
    ['"n" <> 2', false],
    ['"n" != 2', false],
    ['"n" < 3', true],
    ['"n" > 3', false],
    ['"n" <= 2', true],
    ['"n" >= 3', false],
    ['"n" IN (1, 2)', true],
    ['"s" LIKE \'a%\'', true],
    ['"s" ILIKE \'A%\'', true],
    ['"n" BETWEEN 1 AND 2', true],
    ['"n" NOT BETWEEN 1 AND 2', false],
    ['"s" IS NULL', false],
    ['"s" IS NOT NULL', true],
    ['"n" = 2 AND NOT ("s" = \'b\' OR "n" = 3)', true]
  ])('reads %s', (expression, kept) => {
    expect(ogr(expression, { n: 2, s: 'abc' })).toBe(kept)
  })

  it('reads a bare field name, and finds a field ignoring case where none matches exactly', () => {
    expect(ogr('STATUS = \'approved\'', { status: 'approved' })).toBe(true)
    expect(ogr('"Status" = \'approved\'', { Status: 'proposed', status: 'approved' })).toBe(false)
    expect(ogr('"approved"', { approved: 1 })).toBe(true)
    expect(ogr('"approved"', { approved: 0 })).toBe(false)
  })

  it('leaves out a feature that has no properties, or lacks the field', () => {
    expect(ogr('"status" = \'approved\'', null)).toBe(false)
    expect(ogr('"approved" = 1', { comment: 'x' })).toBe(false)
  })

  it.each([
    'lower("status") = \'approved\'',
    '"area" + 1 > 500',
    '"name" || \'x\' = \'ax\'',
    '"flag" = TRUE',
    '"status" IS \'approved\'',
    'SELECT * FROM properties WHERE "status" = \'approved\'',
    '"status" = \'approved',
    '$area > 500',
    '"name" ~ \'^A\''
  ])('cannot read %s', (expression) => {
    expect(readSqlFeatureTest({ expression, dialect: 'ogr_sql' })).toEqual({ kind: 'unreadable', expression })
  })

  it.each(['qgis_expression', 'wfs_sql', 'ogc_filter'] as FeatureFilterDialect[])('reads no %s filter, however simple', (dialect) => {
    expect(readSqlFeatureTest({ expression: '"n" = 1', dialect })).toEqual({ kind: 'unreadable', expression: '"n" = 1' })
  })
})
