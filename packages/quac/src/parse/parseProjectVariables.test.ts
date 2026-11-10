import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { parseProjectVariables } from './parseProjectVariables.ts'
import { parseQgsXml } from './parseQgsXml.ts'

const parse = (properties: string) =>
  parseProjectVariables(new DOMParser().parseFromString(`<qgis><properties>${properties}</properties></qgis>`, 'text/xml').documentElement)

const list = (values: string[]) => values.map((v) => `<value>${v}</value>`).join('')

describe('parseProjectVariables', () => {
  it('reads the QGIS 3 shape', () => {
    expect(parse(`<Variables>
      <variableNames type="QStringList">${list(['quac_logo', 'council'])}</variableNames>
      <variableValues type="QStringList">${list(['logo.svg', 'City of Perth'])}</variableValues>
    </Variables>`)).toEqual({ quac_logo: 'logo.svg', council: 'City of Perth' })
  })

  it('reads the QGIS 4 shape', () => {
    expect(parse(`<properties name="Variables">
      <properties name="variableNames" type="QStringList">${list(['quac_logo'])}</properties>
      <properties name="variableValues" type="QStringList">${list(['logo.svg'])}</properties>
    </properties>`)).toEqual({ quac_logo: 'logo.svg' })
  })

  it('reads none where the lists differ in length, as QGIS does, or there are none', () => {
    expect(parse(`<Variables>
      <variableNames type="QStringList">${list(['a', 'b'])}</variableNames>
      <variableValues type="QStringList">${list(['1'])}</variableValues>
    </Variables>`)).toEqual({})
    expect(parse('<Measurement/>')).toEqual({})
  })

  it('reaches the parsed project', () => {
    const xml = `<qgis version="3.44.8"><properties><Variables>
      <variableNames type="QStringList"><value>quac_logo</value></variableNames>
      <variableValues type="QStringList"><value>logo.svg</value></variableValues>
    </Variables></properties></qgis>`
    expect(parseQgsXml(xml).variables).toEqual({ quac_logo: 'logo.svg' })
  })
})
