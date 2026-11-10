// @vitest-environment jsdom
//
// Kept on real jsdom deliberately: it exercises the browser DOMParser's
// <parsererror> behaviour on malformed XML, which linkedom (used by the
// other parseQgsXml tests to avoid jsdom's setup cost) does not reproduce —
// it silently patches broken markup instead of flagging it.
import { describe, expect, it } from 'vitest'

import { parseQgsXml } from './parseQgsXml.ts'

describe('parseQgsXml — error handling', () => {
  it('throws a clear error for malformed XML', () => {
    expect(() => parseQgsXml('<qgis><unterminated>')).toThrow(/Failed to parse QGS XML/)
  })

  it('throws a clear error when the root element is not <qgis>', () => {
    expect(() => parseQgsXml('<not-qgis><child/></not-qgis>')).toThrow(
      'Expected <qgis> root element, got <not-qgis>'
    )
  })
})
