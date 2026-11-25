import '../tests/xmlParser.ts'
import { describe, expect, it } from 'vitest'

import { generateStacCatalogue } from '../generate/stacCatalogue.ts'
import { parseQgsXml } from './parseQgsXml.ts'
import SURVEYS from '../tests/fixtures/qgis/form-settings/surveys.qgs?raw'

import type { StacCollection } from '../model/Stac.ts'

/** The made-up project with every form setting, its fields `remarks` and `photo` renamed. */
function renamed(remarks: string, photo: string): string {
  return SURVEYS.replaceAll('"remarks"', `"${remarks}"`).replaceAll('"photo"', `"${photo}"`)
}

function columns(xml: string): Record<string, Record<string, unknown>> {
  const catalogue = generateStacCatalogue(parseQgsXml(xml))
  const all = (catalogue.collections ?? []).flatMap((collection: StacCollection) => (collection['table:columns'] as Array<Record<string, unknown>> | undefined) ?? [])
  return Object.fromEntries(all.map((column) => [column.name as string, column]))
}

// A field's settings were kept in plain objects keyed by its name, so a field
// named `__proto__` wrote its settings onto Object.prototype, and a field
// named `constructor` read Object's own constructor as its settings.
describe('a field named as one of an object\'s own properties', () => {
  it('reads its settings as any other field\'s, and changes no other object', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort()
    const plain = columns(SURVEYS)
    const special = columns(renamed('__proto__', 'constructor'))

    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before)
    expect(special.__proto__).toEqual({ ...plain.remarks, name: '__proto__' })
    expect(special.constructor).toEqual({ ...plain.photo, name: 'constructor' })
  })
})
