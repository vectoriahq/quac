import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { findGeometrySiblings } from './geometrySiblings'
import { parseDataSource } from './parseDataSource'
import { parseQgsXml } from './parseQgsXml'
import annotationsXml from '../tests/fixtures/qgis/geometry-sublayers/annotations.qgs?raw'
import { annotationsProjectWith, annotationsProjectWithSource } from '../tests/geometrySublayersFixture'

const POINT_ID = 'annotations_point_0b6c2f1e_8d4a_4e7b_9c31_5f2a7d8e1b01'
const LINE_ID = 'annotations_line_1c7d3a2f_9e5b_4f8c_8d42_6a3b8e9f2c02'
const POLYGON_ID = 'annotations_polygon_2d8e4b3a_af6c_4a9d_9e53_7b4c9fa03d03'

function siblingIds(xml: string): Record<string, string[]> {
  const siblings = findGeometrySiblings(parseQgsXml(xml))
  return Object.fromEntries([...siblings].map(([id, set]) => [id, set.map((layer) => layer.id)]))
}

describe('findGeometrySiblings', () => {
  it('finds layers over one file that differ only by geometrytype=, in the layers panel\'s order', () => {
    const set = [POINT_ID, LINE_ID, POLYGON_ID]
    expect(siblingIds(annotationsXml)).toEqual({ [POINT_ID]: set, [LINE_ID]: set, [POLYGON_ID]: set })
  })

  it('finds two siblings when the project holds two', () => {
    expect(siblingIds(annotationsProjectWith(['Point', 'Polygon']))[POLYGON_ID]).toEqual([POINT_ID, POLYGON_ID])
  })

  it('finds none for a single per-shape layer', () => {
    expect(siblingIds(annotationsProjectWith(['Point']))).toEqual({})
  })

  it.each([
    ['another option', './annotations.geojson|geometrytype=LineString|subset=&quot;label&quot; = \'Fence\''],
    ['no geometrytype=', './annotations.geojson'],
    ['a second geometrytype= option, which QGIS does not read', './annotations.geojson|geometrytype=LineString|geometrytype=Point'],
    ['another spelling of the path', 'annotations.geojson|geometrytype=LineString'],
    ['another file', './other.geojson|geometrytype=LineString']
  ])('leaves out a layer whose source differs by %s', (_difference, source) => {
    const set = [POINT_ID, POLYGON_ID]
    expect(siblingIds(annotationsProjectWithSource('LineString', source))).toEqual({ [POINT_ID]: set, [POLYGON_ID]: set })
  })

  it('finds none among layers QGIS reads from one CSV file with its Delimited Text provider', () => {
    const project = parseQgsXml(annotationsXml)
    const csv = (query: string) => parseDataSource(`file:./annotations.csv?type=csv&${query}`, 'delimitedtext')
    const sources = [csv('geomType=none'), csv('geomType=none&delimiter=;'), csv('geomType=none&skipLines=1')]
    const csvProject = { ...project, layers: project.layers.map((layer, index) => ({ ...layer, dataSource: sources[index] })) }
    expect(csvProject.layers.every((layer) => layer.dataSource.kind === 'file' && layer.dataSource.geometryTypeFilter === null)).toBe(true)
    expect(findGeometrySiblings(csvProject).size).toBe(0)
  })

  it('leaves a set as separate layers where two of them name the same shape', () => {
    expect(siblingIds(annotationsProjectWithSource('LineString', './annotations.geojson|geometrytype=MultiPoint'))).toEqual({})
  })
})
