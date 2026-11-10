import { describe, expect, it } from 'vitest'

import {
  normalizeExternalStacCatalogue,
  parseWfsGetFeatureUrl,
  resolveWfsCollectionSource
} from './externalStacCatalogue.ts'
import { QUAC_SCHEMA_URL } from '../model/quacExtension.ts'

import type { StacCatalog, StacCollection } from '../model/Stac.ts'

/**
 * Documents as they are read from somewhere else: missing the fields the profile
 * requires, and never with our vendor namespaces. Typed loosely for that
 * reason — filling those gaps is what the normaliser is for.
 */
const externalCatalog = {
  type: 'Catalog',
  stac_version: '1.0.0',
  id: 'partner-catalog',
  description: 'A catalogue published by someone else',
  links: [{ rel: 'self', href: 'https://partner.example/catalog.json' }],
  collections: [
    {
      type: 'Collection',
      stac_version: '1.0.0',
      id: 'roads',
      title: 'Roads',
      description: 'Road centrelines',
      extent: { spatial: { bbox: [[115, -32, 116, -31]] } },
      assets: {
        data: {
          href: 'https://partner.example/wfs?SERVICE=WFS&REQUEST=GetFeature&typeName=partner:roads&outputFormat=application/json',
          type: 'application/geo+json'
        }
      },
      links: []
    }
  ],
  catalogs: [
    {
      type: 'Catalog',
      stac_version: '1.0.0',
      id: 'nested',
      description: 'Nested group',
      links: [],
      collections: [
        {
          type: 'Collection',
          stac_version: '1.0.0',
          id: 'parks',
          description: 'Parks',
          license: 'CC-BY-4.0',
          extent: { spatial: { bbox: [[115, -32, 116, -31]] } },
          assets: { data: { href: 'https://partner.example/parks.geojson' } },
          links: []
        }
      ]
    }
  ]
} as unknown as StacCatalog

describe('normalizeExternalStacCatalogue', () => {
  const normalized = normalizeExternalStacCatalogue(externalCatalog)
  const roads = normalized.collections![0]!
  const parks = normalized.catalogs![0]!.collections![0]!

  it('keeps the document the source published', () => {
    expect(normalized.id).toBe('partner-catalog')
    expect(normalized.description).toBe('A catalogue published by someone else')
    expect(normalized.links).toEqual([{ rel: 'self', href: 'https://partner.example/catalog.json' }])
    expect(roads.title).toBe('Roads')
    expect(roads.extent.spatial.bbox).toEqual([[115, -32, 116, -31]])
    expect(parks.license).toBe('CC-BY-4.0')
  })

  it('fills the temporal extent STAC requires on every Collection', () => {
    expect(roads.extent.temporal).toEqual({ interval: [[null, null]] })
    expect(parks.extent.temporal).toEqual({ interval: [[null, null]] })
  })

  it('supplies a license for a Collection that declares none', () => {
    expect(roads.license).toBe('other')
  })

  it('reads the quac:wfs_* fields out of a GetFeature asset href when the source carries none', () => {
    expect(roads['quac:wfs_endpoint']).toBe('https://partner.example/wfs')
    expect(roads['quac:wfs_type_name']).toBe('partner:roads')
  })

  it('leaves a Collection that is not WFS-backed without quac:wfs_* fields', () => {
    expect(parks['quac:wfs_endpoint']).toBeUndefined()
    expect(parks['quac:wfs_type_name']).toBeUndefined()
  })

  it('lists the QUAC schema only on a Collection it writes quac: fields onto', () => {
    expect(roads.stac_extensions).toContain(QUAC_SCHEMA_URL)
    expect(parks.stac_extensions ?? []).not.toContain(QUAC_SCHEMA_URL)
  })

  it('never overwrites vendor fields the source already declares', () => {
    const declared = normalizeExternalStacCatalogue({
      ...externalCatalog,
      collections: [{
        ...externalCatalog.collections![0]!,
        'quac:wfs_endpoint': 'https://partner.example/authoritative/wfs',
        'quac:wfs_type_name': 'authoritative:roads'
      }]
    })
    const collection = declared.collections![0]!
    expect(collection['quac:wfs_endpoint']).toBe('https://partner.example/authoritative/wfs')
    expect(collection['quac:wfs_type_name']).toBe('authoritative:roads')
  })

  it('recurses into nested Catalogs', () => {
    expect(normalized.catalogs).toHaveLength(1)
    expect(normalized.catalogs![0]!.id).toBe('nested')
    expect(parks.id).toBe('parks')
  })

  it('wraps a Collection root in a synthetic Catalog', () => {
    const wrapped = normalizeExternalStacCatalogue(externalCatalog.collections![0]!)
    expect(wrapped.type).toBe('Catalog')
    expect(wrapped.id).toBe('roads-catalog')
    expect(wrapped.title).toBe('Roads')
    expect(wrapped.collections).toHaveLength(1)
    expect(wrapped.collections![0]!.id).toBe('roads')
  })

  it('falls back to the world extent when a Collection declares no spatial box', () => {
    const boxless = normalizeExternalStacCatalogue({
      ...externalCatalog,
      collections: [{ ...externalCatalog.collections![0]!, extent: undefined }]
    } as unknown as StacCatalog)
    expect(boxless.collections![0]!.extent.spatial.bbox).toEqual([[-180, -90, 180, 90]])
  })
})

describe('resolveWfsCollectionSource', () => {
  const base = {
    type: 'Collection',
    stac_version: '1.1.0',
    id: 'roads',
    description: 'Road centrelines',
    license: 'other',
    extent: { spatial: { bbox: [[115, -32, 116, -31]] }, temporal: { interval: [[null, null]] } },
    links: []
  } as unknown as StacCollection

  it('prefers the declared quac:wfs_* fields over the asset href', () => {
    const collection: StacCollection = {
      ...base,
      'quac:wfs_endpoint': 'https://example.org/wfs',
      'quac:wfs_type_name': 'city:roads',
      assets: { data: { href: 'https://elsewhere.example/wfs?REQUEST=GetFeature&typeNames=other:roads' } }
    }
    expect(resolveWfsCollectionSource(collection))
      .toEqual({ endpoint: 'https://example.org/wfs', typeName: 'city:roads' })
  })

  it('falls back to the asset href when only one of the two fields is declared', () => {
    const collection: StacCollection = {
      ...base,
      'quac:wfs_endpoint': 'https://example.org/wfs',
      assets: { data: { href: 'https://elsewhere.example/wfs?REQUEST=GetFeature&typeNames=other:roads' } }
    }
    expect(resolveWfsCollectionSource(collection))
      .toEqual({ endpoint: 'https://elsewhere.example/wfs', typeName: 'other:roads' })
  })

  it('returns null for a Collection that is not WFS-backed', () => {
    const collection: StacCollection = {
      ...base,
      assets: { data: { href: 'https://example.org/roads.geojson' } }
    }
    expect(resolveWfsCollectionSource(collection)).toBeNull()
  })

  // The classifier that lists a Collection in the Add Layer picker reads its
  // data asset by role, so this has to as well: finding it under only one of
  // the two would list the Collection and then refuse the add.
  it('reads a data asset carrying the role under a key of its own', () => {
    const collection: StacCollection = {
      ...base,
      assets: {
        'roads-wfs': {
          href: 'https://example.org/wfs?REQUEST=GetFeature&typeNames=city:roads',
          roles: ['data']
        }
      }
    }
    expect(resolveWfsCollectionSource(collection))
      .toEqual({ endpoint: 'https://example.org/wfs', typeName: 'city:roads' })
  })
})

describe('parseWfsGetFeatureUrl', () => {
  it('reads the WFS 2.x TYPENAMES parameter and strips the query from the endpoint', () => {
    expect(parseWfsGetFeatureUrl('https://example.org/geoserver/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAMES=city:roads'))
      .toEqual({ endpoint: 'https://example.org/geoserver/wfs', typeName: 'city:roads' })
  })

  it('reads the WFS 1.x typeName parameter whatever case the server used', () => {
    expect(parseWfsGetFeatureUrl('https://example.org/wfs?request=GetFeature&TypeName=city:parks'))
      .toEqual({ endpoint: 'https://example.org/wfs', typeName: 'city:parks' })
  })

  it('returns null for a URL carrying no type name, an empty one, or no URL at all', () => {
    expect(parseWfsGetFeatureUrl('https://example.org/roads.geojson')).toBeNull()
    expect(parseWfsGetFeatureUrl('https://example.org/wfs?typeNames=')).toBeNull()
    expect(parseWfsGetFeatureUrl('not a url')).toBeNull()
    expect(parseWfsGetFeatureUrl('')).toBeNull()
  })
})
