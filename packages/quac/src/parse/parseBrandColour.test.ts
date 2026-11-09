import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { parseBrandColour } from './parseBrandColour'
import { parseQgsXml } from './parseQgsXml'

const parse = (properties: string) =>
  parseBrandColour(new DOMParser().parseFromString(`<qgis><properties>${properties}</properties></qgis>`, 'text/xml').documentElement)

// The QGIS 3 shape: each key is an element named after it.
const qgis3Palette = (colours: string[], labels: string[]) => `
  <Palette>
    <Colors type="QStringList">${colours.map((c) => `<value>${c}</value>`).join('')}</Colors>
    <Labels type="QStringList">${labels.map((l) => `<value>${l}</value>`).join('')}</Labels>
  </Palette>`

describe('parseBrandColour', () => {
  it('reads the colour labelled Brand from a QGIS 3 palette', () => {
    expect(parse(qgis3Palette(
      ['255,0,0,255,rgb:1,0,0,1', '7,122,125,255,rgb:0.0274510,0.4784314,0.4901961,1'],
      ['Warning', 'Brand']
    ))).toBe('7,122,125,255,rgb:0.0274510,0.4784314,0.4901961,1')
  })

  it('reads the QGIS 4 shape, where every key is a named properties element', () => {
    expect(parse(`
      <properties name="Palette">
        <properties name="Colors" type="QStringList"><value>7,122,125,255,rgb:0.0274510,0.4784314,0.4901961,1</value></properties>
        <properties name="Labels" type="QStringList"><value>Brand</value></properties>
      </properties>`)).toBe('7,122,125,255,rgb:0.0274510,0.4784314,0.4901961,1')
  })

  it('matches the label ignoring case and surrounding spaces', () => {
    expect(parse(qgis3Palette(['6,32,43,255'], [' brand ']))).toBe('6,32,43,255')
  })

  it('takes the first colour labelled Brand', () => {
    expect(parse(qgis3Palette(['6,32,43,255', '255,0,0,255'], ['Brand', 'BRAND']))).toBe('6,32,43,255')
  })

  it('reads none where no colour is labelled Brand, the palette is absent, or the label has no colour', () => {
    expect(parse(qgis3Palette(['6,32,43,255'], ['Primary']))).toBeNull()
    expect(parse('<Measurement/>')).toBeNull()
    expect(parse(qgis3Palette([], ['Brand']))).toBeNull()
  })

  it('reaches the parsed project', () => {
    const xml = `<qgis version="3.44.8"><properties>${qgis3Palette(['6,32,43,255'], ['Brand'])}</properties></qgis>`
    expect(parseQgsXml(xml).brandColour).toBe('6,32,43,255')
    expect(parseQgsXml('<qgis version="3.44.8"/>').brandColour).toBeNull()
  })
})
