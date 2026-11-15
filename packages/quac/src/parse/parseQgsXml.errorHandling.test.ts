import '../tests/xmlParser.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  describe('without XMLSerializer', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    // Each layer keeps its XML through XMLSerializer, so without one every
    // layer used to be skipped, and the project read as having none.
    it('throws instead of reading a project with no layers', () => {
      vi.stubGlobal('XMLSerializer', undefined)
      expect(() => parseQgsXml('<qgis><projectlayers/></qgis>')).toThrow(/needs XMLSerializer/)
    })
  })
})
