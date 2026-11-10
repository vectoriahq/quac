import { isTrueValue } from './customProperties.ts'

/**
 * Reads each field's active data-defined **Editable** property, the button
 * beside a field's Editable box in QGIS's Attributes Form, as one QGIS
 * expression per field name.
 *
 * QGIS saves them under the layer's `<dataDefinedFieldProperties>`, one
 * `<field name>` per field holding a property collection
 * (`QgsEditFormConfig::writeXml`, `src/core/editform/qgseditformconfig.cpp`,
 * and `QgsPropertyCollection::toVariant`, `src/core/qgspropertycollection.cpp`,
 * `qgis/QGIS@master`, read 2026-10-25):
 *
 *   <dataDefinedFieldProperties>
 *     <field name="installed">
 *       <Option type="Map">
 *         <Option type="QString" value="" name="name"/>
 *         <Option type="Map" name="properties">
 *           <Option type="Map" name="dataDefinedEditable">
 *             <Option type="bool" value="true" name="active"/>
 *             <Option type="QString" value="&quot;last_inspected&quot; IS NULL" name="expression"/>
 *             <Option type="int" value="3" name="type"/>
 *           </Option>
 *         </Option>
 *         <Option type="QString" value="collection" name="type"/>
 *       </Option>
 *     </field>
 *   </dataDefinedFieldProperties>
 *
 * `type` is `Qgis::PropertyType`: 1 static (`val`), 2 field (`field`), 3
 * expression (`expression`) (`QgsProperty::toVariant`, `src/core/qgsproperty.cpp`).
 * A field-type property becomes the field named in double quotes, and a static
 * one `true` or `false`, read as Qt reads a string as a Boolean: empty, `0` and
 * `false` in any case are false. A property that is not active, of an unknown
 * type, or with no field or expression is left out, as `QgsProperty::loadVariant`
 * deactivates an empty field or expression.
 *
 * Alias and Custom comment are not read.
 */
export function parseDataDefinedEditable(maplayer: Element): Map<string, string> {
  const result = new Map<string, string>()
  const block = Array.from(maplayer.children).find((child) => child.tagName === 'dataDefinedFieldProperties')
  for (const field of Array.from(block?.children ?? [])) {
    const name = field.getAttribute('name')?.trim()
    if (field.tagName !== 'field' || !name || result.has(name)) continue
    const property = field.querySelector(':scope > Option[type="Map"] > Option[name="properties"] > Option[name="dataDefinedEditable"]')
    const expression = property ? readProperty(property) : null
    if (expression) result.set(name, expression)
  }
  return result
}

function readProperty(property: Element): string | null {
  const values = new Map<string, string>()
  for (const option of Array.from(property.children)) {
    const key = option.getAttribute('name')
    if (key && option.tagName === 'Option') values.set(key, option.getAttribute('value') ?? '')
  }
  const active = values.get('active')?.trim().toLowerCase()
  if (active !== 'true' && active !== '1') return null

  switch (Number.parseInt(values.get('type') ?? '', 10)) {
    case 1: {
      return isTrueValue((values.get('val') ?? '').trim()) ? 'true' : 'false'
    }
    case 2: {
      const field = values.get('field')?.trim()
      return field ? `"${field.replaceAll('"', '""')}"` : null
    }
    case 3:
      return values.get('expression')?.trim() || null
    default:
      return null
  }
}
