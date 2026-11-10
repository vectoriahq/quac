import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { QUAC_RELATED_TO_FIELD, readCollectionRelatedTo } from './normalizedProject.ts'
import { generateStacCatalogue } from './stacCatalogue.ts'
import { STAC_VERSION } from '../model/Stac.ts'
import { collectCatalogueCollections } from '../model/stacTreeWalk.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'
import fixtureXml from '../tests/fixtures/qgis/related-datasets/street-trees.qgs?raw'

import type { StacCollection } from '../model/Stac.ts'

const PARENT_ID = 'street_trees_5b1d0a72_4e33_4c1a_9f6d_2c8b7a1e4d90'
const CHILD_ID = 'tree_inspections_0a4f9c81_7b26_4f55_8ad3_16e0f9b25c47'

function collectionsFrom(xml: string): Map<string, StacCollection> {
  const catalogue = generateStacCatalogue(parseQgsXml(xml))
  return new Map(collectCatalogueCollections(catalogue).map((collection) => [collection.id, collection]))
}

function bareCollection(fields: Record<string, unknown>): StacCollection {
  return {
    type: 'Collection',
    stac_version: STAC_VERSION,
    id: 'child',
    description: '',
    license: 'other',
    extent: { spatial: { bbox: [] }, temporal: { interval: [[null, null]] } },
    links: [],
    ...fields
  }
}

describe('quac:related_to on a generated Collection', () => {
  const collections = collectionsFrom(fixtureXml)

  it('writes the field on the child Collection, naming the parent, the fields and the relation', () => {
    expect(collections.get(CHILD_ID)?.[QUAC_RELATED_TO_FIELD]).toEqual([
      {
        id: 'tree_inspections_rel',
        name: 'Inspections',
        parent_collection_id: PARENT_ID,
        fields: [{ parent: 'tree_id', child: 'tree_id' }]
      }
    ])
  })

  it('leaves the parent Collection without the field', () => {
    expect(collections.get(PARENT_ID)?.[QUAC_RELATED_TO_FIELD]).toBeUndefined()
  })

  it('drops a relation naming a layer the project does not hold', () => {
    const orphaned = collectionsFrom(fixtureXml.replace(`referencedLayer="${PARENT_ID}"`, 'referencedLayer="gone"'))
    expect(orphaned.get(CHILD_ID)?.[QUAC_RELATED_TO_FIELD]).toBeUndefined()
  })
})

describe('readCollectionRelatedTo', () => {
  it('reads back what the generator wrote', () => {
    const child = collectionsFrom(fixtureXml).get(CHILD_ID)!

    expect(readCollectionRelatedTo(child)).toEqual([
      {
        id: 'tree_inspections_rel',
        name: 'Inspections',
        parentCollectionId: PARENT_ID,
        fields: [{ parent: 'tree_id', child: 'tree_id' }]
      }
    ])
  })

  it('reads nothing from a Collection declaring no relations', () => {
    expect(readCollectionRelatedTo(bareCollection({}))).toEqual([])
    expect(readCollectionRelatedTo(bareCollection({ [QUAC_RELATED_TO_FIELD]: 'trees' }))).toEqual([])
  })

  it('drops an entry with no id, no parent Collection id or no usable field pair', () => {
    const collection = bareCollection({
      [QUAC_RELATED_TO_FIELD]: [
        { name: 'No id', parent_collection_id: 'trees', fields: [{ parent: 'a', child: 'b' }] },
        { id: 'r2', name: 'No parent', fields: [{ parent: 'a', child: 'b' }] },
        { id: 'r3', name: 'No fields', parent_collection_id: 'trees', fields: [{ parent: 'a' }] },
        { id: 'r4', parent_collection_id: 'trees', fields: [{ parent: 'a', child: 'b' }] }
      ]
    })

    expect(readCollectionRelatedTo(collection)).toEqual([
      { id: 'r4', name: '', parentCollectionId: 'trees', fields: [{ parent: 'a', child: 'b' }] }
    ])
  })
})
