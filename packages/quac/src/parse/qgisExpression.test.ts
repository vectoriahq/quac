import { describe, expect, it } from 'vitest'

import { EXPRESSION_VARIABLE, expressionToGeoStylerFunction, LAYER_CRS, readQgisExpression, SHAPE_COORDINATE } from './qgisExpression.ts'

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

  it('leaves $x and $y unread where the caller does not say coordinates', () => {
    expect(read('$x')).toBeNull()
    expect(read('$y')).toBeNull()
  })
})

describe('a coordinate of the record\'s shape', () => {
  function readWith(expression: string, coordinates = true) {
    return readQgisExpression(expression, { geometry: true, aggregates: true, lookups: true, variables: true, coordinates })
  }
  const coordinate = (...args: unknown[]) => ({ name: 'custom', fnName: SHAPE_COORDINATE, args })

  it('is read only where the caller says coordinates', () => {
    expect(readWith('$x', false)).toBeNull()
    expect(readWith('x($geometry)', false)).toBeNull()
    expect(readQgisExpression('round($y, 2)', { geometry: true })).toBeNull()
  })

  it('reads $x and $y as the record\'s own point', () => {
    expect(expressionToGeoStylerFunction(readWith('$x')!)).toEqual(coordinate('x', 'feature', null, null))
    expect(expressionToGeoStylerFunction(readWith('round($y, 2)')!)).toEqual({ name: 'custom', fnName: 'round', args: [coordinate('y', 'feature', null, null), 2] })
  })

  it('reads x(), y() and z() of $geometry as the shape\'s', () => {
    expect(expressionToGeoStylerFunction(readWith('x($geometry)')!)).toEqual(coordinate('x', 'shape', null, null))
    expect(expressionToGeoStylerFunction(readWith('z($geometry)')!)).toEqual(coordinate('z', 'shape', null, null))
  })

  it('reads a transform() of $geometry from and to the coordinate systems it names', () => {
    expect(expressionToGeoStylerFunction(readWith("x(transform($geometry, 'EPSG:28355', 'EPSG:4326'))")!))
      .toEqual(coordinate('x', 'shape', 'EPSG:28355', 'EPSG:4326'))
    expect(expressionToGeoStylerFunction(readWith("y(transform($geometry, @layer_crs, 'EPSG:4326'))")!))
      .toEqual(coordinate('y', 'shape', LAYER_CRS, 'EPSG:4326'))
    expect(expressionToGeoStylerFunction(readWith("y(transform($geometry, layer_property(@layer, 'crs'), 'EPSG:7844'))")!))
      .toEqual(coordinate('y', 'shape', LAYER_CRS, 'EPSG:7844'))
  })

  it('reads one with no variables allowed, as its own @layer is read with it', () => {
    expect(readQgisExpression("x(transform($geometry, @layer_crs, 'EPSG:4326'))", { geometry: true, coordinates: true })).not.toBeNull()
  })

  it('leaves out any other shape, coordinate system or use', () => {
    expect(readWith("x(transform($geometry, @project_crs, 'EPSG:4326'))")).toBeNull()
    expect(readWith("x(transform(geometry(@parent), 'EPSG:28355', 'EPSG:4326'))")).toBeNull()
    expect(readWith("x(transform($geometry, '', 'EPSG:4326'))")).toBeNull()
    expect(readWith("transform($geometry, 'EPSG:28355', 'EPSG:4326')")).toBeNull()
    expect(readWith("layer_property(@layer, 'crs')")).toBeNull()
    expect(readWith('$geometry')).toBeNull()
  })

  it('cannot be used by a read of another layer', () => {
    expect(readWith("array_first(overlay_within('zones', \"name\" || $x))")).toBeNull()
  })
})
