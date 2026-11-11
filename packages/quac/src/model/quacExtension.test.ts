import { describe, expect, it } from 'vitest'

import { QUAC_SCHEMA_URL, declareQuacExtension, isNewerQuacMajor, readQuacVersion } from './quacExtension.ts'
import schemaJson from '../schema/quac.schema.json?raw'

import type { StacCatalog, StacCollection } from './Stac.ts'

const TABLE = 'https://stac-extensions.github.io/table/v1.3.0/schema.json'

function collection(id: string, fields: Record<string, unknown> = {}): StacCollection {
  return { type: 'Collection', stac_version: '1.1.0', id, description: '', license: 'other', extent: { spatial: { bbox: [[-180, -90, 180, 90]] }, temporal: { interval: [[null, null]] } }, links: [], ...fields }
}

describe('declareQuacExtension', () => {
  it('names the address the schema gives as its $id', () => {
    expect(QUAC_SCHEMA_URL).toBe((JSON.parse(schemaJson) as { $id: string }).$id)
  })

  it('lists the schema on the top-level Catalog, and on each child that carries a quac: field of its own', () => {
    const catalog: StacCatalog = {
      type: 'Catalog',
      stac_version: '1.1.0',
      id: 'project',
      description: '',
      links: [],
      collections: [
        collection('plain'),
        collection('on-itself', { 'quac:opacity': 0.5, stac_extensions: [TABLE] }),
        collection('in-summaries', { summaries: { 'quac:geometry_type': ['Point'] } }),
        collection('on-an-asset', { assets: { data: { href: './a.gpkg', 'quac:layer_name': 'a' } } }),
        collection('on-a-link', { links: [{ rel: 'wms', href: 'https://example.com/wms', 'quac:wms_crs': 'EPSG:3857' }] }),
        collection('on-a-column', { 'table:columns': [{ name: 'a', 'quac:hidden': true }] })
      ],
      catalogs: [
        { type: 'Catalog', stac_version: '1.1.0', id: 'plain-group', description: '', links: [] },
        { type: 'Catalog', stac_version: '1.1.0', id: 'exclusive-group', description: '', links: [], 'quac:mutually_exclusive': true }
      ]
    }

    declareQuacExtension(catalog)

    expect(catalog.stac_extensions).toEqual([QUAC_SCHEMA_URL])
    expect(Object.fromEntries(catalog.collections!.map((child) => [child.id, child.stac_extensions]))).toEqual({
      'plain': undefined,
      'on-itself': [TABLE, QUAC_SCHEMA_URL],
      'in-summaries': [QUAC_SCHEMA_URL],
      'on-an-asset': [QUAC_SCHEMA_URL],
      'on-a-link': [QUAC_SCHEMA_URL],
      'on-a-column': [QUAC_SCHEMA_URL]
    })
    expect(catalog.catalogs!.map((child) => child.stac_extensions)).toEqual([undefined, [QUAC_SCHEMA_URL]])
  })

  it('lists the schema once, however often it runs', () => {
    const catalog: StacCatalog = { type: 'Catalog', stac_version: '1.1.0', id: 'p', description: '', links: [] }
    declareQuacExtension(declareQuacExtension(catalog))
    expect(catalog.stac_extensions).toEqual([QUAC_SCHEMA_URL])
  })
})

describe('readQuacVersion', () => {
  it('reads the version from the QUAC schema address, among other extensions', () => {
    expect(readQuacVersion({ stac_extensions: [TABLE, QUAC_SCHEMA_URL] })).toBe('0.2.0')
    expect(readQuacVersion({ stac_extensions: ['https://example.org/schemas/quac/v2.3.4/schema.json'] })).toBe('2.3.4')
  })

  it('is null where no QUAC schema is listed', () => {
    expect(readQuacVersion({ stac_extensions: [TABLE] })).toBeNull()
    expect(readQuacVersion({})).toBeNull()
    expect(readQuacVersion({ stac_extensions: 'not a list' })).toBeNull()
  })
})

describe('isNewerQuacMajor', () => {
  it('is true only for a newer major version than this package reads', () => {
    expect(isNewerQuacMajor('1.0.0')).toBe(true)
    expect(isNewerQuacMajor('0.9.0')).toBe(false)
    expect(isNewerQuacMajor(readQuacVersion({ stac_extensions: [QUAC_SCHEMA_URL] })!)).toBe(false)
  })
})
