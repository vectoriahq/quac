import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { readCollectionFieldAttachments } from './normalizedProject'
import { generateStacCatalogue } from './stacCatalogue'
import { parseQgsXml } from '../parse/parseQgsXml'

import type { TableColumn } from '../model/Stac'

/**
 * QGIS's Attachment edit widget, which it registers as `ExternalResource`,
 * through to `quac:attachment` on the field's `table:columns` entry and
 * back out again.
 *
 * No `.qgs` in this repo has one, so the widget XML is authored here — the
 * same way `qgsMetadata.test.ts` authors the ValueMap widget no fixture has.
 * Its shape is the flat `<Option>` map the real QGIS-written `TextEdit` and
 * `CheckBox` configs use in `packages/quac/src/tests/fixtures/qgis/graffiti/graffiti.qgs`;
 * the key names and the two enumerations are cited beside
 * `parseFieldAttachments` in `packages/quac/src/parse/parseLayers.ts`.
 */

// A layer absent from the layer tree never reaches the catalogue.
const LAYER_TREE =
  '<layer-tree-group><layer-tree-layer id="inspections_1" checked="Qt::Checked" name="Inspections"/></layer-tree-group>'

function attachmentWidget(options: string): string {
  return `<editWidget type="ExternalResource"><config><Option type="Map">${options}</Option></config></editWidget>`
}

function projectWithFieldConfig(fieldConfigXml: string) {
  return parseQgsXml(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<qgis version="3.44.8-Solothurn" projectname="Attachments">'
    + '<title>Attachments</title>'
    + '<projectCrs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></projectCrs>'
    + '<projectlayers><maplayer type="vector" geometry="Point">'
    + '<id>inspections_1</id><layername>Inspections</layername>'
    + '<datasource>./inspections.geojson</datasource><provider>ogr</provider>'
    + '<srs><spatialrefsys><authid>EPSG:4326</authid></spatialrefsys></srs>'
    + `<fieldConfiguration>${fieldConfigXml}</fieldConfiguration>`
    + '</maplayer></projectlayers>'
    + LAYER_TREE
    + '</qgis>'
  )
}

function columnsFor(fieldConfigXml: string): TableColumn[] {
  const catalog = generateStacCatalogue(projectWithFieldConfig(fieldConfigXml))
  return catalog.collections![0]!['table:columns'] as TableColumn[]
}

function attachmentFor(fieldConfigXml: string, fieldName: string) {
  return columnsFor(fieldConfigXml).find((column) => column.name === fieldName)?.['quac:attachment']
}

const PHOTO_FIELD = `
  <field name="photo" configurationFlags="NoFlag">
    ${attachmentWidget(`
      <Option type="QString" value="photos" name="DefaultRoot"/>
      <Option type="int" value="1" name="DocumentViewer"/>
      <Option type="QString" value="Images (*.jpg *.jpeg *.png)" name="FileWidgetFilter"/>
      <Option type="int" value="1" name="RelativeStorage"/>
    `)}
  </field>`

const PLAIN_FIELD = `
  <field name="condition" configurationFlags="NoFlag">
    <editWidget type="TextEdit"><config><Option type="Map">
      <Option type="bool" value="false" name="IsMultiline"/>
    </Option></config></editWidget>
  </field>`

describe('quac:attachment on a table:columns entry', () => {
  it('carries every member the widget declares', () => {
    expect(attachmentFor(PHOTO_FIELD + PLAIN_FIELD, 'photo')).toEqual({
      viewer: 'image',
      filter: 'Images (*.jpg *.jpeg *.png)',
      default_root: 'photos',
      relative_storage: 'project'
    })
  })

  it('leaves a field with no Attachment widget undeclared', () => {
    const column = columnsFor(PHOTO_FIELD + PLAIN_FIELD).find((c) => c.name === 'condition')
    expect(column).toBeDefined()
    expect(column?.['quac:attachment']).toBeUndefined()
  })

  // DocumentViewer counts NoContent, Image, Web, Audio, Video from zero.
  it('reads DocumentViewer 2 as web', () => {
    const field = `<field name="photo" configurationFlags="NoFlag">${
      attachmentWidget('<Option type="int" value="2" name="DocumentViewer"/>')
    }</field>`
    expect(attachmentFor(field, 'photo')?.viewer).toBe('web')
  })

  it('writes no viewer for NoContent, which is a file the source does not show inline', () => {
    const field = `<field name="report" configurationFlags="NoFlag">${
      attachmentWidget('<Option type="int" value="0" name="DocumentViewer"/>')
    }</field>`
    const attachment = attachmentFor(field, 'report')
    expect(attachment).toBeDefined()
    expect(attachment?.viewer).toBeUndefined()
  })

  // QGIS writes an unset key as a value-less `<Option type="invalid">`, which
  // the CheckBox config in graffiti.qgs does for CheckedState.
  it('leaves a value-less option off rather than reading it as blank', () => {
    const field = `<field name="photo" configurationFlags="NoFlag">${
      attachmentWidget('<Option type="invalid" name="DefaultRoot"/><Option type="int" value="1" name="DocumentViewer"/>')
    }</field>`
    expect(attachmentFor(field, 'photo')).toEqual({ viewer: 'image', relative_storage: 'absolute' })
  })

  it('leaves a directory-picking widget undeclared, since an attachment is one file', () => {
    const field = `<field name="folder" configurationFlags="NoFlag">${
      attachmentWidget('<Option type="int" value="1" name="DocumentViewer"/><Option type="int" value="1" name="StorageMode"/>')
    }</field>`
    expect(attachmentFor(field, 'folder')).toBeUndefined()
  })

  it('declares a widget that saves one file, which is StorageMode 3', () => {
    const field = `<field name="photo" configurationFlags="NoFlag">${
      attachmentWidget('<Option type="int" value="1" name="DocumentViewer"/><Option type="int" value="3" name="StorageMode"/>')
    }</field>`
    expect(attachmentFor(field, 'photo')?.viewer).toBe('image')
  })

  it('falls back to absolute when the widget declares no RelativeStorage', () => {
    const field = `<field name="photo" configurationFlags="NoFlag">${
      attachmentWidget('<Option type="int" value="1" name="DocumentViewer"/>')
    }</field>`
    expect(attachmentFor(field, 'photo')?.relative_storage).toBe('absolute')
  })

  // The same trap parseFieldValueMaps guards: a saved alternate style embeds
  // its own <fieldConfiguration>, which can disagree with the layer's own and
  // comes first in document order here.
  it('reads the layer’s own field configuration, not a saved style’s decoy', () => {
    const project = parseQgsXml(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<qgis version="3.44.8-Solothurn"><title>Attachments</title>'
      + '<projectlayers><maplayer type="vector" geometry="Point">'
      + '<id>inspections_1</id><layername>Inspections</layername>'
      + '<datasource>./inspections.geojson</datasource><provider>ogr</provider>'
      + '<map-layer-style-manager current="default"><map-layer-style name="Archived"><qgis>'
      + `<fieldConfiguration><field name="photo" configurationFlags="NoFlag">${
        attachmentWidget('<Option type="QString" value="decoy" name="DefaultRoot"/>')
      }</field></fieldConfiguration>`
      + '</qgis></map-layer-style></map-layer-style-manager>'
      + `<fieldConfiguration>${PHOTO_FIELD}</fieldConfiguration>`
      + '</maplayer></projectlayers>'
      + LAYER_TREE
      + '</qgis>'
    )
    const columns = generateStacCatalogue(project).collections![0]!['table:columns'] as TableColumn[]
    expect(columns.find((c) => c.name === 'photo')?.['quac:attachment']?.default_root).toBe('photos')
  })
})

describe('readCollectionFieldAttachments', () => {
  it('reads back what the generator wrote', () => {
    const collection = generateStacCatalogue(projectWithFieldConfig(PHOTO_FIELD + PLAIN_FIELD)).collections![0]!
    expect(readCollectionFieldAttachments(collection)).toEqual({
      photo: {
        viewer: 'image',
        filter: 'Images (*.jpg *.jpeg *.png)',
        defaultRoot: 'photos',
        relativeStorage: 'project'
      }
    })
  })

  it('returns nothing for a Collection whose columns declare no attachment', () => {
    const collection = generateStacCatalogue(projectWithFieldConfig(PLAIN_FIELD)).collections![0]!
    expect(readCollectionFieldAttachments(collection)).toEqual({})
  })

  it('ignores a column whose attachment is an array rather than an object', () => {
    const collection = { 'table:columns': [{ name: 'photo', 'quac:attachment': [] }] } as never
    expect(readCollectionFieldAttachments(collection)).toEqual({})
  })

  // A catalogue written by somebody else can have anything under the key.
  it('falls back rather than trusting a viewer or relative_storage it does not know', () => {
    const collection = {
      'table:columns': [
        { name: 'photo', 'quac:attachment': { viewer: 'hologram', relative_storage: 'sideways' } }
      ]
    } as never
    expect(readCollectionFieldAttachments(collection)).toEqual({
      photo: { viewer: null, filter: null, defaultRoot: null, relativeStorage: 'absolute' }
    })
  })
})
