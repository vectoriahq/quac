/**
 * Reads `<qgis><properties>`, which QGIS writes in two shapes. QGIS 3 names
 * each element after its key (`<Measurement><AreaUnits>`); QGIS 4 writes every
 * key as a `<properties name="…">` element (`QgsProjectPropertyValue::writeXml`,
 * `src/core/project/qgsprojectproperty.cpp`, `qgis/QGIS@master`, read
 * 2026-10-25). Both shapes are in this repository's demo projects.
 */

/** The child of `parent` holding `name`, in either shape. */
export function propertyChild(parent: Element, name: string): Element | null {
  return parent.querySelector(`:scope > ${name}`)
    ?? Array.from(parent.querySelectorAll(':scope > properties')).find((child) => child.getAttribute('name') === name)
    ?? null
}

/** A top-level block of `<qgis><properties>`, such as `Measurement` or `Palette`. */
export function readPropertyBlock(qgisRoot: Element, name: string): Element | null {
  const properties = qgisRoot.querySelector(':scope > properties')
  return properties ? propertyChild(properties, name) : null
}

/** A key's text, trimmed; null where the key is absent or blank. */
export function propertyText(parent: Element, name: string): string | null {
  return propertyChild(parent, name)?.textContent?.trim() || null
}

/** A string-list key's members, one per `<value>` element. */
export function propertyList(parent: Element, name: string): string[] {
  const key = propertyChild(parent, name)
  return key ? Array.from(key.querySelectorAll(':scope > value')).map((value) => value.textContent ?? '') : []
}
