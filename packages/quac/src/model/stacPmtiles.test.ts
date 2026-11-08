import { describe, expect, it } from 'vitest'

import { readCollectionPmtiles } from './stacPmtiles'

import type { StacCollection } from './Stac'

function collection(overrides: Partial<StacCollection>): StacCollection {
  return {
    type: 'Collection',
    stac_version: '1.1.0',
    id: 'boundaries',
    description: 'Administrative boundaries',
    license: 'other',
    extent: { spatial: { bbox: [[115, -32, 116, -31]] }, temporal: { interval: [[null, null]] } },
    links: [],
    ...overrides
  } as StacCollection
}

describe('readCollectionPmtiles', () => {
  it('reads the web-map-links registration, layers and all', () => {
    const source = readCollectionPmtiles(collection({
      links: [{
        rel: 'pmtiles',
        href: 'https://data.test/boundaries.pmtiles',
        type: 'application/vnd.pmtiles',
        'pmtiles:layers': ['suburbs', 'wards']
      }]
    }))

    expect(source).toEqual({
      href: 'https://data.test/boundaries.pmtiles',
      layers: ['suburbs', 'wards']
    })
  })

  // web-map-links leaves the choice of layers to the reader when the link
  // has none, so an empty list here means "every layer in the archive".
  it('reads a link that declares no layers', () => {
    const source = readCollectionPmtiles(collection({
      links: [{ rel: 'pmtiles', href: 'https://data.test/boundaries.pmtiles' }]
    }))

    expect(source).toEqual({ href: 'https://data.test/boundaries.pmtiles', layers: [] })
  })

  it('falls back to a visual-role asset when the collection registers no link', () => {
    const source = readCollectionPmtiles(collection({
      assets: {
        'boundaries.pmtiles': {
          href: 'https://data.test/boundaries.pmtiles',
          type: 'application/vnd.pmtiles',
          roles: ['visual']
        }
      }
    }))

    expect(source).toEqual({ href: 'https://data.test/boundaries.pmtiles', layers: [] })
  })

  // Portolan allows both, addressing the same file. The link is the normative
  // registration and the only one with the layer names.
  it('prefers the link over the asset when a collection carries both', () => {
    const source = readCollectionPmtiles(collection({
      links: [{
        rel: 'pmtiles',
        href: 'https://data.test/from-link.pmtiles',
        'pmtiles:layers': ['suburbs']
      }],
      assets: {
        visual: {
          href: 'https://data.test/from-asset.pmtiles',
          type: 'application/vnd.pmtiles',
          roles: ['visual']
        }
      }
    }))

    expect(source?.href).toBe('https://data.test/from-link.pmtiles')
  })

  it('ignores a visual asset that is not PMTiles, and a collection offering neither', () => {
    expect(readCollectionPmtiles(collection({
      assets: { visual: { href: 'https://data.test/preview.png', type: 'image/png', roles: ['visual'] } }
    }))).toBeNull()
    expect(readCollectionPmtiles(collection({}))).toBeNull()
  })

  // `new URL` accepts any well-formed absolute address, so parsing alone would
  // let all of these through to a tile reader that cannot fetch them.
  it.each([
    ['a relative path', './boundaries.pmtiles'],
    ['MapLibre’s pmtiles:// prefix', 'pmtiles://https://data.test/boundaries.pmtiles'],
    ['a file address', 'file:///data/boundaries.pmtiles'],
    ['a javascript address', 'javascript:alert(1)']
  ])('passes over a link whose href is %s', (_label, href) => {
    expect(readCollectionPmtiles(collection({ links: [{ rel: 'pmtiles', href }] }))).toBeNull()
  })

  // Otherwise a Collection with a broken link resolves to a PMTiles layer that
  // can only draw nothing, and its loadable data asset is never reached.
  it('falls through to a usable visual asset when the link’s href is not fetchable', () => {
    const source = readCollectionPmtiles(collection({
      links: [{ rel: 'pmtiles', href: './boundaries.pmtiles', 'pmtiles:layers': ['suburbs'] }],
      assets: {
        visual: {
          href: 'https://data.test/boundaries.pmtiles',
          type: 'application/vnd.pmtiles',
          roles: ['visual']
        }
      }
    }))

    expect(source?.href).toBe('https://data.test/boundaries.pmtiles')
  })

  it('keeps only the strings in a pmtiles:layers array', () => {
    const source = readCollectionPmtiles(collection({
      links: [{
        rel: 'pmtiles',
        href: 'https://data.test/boundaries.pmtiles',
        'pmtiles:layers': ['suburbs', '', 7, null]
      }]
    }))

    expect(source?.layers).toEqual(['suburbs'])
  })
})
