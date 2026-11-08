import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { readCollectionFormLayout } from './normalizedProject'
import { generateStacCatalogue } from './stacCatalogue'
import { parseQgsXml } from '../parse/parseQgsXml'
import { readQgisExpression } from '../parse/qgisExpression'

import type { StacCollection, TableColumn } from '../model/Stac'

/**
 * QGIS's Drag and Drop Designer form, through to `quac:form_order`,
 * `quac:visible_when` and `quac:in_form` and back out again. The container and
 * field elements carry the attributes QGIS writes (`QgsAttributeEditorContainer::saveConfiguration`
 * and `QgsAttributeEditorField::saveConfiguration`), as the `tablayout` form of
 * `tests/testdata/project_translation/points_translation.qgs` in `qgis/QGIS@master`
 * does: a Tab holding fields and a GroupBox.
 */

const LAYER_TREE =
  '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'

const FIELDS = ['asset_id', 'condition', 'notes', 'repair_notes', 'removed_on']

function fieldXml(name: string): string {
  return `<attributeEditorField horizontalStretch="0" index="${FIELDS.indexOf(name)}" name="${name}" showLabel="1" verticalStretch="0"/>`
}

function containerXml(
  name: string,
  type: 'Tab' | 'GroupBox' | 'Row',
  expression: { enabled: boolean, text: string },
  children: string
): string {
  const text = expression.text.replaceAll('"', '&quot;')
  return `<attributeEditorContainer collapsed="0" collapsedExpression="" collapsedExpressionEnabled="0" columnCount="1" groupBox="${type === 'GroupBox' ? 1 : 0}" horizontalStretch="0" name="${name}" showLabel="1" type="${type}" verticalStretch="0" visibilityExpression="${text}" visibilityExpressionEnabled="${expression.enabled ? 1 : 0}">${children}</attributeEditorContainer>`
}

const NO_EXPRESSION = { enabled: false, text: '' }

function layerXml(layout: string, tree: string): string {
  return '<fieldConfiguration>'
    + FIELDS.map((name) => `<field name="${name}" configurationFlags="NoFlag"><editWidget type="TextEdit"><config><Option/></config></editWidget></field>`).join('')
    + '</fieldConfiguration>'
    + `<editorlayout>${layout}</editorlayout>`
    + `<attributeEditorForm>${tree}</attributeEditorForm>`
}

function projectFor(layerBody: string) {
  return parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Form">'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + '<projectlayers><maplayer type="vector" geometry="Point">'
    + '<id>assets_1</id><layername>Assets</layername>'
    + '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + layerBody
    + '</maplayer></projectlayers>'
    + LAYER_TREE
    + '</qgis>'
  )
}

function collectionFor(layout: string, tree: string): StacCollection {
  return generateStacCatalogue(projectFor(layerXml(layout, tree))).collections![0]!
}

function column(collection: StacCollection, name: string): TableColumn {
  return (collection['table:columns'] as TableColumn[]).find((entry) => entry.name === name)!
}

const REPAIR_BOX = containerXml('Repair', 'GroupBox', { enabled: true, text: '"condition" = \'P\'' }, fieldXml('repair_notes'))

describe('a Drag and Drop Designer form', () => {
  it('writes the placed fields in the layout\'s order, and the expression of the box around a field', () => {
    const collection = collectionFor('tablayout', fieldXml('asset_id') + fieldXml('condition') + fieldXml('notes') + REPAIR_BOX + fieldXml('removed_on'))

    expect(collection['quac:form_order']).toEqual(['asset_id', 'condition', 'notes', 'repair_notes', 'removed_on'])
    expect(column(collection, 'repair_notes')['quac:visible_when']).toEqual(['"condition" = \'P\''])
    expect(column(collection, 'notes')['quac:visible_when']).toBeUndefined()
    expect(column(collection, 'notes')['quac:in_form']).toBeUndefined()
  })

  it('keeps the order of the layout where it differs from the order of the fields', () => {
    const collection = collectionFor('tablayout', fieldXml('notes') + fieldXml('asset_id'))

    expect(collection['quac:form_order']).toEqual(['notes', 'asset_id'])
  })

  it('chains the expressions of nested containers, outermost first', () => {
    const tree = containerXml(
      'Details',
      'Tab',
      { enabled: true, text: '"asset_id" IS NOT NULL' },
      fieldXml('asset_id')
      + containerXml('Poor', 'GroupBox', { enabled: true, text: '"condition" = \'P\'' }, fieldXml('repair_notes')
        + containerXml('Removed', 'Row', { enabled: true, text: '"notes" IS NOT NULL' }, fieldXml('removed_on')))
    )
    const collection = collectionFor('tablayout', tree + fieldXml('condition') + fieldXml('notes'))

    expect(column(collection, 'asset_id')['quac:visible_when']).toEqual(['"asset_id" IS NOT NULL'])
    expect(column(collection, 'repair_notes')['quac:visible_when']).toEqual(['"asset_id" IS NOT NULL', '"condition" = \'P\''])
    expect(column(collection, 'removed_on')['quac:visible_when']).toEqual(['"asset_id" IS NOT NULL', '"condition" = \'P\'', '"notes" IS NOT NULL'])
    expect(column(collection, 'condition')['quac:visible_when']).toBeUndefined()
  })

  it('lists no expression for a container without an enabled one, but still goes through it', () => {
    const tree = containerXml(
      'Details',
      'Tab',
      NO_EXPRESSION,
      containerXml('Poor', 'GroupBox', { enabled: true, text: '"condition" = \'P\'' }, fieldXml('repair_notes'))
      + containerXml('Left over', 'GroupBox', { enabled: false, text: '"condition" = \'G\'' }, fieldXml('notes'))
      + containerXml('Blank', 'GroupBox', { enabled: true, text: '  ' }, fieldXml('asset_id'))
    )
    const collection = collectionFor('tablayout', tree + fieldXml('condition') + fieldXml('removed_on'))

    expect(collection['quac:form_order']).toEqual(['repair_notes', 'notes', 'asset_id', 'condition', 'removed_on'])
    expect(column(collection, 'repair_notes')['quac:visible_when']).toEqual(['"condition" = \'P\''])
    expect(column(collection, 'notes')['quac:visible_when']).toBeUndefined()
    expect(column(collection, 'asset_id')['quac:visible_when']).toBeUndefined()
  })

  it('keeps an expression the reader cannot read, as QGIS wrote it', () => {
    const unreadable = 'geom_to_wkt($geometry) = \'POINT(0 0)\''
    expect(readQgisExpression(unreadable)).toBeNull()

    const collection = collectionFor('tablayout', fieldXml('asset_id') + containerXml('Odd', 'GroupBox', { enabled: true, text: unreadable }, fieldXml('notes')))

    expect(column(collection, 'notes')['quac:visible_when']).toEqual([unreadable])
    expect(readCollectionFormLayout(collection)?.fields.find((field) => field.name === 'notes')?.visibleWhen).toEqual([unreadable])
  })

  it('marks a field the layout does not place', () => {
    const collection = collectionFor('tablayout', fieldXml('asset_id') + fieldXml('condition'))

    expect(column(collection, 'notes')['quac:in_form']).toBe(false)
    expect(column(collection, 'repair_notes')['quac:in_form']).toBe(false)
    expect(column(collection, 'asset_id')['quac:in_form']).toBeUndefined()
    expect(readCollectionFormLayout(collection)?.unplaced).toEqual(['notes', 'repair_notes', 'removed_on'])
  })

  it('ignores relation editors and other elements, and keeps a field\'s first place', () => {
    const tree = '<attributeEditorRelation name="inspections" relation="r1" showLabel="1"/>'
      + '<attributeEditorTextElement name="Heading" showLabel="1"/>'
      + fieldXml('asset_id')
      + containerXml('Again', 'GroupBox', { enabled: true, text: '1 = 2' }, fieldXml('asset_id') + fieldXml('notes'))
    const collection = collectionFor('tablayout', tree)

    expect(collection['quac:form_order']).toEqual(['asset_id', 'notes'])
    expect(column(collection, 'asset_id')['quac:visible_when']).toBeUndefined()
    expect(column(collection, 'notes')['quac:visible_when']).toEqual(['1 = 2'])
  })
})

describe('a form that is not a Drag and Drop Designer form', () => {
  it.each(['generatedlayout', 'uifilelayout', ''])('ignores a saved tree under the %j layout', (layout) => {
    const collection = collectionFor(layout, fieldXml('asset_id') + REPAIR_BOX)

    expect(collection['quac:form_order']).toBeUndefined()
    for (const name of FIELDS) {
      expect(column(collection, name)['quac:visible_when']).toBeUndefined()
      expect(column(collection, name)['quac:in_form']).toBeUndefined()
    }
    expect(readCollectionFormLayout(collection)).toBeNull()
    expect(projectFor(layerXml(layout, REPAIR_BOX)).layers[0]!.formLayout).toBeNull()
  })

  it('ignores a layer with no editorlayout at all', () => {
    const body = layerXml('tablayout', REPAIR_BOX).replace('<editorlayout>tablayout</editorlayout>', '')

    expect(projectFor(body).layers[0]!.formLayout).toBeNull()
  })

  it('reads a tablayout with an empty tree as no layout, because QGIS then places every field', () => {
    const collection = collectionFor('tablayout', '')

    expect(collection['quac:form_order']).toBeUndefined()
    expect(column(collection, 'notes')['quac:in_form']).toBeUndefined()
  })
})

describe('readCollectionFormLayout', () => {
  it('round trips the order, the chains and the unplaced columns', () => {
    const collection = collectionFor('tablayout', fieldXml('notes') + REPAIR_BOX + fieldXml('asset_id'))

    expect(readCollectionFormLayout(collection)).toEqual({
      fields: [
        { name: 'notes', visibleWhen: [] },
        { name: 'repair_notes', visibleWhen: ['"condition" = \'P\''] },
        { name: 'asset_id', visibleWhen: [] }
      ],
      unplaced: ['condition', 'removed_on']
    })
  })

  it('reads the same layout after the Collection has been through JSON', () => {
    const collection = collectionFor('tablayout', fieldXml('asset_id') + REPAIR_BOX)

    expect(readCollectionFormLayout(JSON.parse(JSON.stringify(collection)) as StacCollection)).toEqual(readCollectionFormLayout(collection))
  })

  it('is null for a Collection with no layout', () => {
    expect(readCollectionFormLayout(collectionFor('generatedlayout', ''))).toBeNull()
    expect(readCollectionFormLayout({ 'quac:form_order': 'asset_id' } as unknown as StacCollection)).toBeNull()
  })

  it('skips what is not usable in a hand-written Collection', () => {
    const collection = {
      'quac:form_order': ['a', 3, '  ', 'a', 'b', 'c'],
      'table:columns': [
        { name: 'a', 'quac:visible_when': ['x = 1', '', 7, '  y = 2  '] },
        { name: 'b', 'quac:visible_when': 'x = 1' },
        { name: 'c', 'quac:in_form': false },
        { name: 'd', 'quac:in_form': false },
        { name: 'e', 'quac:in_form': true },
        null
      ]
    } as unknown as StacCollection

    expect(readCollectionFormLayout(collection)).toEqual({
      fields: [
        { name: 'a', visibleWhen: ['x = 1', 'y = 2'] },
        { name: 'b', visibleWhen: [] },
        { name: 'c', visibleWhen: [] }
      ],
      unplaced: ['d']
    })
  })
})
