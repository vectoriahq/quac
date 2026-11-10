import { describe, expect, it } from 'vitest'

import {
  readCollectionAttribution,
  readCollectionDeprecation,
  readCollectionSelfHref,
  readCollectionThumbnail
} from './stacCollectionNotes.ts'

import type { StacCollection } from './Stac.ts'

function collection(fields: Record<string, unknown> = {}): StacCollection {
  return { type: 'Collection', id: 'provinces', links: [], ...fields } as unknown as StacCollection
}

describe('readCollectionAttribution', () => {
  it('reads the credit, trimmed', () => {
    expect(readCollectionAttribution(collection({ attribution: '  Source, Eurostat ' }))).toBe('Source, Eurostat')
  })

  it.each([['blank', '  '], ['not text', 12], ['absent', undefined]])('reads %s as absent', (_case, attribution) => {
    expect(readCollectionAttribution(collection({ attribution }))).toBeNull()
  })
})

describe('readCollectionDeprecation', () => {
  it('reads an outdated Collection and its latest-version link', () => {
    const outdated = collection({
      deprecated: true,
      links: [{ rel: 'latest-version', href: 'https://data.test/provinces-2026/collection.json' }]
    })
    expect(readCollectionDeprecation(outdated)).toEqual({ latestVersionHref: 'https://data.test/provinces-2026/collection.json' })
  })

  it('reads an outdated Collection with no usable replacement link', () => {
    expect(readCollectionDeprecation(collection({ deprecated: true }))).toEqual({ latestVersionHref: null })
    expect(readCollectionDeprecation(collection({
      deprecated: true,
      links: [{ rel: 'latest-version', href: 'javascript:alert(1)' }]
    }))).toEqual({ latestVersionHref: null })
  })

  it.each([false, 'true', undefined])('reads deprecated: %s as not outdated', (deprecated) => {
    expect(readCollectionDeprecation(collection({ deprecated }))).toBeUndefined()
  })
})

describe('readCollectionThumbnail', () => {
  it('reads the address of the asset with the thumbnail role', () => {
    const withPreview = collection({
      assets: { preview: { href: 'https://data.test/provinces.png', type: 'image/png', roles: ['thumbnail'] } }
    })
    expect(readCollectionThumbnail(withPreview)).toBe('https://data.test/provinces.png')
  })

  it('reads no thumbnail from an asset without the role, or one at a non-web address', () => {
    expect(readCollectionThumbnail(collection({ assets: { thumbnail: { href: 'https://data.test/a.png', roles: ['data'] } } }))).toBeNull()
    expect(readCollectionThumbnail(collection({ assets: { preview: { href: 'data:image/png;base64,AAAA', roles: ['thumbnail'] } } }))).toBeNull()
  })
})

describe('readCollectionSelfHref', () => {
  it('reads the self link where it is a web address', () => {
    expect(readCollectionSelfHref(collection({ links: [{ rel: 'self', href: 'https://data.test/provinces/collection.json' }] })))
      .toBe('https://data.test/provinces/collection.json')
    expect(readCollectionSelfHref(collection({ links: [{ rel: 'self', href: './collection.json' }] }))).toBeNull()
  })
})
