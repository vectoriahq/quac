import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { parseGetProjectSettings } from './parseGetProjectSettings.ts'
import { generateStacCatalogueFromWms } from '../generate/wmsStacCatalogue.ts'
import fixtureXml from '../tests/fixtures/qgis/graffiti/graffiti-get-project-settings.xml?raw'


describe('parseGetProjectSettings — graffiti fixture', () => {
  const project = parseGetProjectSettings(fixtureXml)

  it('reads the project title and keywords', () => {
    expect(project.title).toBe('WA Municipal Graffiti Vandalism Register')
    expect(project.keywords).toEqual(expect.arrayContaining(['infoMapAccessService']))
  })

  it('captures the project-level WGS84 bounding box (Perth metro)', () => {
    expect(project.bbox).not.toBeNull()
    expect(project.bbox!.westBoundLongitude).toBeCloseTo(115.75, 1)
    expect(project.bbox!.eastBoundLongitude).toBeCloseTo(115.95, 1)
  })

  it('walks the layer tree to find the Graffiti Reports leaf', () => {
    expect(project.layerTree).toHaveLength(1)
    const root = project.layerTree[0]
    expect(root.kind).toBe('group')
    if (root.kind !== 'group') return
    expect(root.children).toHaveLength(1)
    const leaf = root.children[0]
    expect(leaf.kind).toBe('layer')
    if (leaf.kind !== 'layer') return
    expect(leaf.name).toBe('Graffiti Reports')
    expect(leaf.title).toBe('Graffiti Reports')
    expect(leaf.geometryType).toBe('Point')
    expect(leaf.queryable).toBe(true)
    expect(leaf.visibilityChecked).toBe(true)
    expect(leaf.displayField).toBe('location_description')
  })

  it('extracts the named styles defined for the layer (Attribution Title is correctly excluded)', () => {
    const leaf = leafByName(project, 'Graffiti Reports')
    expect(leaf.styles.map((s) => s.title).sort()).toEqual(['Asset Owner', 'Priority'])
  })

  it('captures the full attribute schema with Qt type info', () => {
    const leaf = leafByName(project, 'Graffiti Reports')
    expect(leaf.attributes.length).toBeGreaterThan(10)
    const byName = Object.fromEntries(leaf.attributes.map((a) => [a.name, a]))
    expect(byName.priority_status?.type).toBe('QString')
    expect(byName.offensive_flag?.type).toBe('bool')
    expect(byName.cost_estimate?.type).toBe('double')
    expect(byName.location_description?.editType).toBe('TextEdit')
  })

  it('carries Attribute aliases into STAC column titles', () => {
    const withAlias = fixtureXml.replace(
      'name="cost_estimate"',
      'name="cost_estimate" alias="Cost estimate ($)"'
    )
    const projectWithAlias = parseGetProjectSettings(withAlias)
    const leaf = leafByName(projectWithAlias, 'Graffiti Reports')
    const byName = Object.fromEntries(leaf.attributes.map((a) => [a.name, a]))
    expect(byName.cost_estimate?.alias).toBe('Cost estimate ($)')

    const stac = generateStacCatalogueFromWms(projectWithAlias)
    const collection = stac.catalogs![0].collections![0]
    const columns = collection['table:columns'] as Array<{ name: string, title?: string }>
    expect(Object.fromEntries(columns.map((c) => [c.name, c])).cost_estimate?.title)
      .toBe('Cost estimate ($)')
  })

  it('lists the layer in WFSLayers (it is published via WFS)', () => {
    expect(project.wfsLayerNames).toContain('Graffiti Reports')
  })

  it('retains the original XML for future enhancements', () => {
    expect(project.rawXml).not.toBeNull()
    expect(project.rawXml!.length).toBe(fixtureXml.length)
  })
})

function leafByName(project: ReturnType<typeof parseGetProjectSettings>, name: string) {
  const root = project.layerTree[0]
  if (root.kind !== 'group') throw new Error('Expected root group')
  const leaf = root.children.find((child) => child.kind === 'layer' && child.name === name)
  if (!leaf || leaf.kind !== 'layer') throw new Error(`No layer "${name}"`)
  return leaf
}
