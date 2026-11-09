import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { qmlForLayer } from './qmlForLayer'
import { parseQgsXml } from '../parse/parseQgsXml'
import fixtureXml from '../tests/fixtures/qgis/graffiti/graffiti.qgs?raw'


describe('qmlForLayer — graffiti fixture', () => {
  const project = parseQgsXml(fixtureXml)
  const graffitiLayer = project.layers.find((l) => l.name === 'Graffiti Reports')!

  it('produces a standalone QML envelope wrapping the renderer-v2 subtree', () => {
    const qml = qmlForLayer(project, graffitiLayer.id)
    expect(qml).not.toBeNull()
    expect(qml!).toContain('<!DOCTYPE qgis PUBLIC \'http://mrcc.com/qgis.dtd\' \'SYSTEM\'>')
    expect(qml!).toContain('<qgis version=')
    expect(qml!).toContain('renderer-v2')
    expect(qml!).toMatch(/<\/qgis>\s*$/)
  })

  it('keeps layer label settings outside the generated renderer document', () => {
    const labelledLayer = {
      ...graffitiLayer,
      rawXml: graffitiLayer.rawXml!.replace('</maplayer>', '<labeling type="simple"/></maplayer>')
    }
    const labelledProject = { ...project, layers: [labelledLayer] }
    expect(labelledLayer.rawXml).toContain('<labeling')
    const qml = qmlForLayer(labelledProject, graffitiLayer.id)!
    const doc = new DOMParser().parseFromString(qml, 'text/xml')
    expect(doc.querySelector('labeling')).toBeNull()
  })

  it('includes the QGIS version attribute from the project', () => {
    const qml = qmlForLayer(project, graffitiLayer.id)!
    expect(qml).toMatch(/version="3\./)
  })

  it('returns null for a layer that does not exist', () => {
    expect(qmlForLayer(project, 'no-such-layer')).toBeNull()
  })

  it('returns null when a layer has no inline style', () => {
    const stripped = {
      ...project,
      layers: [{ ...graffitiLayer, styles: [], activeStyleIndex: -1 }]
    }
    expect(qmlForLayer(stripped, graffitiLayer.id)).toBeNull()
  })

  it('renders QML for a non-active style when explicitly requested', () => {
    // Active style is "Asset Owner" (index 0). Ask for "Priority" (index 1).
    const qml = qmlForLayer(project, graffitiLayer.id, 1)
    expect(qml).not.toBeNull()
    expect(qml!).toContain('renderer-v2')
    expect(qml!).toContain('priority_status')
  })
})
