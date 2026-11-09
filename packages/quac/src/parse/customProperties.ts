/**
 * Reads a `<maplayer>`'s `<customproperties>`, in either form QGIS reads
 * (`QgsObjectCustomProperties::readXml`, `src/core/qgsobjectcustomproperties.cpp`,
 * `qgis/QGIS@master`, read 2026-10-25). Since QGIS 3.20 the block holds one
 * `<Option type="Map">` with an `<Option name>` per key: a `value` attribute
 * for a single value, or a child `<Option>` per entry of a list. Before that it
 * held a `<property key>` per key, with a `value` attribute or a child `<value>`
 * per entry. Keys are flat, slashes and all (`QFieldSync/action`).
 */

/** A key's values, in either form: one item for a single value, none where the key is absent. */
export function readCustomPropertyList(properties: Element, key: string): string[] {
  const map = Array.from(properties.children).find((child) => child.tagName === 'Option')
  if (map) {
    const list = Array.from(map.children).find((option) => option.tagName === 'Option' && option.getAttribute('name') === key)
    if (!list) return []
    const single = list.getAttribute('value')
    if (single !== null) return [single]
    return Array.from(list.children).flatMap((item) => item.tagName === 'Option' ? [item.getAttribute('value') ?? ''] : [])
  }
  const legacy = Array.from(properties.children).find((property) => property.tagName === 'property' && property.getAttribute('key') === key)
  if (!legacy) return []
  const single = legacy.getAttribute('value')
  if (single !== null) return [single]
  return Array.from(legacy.children).flatMap((item) => item.tagName === 'value' ? [item.textContent ?? ''] : [])
}

/** A single-valued key's value, or null where the key is absent. */
export function readCustomProperty(properties: Element, key: string): string | null {
  return readCustomPropertyList(properties, key)[0] ?? null
}

/**
 * Whether a saved value reads as true, as Qt's `QVariant::toBool` reads text:
 * anything but blank, `0` and `false`, ignoring case. Null, an absent key, is false.
 */
export function isTrueValue(value: string | null): boolean {
  if (value === null) return false
  const text = value.toLowerCase()
  return text !== '' && text !== '0' && text !== 'false'
}
