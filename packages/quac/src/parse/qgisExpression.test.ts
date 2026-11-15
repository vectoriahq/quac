import { describe, expect, it } from 'vitest'

import { EXPRESSION_VARIABLE, expressionToGeoStylerFunction, readQgisExpression } from './qgisExpression.ts'

function read(expression: string, variables = true) {
  return readQgisExpression(expression, { geometry: true, aggregates: true, lookups: true, variables })
}

describe('a variable', () => {
  it('is read only where the caller says variables', () => {
    expect(read('@cloud_useremail', false)).toBeNull()
    expect(read('@cloud_useremail')).not.toBeNull()
    expect(readQgisExpression("'x' || @mm_user_email")).toBeNull()
  })

  it('becomes the variable function with its name and no @', () => {
    expect(expressionToGeoStylerFunction(read('@mm_user_email')!))
      .toEqual({ name: 'custom', fnName: EXPRESSION_VARIABLE, args: ['mm_user_email'] })
  })

  it('keeps its spelling, as QGIS looks a variable up by its exact name', () => {
    expect(expressionToGeoStylerFunction(read('@Cloud_UserEmail')!))
      .toEqual({ name: 'custom', fnName: EXPRESSION_VARIABLE, args: ['Cloud_UserEmail'] })
  })

  it('stands inside other functions', () => {
    expect(expressionToGeoStylerFunction(read("coalesce(@cloud_useremail, 'unknown')")!)).toEqual({
      name: 'custom',
      fnName: 'coalesce',
      args: [{ name: 'custom', fnName: EXPRESSION_VARIABLE, args: ['cloud_useremail'] }, 'unknown']
    })
  })

  it('cannot be used by a read of another layer', () => {
    expect(read("array_first(overlay_within('zones', \"name\", filter:=\"owner\" = @cloud_useremail))")).toBeNull()
    expect(read("array_first(overlay_within('zones', @cloud_useremail))")).toBeNull()
  })

  it('leaves @parent to an aggregate filter, as before', () => {
    expect(read('@parent')).toBeNull()
  })
})

describe('x, y and z', () => {
  it('take the coordinate of the point a variable holds', () => {
    expect(expressionToGeoStylerFunction(read('x(@position_coordinate)')!))
      .toEqual({ name: 'custom', fnName: EXPRESSION_VARIABLE, args: ['position_coordinate', 'x'] })
    expect(expressionToGeoStylerFunction(read('round(y(@position_coordinate), 6)')!)).toEqual({
      name: 'custom',
      fnName: 'round',
      args: [{ name: 'custom', fnName: EXPRESSION_VARIABLE, args: ['position_coordinate', 'y'] }, 6]
    })
    expect(read('z(@position_coordinate)')).not.toBeNull()
  })

  it('are not read with any other point', () => {
    expect(read('x($geometry)')).toBeNull()
    expect(read('x("location")')).toBeNull()
    expect(read('x(@position_coordinate)', false)).toBeNull()
  })

  it('leaves $x and $y unread', () => {
    expect(read('$x')).toBeNull()
    expect(read('$y')).toBeNull()
  })
})
