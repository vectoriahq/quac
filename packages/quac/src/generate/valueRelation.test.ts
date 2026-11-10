import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { QUAC_PRIVATE_FIELD, readCollectionFieldValueRelations, readCollectionPrivate } from './normalizedProject.ts'
import { generateStacCatalogue } from './stacCatalogue.ts'
import { STAC_VERSION } from '../model/Stac.ts'
import { collectCatalogueCollections } from '../model/stacTreeWalk.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'
import fixtureXml from '../tests/fixtures/qgis/related-datasets/street-trees.qgs?raw'

import type { StacCollection } from '../model/Stac.ts'

const TREES_ID = 'street_trees_5b1d0a72_4e33_4c1a_9f6d_2c8b7a1e4d90'
const INSPECTIONS_ID = 'tree_inspections_0a4f9c81_7b26_4f55_8ad3_16e0f9b25c47'
const SPECIES_FIELD = '<field configurationFlags="NoFlag" name="species"/>'

/** The options QGIS writes for a Value Relation on the Inspections table, overridden by `options`. */
function widgetXml(options: Record<string, [type: string, value: string]> = {}): string {
  const all: Record<string, [string, string]> = {
    Layer: ['QString', INSPECTIONS_ID],
    LayerName: ['QString', 'Inspections'],
    LayerSource: ['QString', './tree-inspections.geojson'],
    LayerProviderName: ['QString', 'ogr'],
    Key: ['QString', 'inspection_id'],
    Value: ['QString', 'condition'],
    Group: ['QString', ''],
    DisplayGroupName: ['bool', 'false'],
    Description: ['QString', ''],
    AllowMulti: ['bool', 'false'],
    NofColumns: ['int', '1'],
    AllowNull: ['bool', 'false'],
    OrderByValue: ['bool', 'false'],
    OrderByKey: ['bool', 'true'],
    OrderByField: ['bool', 'false'],
    OrderByFieldName: ['QString', ''],
    OrderByDescending: ['bool', 'false'],
    FilterExpression: ['QString', ''],
    UseCompleter: ['bool', 'false'],
    CompleterMatchFlags: ['int', '1'],
    ...options
  }
  const entries = Object.entries(all)
    .map(([name, [type, value]]) => `<Option type="${type}" value="${value}" name="${name}"/>`)
    .join('')
  return `<field configurationFlags="NoFlag" name="species"><editWidget type="ValueRelation"><config><Option type="Map">${entries}</Option></config></editWidget></field>`
}

function withWidget(options?: Record<string, [string, string]>): string {
  return fixtureXml.replace(SPECIES_FIELD, widgetXml(options))
}

/** Ticks Private on the layer with `layerId`, as QGIS's Data Sources table does. */
function withPrivate(xml: string, layerId: string): string {
  const start = xml.indexOf(`<id>${layerId}</id>`)
  const flag = xml.indexOf('<Private>0</Private>', start)
  return xml.slice(0, flag) + '<Private>1</Private>' + xml.slice(flag + '<Private>0</Private>'.length)
}

function collectionsFrom(xml: string): Map<string, StacCollection> {
  const catalogue = generateStacCatalogue(parseQgsXml(xml))
  return new Map(collectCatalogueCollections(catalogue).map((collection) => [collection.id, collection]))
}

function speciesColumn(collection: StacCollection | undefined): Record<string, unknown> | undefined {
  const columns = (collection?.['table:columns'] ?? []) as Record<string, unknown>[]
  return columns.find((column) => column.name === 'species')
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

describe('a Value Relation widget in a QGIS project', () => {
  it('reads the widget\'s settings off the layer', () => {
    const project = parseQgsXml(withWidget({
      FilterExpression: ['QString', '&quot;condition&quot; != \'Poor\''],
      AllowNull: ['bool', 'true'],
      AllowMulti: ['bool', 'true'],
      OrderByDescending: ['bool', 'true']
    }))

    expect(project.layers.find((layer) => layer.id === TREES_ID)?.fieldValueRelations).toEqual({
      species: {
        layerId: INSPECTIONS_ID,
        layerName: 'Inspections',
        keyField: 'inspection_id',
        valueField: 'condition',
        filterExpression: '"condition" != \'Poor\'',
        allowNull: true,
        allowMulti: true,
        orderBy: 'key',
        orderField: null,
        descending: true
      }
    })
  })

  it('reads no widget from a field with another widget, or one missing its key or value field', () => {
    expect(parseQgsXml(fixtureXml).layers.find((layer) => layer.id === TREES_ID)?.fieldValueRelations).toEqual({})
    expect(parseQgsXml(withWidget({ Key: ['QString', ''] })).layers[0]!.fieldValueRelations).toEqual({})
    expect(parseQgsXml(withWidget({ Value: ['QString', ''] })).layers[0]!.fieldValueRelations).toEqual({})
  })

  it('orders by value ahead of the other fields, as QGIS does', () => {
    const order = (options: Record<string, [string, string]>) =>
      parseQgsXml(withWidget(options)).layers.find((layer) => layer.id === TREES_ID)?.fieldValueRelations.species

    expect(order({ OrderByKey: ['bool', 'false'], OrderByValue: ['bool', 'true'] })).toMatchObject({ orderBy: 'value', orderField: null })
    expect(order({
      OrderByKey: ['bool', 'false'],
      OrderByValue: ['bool', 'true'],
      OrderByField: ['bool', 'true'],
      OrderByFieldName: ['QString', 'inspected']
    })).toMatchObject({ orderBy: 'value', orderField: null })
    expect(order({
      OrderByKey: ['bool', 'false'],
      OrderByField: ['bool', 'true'],
      OrderByFieldName: ['QString', 'inspected']
    })).toMatchObject({ orderBy: 'field', orderField: 'inspected' })
  })

  it('orders by key where the order-by-field box names no field', () => {
    const project = parseQgsXml(withWidget({ OrderByKey: ['bool', 'false'], OrderByField: ['bool', 'true'] }))
    expect(project.layers.find((layer) => layer.id === TREES_ID)?.fieldValueRelations.species).toMatchObject({ orderBy: 'key', orderField: null })
  })
})

describe('quac:value_relation on a generated column', () => {
  it('names the lookup\'s Collection id, key and value, and nothing at its default', () => {
    const column = speciesColumn(collectionsFrom(withWidget()).get(TREES_ID))

    expect(column?.['quac:value_relation']).toEqual({
      collection: INSPECTIONS_ID,
      key: 'inspection_id',
      value: 'condition'
    })
  })

  it('writes the filter, Allow NULL, Allow multiple, the order and its direction where they are set', () => {
    const column = speciesColumn(collectionsFrom(withWidget({
      FilterExpression: ['QString', '&quot;condition&quot; != \'Poor\''],
      AllowNull: ['bool', 'true'],
      AllowMulti: ['bool', 'true'],
      OrderByKey: ['bool', 'false'],
      OrderByField: ['bool', 'true'],
      OrderByFieldName: ['QString', 'inspected'],
      OrderByDescending: ['bool', 'true']
    })).get(TREES_ID))

    expect(column?.['quac:value_relation']).toEqual({
      collection: INSPECTIONS_ID,
      key: 'inspection_id',
      value: 'condition',
      filter: '"condition" != \'Poor\'',
      allow_null: true,
      allow_multi: true,
      order_by: 'field',
      order_field: 'inspected',
      descending: true
    })
  })

  it('writes order_by value for a list ordered by its shown value', () => {
    const column = speciesColumn(collectionsFrom(withWidget({ OrderByKey: ['bool', 'false'], OrderByValue: ['bool', 'true'] })).get(TREES_ID))

    expect(column?.['quac:value_relation']).toMatchObject({ order_by: 'value' })
    expect(column?.['quac:value_relation']).not.toHaveProperty('order_field')
  })

  it('finds the lookup by its name where no layer has the id', () => {
    const column = speciesColumn(collectionsFrom(withWidget({ Layer: ['QString', 'renamed_in_another_project'] })).get(TREES_ID))

    expect(column?.['quac:value_relation']).toMatchObject({ collection: INSPECTIONS_ID })
  })

  it('finds the lookup by its id ahead of its name', () => {
    const column = speciesColumn(collectionsFrom(withWidget({ LayerName: ['QString', 'Street trees'] })).get(TREES_ID))

    expect(column?.['quac:value_relation']).toMatchObject({ collection: INSPECTIONS_ID })
  })

  it('writes none where the lookup is in no layer of the project', () => {
    const collections = collectionsFrom(withWidget({
      Layer: ['QString', 'gone'],
      LayerName: ['QString', 'Gone']
    }))

    expect(speciesColumn(collections.get(TREES_ID))).not.toHaveProperty('quac:value_relation')
  })

  it('writes none from a field with no Value Relation widget', () => {
    expect(speciesColumn(collectionsFrom(fixtureXml).get(TREES_ID))).not.toHaveProperty('quac:value_relation')
  })
})

describe('readCollectionFieldValueRelations', () => {
  it('reads back what the generator wrote', () => {
    const collection = collectionsFrom(withWidget({
      FilterExpression: ['QString', '&quot;condition&quot; != \'Poor\''],
      AllowNull: ['bool', 'true'],
      AllowMulti: ['bool', 'true'],
      OrderByKey: ['bool', 'false'],
      OrderByField: ['bool', 'true'],
      OrderByFieldName: ['QString', 'inspected'],
      OrderByDescending: ['bool', 'true']
    })).get(TREES_ID)!

    expect(readCollectionFieldValueRelations(collection)).toEqual({
      species: {
        collection: INSPECTIONS_ID,
        key: 'inspection_id',
        value: 'condition',
        filter: '"condition" != \'Poor\'',
        allow_null: true,
        allow_multi: true,
        order_by: 'field',
        order_field: 'inspected',
        descending: true
      }
    })
  })

  it('reads nothing from a Collection with no column declaring one', () => {
    expect(readCollectionFieldValueRelations(bareCollection({}))).toEqual({})
    expect(readCollectionFieldValueRelations(bareCollection({ 'table:columns': [{ name: 'species' }] }))).toEqual({})
    expect(readCollectionFieldValueRelations(bareCollection({ 'table:columns': 'species' }))).toEqual({})
  })

  it('drops an entry with no Collection id, key or value', () => {
    const column = (relation: unknown) => ({ name: 'species', 'quac:value_relation': relation })
    const collection = bareCollection({
      'table:columns': [
        column({ key: 'k', value: 'v' }),
        column({ collection: 'lookup', value: 'v' }),
        column({ collection: 'lookup', key: 'k' }),
        column('lookup')
      ]
    })

    expect(readCollectionFieldValueRelations(collection)).toEqual({})
  })

  it('reads an order it does not know, or a field order naming no field, as the key order', () => {
    const read = (extra: Record<string, unknown>) => readCollectionFieldValueRelations(bareCollection({
      'table:columns': [{ name: 'species', 'quac:value_relation': { collection: 'lookup', key: 'k', value: 'v', ...extra } }]
    })).species

    expect(read({ order_by: 'size' })).toEqual({ collection: 'lookup', key: 'k', value: 'v' })
    expect(read({ order_by: 'field' })).toEqual({ collection: 'lookup', key: 'k', value: 'v' })
    expect(read({ order_by: 'field', order_field: 'rank' })).toMatchObject({ order_by: 'field', order_field: 'rank' })
  })
})

describe('quac:private on a generated Collection', () => {
  it('is written for a layer whose Private flag is ticked, and for no other', () => {
    const collections = collectionsFrom(withPrivate(fixtureXml, INSPECTIONS_ID))

    expect(collections.get(INSPECTIONS_ID)?.[QUAC_PRIVATE_FIELD]).toBe(true)
    expect(collections.get(TREES_ID)).not.toHaveProperty(QUAC_PRIVATE_FIELD)
  })

  it('is read back by readCollectionPrivate', () => {
    const collections = collectionsFrom(withPrivate(fixtureXml, INSPECTIONS_ID))

    expect(readCollectionPrivate(collections.get(INSPECTIONS_ID)!)).toBe(true)
    expect(readCollectionPrivate(collections.get(TREES_ID)!)).toBe(false)
    expect(readCollectionPrivate(bareCollection({ [QUAC_PRIVATE_FIELD]: 'yes' }))).toBe(false)
  })

  it('is not written for a layer with no flags', () => {
    const noFlags = fixtureXml.replace(/<flags>[\s\S]*?<\/flags>/g, '')

    expect(collectionsFrom(noFlags).get(TREES_ID)).not.toHaveProperty(QUAC_PRIVATE_FIELD)
  })
})
