import '../tests/xmlParser.ts'

import { describe, expect, it } from 'vitest'

import { layoutLengthToMillimetres, parseQgsLayouts } from './parseQgsLayouts.ts'
import graffitiXml from '../tests/fixtures/qgis/graffiti/graffiti.qgs?raw'
import sampleXml from '../tests/fixtures/qgis/simple-styles/sample.qgs?raw'

import type { LayoutItem, PrintLayout } from '../model/PrintLayout.ts'

const WHATS_ON_WHEN = 'What_s_On_When_e2d6cc77_d805_4b20_98b9_00be61c397d7'
const BICYCLE_ROUTES = 'Bicycle_Routes_e1d2fe6c_392d_414c_be98_884f957d20cc'

describe('parseQgsLayouts — simple-styles fixture', () => {
  const layouts = parseQgsLayouts(sampleXml)
  const sitePlan = layoutNamed(layouts, 'Site plan A4')
  const twoPages = layoutNamed(layouts, 'Two pages')

  it('reads every layout, with its first page in millimetres', () => {
    expect(layouts.map((layout) => layout.name)).toEqual(['Site plan A4', 'Two pages'])
    expect(sitePlan.page).toEqual({ width: 297, height: 210 })
    expect(sitePlan.pageCount).toBe(1)
    expect(twoPages.page).toEqual({ width: 210, height: 297 })
    expect(twoPages.pageCount).toBe(2)
  })

  it('lists the first page\'s items in drawing order, with their kinds', () => {
    expect(sitePlan.items.map((item) => [item.id, item.kind])).toEqual([
      ['Border', 'shape'],
      ['Site map', 'map'],
      ['Title', 'label'],
      ['Event details', 'label'],
      ['Logo', 'picture'],
      ['North arrow', 'picture'],
      ['Scale bar', 'scalebar'],
      ['Legend', 'legend'],
      ['', 'attributeTable'],
      ['Draft note', 'label']
    ])
  })

  it('reads a map item\'s extent, CRS, layers and atlas settings', () => {
    const map = itemWithId(sitePlan, 'Site map')
    expect(map).toMatchObject({
      kind: 'map',
      box: { x: 10, y: 25, width: 200, height: 175 },
      extent: { xmin: 144.99470105, ymin: -37.940564175, xmax: 145.111240284, ymax: -37.858446825 },
      crs: 'EPSG:4326',
      layerIds: [WHATS_ON_WHEN, BICYCLE_ROUTES],
      theme: null,
      mapRotation: 0,
      isAtlasDriven: true,
      atlasMargin: 0.1
    })
  })

  it('reads a label\'s text unevaluated, and whether it is HTML', () => {
    expect(itemWithId(sitePlan, 'Title')).toMatchObject({ kind: 'label', text: '[% @project_title %]', isHtml: false })
    expect(itemWithId(sitePlan, 'Event details')).toMatchObject({ kind: 'label', text: '<b>[% "name" %]</b>', isHtml: true })
  })

  it('reads a picture\'s path, and the map a north arrow turns with', () => {
    expect(itemWithId(sitePlan, 'Logo')).toMatchObject({ kind: 'picture', path: 'logo.svg', rotatesWithMapUuid: null })
    expect(itemWithId(sitePlan, 'North arrow')).toMatchObject({
      kind: 'picture',
      path: ':/images/north_arrows/layout_default_north_arrow.svg',
      rotatesWithMapUuid: '{a1000000-0000-4000-8000-000000000003}'
    })
  })

  it('gives the top-left corner of an item positioned by another reference point', () => {
    // The logo's saved position is its top-right corner.
    expect(itemWithId(sitePlan, 'Logo').box).toEqual({ x: 247, y: 8, width: 40, height: 15 })
  })

  it('reads whether an item is shown and whether it is printed', () => {
    expect(itemWithId(sitePlan, 'Draft note')).toMatchObject({ isVisible: false, isExcludedFromExports: true })
    expect(itemWithId(sitePlan, 'Title')).toMatchObject({ isVisible: true, isExcludedFromExports: false })
  })

  it('keeps each item\'s own XML', () => {
    expect(itemWithId(sitePlan, 'Border').xml).toContain('shapeType="1"')
  })

  it('reads the atlas', () => {
    expect(sitePlan.atlas).toEqual({
      coverageLayerId: WHATS_ON_WHEN,
      coverageLayerName: 'whats-on-when-polygon_Whats_On_When',
      hidesCoverage: false,
      featureFilter: '"name" IS NOT NULL',
      pageNameExpression: '"name"'
    })
    expect(twoPages.atlas).toBeNull()
  })

  it('converts other units to millimetres and leaves out items on later pages', () => {
    expect(twoPages.items.map((item) => item.id)).toEqual(['Badge', 'Heading'])
    expect(itemWithId(twoPages, 'Heading').box).toEqual({ x: 10, y: 10, width: 100, height: 20 })
    // The badge is saved by its centre, in inches, with its size in pixels at
    // the layout's 96 dpi.
    const badge = itemWithId(twoPages, 'Badge')
    expect(badge).toMatchObject({ kind: 'shape', shape: 'ellipse', rotation: 45 })
    expect(badge.box.x).toBeCloseTo(38.1)
    expect(badge.box.y).toBeCloseTo(69.85)
    expect(badge.box.width).toBeCloseTo(25.4)
    expect(badge.box.height).toBeCloseTo(12.7)
  })
})

describe('parseQgsLayouts — other projects', () => {
  it('returns no layouts for a project that has none', () => {
    expect(parseQgsLayouts(graffitiXml)).toEqual([])
  })

  it('leaves out a layout with no page', () => {
    const xml = '<qgis><Layouts><Layout name="Empty" units="mm"><PageCollection/></Layout></Layouts></qgis>'
    expect(parseQgsLayouts(xml)).toEqual([])
  })

  it('throws on XML it cannot parse, as parseQgsXml does', () => {
    expect(() => parseQgsLayouts('<qgis>')).toThrow('Failed to parse QGS XML')
    expect(() => parseQgsLayouts('<project/>')).toThrow('Expected <qgis> root element')
  })
})

describe('layoutLengthToMillimetres', () => {
  it.each([
    [2, 'mm', 2],
    [2, 'cm', 20],
    [2, 'm', 2000],
    [2, 'in', 50.8],
    [2, 'ft', 609.6],
    [72, 'pt', 25.4],
    [6, 'pi', 25.4],
    [300, 'px', 25.4]
  ])('converts %d %s', (value, unit, millimetres) => {
    expect(layoutLengthToMillimetres(value, unit, 300)).toBeCloseTo(millimetres, 3)
  })

  it('returns null for a unit QGIS does not save', () => {
    expect(layoutLengthToMillimetres(2, 'furlong', 300)).toBeNull()
  })
})

function layoutNamed(layouts: PrintLayout[], name: string): PrintLayout {
  const layout = layouts.find((candidate) => candidate.name === name)
  if (!layout) throw new Error(`no layout named ${name}`)
  return layout
}

function itemWithId(layout: PrintLayout, id: string): LayoutItem {
  const item = layout.items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`no item with ID ${id} in ${layout.name}`)
  return item
}
