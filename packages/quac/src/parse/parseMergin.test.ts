import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { parseMerginFilters } from './parseMergin'

const filter = (overrides: Record<string, unknown> = {}) => ({
  filter_name: 'Priority',
  layer_id: 'graffiti',
  field_name: 'priority_status',
  filter_type: 'Single select',
  sql_expression: '"priority_status" IS @@value@@',
  ...overrides
})

/** A project whose Mergin Maps entries are saved as QGIS 3 saves them, the list escaped as XML text. */
const parse = (enabled: string, filters: unknown) => parseMerginFilters(new DOMParser().parseFromString(`<qgis><properties>
  <Mergin>
    <Filtering>
      <Enabled type="bool">${enabled}</Enabled>
      <Filters type="QString">${JSON.stringify(filters).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</Filters>
    </Filtering>
  </Mergin>
</properties></qgis>`, 'text/xml').documentElement)

describe('parseMerginFilters', () => {
  it('reads each filter\'s layer, field and name, in order', () => {
    expect(parse('true', [filter(), filter({ filter_name: '', field_name: 'damage_category', filter_type: 'Multi select' })])).toEqual([
      { layerId: 'graffiti', field: 'priority_status', name: 'Priority' },
      { layerId: 'graffiti', field: 'damage_category', name: null }
    ])
  })

  it('reads nothing while filtering is switched off, or where the list is not JSON', () => {
    expect(parse('false', [filter()])).toEqual([])
    expect(parseMerginFilters(new DOMParser().parseFromString(
      '<qgis><properties><Mergin><Filtering><Enabled type="bool">true</Enabled><Filters type="QString">[{</Filters></Filtering></Mergin></properties></qgis>',
      'text/xml'
    ).documentElement)).toEqual([])
    expect(parseMerginFilters(new DOMParser().parseFromString('<qgis><properties/></qgis>', 'text/xml').documentElement)).toEqual([])
  })

  it('leaves out a Text filter, and one that lacks a layer, a field or its SQL template, as the app does', () => {
    expect(parse('true', [
      filter({ filter_type: 'Text' }),
      filter({ layer_id: '' }),
      filter({ field_name: undefined }),
      filter({ sql_expression: '' }),
      filter({ filter_type: 'Date', field_name: 'reported_on' })
    ])).toEqual([{ layerId: 'graffiti', field: 'reported_on', name: 'Priority' }])
  })
})
