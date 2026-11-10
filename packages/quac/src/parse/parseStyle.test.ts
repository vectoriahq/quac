import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { parseLayerStyles } from './parseStyle.ts'

/**
 * `categorisedField` is read from the renderer's own `attr`, gated on the
 * renderer type — a graduated renderer identifies its field the same way a
 * categorized one does, one range per rule rather than one value, per
 * `geostyler-qgis-parser`'s `QGISStyleParser.js` categories/ranges branches.
 */

function maplayerWithRenderer(rendererXml: string): Element {
  const doc = new DOMParser().parseFromString(`<maplayer>${rendererXml}</maplayer>`, 'text/xml')
  return doc.documentElement
}

describe('parseLayerStyles — categorisedField extraction', () => {
  it('reads the field from a categorized renderer', () => {
    const maplayer = maplayerWithRenderer('<renderer-v2 type="categorizedSymbol" attr="asset_type"/>')
    const { styles } = parseLayerStyles(maplayer)
    expect(styles[0].categorisedField).toBe('asset_type')
  })

  it('reads the field from a graduated renderer', () => {
    const maplayer = maplayerWithRenderer('<renderer-v2 type="graduatedSymbol" attr="risk_level"/>')
    const { styles } = parseLayerStyles(maplayer)
    expect(styles[0].categorisedField).toBe('risk_level')
  })

  it('reads nothing from a single-symbol renderer, even where it carries an attr', () => {
    const maplayer = maplayerWithRenderer('<renderer-v2 type="singleSymbol" attr="asset_type"/>')
    const { styles } = parseLayerStyles(maplayer)
    expect(styles[0].categorisedField).toBeNull()
  })

  it('reads nothing from a rule-based renderer', () => {
    const maplayer = maplayerWithRenderer('<renderer-v2 type="RuleRenderer"/>')
    const { styles } = parseLayerStyles(maplayer)
    expect(styles[0].categorisedField).toBeNull()
  })
})
