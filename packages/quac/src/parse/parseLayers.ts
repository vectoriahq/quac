import { readCustomPropertyList } from './customProperties.ts'
import { parseDataSource } from './parseDataSource.ts'
import { parseFormLayout } from './parseFormLayout.ts'
import { parseQfieldSyncLocks } from './parseQfieldSync.ts'
import { parseLayerStyles } from './parseStyle.ts'
import { readQgisExpression, unescapeStringLiteral } from './qgisExpression.ts'
import { resolveFieldIconAddress } from '../model/fieldIconAddress.ts'
import { devLog } from '../util/devLog.ts'

import type {
  BoundingBox,
  FieldAttachment,
  FieldConstraintExpression,
  FieldControl,
  FieldDefaultValue,
  FieldEditRule,
  FieldFixedValue,
  FieldRange,
  FieldUuidFormat,
  FieldValueMapEntry,
  FieldValueRelation,
  LayerAttribution,
  LayerContact,
  LayerEntry,
  LayerResourceMetadata,
  LayerScaleRange,
  ServerHiddenFields
} from '../model/QgsProject.ts'

/**
 * Parses the <projectlayers> block into a list of LayerEntry. Annotation
 * layers (<main-annotation-layer>) are filtered out — they're QGIS's drawing
 * layer, not real data.
 *
 * Each <maplayer> has the shape:
 *   <maplayer type="vector" geometry="Point" hasScaleBasedVisibilityFlag="0"
 *             minScale="..." maxScale="..." ...>
 *     <id>...</id>
 *     <datasource>...</datasource>
 *     <layername>...</layername>
 *     <provider>ogr</provider>            ← optional, used as a hint
 *     <srs><spatialrefsys><authid>EPSG:4326</authid>...
 *     <extent><xmin>...</xmin>...</extent>
 *     ...
 *     <renderer-v2 ...> ← inline symbology, captured by parseStyle
 *   </maplayer>
 *
 * On any per-layer failure the layer is skipped (logged via devLog) so a
 * single bad layer doesn't take down the whole project.
 */
export function parseProjectLayers(qgisRoot: Element): LayerEntry[] {
  const projectLayers = qgisRoot.querySelector('projectlayers')
  if (!projectLayers) return []

  const layers: LayerEntry[] = []
  for (const node of Array.from(projectLayers.children)) {
    if (node.tagName !== 'maplayer') continue
    try {
      const layer = parseMapLayer(node)
      if (layer) layers.push(layer)
    } catch (err) {
      devLog('qgs/parseLayers', 'failed to parse a maplayer; skipping', {
        error: String(err),
        id: node.querySelector('id')?.textContent ?? '<unknown>'
      })
    }
  }
  return layers
}

function parseMapLayer(maplayer: Element): LayerEntry | null {
  const id = maplayer.querySelector('id')?.textContent?.trim()
  const name = maplayer.querySelector('layername')?.textContent?.trim() ?? ''
  if (!id) return null

  const type = maplayer.getAttribute('type') ?? ''
  const geometryType = maplayer.getAttribute('geometry') || null
  const wkbType = maplayer.getAttribute('wkbType') || null

  const crs = maplayer.querySelector('srs spatialrefsys authid')?.textContent?.trim() || null
  const extent = parseBoundingBox(maplayer, 'extent')
  const wgs84Extent = parseBoundingBox(maplayer, 'wgs84extent')

  const datasourceText = directChildText(maplayer, 'datasource') ?? ''
  const providerHint = directChildText(maplayer, 'provider') ?? null
  const dataSource = parseDataSource(datasourceText, providerHint)

  const fieldNames = parseFieldNames(maplayer)
  const fieldAliases = parseFieldAliases(maplayer)
  const { styles, activeIndex } = parseLayerStyles(maplayer)

  return {
    id,
    name,
    type,
    geometryType,
    wkbType,
    shortName: directChildText(maplayer, 'shortname') || null,
    crs,
    extent,
    wgs84Extent,
    dataSource,
    displayField: parseDisplayField(maplayer),
    // isVisible is set later by parseQgsXml after the layer tree is parsed,
    // since visibility flows from the layer-tree-layer's `checked` attribute
    // (and parent groups), not from the maplayer itself.
    isVisible: true,
    queryable: parseQueryable(maplayer),
    opacity: parseOpacity(maplayer),
    editable: maplayer.getAttribute('readOnly') !== '1',
    fieldNames,
    fieldAliases,
    ...serverHiddenFieldsOf(maplayer),
    styles,
    activeStyleIndex: activeIndex,
    resourceMetadata: parseLayerResourceMetadata(maplayer),
    attribution: parseLayerAttribution(maplayer),
    fieldValueMaps: parseFieldValueMaps(maplayer),
    isPrivate: parsePrivate(maplayer),
    legendImage: parseLegendImage(maplayer),
    fieldValueRelations: parseFieldValueRelations(maplayer),
    fieldAttachments: parseFieldAttachments(maplayer),
    fieldEditRules: parseFieldEditRules(maplayer),
    icon: parseLayerIcon(maplayer),
    fieldIcons: parseFieldIcons(maplayer),
    fieldControls: parseFieldControls(maplayer),
    formLayout: parseFormLayout(maplayer),
    scaleRange: parseScaleRange(maplayer),
    locks: parseQfieldSyncLocks(maplayer),
    rawXml: new XMLSerializer().serializeToString(maplayer)
  }
}

/**
 * The fields QGIS Server hides from WMS and from WFS. QGIS saves each field's
 * choice as `configurationFlags` on its `<fieldConfiguration><field>`, holding
 * `HideFromWms` and `HideFromWfs` joined by `|`, and a project saved by QGIS
 * 3.14 or older as the lists `<excludeAttributesWMS>` and
 * `<excludeAttributesWFS>` of `<attribute>` names, which QGIS still reads and
 * adds to the flags (`QgsVectorLayer::readSymbology`,
 * `src/core/vector/qgsvectorlayer.cpp`, `qgis/QGIS@master` at `ec40788`, read
 * 2026-11-06). Only the layer's own blocks are read, never a saved style's.
 */
function serverHiddenFieldsOf(maplayer: Element): { serverHiddenFields?: ServerHiddenFields } {
  const wms = new Set<string>()
  const wfs = new Set<string>()
  for (const [name, field] of layerFields(maplayer)) {
    const flags = configurationFlagsOf(field)
    if (flags.includes('HideFromWms')) wms.add(name)
    if (flags.includes('HideFromWfs')) wfs.add(name)
  }
  for (const [element, into] of [['excludeAttributesWMS', wms], ['excludeAttributesWFS', wfs]] as const) {
    for (const attribute of directChild(maplayer, element)?.querySelectorAll(':scope > attribute') ?? []) {
      const name = attribute.textContent?.trim()
      if (name) into.add(name)
    }
  }
  if (wms.size === 0 && wfs.size === 0) return {}
  return { serverHiddenFields: { wms: [...wms], wfs: [...wfs] } }
}

/**
 * Reads a `<resourceMetadata>` block — a direct child of `<maplayer>`, sibling
 * to `<srs>`. Both `<maplayer>` elements in
 * `packages/quac/src/tests/fixtures/qgis/graffiti/graffiti.qgs` have one, empty fields and
 * all; an absent block (a layer saved by something other than QGIS) reads the
 * same as one with nothing filled in.
 *
 * `license` reads the first non-blank `<license>` element: QGIS writes each
 * licence as its own sibling element under `<resourceMetadata>` rather than a
 * wrapper holding several (`QgsLayerMetadata::writeMetadataXml`,
 * `src/core/metadata/qgslayermetadata.cpp`, `qgis/QGIS@master`, read
 * 2026-08-12) — this repo's fixtures never populate one, so the element name
 * is checked against that source rather than a sample file.
 */
function parseLayerResourceMetadata(maplayer: Element): LayerResourceMetadata {
  const block = directChild(maplayer, 'resourceMetadata')
  if (!block) {
    return { abstract: null, license: null, keywords: [], contacts: [], temporalInterval: null }
  }

  const abstractText = directChildText(block, 'abstract')
  const license = Array.from(block.querySelectorAll(':scope > license'))
    .map((node) => node.textContent?.trim() ?? '')
    .find((text) => text.length > 0) ?? null

  const keywords: string[] = []
  const seenKeywords = new Set<string>()
  for (const keyword of block.querySelectorAll(':scope > keywords > keyword')) {
    const text = keyword.textContent?.trim()
    if (!text || seenKeywords.has(text)) continue
    seenKeywords.add(text)
    keywords.push(text)
  }

  const contacts: LayerContact[] = []
  for (const contact of block.querySelectorAll(':scope > contact')) {
    const contactName = directChildText(contact, 'name') ?? ''
    const organization = directChildText(contact, 'organization') ?? ''
    const email = directChildText(contact, 'email') ?? ''
    if (!contactName && !organization) continue
    contacts.push({ name: contactName, organization, email })
  }

  return {
    abstract: abstractText && abstractText.length > 0 ? abstractText : null,
    license,
    keywords,
    contacts,
    temporalInterval: parseResourceMetadataTemporal(block)
  }
}

/**
 * Reads `<resourceMetadata><extent><temporal>`'s declared range: a
 * `<period><start>`/`<end>` — the shape `graffiti.qgs` writes, empty — or a
 * single `<instant>` read as both ends of the interval. No fixture in this
 * repo has an `<instant>`, so that alternative is checked instead against
 * `QgsLayerMetadata::writeMetadataXml` (`src/core/metadata/qgslayermetadata.cpp`,
 * `qgis/QGIS@master`, read 2026-08-12), which writes one or the other. Null
 * when the block declares neither, or declares them blank.
 */
function parseResourceMetadataTemporal(block: Element): [string | null, string | null] | null {
  const temporal = block.querySelector(':scope > extent > temporal')
  if (!temporal) return null

  const period = directChild(temporal, 'period')
  if (period) {
    const start = directChildText(period, 'start')
    const end = directChildText(period, 'end')
    if (!start && !end) return null
    return [start || null, end || null]
  }

  const instant = directChildText(temporal, 'instant')
  return instant ? [instant, instant] : null
}

/**
 * Reads `<attribution href="...">text</attribution>` — a direct child of
 * `<maplayer>`, separate from `<resourceMetadata>` (verified against
 * a saved QGIS project, where it sits alongside
 * `<resourceMetadata>` and `<provider>`). Null when the layer declares none.
 */
function parseLayerAttribution(maplayer: Element): LayerAttribution | null {
  const node = directChild(maplayer, 'attribution')
  const text = node?.textContent?.trim()
  if (!text) return null
  const href = node?.getAttribute('href')?.trim()
  return { text, href: href && href.length > 0 ? href : null }
}

/** `QgsValueMapFieldFormatter::NULL_VALUE`: the stored value of a value map's blank entry. */
const VALUE_MAP_NULL_CODE = '{2839923C-8B7D-419E-B84B-CA2FE9B80EC7}'

/**
 * Reads every field's ValueMap edit widget into its picklist, keyed by field
 * name. QGIS 3.x writes a widget's config as a generic `<Option>` tree
 * (verified in this project's own fixtures, e.g.
 * a saved QGIS project's `TextEdit`/`CheckBox` field
 * configs); for `ValueMap` specifically, each entry is a nested
 * `<Option type="Map">` holding one `<Option>` whose `name` is the display
 * label and `value` is what QGIS stores
 * (`QgsValueMapConfigDlg`, `src/gui/editorwidgets/qgsvaluemapconfigdlg.cpp`,
 * `qgis/QGIS@master`, read 2026-08-12 — no fixture in this repo has a
 * ValueMap widget to check the shape against directly):
 *
 *   <editWidget type="ValueMap">
 *     <config>
 *       <Option type="Map">
 *         <Option type="List" name="map">
 *           <Option type="Map">
 *             <Option type="QString" name="Waiting" value="waiting"/>
 *           </Option>
 *         </Option>
 *       </Option>
 *     </config>
 *   </editWidget>
 *
 * Older projects write the map flat instead, as one `<Option type="Map"
 * name="map">` whose children are the entries; QGIS reads both
 * (`QgsValueMapFieldFormatter::representValue`,
 * `src/core/fieldformatter/qgsvaluemapfieldformatter.cpp`, read 2026-10-23).
 *
 * QGIS writes the blank entry's value as the fixed code
 * `QgsValueMapFieldFormatter::NULL_VALUE` (same file); it is read as an empty
 * string, the blank choice's label.
 *
 * A field with no ValueMap widget, or one with no entries, is absent from the
 * returned map.
 */
function parseFieldValueMaps(maplayer: Element): Record<string, FieldValueMapEntry[]> {
  const result: Record<string, FieldValueMapEntry[]> = {}
  for (const [name, editWidget] of layerEditWidgets(maplayer)) {
    if (result[name]) continue

    if (editWidget?.getAttribute('type') !== 'ValueMap') continue

    const mapList = editWidget.querySelector(':scope > config > Option[type="Map"] > Option[type="List"][name="map"]')
    const flatMap = editWidget.querySelector(':scope > config > Option[type="Map"] > Option[type="Map"][name="map"]')
    const options = mapList
      ? mapList.querySelectorAll(':scope > Option[type="Map"] > Option')
      : flatMap?.querySelectorAll(':scope > Option') ?? []

    const entries: FieldValueMapEntry[] = []
    for (const entry of options) {
      const label = entry.getAttribute('name')
      const value = entry.getAttribute('value')
      if (label && value !== null) entries.push({ value: value === VALUE_MAP_NULL_CODE ? '' : value, label })
    }
    if (entries.length > 0) result[name] = entries
  }
  return result
}

/**
 * Reads every field's Value Relation edit widget, keyed by field name. QGIS
 * writes the widget's config as the same flat `<Option>` map the `TextEdit`
 * and `CheckBox` widgets use (`QgsValueRelationConfigDlg::config`,
 * `src/gui/editorwidgets/qgsvaluerelationconfigdlg.cpp`, `qgis/QGIS@master`,
 * read 2026-10-24):
 *
 *   <editWidget type="ValueRelation">
 *     <config>
 *       <Option type="Map">
 *         <Option type="QString" value="asset_types_1" name="Layer"/>
 *         <Option type="QString" value="Asset types" name="LayerName"/>
 *         <Option type="QString" value="name" name="Key"/>
 *         <Option type="QString" value="name" name="Value"/>
 *         <Option type="bool" value="false" name="AllowNull"/>
 *         <Option type="bool" value="true" name="OrderByValue"/>
 *       </Option>
 *     </config>
 *   </editWidget>
 *
 * The lookup is named by `Layer` (its id) and `LayerName`; a widget naming
 * neither, or with no `Key` or no `Value`, is skipped, since no list can come
 * from it. The order follows the formatter's: `OrderByValue` first, then
 * `OrderByField` where it names a field, and the key otherwise
 * (`QgsValueRelationFieldFormatter::createCache`,
 * `src/core/fieldformatter/qgsvaluerelationfieldformatter.cpp`, same commit).
 * `Group`, `DisplayGroupName`, `Description`, `NofColumns`, `UseCompleter` and
 * `CompleterMatchFlags` are not read.
 *
 * A field with no ValueRelation widget is absent from the returned map.
 */
function parseFieldValueRelations(maplayer: Element): Record<string, FieldValueRelation> {
  const result: Record<string, FieldValueRelation> = {}
  for (const [name, editWidget] of layerEditWidgets(maplayer)) {
    if (result[name]) continue

    if (editWidget?.getAttribute('type') !== 'ValueRelation') continue

    const options = readOptionMap(editWidget)

    const layerId = readTrimmedOption(options, 'Layer') ?? ''
    const layerName = readTrimmedOption(options, 'LayerName') ?? ''
    const keyField = readTrimmedOption(options, 'Key')
    const valueField = readTrimmedOption(options, 'Value')
    if ((!layerId && !layerName) || !keyField || !valueField) continue

    const orderField = readFlag(options, 'OrderByField') ? readTrimmedOption(options, 'OrderByFieldName') : null
    result[name] = {
      layerId,
      layerName,
      keyField,
      valueField,
      filterExpression: readTrimmedOption(options, 'FilterExpression') ?? '',
      allowNull: readFlag(options, 'AllowNull'),
      allowMulti: readFlag(options, 'AllowMulti'),
      orderBy: readFlag(options, 'OrderByValue') ? 'value' : orderField ? 'field' : 'key',
      orderField: readFlag(options, 'OrderByValue') ? null : orderField,
      descending: readFlag(options, 'OrderByDescending')
    }
  }
  return result
}

/**
 * QGIS's `DocumentViewerContent`, by its own order from zero
 * (`src/gui/qgsexternalresourcewidget.h`, `qgis/QGIS@master`, read
 * 2026-08-29). `NoContent` is index 0 and reads as null.
 */
const DOCUMENT_VIEWERS: FieldAttachment['viewer'][] = [null, 'image', 'web', 'audio', 'video']

/**
 * QGIS's `QgsFileWidget::RelativeStorage`, by its own order from zero
 * (`src/gui/qgsfilewidget.h`, same commit).
 */
const RELATIVE_STORAGE: FieldAttachment['relativeStorage'][] = ['absolute', 'project', 'default-root']

/**
 * The `QgsFileWidget::StorageMode` values that pick one file — `GetFile` and
 * `SaveFile`, indices 0 and 3 of `GetFile, GetDirectory, GetMultipleFiles,
 * SaveFile` (`src/gui/qgsfilewidget.h`, same commit). A widget set to either
 * of the other two stores a directory or a list, neither of which is the
 * single path `quac:attachment` declares.
 */
const SINGLE_FILE_STORAGE_MODES = new Set([0, 3])

/**
 * Reads every field's Attachment edit widget into what the catalogue records,
 * keyed by field name. QGIS registers the widget as `ExternalResource`
 * (`QgsEditorWidgetRegistry::initEditors`,
 * `src/gui/editorwidgets/core/qgseditorwidgetregistry.cpp`, `qgis/QGIS@master`,
 * read 2026-08-29) and writes its config as the same flat `<Option>` map the
 * `TextEdit` and `CheckBox` widgets use in
 * `packages/quac/src/tests/fixtures/qgis/graffiti/graffiti.qgs`:
 *
 *   <editWidget type="ExternalResource">
 *     <config>
 *       <Option type="Map">
 *         <Option type="QString" value="photos" name="DefaultRoot"/>
 *         <Option type="int" value="1" name="DocumentViewer"/>
 *         <Option type="int" value="1" name="RelativeStorage"/>
 *       </Option>
 *     </config>
 *   </editWidget>
 *
 * The widget writes more keys than these four; the rest are left behind
 * and the catalogue does not carry them. A value-less `<Option type="invalid">`,
 * which QGIS writes for an unset key, is skipped rather than read as blank.
 * A widget whose `StorageMode` picks a directory or several files is not an
 * attachment here.
 *
 * A field with no ExternalResource widget is absent from the returned map.
 */
function parseFieldAttachments(maplayer: Element): Record<string, FieldAttachment> {
  const result: Record<string, FieldAttachment> = {}
  for (const [name, editWidget] of layerEditWidgets(maplayer)) {
    if (result[name]) continue

    if (editWidget?.getAttribute('type') !== 'ExternalResource') continue

    const options = readOptionMap(editWidget)

    const storageMode = options.get('StorageMode')
    if (storageMode !== undefined && !SINGLE_FILE_STORAGE_MODES.has(Number(storageMode))) continue

    result[name] = {
      viewer: DOCUMENT_VIEWERS[Number(options.get('DocumentViewer'))] ?? null,
      filter: readTrimmedOption(options, 'FileWidgetFilter'),
      defaultRoot: readTrimmedOption(options, 'DefaultRoot'),
      relativeStorage: RELATIVE_STORAGE[Number(options.get('RelativeStorage'))] ?? 'absolute'
    }
  }
  return result
}

/**
 * The default-value expressions read as `now`, compared with spaces removed
 * and in lower case. `$now` is QGIS's older spelling of `now()`.
 */
const NOW_EXPRESSIONS = new Set(['now()', '$now', 'to_date(now())', 'to_datetime(now())'])

/**
 * Reads the Attributes Form settings the catalogue records for every field, keyed
 * by field name. QGIS writes them as blocks of the layer's own, shown here as
 * `packages/quac/src/tests/fixtures/qgis/graffiti/graffiti.qgs` writes them:
 *
 *   <fieldConfiguration>
 *     <field name="date_report"><editWidget type="Hidden">…</editWidget></field>
 *   </fieldConfiguration>
 *   <defaults>
 *     <default field="date_report" expression="" applyOnUpdate="0"/>
 *   </defaults>
 *   <constraints>
 *     <constraint field="date_report" constraints="0" notnull_strength="0" unique_strength="0" exp_strength="0"/>
 *   </constraints>
 *   <editable>
 *     <field editable="1" name="date_report"/>
 *   </editable>
 *   <reuseLastValuePolicy>
 *     <field name="date_report" reuseLastValuePolicy="AllowedDefaultOn"/>
 *   </reuseLastValuePolicy>
 *   <duplicatePolicies>
 *     <policy field="date_report" policy="DefaultValue"/>
 *   </duplicatePolicies>
 *   <constraintExpressions>
 *     <constraint field="date_report" exp="" desc=""/>
 *   </constraintExpressions>
 *
 * A default is kept as a `defaultValue` where `parseDefaultExpression` reads it,
 * as a `defaultExpression` where only `readQgisExpression` does, and otherwise
 * left out. A constraint expression follows the same rule. A field the
 * `<editable>` block does not list is editable. A field with none of these
 * settings is absent from the returned map.
 */
function parseFieldEditRules(maplayer: Element): Record<string, FieldEditRule> {
  const result: Record<string, FieldEditRule> = {}
  const ruleFor = (name: string): FieldEditRule => {
    result[name] ??= { readOnly: false, defaultValue: null, notNull: null, unique: null, hidden: false, reuseLastValue: false, duplicatePolicy: null }
    return result[name]
  }

  // Scoped to the layer's own blocks, as the field configuration is above: a
  // saved alternate style embeds its own copies.
  const fieldsWithExpression = new Set<string>()
  for (const node of directChild(maplayer, 'defaults')?.querySelectorAll(':scope > default') ?? []) {
    const name = node.getAttribute('field')
    const expression = node.getAttribute('expression') ?? ''
    if (!name || !expression.trim()) continue
    fieldsWithExpression.add(name)
    const onUpdate = node.getAttribute('applyOnUpdate') === '1'
    const defaultValue = parseDefaultExpression(expression, onUpdate)
    if (defaultValue) ruleFor(name).defaultValue = defaultValue
    else if (readQgisExpression(expression, { geometry: true, aggregates: true, lookups: true })) ruleFor(name).defaultExpression = { expression: expression.trim(), onUpdate }
  }

  // The UUID Generator widget disables its line edit and fills a null field
  // with `QUuid::createUuid().toString()`, which has braces
  // (`QgsUuidWidgetWrapper`, `src/gui/editorwidgets/qgsuuidwidgetwrapper.cpp`,
  // `qgis/QGIS@master`, read 2026-10-23). A default expression fills the field
  // first, so the widget's identifier stands only where there is none. The
  // widget's shortening to a string field's declared length is not followed:
  // a `.qgs` file does not carry a WFS field's length.
  const seenWidgets = new Set<string>()
  const allowNullOff = new Set<string>()
  for (const [name, field] of layerFields(maplayer)) {
    if (seenWidgets.has(name)) continue
    seenWidgets.add(name)
    const widgetType = directChild(field, 'editWidget')?.getAttribute('type')
    if (widgetType === 'Hidden') ruleFor(name).hidden = true
    // The Fields tab's Not searchable, which QGIS's search of the active
    // layer's features skips (`QgsActiveLayerFeaturesLocatorFilter`,
    // `src/app/locator/qgsactivelayerfeatureslocatorfilter.cpp`,
    // `qgis/QGIS@master`, read 2026-11-11).
    if (configurationFlagsOf(field).includes('NotSearchable')) ruleFor(name).notSearchable = true
    // The widget has no settings of its own (`QgsColorWidgetFactory::configWidget`,
    // `src/gui/editorwidgets/qgscolorwidgetfactory.cpp`, `qgis/QGIS@master`,
    // read 2026-10-25).
    if (widgetType === 'Color') ruleFor(name).colour = true
    if (widgetType === 'CheckBox' || widgetType === 'Range' || widgetType === 'DateTime') {
      readWidgetOptions(field, name, widgetType, ruleFor, allowNullOff)
    }
    if (widgetType === 'UuidGenerator') {
      const rule = ruleFor(name)
      rule.readOnly = true
      if (!fieldsWithExpression.has(name)) rule.defaultValue = { kind: 'uuid', format: 'with_braces', onUpdate: false }
    }
  }

  // `constraints` is a bit mask with Not null as 1, Unique as 2 and Expression
  // as 4, and a missing strength reads as 1, hard; 2 is soft and 0 not set
  // (`QgsVectorLayer::readSymbology`, `src/core/vector/qgsvectorlayer.cpp`, and
  // `QgsFieldConstraints`, `src/core/qgsfieldconstraints.h`, `qgis/QGIS@master`,
  // read 2026-10-23). An expression is kept only where `readQgisExpression`
  // reads it.
  const constraintExpressions = new Map<string, { expression: string, description: string }>()
  for (const node of directChild(maplayer, 'constraintExpressions')?.querySelectorAll(':scope > constraint') ?? []) {
    const name = node.getAttribute('field')
    const expression = (node.getAttribute('exp') ?? '').trim()
    if (name && expression) constraintExpressions.set(name, { expression, description: (node.getAttribute('desc') ?? '').trim() })
  }
  for (const node of directChild(maplayer, 'constraints')?.querySelectorAll(':scope > constraint') ?? []) {
    const name = node.getAttribute('field')
    const constraints = Number(node.getAttribute('constraints') ?? '0')
    if (!name || !Number.isInteger(constraints)) continue
    if (constraints & 1) {
      const notNull = constraintStrength(node.getAttribute('notnull_strength'))
      if (notNull) ruleFor(name).notNull = notNull
    }
    if (constraints & 2) {
      const unique = constraintStrength(node.getAttribute('unique_strength'))
      if (unique) ruleFor(name).unique = unique
    }
    const written = constraintExpressions.get(name)
    if (constraints & 4 && written && readQgisExpression(written.expression, { geometry: true })) {
      const strength = constraintStrength(node.getAttribute('exp_strength'))
      if (strength) {
        const expression: FieldConstraintExpression = { expression: written.expression, strength }
        if (written.description) expression.description = written.description
        ruleFor(name).constraintExpression = expression
      }
    }
  }

  // A Range with Allow NULL off, or a Date/Time with it off, is a required
  // field.
  // It also raises a Not null that only warns.
  for (const name of allowNullOff) ruleFor(name).notNull = 'enforced'

  // A field absent from `<duplicatePolicies>`, or holding a key QGIS does not
  // know, reads as `Duplicate` (`QgsVectorLayer::readSymbology`,
  // `src/core/vector/qgsvectorlayer.cpp`, `qgis/QGIS@master`, read 2026-10-23).
  for (const node of directChild(maplayer, 'duplicatePolicies')?.querySelectorAll(':scope > policy') ?? []) {
    const name = node.getAttribute('field')
    const policy = node.getAttribute('policy')
    if (name && (policy === 'DefaultValue' || policy === 'UnsetField')) {
      ruleFor(name).duplicatePolicy = policy === 'DefaultValue' ? 'default' : 'unset'
    }
  }

  for (const node of directChild(maplayer, 'editable')?.querySelectorAll(':scope > field') ?? []) {
    const name = node.getAttribute('name')
    if (name && node.getAttribute('editable') === '0') ruleFor(name).readOnly = true
  }

  for (const [name, reuse] of parseReuseLastValue(maplayer)) {
    if (reuse) ruleFor(name).reuseLastValue = true
  }

  return result
}

/**
 * Reads a Checkbox, Range or Date/Time widget's config into the field's rule.
 * QGIS writes the config as a flat `<Option type="Map">` and an untouched
 * widget writes an empty `<Option/>`, which reads as every default
 * (`QgsCheckboxConfigDlg`, `QgsRangeConfigDlg` and `QgsDateTimeEditConfig`,
 * `src/gui/editorwidgets/`, `qgis/QGIS@master`, read 2026-10-23). A value-less
 * `<Option type="invalid">` reads as unset. Range's `AllowNull` and Date/Time's
 * `allow_null` both default to true; a field with either off goes in `allowNullOff`.
 */
function readWidgetOptions(
  field: Element,
  name: string,
  widgetType: 'CheckBox' | 'Range' | 'DateTime',
  ruleFor: (name: string) => FieldEditRule,
  allowNullOff: Set<string>
): void {
  const options = readOptionMap(directChild(field, 'editWidget'))
  const number = (key: string): number | undefined => {
    const text = options.get(key)?.trim()
    if (!text) return undefined
    const value = Number(text)
    return Number.isFinite(value) ? value : undefined
  }

  switch (widgetType) {
    case 'CheckBox':
      ruleFor(name).checkbox = {
        checkedValue: readTrimmedOption(options, 'CheckedState'),
        uncheckedValue: readTrimmedOption(options, 'UncheckedState'),
        showStoredValue: options.get('TextDisplayMethod') === '1',
        allowNull: readFlag(options, 'AllowNullState', false)
      }
      return
    case 'Range': {
      const range: FieldRange = {}
      const min = number('Min')
      const max = number('Max')
      const step = number('Step')
      const precision = number('Precision')
      const suffix = options.get('Suffix')
      if (min !== undefined) range.min = min
      if (max !== undefined) range.max = max
      if (step !== undefined) range.step = step
      if (precision !== undefined && Number.isInteger(precision) && precision >= 0) range.precision = precision
      if (suffix) range.suffix = suffix
      if (Object.keys(range).length > 0) ruleFor(name).range = range
      if (!readFlag(options, 'AllowNull', true)) allowNullOff.add(name)
      return
    }
    case 'DateTime': {
      // A date or date-time field ignores `field_format`, which this parser
      // cannot tell here. ISO 8601 and the default for a date are what an
      // application already reads, so they write nothing.
      const format = options.get('field_format')?.trim()
      if (format && format !== 'yyyy-MM-dd' && !readFlag(options, 'field_iso_format', false)) ruleFor(name).dateFormat = format
      if (!readFlag(options, 'allow_null', true)) allowNullOff.add(name)
    }
  }
}

/** A constraint's strength: 1, or absent, is hard; 2 is soft; 0 or anything else is not set. */
function constraintStrength(strength: string | null): 'enforced' | 'warn' | null {
  switch (strength ?? '1') {
    case '1': return 'enforced'
    case '2': return 'warn'
    default: return null
  }
}

/**
 * Which fields offer a new feature the value last entered, from either of
 * QGIS's two forms. An older project writes
 * `<reuseLastValue><field name reuseLastValue="1"/></reuseLastValue>`; QGIS now
 * writes `<reuseLastValuePolicy><field name reuseLastValuePolicy="AllowedDefaultOn"/></reuseLastValuePolicy>`,
 * and reads the older block first so the newer one wins
 * (`QgsEditFormConfig::readXml`, `src/core/editform/qgseditformconfig.cpp`,
 * `qgis/QGIS@master`, read 2026-10-23). `AllowedDefaultOff` reads as not
 * reused: it is off until someone ticks it in QGIS's own form, which a
 * reading application's form may have no tick for.
 */
function parseReuseLastValue(maplayer: Element): Map<string, boolean> {
  const reuse = new Map<string, boolean>()
  for (const node of directChild(maplayer, 'reuseLastValue')?.querySelectorAll(':scope > field') ?? []) {
    const name = node.getAttribute('name')
    const flag = Number(node.getAttribute('reuseLastValue'))
    if (name) reuse.set(name, Number.isInteger(flag) && flag !== 0)
  }
  for (const node of directChild(maplayer, 'reuseLastValuePolicy')?.querySelectorAll(':scope > field') ?? []) {
    const name = node.getAttribute('name')
    if (name) reuse.set(name, node.getAttribute('reuseLastValuePolicy') === 'AllowedDefaultOn')
  }
  return reuse
}

/**
 * Reads a default-value expression an application can fill: one of
 * `NOW_EXPRESSIONS`, `uuid()` or `$uuid` with an optional format, or a lone
 * literal. Anything else, such as a field reference, a variable or a
 * calculation, is null.
 *
 * `uuid()` takes `format` (`WithBraces` by default, `WithoutBraces`, `Id128`,
 * compared ignoring case, with any other text read as `WithBraces`) and
 * `version` (4 by default, or 7), by position or by name (`format:='Id128'`)
 * (`fcnUuid` and its registration, `src/core/expression/qgsexpressionfunction.cpp`,
 * `qgis/QGIS@master`, read 2026-10-23). A version other than 4 is null: the
 * app makes version 4 identifiers only.
 */
function parseDefaultExpression(expression: string, onUpdate: boolean): FieldDefaultValue | null {
  if (NOW_EXPRESSIONS.has(expression.replace(/\s+/g, '').toLowerCase())) return { kind: 'now', onUpdate }

  const tokens = tokenizeExpression(expression)
  if (!tokens) return null

  const literal = readLiteral(tokens, 0)
  if (literal && literal.next === tokens.length) return { kind: 'fixed', value: literal.value, onUpdate }

  const format = readUuidCall(tokens)
  return format ? { kind: 'uuid', format, onUpdate } : null
}

type ExpressionToken =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'named'; value: string }
  | { type: 'punct'; value: '(' | ')' | ',' | '-' }

/**
 * Splits an expression into the tokens a literal or a `uuid()` call is made
 * of, following QGIS's lexer (`src/core/qgsexpressionlexer.ll`,
 * `qgis/QGIS@master`, read 2026-10-23), which ignores case. Null where the
 * expression holds anything else, such as an operator, a quoted field name or
 * a comment.
 */
function tokenizeExpression(expression: string): ExpressionToken[] | null {
  const pattern = /\s+|'((?:''|\\.|[^'\\])*)'|(\d*(?:\.\d+(?:[eE][-+]?\d+)?|[eE][-+]?\d+)|\d+)|([A-Za-z_\x80-\uFFFF$][A-Za-z0-9_\x80-\uFFFF]*)(\s*:=\s*)?|([(),-])/y
  const tokens: ExpressionToken[] = []
  pattern.lastIndex = 0
  while (pattern.lastIndex < expression.length) {
    const match = pattern.exec(expression)
    if (!match) return null
    const [, text, number, name, named, punct] = match
    if (text !== undefined) tokens.push({ type: 'string', value: unescapeStringLiteral(text) })
    else if (number !== undefined) tokens.push({ type: 'number', value: Number(number) })
    else if (name !== undefined) tokens.push({ type: named ? 'named' : 'name', value: name.toLowerCase() })
    else if (punct !== undefined) tokens.push({ type: 'punct', value: punct as '(' | ')' | ',' | '-' })
  }
  return tokens
}

/** The literal starting at `index` — a string, a number with or without a minus, `TRUE`, `FALSE` or `NULL` — and the index after it. */
function readLiteral(tokens: ExpressionToken[], index: number): { value: FieldFixedValue; next: number } | null {
  const token = tokens[index]
  const after = tokens[index + 1]
  if (token?.type === 'punct' && token.value === '-' && after?.type === 'number') return { value: -after.value, next: index + 2 }
  if (token?.type === 'string' || token?.type === 'number') return { value: token.value, next: index + 1 }
  if (token?.type !== 'name') return null
  if (token.value === 'true') return { value: true, next: index + 1 }
  if (token.value === 'false') return { value: false, next: index + 1 }
  if (token.value === 'null') return { value: null, next: index + 1 }
  return null
}

/** The format of a whole-expression `uuid()` or `$uuid`, or null where the expression is not one. */
function readUuidCall(tokens: ExpressionToken[]): FieldUuidFormat | null {
  const [head, open] = tokens
  if (head?.type !== 'name') return null
  if (head.value === '$uuid') return tokens.length === 1 ? 'with_braces' : null
  if (head.value !== 'uuid' || open?.type !== 'punct' || open.value !== '(') return null
  const close = tokens[tokens.length - 1]
  if (close?.type !== 'punct' || close.value !== ')') return null

  const args: Partial<Record<'format' | 'version', FieldFixedValue>> = {}
  const positions = ['format', 'version'] as const
  let index = 2
  let position = 0
  while (index < tokens.length - 1) {
    if (position > 0) {
      const comma = tokens[index]
      if (comma?.type !== 'punct' || comma.value !== ',') return null
      index += 1
    }
    const token = tokens[index]
    let parameter: 'format' | 'version' | undefined = positions[position]
    if (token?.type === 'named') {
      if (token.value !== 'format' && token.value !== 'version') return null
      parameter = token.value
      index += 1
    }
    const literal = readLiteral(tokens, index)
    if (!parameter || !literal || parameter in args) return null
    args[parameter] = literal.value
    index = literal.next
    position += 1
  }

  if (args.version !== undefined && args.version !== 4) return null
  if (args.format === undefined) return 'with_braces'
  if (typeof args.format !== 'string') return null
  const format = args.format.toLowerCase()
  return format === 'withoutbraces' ? 'without_braces' : format === 'id128' ? 'id128' : 'with_braces'
}

function readTrimmedOption(options: Map<string, string>, key: string): string | null {
  const value = options.get(key)?.trim()
  return value ? value : null
}

function parseBoundingBox(maplayer: Element, tag: string): BoundingBox | null {
  const node = directChild(maplayer, tag)
  if (!node) return null
  const xmin = readNumber(node, 'xmin')
  const ymin = readNumber(node, 'ymin')
  const xmax = readNumber(node, 'xmax')
  const ymax = readNumber(node, 'ymax')
  if (xmin === null || ymin === null || xmax === null || ymax === null) return null
  return { xmin, ymin, xmax, ymax }
}

/**
 * Parses <fieldConfiguration> into the canonical list of field names.
 *
 *   <fieldConfiguration>
 *     <field name="objectid" configurationFlags="...">
 *       <editWidget type="...">...</editWidget>
 *     </field>
 *     ...
 *   </fieldConfiguration>
 *
 * Modern QGIS may write fieldConfiguration both at the maplayer level and
 * inside the active <map-layer-style> block — we collect from anywhere
 * inside the maplayer and dedupe, preserving first-seen order.
 *
 * QGIS does not declare field types here for WFS layers (those come from
 * DescribeFeatureType at runtime), so this function only returns names.
 */
function parseFieldNames(maplayer: Element): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  const fields = maplayer.querySelectorAll('fieldConfiguration > field')
  for (const node of Array.from(fields)) {
    const name = node.getAttribute('name')
    if (!name) continue
    if (seen.has(name)) continue
    seen.add(name)
    ordered.push(name)
  }
  return ordered
}

/**
 * Parses <aliases> into a { fieldName: aliasText } map.
 *
 *   <aliases>
 *     <alias field="incident_uid" name="Incident UID" index="0"/>
 *     ...
 *   </aliases>
 *
 * Modern QGIS supports per-style aliases — they live inside the active
 * <map-layer-style> block under the style manager. Legacy QGIS put them
 * at the maplayer level. Same project can have both, and the maplayer-
 * level copy may have empty `name=""` placeholders. We collect every
 * <alias> anywhere inside the maplayer and keep the last non-empty value
 * per field, which is the active-style block's when both are present.
 */
function parseFieldAliases(maplayer: Element): Record<string, string> {
  const out: Record<string, string> = {}
  const nodes = maplayer.querySelectorAll('aliases > alias')
  for (const node of Array.from(nodes)) {
    const field = node.getAttribute('field')
    const name = node.getAttribute('name')
    if (!field || !name) continue
    out[field] = name
  }
  return out
}

/** The start of the name of a layer variable that sets a field's icon: `quac_icon_species`. */
const FIELD_ICON_VARIABLE_PREFIX = 'quac_icon_'

/**
 * Reads the field icons the layer's variables set, as an address for each
 * field (`resolveFieldIconAddress`). A variable whose value names no icon is
 * left out; whether the layer has the field is for the reader of the result.
 *
 * QGIS keeps a layer's variables as two lists of the same length in its custom
 * properties, `variableNames` and `variableValues`
 * (`QgsExpressionContextUtils::setLayerVariable`,
 * `src/core/expression/qgsexpressioncontextutils.cpp`), saved as a direct
 * child of `<maplayer>`:
 *
 *   <customproperties>
 *     <Option type="Map">
 *       <Option name="variableNames" type="StringList">
 *         <Option type="QString" value="quac_icon_species"/>
 *       </Option>
 *       <Option name="variableValues" type="StringList">
 *         <Option type="QString" value="tabler:tree"/>
 *       </Option>
 *     </Option>
 *   </customproperties>
 *
 * A project saved before QGIS 3.20 holds `<property key="variableNames">`
 * with a `<value>` per entry, or a `value` attribute for a single one, which
 * QGIS still reads (`QgsObjectCustomProperties::readXml`,
 * `src/core/qgsobjectcustomproperties.cpp`, `qgis/QGIS@master`, read
 * 2026-10-25).
 */
function parseFieldIcons(maplayer: Element): Record<string, string> {
  const icons: Record<string, string> = {}
  for (const [field, value] of readFieldVariables(maplayer, FIELD_ICON_VARIABLE_PREFIX)) {
    const address = resolveFieldIconAddress(value)
    if (address) icons[field] = address
  }
  return icons
}

/** The name of the layer variable that sets the layer's own icon. */
const LAYER_ICON_VARIABLE = 'quac_icon'

/**
 * Reads the icon the layer's `quac_icon` variable sets, as an address
 * (`resolveFieldIconAddress`), held in the same lists as the field icons.
 * Null where the layer has no such variable or its value names no icon.
 */
function parseLayerIcon(maplayer: Element): string | null {
  const properties = directChild(maplayer, 'customproperties')
  if (!properties) return null
  const names = readCustomPropertyList(properties, 'variableNames')
  const values = readCustomPropertyList(properties, 'variableValues')
  const index = names.indexOf(LAYER_ICON_VARIABLE)
  return index === -1 || index >= values.length ? null : resolveFieldIconAddress(values[index])
}

/** The start of the name of a layer variable that chooses a field's control: `quac_control_condition`. */
const FIELD_CONTROL_VARIABLE_PREFIX = 'quac_control_'

/**
 * Reads the control each field's `quac_control_<field>` variable asks for,
 * held in the same lists as the field icons. The value is compared without
 * regard to case or surrounding spaces, and one that names no control is left
 * out.
 */
function parseFieldControls(maplayer: Element): Record<string, FieldControl> {
  const controls: Record<string, FieldControl> = {}
  for (const [field, value] of readFieldVariables(maplayer, FIELD_CONTROL_VARIABLE_PREFIX)) {
    const control = value.trim().toLowerCase()
    if (control === 'buttons' || control === 'dropdown') controls[field] = control
  }
  return controls
}

/** Each of the layer's variables named `prefix` and a field's name, as that field's name and the variable's value. */
function readFieldVariables(maplayer: Element, prefix: string): Array<[string, string]> {
  const properties = directChild(maplayer, 'customproperties')
  if (!properties) return []
  const names = readCustomPropertyList(properties, 'variableNames')
  const values = readCustomPropertyList(properties, 'variableValues')
  return names.flatMap((variable, index): Array<[string, string]> => {
    if (!variable.startsWith(prefix) || index >= values.length) return []
    const field = variable.slice(prefix.length)
    return field ? [[field, values[index]]] : []
  })
}

/**
 * Reads the layer's preview/display field from `<previewExpression>`. QGIS
 * writes the value as a quoted field reference, e.g.
 * `<previewExpression>"location_description"</previewExpression>`. We strip
 * the surrounding quotes to recover the field name. More complex expressions
 * (concatenations, conditionals) are not a single field reference, so they
 * return null.
 */
function parseDisplayField(maplayer: Element): string | null {
  const node = directChild(maplayer, 'previewExpression')
  const text = node?.textContent?.trim()
  if (!text) return null
  const match = /^"([^"]+)"$/.exec(text)
  return match ? match[1] : null
}

/**
 * Reads the layer's queryable flag from `<flags><Identifiable>1</Identifiable></flags>`.
 * "1" means queryable; "0" means not. Defaults to true when the flags
 * element is absent (matches QGIS's default behaviour).
 */
function parseQueryable(maplayer: Element): boolean {
  const flags = directChild(maplayer, 'flags')
  if (!flags) return true
  const identifiable = directChild(flags, 'Identifiable')
  if (!identifiable) return true
  return identifiable.textContent?.trim() === '1'
}

/** The image types an embedded legend image is read as, by the bytes it opens with. */
const IMAGE_SIGNATURES: Array<[string, (bytes: string) => boolean]> = [
  ['image/png', (bytes) => bytes.startsWith('\x89PNG')],
  ['image/jpeg', (bytes) => bytes.startsWith('\xff\xd8\xff')],
  ['image/gif', (bytes) => bytes.startsWith('GIF8')],
  ['image/webp', (bytes) => bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'],
  ['image/svg+xml', (bytes) => /^\s*(?:<\?xml|<svg)/.test(bytes)]
]

/**
 * Reads the layer's legend placeholder image where QGIS embeds it. **Embed
 * File…** saves the file as `base64:` and its contents, with no type
 * (`QgsFileContentSourceLineEdit`, `src/gui/qgsfilecontentsourcelineedit.cpp`),
 * so the type is read from the bytes the image opens with. QGIS's image cache
 * also reads a `data:` URL (`QgsAbstractContentCacheBase::parseBase64DataUrl`,
 * `src/core/qgsabstractcontentcache.cpp`), so one is kept as written. Both
 * read at qgis/QGIS@master, 2026-10-25. A file path or web address is not
 * read: it names a file rather than holding one.
 */
function parseLegendImage(maplayer: Element): string | null {
  const source = maplayer.getAttribute('legendPlaceholderImage')?.trim() ?? ''
  if (/^data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=\s]+$/.test(source)) return source
  const match = /^base64:([A-Za-z0-9+/=\s]+)$/i.exec(source)
  if (!match) return null
  const data = match[1]!.replace(/\s/g, '')
  let opening: string
  try {
    opening = atob(data.slice(0, 24))
  } catch {
    return null
  }
  const type = IMAGE_SIGNATURES.find(([, matches]) => matches(opening))?.[0]
  return type ? `data:${type};base64,${data}` : null
}

/**
 * Reads the layer's Private flag from `<flags><Private>1</Private></flags>`,
 * the **Private** column of QGIS's Project Properties → Data Sources
 * (`QgsMapLayer::writeCommonStyle`, `src/core/qgsmaplayer.cpp`,
 * `qgis/QGIS@master`, read 2026-10-24). QGIS writes every flag, each as 0 or 1.
 * A layer with no flags, or no Private flag, is not private.
 */
function parsePrivate(maplayer: Element): boolean {
  const flags = directChild(maplayer, 'flags')
  if (!flags) return false
  return directChild(flags, 'Private')?.textContent?.trim() === '1'
}

/**
 * Reads scale-dependent visibility from the `<maplayer>` attributes. QGIS
 * writes `minScale` and `maxScale` whether or not the flag is on, so both are
 * ignored unless `hasScaleBasedVisibilityFlag` is "1". A value of 0 means no
 * limit on that side.
 */
function parseScaleRange(maplayer: Element): LayerScaleRange | null {
  if (maplayer.getAttribute('hasScaleBasedVisibilityFlag') !== '1') return null
  const minScale = parseScaleDenominator(maplayer.getAttribute('minScale'))
  const maxScale = parseScaleDenominator(maplayer.getAttribute('maxScale'))
  if (minScale === null && maxScale === null) return null
  return { minScale, maxScale }
}

function parseScaleDenominator(text: string | null): number | null {
  const value = Number(text)
  return text && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Reads the layer's opacity from `<layerOpacity>`. Defaults to 1 when the
 * element is absent or unparseable.
 */
function parseOpacity(maplayer: Element): number {
  const text = directChildText(maplayer, 'layerOpacity')
    ?? maplayer.querySelector('pipe > rasterrenderer')?.getAttribute('opacity')
  if (!text) return 1
  const value = Number(text)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
}

/**
 * The layer's own `<fieldConfiguration>` fields that have a name, as
 * `[name, <field>]`, in document order. A saved alternate style embeds its
 * own `<fieldConfiguration>`, which can disagree with the layer's own, so only
 * the direct child of `<maplayer>` is read (see docs/gotchas.md).
 */
function* layerFields(maplayer: Element): Generator<[string, Element]> {
  for (const field of directChild(maplayer, 'fieldConfiguration')?.querySelectorAll(':scope > field') ?? []) {
    const name = field.getAttribute('name')
    if (name) yield [name, field]
  }
}

/**
 * A `<fieldConfiguration><field>`'s `configurationFlags`: the Fields tab's
 * Configuration column, saved as `Qgis::FieldConfigurationFlag` names joined
 * by `|`, such as `NotSearchable|HideFromWms`, and `NoFlag` where none is set.
 */
function configurationFlagsOf(field: Element): string[] {
  return (field.getAttribute('configurationFlags') ?? '').split('|').map((flag) => flag.trim())
}

/** The named fields' `<editWidget>`, as `[name, <editWidget>]`; null where a field has none. */
function* layerEditWidgets(maplayer: Element): Generator<[string, Element | null]> {
  for (const [name, field] of layerFields(maplayer)) yield [name, directChild(field, 'editWidget')]
}

/**
 * A flat widget config as key and value: the widget's `<Option type="Map">`
 * members that have a name and a `value`. An `<Option type="invalid">` that
 * QGIS writes for an unset key has no `value` and is left out.
 */
function readOptionMap(editWidget: Element | null): Map<string, string> {
  const options = new Map<string, string>()
  for (const option of editWidget?.querySelectorAll(':scope > config > Option[type="Map"] > Option') ?? []) {
    const key = option.getAttribute('name')
    const value = option.getAttribute('value')
    if (key && value !== null) options.set(key, value)
  }
  return options
}

/** A Boolean widget option: `true` or `1` is on, any other value off, and an absent key `fallback`. */
function readFlag(options: Map<string, string>, key: string, fallback = false): boolean {
  const value = options.get(key)
  return value === undefined ? fallback : value === 'true' || value === '1'
}

function directChild(parent: Element, tag: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) return child
  }
  return null
}

function directChildText(parent: Element, tag: string): string | null {
  return directChild(parent, tag)?.textContent?.trim() ?? null
}

function readNumber(parent: Element, tag: string): number | null {
  const text = parent.querySelector(tag)?.textContent?.trim()
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}
