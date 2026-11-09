import { isTrueValue } from './customProperties'
import { propertyChild, propertyText, readPropertyBlock } from './projectProperties'

import type { PresetFilter } from '../model/QgsProject'

/** The Mergin Maps filter types the filter row has a control for; `Text`, a "contains" search, is not one. */
const READ_FILTER_TYPES = new Set(['Number', 'Date', 'Checkbox', 'Single select', 'Multi select'])

/**
 * The filters the Mergin Maps plugin sets up, on its **Mergin Maps** tab of
 * Project Properties: the project entries `Mergin/Filtering/Enabled` and
 * `Mergin/Filtering/Filters`, saved as `<properties><Mergin><Filtering>`
 * (`ProjectSettingsWidget.apply`, `Mergin/project_settings_widget.py`,
 * `MerginMaps/qgis-plugin@eb2c52a`). The second is a JSON list of filters, each
 * with `filter_name`, `layer_id`, `field_name`, `filter_type` and
 * `sql_expression` (`FieldFilter`, `Mergin/field_filtering.py`, same commit).
 *
 * The app offers them only while `Enabled` is true, and skips a filter that
 * lacks `layer_id`, `field_name` or `sql_expression` (`FilterController`,
 * `app/filter/filtercontroller.cpp`, `MerginMaps/mobile@779434d`), as this
 * does. `sql_expression`, a template for the data source's own SQL, is not
 * read beyond that: the filter row filters the field itself. A `Text` filter
 * is left out. Empty where the project sets none, or the list does not read
 * as JSON.
 */
export function parseMerginFilters(qgisRoot: Element): PresetFilter[] {
  const block = readPropertyBlock(qgisRoot, 'Mergin')
  const filtering = block ? propertyChild(block, 'Filtering') : null
  if (!filtering || !isTrueValue(propertyText(filtering, 'Enabled'))) return []

  let entries: unknown
  try {
    entries = JSON.parse(propertyText(filtering, 'Filters') ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []

  const text = (entry: Record<string, unknown>, key: string) => {
    const value = entry[key]
    return typeof value === 'string' && value.trim() !== '' ? value : null
  }
  return entries.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const filter = entry as Record<string, unknown>
    const layerId = text(filter, 'layer_id')
    const field = text(filter, 'field_name')
    const type = text(filter, 'filter_type')
    if (!layerId || !field || !text(filter, 'sql_expression') || !type || !READ_FILTER_TYPES.has(type)) return []
    return [{ layerId, field, name: text(filter, 'filter_name')?.trim() ?? null }]
  })
}
