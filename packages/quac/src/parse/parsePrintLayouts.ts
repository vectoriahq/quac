import { propertyList } from './projectProperties.ts'

import type { PrintLayoutTemplate } from '../model/QgsProject.ts'

/**
 * The project's print layouts, from `<qgis><Layouts>`, each as its name and its
 * `<Layout>` element written out by `writeLayoutTemplate`. That element is what
 * QGIS saves as a layout template (`.qpt`): `QgsLayout::saveAsTemplate` writes
 * the same `writeXml` element as the only element of the file
 * (`src/core/layout/qgslayout.cpp`, `qgis/QGIS@master`, read 2026-11-25).
 *
 * A layout whose name the project leaves out of WMS, under Project Properties →
 * QGIS Server → WMS capabilities → **Exclude layouts**, saved as
 * `WMSRestrictedComposers` (`QgsServerProjectUtils::wmsRestrictedComposers`,
 * `src/server/qgsserverprojectutils.cpp`, same revision), is left out, as its
 * excluded layers are. Reports are not read.
 */
export function parsePrintLayouts(qgisRoot: Element): PrintLayoutTemplate[] {
  const properties = qgisRoot.querySelector(':scope > properties')
  const restricted = new Set(properties ? propertyList(properties, 'WMSRestrictedComposers') : [])
  return Array.from(qgisRoot.querySelectorAll(':scope > Layouts > Layout'))
    .map((layout) => ({ name: layout.getAttribute('name') ?? '', template: writeLayoutTemplate(layout) }))
    .filter((layout) => !restricted.has(layout.name))
}

/**
 * An attribute QGIS writes a layer's data source or provider in: `source` and
 * `provider` on a map item's `<Layer>`, and `coverageLayerSource`,
 * `vectorLayerSource` and the like, which a data source's password or file
 * path can be in.
 */
const SOURCE_ATTRIBUTE = /^(source|provider)$|(Source|Provider)$/

/**
 * A value that is a path on the computer that saved the project: from the
 * root of a disk or a home folder (`~/`), a drive, a network share, or a
 * `file:` address. It is narrower than `isProjectRelativeFolder`'s test of an
 * Attachment folder, because it reads every attribute of a layout, label text
 * included, so a value such as `Address: 12 Main St` is not taken for an
 * address.
 */
const ABSOLUTE_PATH = /^\s*(\/|\\|~[\\/]|[A-Za-z]:([\\/]|$)|file:)/i

/**
 * A layout element as XML text, written by one fixed rule so that the
 * plugin's Python writes the same text: attributes in the order the document
 * holds them, an element with no children closed as `<name/>`, text that is
 * only white space left out, comments and processing instructions left out,
 * and `&`, `<`, `>` escaped everywhere, with `"`, tab, line feed and carriage
 * return escaped in attribute values too.
 *
 * It holds no layer's data source and no absolute path: each `SOURCE_ATTRIBUTE`
 * is left out, and an attribute whose value is an `ABSOLUTE_PATH` is written
 * empty.
 */
export function writeLayoutTemplate(element: Element): string {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => !SOURCE_ATTRIBUTE.test(attribute.name))
    .map((attribute) => ` ${attribute.name}="${ABSOLUTE_PATH.test(attribute.value) ? '' : escapeAttribute(attribute.value)}"`)
    .join('')
  const children = Array.from(element.childNodes)
    .map((child) => {
      if (child.nodeType === 1) return writeLayoutTemplate(child as Element)
      if (child.nodeType === 3 || child.nodeType === 4) {
        const text = child.nodeValue ?? ''
        return text.trim() === '' ? '' : escapeText(text)
      }
      return ''
    })
    .join('')
  return children === ''
    ? `<${element.tagName}${attributes}/>`
    : `<${element.tagName}${attributes}>${children}</${element.tagName}>`
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}
