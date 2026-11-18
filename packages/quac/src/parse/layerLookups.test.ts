import { describe, expect, it } from 'vitest'

import { expressionToGeoStylerFunction, LAYER_LOOKUP, readLayerLookups, readQgisExpression } from './qgisExpression.ts'

function read(expression: string, lookups = true) {
  return readQgisExpression(expression, { lookups })
}

function lookupOf(expression: string) {
  const node = read(expression)
  expect(node).not.toBeNull()
  return readLayerLookups(node!)[0]!
}

describe('overlay_nearest', () => {
  it('is read as a lookup of the nearest feature, which gives one feature where it has no limit', () => {
    const lookup = lookupOf("array_first(overlay_nearest('depots', \"name\"))")
    expect(lookup).toMatchObject({ layer: 'depots', predicate: 'nearest', limit: 1, filter: null })
    expect(lookup).not.toHaveProperty('maxDistance')
    expect(lookup).not.toHaveProperty('sortByOverlap')
  })

  it('reads a limit, a limit of -1 as every feature, and a maximum distance, by name or by position', () => {
    expect(lookupOf("array_first(overlay_nearest('depots', \"name\", limit:=3))").limit).toBe(3)
    expect(lookupOf("array_first(overlay_nearest('depots', \"name\", limit:=-1))").limit).toBeNull()
    expect(lookupOf("array_first(overlay_nearest(layer:='depots', expression:=\"name\", max_distance:=250))").maxDistance).toBe(250)
    expect(lookupOf("array_first(overlay_nearest('depots', \"name\", NULL, 2, 100))")).toMatchObject({ limit: 2, maxDistance: 100 })
  })

  it('reads a filter over the target\'s own fields, and leaves out any other', () => {
    expect(lookupOf("array_first(overlay_nearest('depots', \"name\", filter:=\"open\" = 'yes'))").filter).not.toBeNull()
    expect(read("array_first(overlay_nearest('depots', \"name\", filter:=\"open\" = @cloud_useremail))")).toBeNull()
  })

  it('is unread where it has no expression, a layer named by a field, a negative distance or a limit that is not whole', () => {
    expect(read("array_first(overlay_nearest('depots'))")).toBeNull()
    expect(read("array_first(overlay_nearest(\"layer\", \"name\"))")).toBeNull()
    expect(read("array_first(overlay_nearest('depots', \"name\", max_distance:=-5))")).toBeNull()
    expect(read("array_first(overlay_nearest('depots', \"name\", limit:=1.5))")).toBeNull()
  })

  it('is read only where the caller says lookups, and only as the array that array_first or an index reads', () => {
    expect(read("array_first(overlay_nearest('depots', \"name\"))", false)).toBeNull()
    expect(read("overlay_nearest('depots', \"name\")")).toBeNull()
    expect(read("array_get(overlay_nearest('depots', \"name\", limit:=2), 1)")).not.toBeNull()
  })

  it('becomes the layer lookup function with its key', () => {
    const node = read("array_first(overlay_nearest('depots', \"name\"))")!
    const lookup = readLayerLookups(node)[0]!
    expect(expressionToGeoStylerFunction(node)).toMatchObject({ args: [{ name: 'custom', fnName: LAYER_LOOKUP, args: [lookup.key] }] })
  })
})

describe('overlay_intersects with sort_by_intersection_size', () => {
  it('reads des as the largest overlap first and asc as the smallest, by name or by position', () => {
    expect(lookupOf("array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:='des'))").sortByOverlap).toBe('descending')
    expect(lookupOf("array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:='ASC'))").sortByOverlap).toBe('ascending')
    expect(lookupOf("array_first(overlay_intersects('zones', \"name\", NULL, NULL, NULL, NULL, NULL, NULL, 'des'))").sortByOverlap).toBe('descending')
  })

  it('leaves the order out where the expression gives none, so the key of an earlier read is the same', () => {
    const lookup = lookupOf("array_first(overlay_intersects('zones', \"name\"))")
    expect(lookup).not.toHaveProperty('sortByOverlap')
    expect(lookup.key).toBe(JSON.stringify({ layer: 'zones', predicate: 'intersects', expression: { kind: 'field', name: 'name' }, filter: null, limit: null }))
  })

  it('gives reads that differ only in order different keys', () => {
    const [none, sorted] = [
      lookupOf("array_first(overlay_intersects('zones', \"name\"))"),
      lookupOf("array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:='des'))")
    ]
    expect(sorted.key).not.toBe(none.key)
  })

  it('is unread for any other order, or for another of QGIS\'s options', () => {
    expect(read("array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:='largest'))")).toBeNull()
    expect(read("array_first(overlay_intersects('zones', \"name\", sort_by_intersection_size:=\"order\"))")).toBeNull()
    expect(read("array_first(overlay_intersects('zones', \"name\", min_overlap:=10))")).toBeNull()
    expect(read("array_first(overlay_intersects('zones', \"name\", min_inscribed_circle_radius:=2))")).toBeNull()
    expect(read("array_first(overlay_intersects('zones', \"name\", return_details:=true))")).toBeNull()
  })

  it('is not read for overlay_within, which QGIS gives no order', () => {
    expect(read("array_first(overlay_within('zones', \"name\", sort_by_intersection_size:='des'))")).toBeNull()
  })
})

describe('reads of more than one layer', () => {
  it('are told apart by key, one of each kind', () => {
    const node = read("array_first(overlay_within('a', \"x\")) || array_first(overlay_intersects('b', \"x\")) || array_first(overlay_nearest('c', \"x\"))")
    expect(readLayerLookups(node!).map((lookup) => lookup.predicate)).toEqual(['within', 'intersects', 'nearest'])
  })
})
