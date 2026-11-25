/**
 * Reads a .qgs XML string and returns its root `<qgis>` element.
 *
 * Throws when the XML is unparseable or has no `<qgis>` root. `DOMParser`
 * reports an XML error as a `<parsererror>` node in the document rather than
 * by throwing, so that node is what is checked.
 */
export function readQgisRoot(xmlText: string): Element {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`Failed to parse QGS XML: ${parserError.textContent?.slice(0, 200) ?? 'unknown error'}`)
  }

  const qgisRoot = doc.documentElement
  if (!qgisRoot || qgisRoot.tagName !== 'qgis') {
    throw new Error(`Expected <qgis> root element, got <${qgisRoot?.tagName ?? 'nothing'}>`)
  }
  return qgisRoot
}
