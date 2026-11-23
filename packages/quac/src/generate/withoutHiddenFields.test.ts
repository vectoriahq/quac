import { describe, expect, it } from 'vitest'

import { withoutHiddenFields } from './serverStacCatalogue.ts'

import type { StacCollection } from '../model/Stac.ts'

const collection = {
  type: 'Collection',
  stac_version: '1.1.0',
  id: 'submissions',
  description: 'Submissions',
  license: 'other',
  extent: { spatial: { bbox: [[0, 0, 1, 1]] }, temporal: { interval: [[null, null]] } },
  links: [],
  assets: {
    data: { href: './submissions.geojson', roles: ['data'] },
    default: { href: './project.qgs#submissions/default', roles: ['style'], 'quac:categorised_field': 'email' }
  },
  'quac:display_field': 'email',
  'quac:form_order': ['comment', 'email'],
  'quac:related_to': [{ parent_collection_id: 'parks', fields: [{ parent: 'park_id', child: 'park_id' }] }],
  'table:columns': [
    { name: 'comment', 'quac:visible_when': ['"email" IS NOT NULL', '"comment" <> \'\''] },
    { name: 'email' },
    { name: 'park_id', 'quac:editable_when': '"email" IS NULL' }
  ]
} as unknown as StacCollection

describe('withoutHiddenFields', () => {
  it('drops every mention of a hidden field, and locks a field whose edit depends on one', () => {
    const shown = withoutHiddenFields(collection, 'submissions', {
      hiddenOf: (id) => new Set(id === 'submissions' ? ['email'] : []),
      servedId: (id) => id
    })
    expect(shown['quac:display_field']).toBeUndefined()
    expect(shown['quac:form_order']).toEqual(['comment'])
    expect(shown['table:columns']).toEqual([
      { name: 'comment', 'quac:visible_when': ['"comment" <> \'\''] },
      { name: 'park_id', 'quac:editable': false }
    ])
    expect(shown.assets?.default).toEqual({ href: './project.qgs#submissions/default', roles: ['style'] })
    expect(shown['quac:related_to']).toEqual(collection['quac:related_to'])
  })

  it('drops a relation to a layer that is not served, or joined on a field its parent hides', () => {
    const unserved = withoutHiddenFields(collection, 'submissions', { hiddenOf: () => new Set(), servedId: () => null })
    expect(unserved['quac:related_to']).toBeUndefined()
    const parentHides = withoutHiddenFields(collection, 'submissions', { hiddenOf: (id) => new Set(id === 'parks' ? ['park_id'] : []), servedId: (id) => id })
    expect(parentHides['quac:related_to']).toBeUndefined()
  })

  it('does not change the Collection it was given', () => {
    const copy = structuredClone(collection)
    withoutHiddenFields(collection, 'submissions', { hiddenOf: () => new Set(['email']), servedId: (id) => id })
    expect(collection).toEqual(copy)
  })
})
