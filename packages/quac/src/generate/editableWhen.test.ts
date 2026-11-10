import '../tests/linkedomDomParser.ts'

import { describe, expect, it } from 'vitest'

import { readCollectionFormLayout } from './normalizedProject.ts'
import { generateStacCatalogue } from './stacCatalogue.ts'
import { parseQgsXml } from '../parse/parseQgsXml.ts'

import type { StacCollection, TableColumn } from '../model/Stac.ts'

/**
 * A field's data-defined Editable property, from the `<dataDefinedFieldProperties>`
 * block QGIS writes (`QgsEditFormConfig::writeXml`) through to `quac:editable_when`
 * and back out again. The block is written from `QgsPropertyCollection::toVariant`
 * and `QgsProperty::toVariant`, `qgis/QGIS@master` (`Static` 1, `Field` 2, `Expression` 3).
 */

const FIELDS = ['installed', 'last_inspected', 'notes']

function placed(name: string): string {
  return `<attributeEditorField horizontalStretch="0" index="${FIELDS.indexOf(name)}" name="${name}" showLabel="1" verticalStretch="0"/>`
}

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function property(options: { active?: boolean, type: number, key?: 'val' | 'field' | 'expression', value?: string }): string {
  const { active = true, type, key, value = '' } = options
  return '<Option type="Map" name="dataDefinedEditable">'
    + `<Option type="bool" value="${active}" name="active"/>`
    + (key ? `<Option type="QString" value="${escape(value)}" name="${key}"/>` : '')
    + `<Option type="int" value="${type}" name="type"/>`
    + '</Option>'
}

function dataDefined(name: string, inner: string): string {
  return `<field name="${name}"><Option type="Map"><Option type="QString" value="" name="name"/>`
    + `<Option type="Map" name="properties">${inner}</Option>`
    + '<Option type="QString" value="collection" name="type"/></Option></field>'
}

function collectionFor(layout: string, tree: string, block: string): StacCollection {
  const body = '<fieldConfiguration>'
    + FIELDS.map((name) => `<field name="${name}" configurationFlags="NoFlag"><editWidget type="TextEdit"><config><Option/></config></editWidget></field>`).join('')
    + '</fieldConfiguration>'
    + `<editorlayout>${layout}</editorlayout>`
    + `<attributeEditorForm>${tree}</attributeEditorForm>`
    + `<dataDefinedFieldProperties>${block}</dataDefinedFieldProperties>`
  const project = parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Form">'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + '<projectlayers><maplayer type="vector" geometry="Point">'
    + '<id>assets_1</id><layername>Assets</layername>'
    + '<datasource>./assets.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + body
    + '</maplayer></projectlayers>'
    + '<layer-tree-group><layer-tree-layer id="assets_1" checked="Qt::Checked" name="Assets"/></layer-tree-group>'
    + '</qgis>'
  )
  return generateStacCatalogue(project).collections![0]!
}

const TREE = FIELDS.map(placed).join('')

function editableWhen(collection: StacCollection, name: string): unknown {
  return (collection['table:columns'] as TableColumn[]).find((column) => column.name === name)?.['quac:editable_when']
}

describe('a field\'s data-defined Editable property', () => {
  it('writes an expression as it was written', () => {
    const collection = collectionFor('tablayout', TREE, dataDefined('installed', property({ type: 3, key: 'expression', value: '"last_inspected" IS NULL' })))

    expect(editableWhen(collection, 'installed')).toBe('"last_inspected" IS NULL')
    expect(editableWhen(collection, 'notes')).toBeUndefined()
  })

  it('writes a field-type property as the field in double quotes', () => {
    const collection = collectionFor('tablayout', TREE, dataDefined('installed', property({ type: 2, key: 'field', value: 'notes' })))

    expect(editableWhen(collection, 'installed')).toBe('"notes"')
  })

  it.each([
    ['true', 'true'],
    ['false', 'false'],
    ['FALSE', 'false'],
    ['0', 'false'],
    ['1', 'true'],
    ['', 'false']
  ])('writes a static value of %j as %s', (val, expected) => {
    const collection = collectionFor('tablayout', TREE, dataDefined('installed', property({ type: 1, key: 'val', value: val })))

    expect(editableWhen(collection, 'installed')).toBe(expected)
  })

  it('leaves out a property that is inactive, of an unknown type, or empty', () => {
    const block = dataDefined('installed', property({ active: false, type: 3, key: 'expression', value: '1 = 1' }))
      + dataDefined('last_inspected', property({ type: 0 }))
      + dataDefined('notes', property({ type: 3, key: 'expression', value: '  ' }))
    const collection = collectionFor('tablayout', TREE, block)

    for (const name of FIELDS) expect(editableWhen(collection, name)).toBeUndefined()
  })

  it('reads only the Editable property, not Alias or Custom comment', () => {
    const alias = '<Option type="Map" name="dataDefinedAlias"><Option type="bool" value="true" name="active"/><Option type="QString" value="1 = 2" name="expression"/><Option type="int" value="3" name="type"/></Option>'
    const collection = collectionFor('tablayout', TREE, dataDefined('installed', alias))

    expect(editableWhen(collection, 'installed')).toBeUndefined()
  })

  it('ignores a generated form, and a Drag and Drop Designer form with no fields', () => {
    const block = dataDefined('installed', property({ type: 3, key: 'expression', value: '1 = 2' }))

    expect(editableWhen(collectionFor('generatedlayout', TREE, block), 'installed')).toBeUndefined()
    expect(editableWhen(collectionFor('tablayout', '', block), 'installed')).toBeUndefined()
  })

  it('ignores a field the form does not place', () => {
    const block = dataDefined('notes', property({ type: 3, key: 'expression', value: '1 = 2' }))
    const collection = collectionFor('tablayout', placed('installed'), block)

    expect(editableWhen(collection, 'notes')).toBeUndefined()
  })

  it('reads back through the layout, and through JSON', () => {
    const block = dataDefined('installed', property({ type: 3, key: 'expression', value: '"last_inspected" IS NULL' }))
      + dataDefined('notes', property({ type: 1, key: 'val', value: 'false' }))
    const collection = collectionFor('tablayout', TREE, block)
    const expected = [
      { name: 'installed', visibleWhen: [], editableWhen: '"last_inspected" IS NULL' },
      { name: 'last_inspected', visibleWhen: [] },
      { name: 'notes', visibleWhen: [], editableWhen: 'false' }
    ]

    expect(readCollectionFormLayout(collection)?.fields).toEqual(expected)
    expect(readCollectionFormLayout(JSON.parse(JSON.stringify(collection)) as StacCollection)?.fields).toEqual(expected)
  })

  it('skips an entry that is not text in a hand-written Collection', () => {
    const collection = {
      'quac:form_order': ['a', 'b'],
      'table:columns': [{ name: 'a', 'quac:editable_when': 7 }, { name: 'b', 'quac:editable_when': '  ' }]
    } as unknown as StacCollection

    expect(readCollectionFormLayout(collection)?.fields).toEqual([{ name: 'a', visibleWhen: [] }, { name: 'b', visibleWhen: [] }])
  })
})
