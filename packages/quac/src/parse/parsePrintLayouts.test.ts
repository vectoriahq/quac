import '../tests/xmlParser.ts'

import { describe, expect, it } from 'vitest'

import { parsePrintLayouts, writeLayoutTemplate } from './parsePrintLayouts.ts'
import { readCataloguePrintLayouts } from '../generate/normalizedProject.ts'
import { generateStacCatalogue } from '../generate/stacCatalogue.ts'
import { parseQgsXml } from './parseQgsXml.ts'
import graffitiXml from '../tests/fixtures/qgis/graffiti/graffiti.qgs?raw'
import sampleXml from '../tests/fixtures/qgis/simple-styles/sample.qgs?raw'

import type { StacCatalog } from '../model/Stac.ts'

function rootOf(xml: string): Element {
  return new DOMParser().parseFromString(xml, 'text/xml').documentElement
}

describe('parsePrintLayouts', () => {
  it('reads each layout as its name and its <Layout> element', () => {
    const layouts = parseQgsXml(sampleXml).printLayouts ?? []
    expect(layouts.map((layout) => layout.name)).toEqual(['Site plan A4', 'Two pages'])
    const [sitePlan] = layouts
    expect(sitePlan.template.startsWith('<Layout name="Site plan A4" units="mm" worldFileMap="" printResolution="300">')).toBe(true)
    expect(sitePlan.template.endsWith('</Layout>')).toBe(true)
    // The template reads back as the same layout.
    const reread = rootOf(sitePlan.template)
    expect(reread.querySelectorAll(':scope > LayoutItem')).toHaveLength(10)
    expect(reread.querySelector(':scope > Atlas')?.getAttribute('featureFilter')).toBe('"name" IS NOT NULL')
  })

  it('reads none from a project that has none', () => {
    expect(parseQgsXml(graffitiXml).printLayouts).toEqual([])
  })

  it.each([
    ['QGIS 3', '<WMSRestrictedComposers type="QStringList"><value>Internal</value></WMSRestrictedComposers>'],
    ['QGIS 4', '<properties name="WMSRestrictedComposers" type="QStringList"><value>Internal</value></properties>']
  ])('leaves out a layout the project excludes from QGIS Server, as %s saves it', (_, property) => {
    const root = rootOf(`<qgis><properties>${property}</properties><Layouts><Layout name="Internal"/><Layout name="Public"/></Layouts></qgis>`)
    expect(parsePrintLayouts(root)).toEqual([{ name: 'Public', template: '<Layout name="Public"/>' }])
  })

  it('reads no report', () => {
    const root = rootOf('<qgis><Layouts><Report name="Annual"/><Layout name="Plan"/></Layouts></qgis>')
    expect(parsePrintLayouts(root).map((layout) => layout.name)).toEqual(['Plan'])
  })
})

describe('writeLayoutTemplate', () => {
  it('keeps attribute order, closes an empty element, and drops white space between elements', () => {
    expect(writeLayoutTemplate(rootOf('<a z="1" b="2">\n  <c/>\n  <d>text</d>\n</a>'))).toBe('<a z="1" b="2"><c/><d>text</d></a>')
  })

  it('escapes text and attribute values by its fixed rule', () => {
    const element = rootOf('<a label="&lt;b&gt;[% &quot;name&quot; %]&lt;/b&gt; &amp; more&#10;line&#9;tab">x &lt; y &amp;&amp; y &gt; z</a>')
    expect(writeLayoutTemplate(element)).toBe('<a label="&lt;b&gt;[% &quot;name&quot; %]&lt;/b&gt; &amp; more&#10;line&#9;tab">x &lt; y &amp;&amp; y &gt; z</a>')
  })

  it('leaves out comments and writes CDATA as text', () => {
    expect(writeLayoutTemplate(rootOf('<a><!-- note --><b><![CDATA[1 < 2]]></b></a>'))).toBe('<a><b>1 &lt; 2</b></a>')
  })

  it('leaves out every layer data source and provider, and empties an absolute path', () => {
    const element = rootOf(`<Layout name="Plan">
      <LayoutItem type="65640" file="C:/Users/editor/logo.png"/>
      <LayoutItem type="65640" file="/home/editor/logo.png"/>
      <LayoutItem type="65640" file="./logo.png"/>
      <LayoutItem type="65639"><LayerSet><Layer name="Parks" source="dbname='parks' user='editor' password='secret'" provider="postgres">parks_1</Layer></LayerSet></LayoutItem>
      <Atlas enabled="1" coverageLayer="parks_1" coverageLayerName="Parks" coverageLayerSource="//server/share/parks.gpkg" coverageLayerProvider="ogr"/>
    </Layout>`)
    expect(writeLayoutTemplate(element)).toBe(
      '<Layout name="Plan">'
      + '<LayoutItem type="65640" file=""/>'
      + '<LayoutItem type="65640" file=""/>'
      + '<LayoutItem type="65640" file="./logo.png"/>'
      + '<LayoutItem type="65639"><LayerSet><Layer name="Parks">parks_1</Layer></LayerSet></LayoutItem>'
      + '<Atlas enabled="1" coverageLayer="parks_1" coverageLayerName="Parks"/>'
      + '</Layout>'
    )
  })
})

describe('readCataloguePrintLayouts', () => {
  it('reads back the layouts a project\'s catalogue carries', () => {
    const project = parseQgsXml(sampleXml)
    expect(readCataloguePrintLayouts(generateStacCatalogue(project))).toEqual(project.printLayouts)
  })

  it('reads nothing from a catalogue with none, and skips an entry that is not a layout', () => {
    const catalog = { type: 'Catalog', stac_version: '1.1.0', id: 'c', description: 'c', links: [] } as StacCatalog
    expect(readCataloguePrintLayouts(catalog)).toEqual([])
    expect(readCataloguePrintLayouts({
      ...catalog,
      'quac:print_layouts': [{ name: 'Plan', template: '<Layout name="Plan"/>' }, { name: 'Odd', template: '<Report/>' }, 'Loose']
    })).toEqual([{ name: 'Plan', template: '<Layout name="Plan"/>' }])
  })
})
