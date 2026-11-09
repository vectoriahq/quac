import { arcgisQueryAsset } from './arcgisStacCatalogue'
import {
  QUAC_MEASUREMENT_FIELD,
  slugify,
  generateStacFromNormalized,
  unionBboxes,
  withSelfLink
} from './normalizedProject'
import { wfsGetFeatureAsset } from './wfsStacCatalogue'
import { delimitedTextField, QUAC_DELIMITED_TEXT } from '../model/delimitedText'
import { featureFilterField, QUAC_FEATURE_FILTER } from '../model/featureFilter'
import { readDataAsset } from '../model/stacAssetRoles'
import { decodeAssetPath, encodeAssetPath } from '../model/stacHref'
import { DEFAULT_STYLE_ROLE, styleAssetKey } from '../model/stacStyles'
import { buildWmsLink, WEB_MAP_LINKS_EXTENSION } from '../model/stacWms'
import { buildWmtsLink } from '../model/stacWmts'
import { buildXyzLink } from '../model/stacXyz'
import { findGeometrySiblings, readSiblingShapes, siblingCollectionId } from '../parse/geometrySiblings'
import { declaredMediaTypeForFile, isLayerFileOfFormat, PROJECT_DATA_ROLES, QML_STYLE_MEDIA_TYPE } from '../util/catalogueFileFormats'

import type { CollectionFilter, CollectionRelation, NormalizedLayer, NormalizedNode, NormalizedProject, QgisServerNames } from './normalizedProject'
import type { BoundingBox, EditLock, FieldAttachment, FieldConstraintExpression, FieldControl, FieldDefaultValue, FieldEditRule, FieldValueMapEntry, FieldValueRelation, FileDataSource, LayerEntry, LayerFormLayout, LayerGroup, LayerLocks, LayerStyle, LockedEdit, PresetFilter, ProjectMeasurement, QgsProject, QgsRelation, WfsTransactionLayers, WmsPublishing } from '../model/QgsProject'
import type { StacAsset, StacCatalog, StacCollection, StacLink, StacProvider, TableColumn, TableColumnAttachment, TableColumnConstraints, TableColumnDefault, TableColumnType, TableColumnValueRelation } from '../model/Stac'
import type { FeatureCollection } from 'geojson'

/**
 * Inputs to the STAC generator: per-layer optional GeoJSON FeatureCollection
 * (used to derive `table:columns` from real properties when available).
 */
export interface StacCompanionData {
  /** Layer id matching QgsProject.LayerEntry.id. */
  layerId: string
  /** GeoJSON FeatureCollection if loaded; null for unmatched/WFS layers. */
  geojson: FeatureCollection | null
}

/**
 * Generates a STAC Catalog tree from a parsed QgsProject.
 *
 * Mapping:
 *   QgsProject               → top-level Catalog
 *   QgsProject.layerTree     → nested Catalogs (groups) + Collection links
 *   LayerEntry               → Collection
 *   LayerEntry.dataSource    → Asset within the Collection
 *   GeoJSON properties       → table:columns extension on the Collection
 *
 * Pure function — no side effects, no I/O. Companion GeoJSONs are passed
 * in by the caller; if absent for a given layer, the Collection is still
 * emitted but `table:columns` is omitted.
 *
 * This is a thin wrapper: `qgsProjectToNormalized` resolves the QGS-specific
 * wording, assets and columns into the shared `NormalizedProject`, and
 * `generateStacFromNormalized` (see normalizedProject.ts) builds the catalogue.
 */
export function generateStacCatalogue(
  project: QgsProject,
  companions: StacCompanionData[] = [],
  options: {
    selfHref?: string
    projectPath?: string
    projectFileName?: string
    initialView?: BoundingBox | null
    layerWgs84Extents?: Map<string, BoundingBox>
  } = {}
): StacCatalog {
  // `selfHref` is the folder the project was published from, for a project
  // loaded out of cloud storage. A dragged-in project has no address to record.
  //
  // `projectPath` is the project document's own path inside that folder, which
  // the layers' style assets address into — a path, not an href, so the
  // generator is the one place that escapes it. A caller that doesn't know
  // where the project file sits leaves it off, and the style assets fall back
  // to a bare fragment — see `buildStyleAssets`.
  //
  // `projectFileName` is the project file's name for each layer's `via` link
  // alone, where the caller knows it but leaves `projectPath` off, as the drop
  // route does. `projectPath` gives the link where it is set.
  //
  // `initialView` is the project's saved map canvas extent **already in
  // WGS84**, which is what `quac:initial_view` publishes. The canvas has
  // its own CRS and this package holds no reprojection — it must not import
  // OpenLayers or proj4 (see `packages/quac/src/index.ts`) — so the caller converts and
  // passes the result, or leaves it off.
  //
  // `layerWgs84Extents` is the same conversion, per layer, for a layer whose
  // `<wgs84extent>` QGIS didn't write: `layer.extent` is in the layer's own
  // CRS, and this package cannot reproject it for the same reason it cannot
  // reproject the canvas. `resolveLayerWgs84Extents` in the same file builds
  // this map; a layer left out of it (or a caller that leaves the option off
  // entirely) has no box of its own.
  return withSelfLink(
    generateStacFromNormalized(qgsProjectToNormalized(
      project,
      companions,
      options.projectPath,
      options.projectPath ?? options.projectFileName,
      options.initialView ?? null,
      options.layerWgs84Extents
    )),
    options.selfHref
  )
}

/**
 * The key a style asset takes for the field its renderer classifies by, when
 * that renderer is a categorised one. The project author's declaration.
 */
export const QUAC_CATEGORISED_FIELD = 'quac:categorised_field'

/**
 * The key a data asset takes for the shapes of feature its Collection holds,
 * from QGIS file sources' `|geometrytype=`: a list of `Point`, `LineString` and
 * `Polygon`, a `Multi*` geometry counting as its single-part shape.
 */
export const QUAC_GEOMETRY_FILTER = 'quac:geometry_filter'

type GeometryFilterShape = NonNullable<FileDataSource['geometryTypeFilter']>

/**
 * The shapes a Collection's data asset keeps, or null where it names none, or
 * names anything this does not read, so a data file is read whole.
 */
export function readCollectionGeometryFilter(collection: StacCollection): GeometryFilterShape[] | null {
  const value: unknown = readDataAsset(collection)?.[QUAC_GEOMETRY_FILTER]
  if (!Array.isArray(value) || value.length === 0) return null
  const isShape = (entry: unknown): entry is GeometryFilterShape => entry === 'Point' || entry === 'LineString' || entry === 'Polygon'
  return value.every(isShape) ? value : null
}

/**
 * The key a data asset takes for the table of a GeoPackage its Collection
 * reads, from a QGIS file source's `|layername=`.
 */
export const QUAC_LAYER_NAME = 'quac:layer_name'

/** The table a Collection's data asset names, or null where it names none. */
export function readCollectionLayerName(collection: StacCollection): string | null {
  const value: unknown = readDataAsset(collection)?.[QUAC_LAYER_NAME]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Projects a parsed QgsProject into the source-agnostic normalized model. */
function qgsProjectToNormalized(
  project: QgsProject,
  companions: StacCompanionData[],
  projectPath: string | undefined,
  projectFileName: string | undefined,
  initialView: BoundingBox | null,
  layerWgs84Extents: Map<string, BoundingBox> | undefined
): NormalizedProject {
  const companionByLayerId = new Map<string, FeatureCollection>()
  for (const c of companions) {
    if (c.geojson) companionByLayerId.set(c.layerId, c.geojson)
  }

  const layersById = new Map<string, LayerEntry>()
  for (const layer of project.layers) layersById.set(layer.id, layer)

  // Layers QGIS split out of one file by shape are one Collection, under the
  // first sibling's id, so whatever names a later sibling names that Collection.
  const siblingsById = findGeometrySiblings(project)
  const collectionIdOf = (layerId: string) => siblingCollectionId(siblingsById, layerId)

  const context: LayerContext = {
    companionByLayerId,
    projectPath,
    projectFileName,
    layerWgs84Extents,
    relationsByChildLayerId: collectRelationsByChildLayerId(project.relations ?? [], layersById, collectionIdOf),
    valueRelationsByLayerId: collectValueRelationsByLayerId(project.layers, layersById, collectionIdOf),
    siblingsById,
    measurement: project.measurement ?? null,
    wfsTransactionLayers: project.wfsTransactionLayers ?? null,
    wmsPublishing: project.wmsPublishing ?? null,
    filtersByCollectionId: collectFiltersByCollectionId(project.merginFilters ?? [], layersById, collectionIdOf)
  }
  const nodes = walkQgsGroup(project.layerTree, layersById, context)

  // A layer the layers panel does not list comes after every listed one, in the
  // order the project file holds it.
  const listedLayerIds = new Set<string>()
  const collectListedLayerIds = (group: LayerGroup) => {
    for (const child of group.children) {
      if (child.kind === 'layer') listedLayerIds.add(child.layerId)
      else collectListedLayerIds(child)
    }
  }
  collectListedLayerIds(project.layerTree)
  for (const layer of project.layers) {
    if (listedLayerIds.has(layer.id)) continue
    const node = layerToNormalized(layer, context)
    if (node) nodes.push(node)
  }

  // The Catalog's extent is what the project's data covers — the union of its
  // layers' boxes, the same thing every other source's Catalog extent means.
  // Where the map *opens* is a different fact, and is only true of a project
  // whose author saved a canvas position, so it goes in its own field below
  // and is absent from a project that declares none.
  return {
    id: slugify(project.title || 'qgs-project') || 'qgs-project',
    title: project.title,
    description: project.metadata.abstract ?? (
      project.title
        ? `STAC catalogue generated from QGIS project "${project.title}".`
        : 'STAC catalogue generated from a QGIS project.'
    ),
    bbox: unionExtent(project.layers, layerWgs84Extents),
    providers: project.metadata.author ? [{ name: project.metadata.author, roles: ['producer'] }] : undefined,
    initialView,
    activeCollectionId: project.initialActiveLayerId && layersById.has(project.initialActiveLayerId)
      ? collectionIdOf(project.initialActiveLayerId)
      : null,
    nodes
  }
}

/** What turning one project layer into a Collection reads beyond the layer itself. */
interface LayerContext {
  companionByLayerId: Map<string, FeatureCollection>
  projectPath: string | undefined
  /** The project file each layer's `via` link names, where the caller knows it. */
  projectFileName: string | undefined
  layerWgs84Extents: Map<string, BoundingBox> | undefined
  relationsByChildLayerId: Map<string, CollectionRelation[]>
  valueRelationsByLayerId: Map<string, Record<string, TableColumnValueRelation>>
  /** `findGeometrySiblings`. */
  siblingsById: Map<string, readonly LayerEntry[]>
  /** The project's area and distance units, written onto every layer's Collection. */
  measurement: ProjectMeasurement | null
  /** The project's WFS publishing, which locks the edits a published layer does not take. */
  wfsTransactionLayers: WfsTransactionLayers | null
  /** The project's WMS publishing, which decides the WMS name QGIS Server gives each layer. */
  wmsPublishing: WmsPublishing | null
  /** The filters the project sets up, by the id of the Collection each goes onto. */
  filtersByCollectionId: Map<string, CollectionFilter[]>
}

/**
 * Sorts a project's filters by the Collection each goes onto: its layer's, the
 * first sibling's for a layer QGIS split by shape. A filter whose layer is not
 * in the project, or does not have its field, goes nowhere.
 */
function collectFiltersByCollectionId(
  filters: readonly PresetFilter[],
  layersById: Map<string, LayerEntry>,
  collectionIdOf: (layerId: string) => string
): Map<string, CollectionFilter[]> {
  const byCollectionId = new Map<string, CollectionFilter[]>()
  for (const { layerId, field, name } of filters) {
    if (!layersById.get(layerId)?.fieldNames.includes(field)) continue
    const collectionId = collectionIdOf(layerId)
    byCollectionId.set(collectionId, [...(byCollectionId.get(collectionId) ?? []), { field, name }])
  }
  return byCollectionId
}

/**
 * Groups the project's relations under the child layer each one hangs off a
 * parent, which is the layer whose Collection has them.
 *
 * A `.qgs` Collection's id is the QGIS layer id (`packages/quac/spec/README.md`
 * § Collection ids), so a relation's layer ids are already Collection ids. One
 * pointing to a layer the project does not hold is dropped — it would point at a
 * Collection this catalogue has no entry for.
 */
function collectRelationsByChildLayerId(
  relations: QgsRelation[],
  layersById: Map<string, LayerEntry>,
  collectionIdOf: (layerId: string) => string
): Map<string, CollectionRelation[]> {
  const byChildLayerId = new Map<string, CollectionRelation[]>()

  for (const relation of relations) {
    if (!layersById.has(relation.parentLayerId) || !layersById.has(relation.childLayerId)) continue
    const childCollectionId = collectionIdOf(relation.childLayerId)
    const forChild = byChildLayerId.get(childCollectionId) ?? []
    forChild.push({
      id: relation.id,
      name: relation.name,
      parentCollectionId: collectionIdOf(relation.parentLayerId),
      fields: relation.fieldPairs.map((pair) => ({ parent: pair.parentField, child: pair.childField }))
    })
    byChildLayerId.set(childCollectionId, forChild)
  }

  return byChildLayerId
}

/**
 * Each layer's Value Relation widgets as `quac:value_relation` writes
 * them, keyed by layer id and then field name. The lookup is found by layer id
 * and then by layer name, as QGIS finds it
 * (`QgsVectorLayerRef::resolveByIdOrNameOnly`, `src/core/qgsvectorlayerref.cpp`,
 * `qgis/QGIS@master`); its Collection id is its layer id. A widget naming a
 * layer the project does not hold writes nothing, since it would point at a
 * Collection this catalogue has no entry for.
 */
function collectValueRelationsByLayerId(
  layers: LayerEntry[],
  layersById: Map<string, LayerEntry>,
  collectionIdOf: (layerId: string) => string
): Map<string, Record<string, TableColumnValueRelation>> {
  const byLayerId = new Map<string, Record<string, TableColumnValueRelation>>()

  for (const layer of layers) {
    const relations: Record<string, TableColumnValueRelation> = {}
    for (const [field, widget] of Object.entries(layer.fieldValueRelations)) {
      const lookup = layersById.get(widget.layerId) ?? layers.find((candidate) => candidate.name === widget.layerName)
      if (lookup) relations[field] = valueRelationToJson(collectionIdOf(lookup.id), widget)
    }
    if (Object.keys(relations).length > 0) byLayerId.set(layer.id, relations)
  }

  return byLayerId
}

/** A Value Relation widget as `quac:value_relation` stores it: a member at its default is left off. */
function valueRelationToJson(collectionId: string, widget: FieldValueRelation): TableColumnValueRelation {
  return {
    collection: collectionId,
    key: widget.keyField,
    value: widget.valueField,
    ...(widget.filterExpression ? { filter: widget.filterExpression } : {}),
    ...(widget.allowNull ? { allow_null: true as const } : {}),
    ...(widget.allowMulti ? { allow_multi: true as const } : {}),
    ...(widget.orderBy !== 'key' ? { order_by: widget.orderBy } : {}),
    ...(widget.orderBy === 'field' && widget.orderField ? { order_field: widget.orderField } : {}),
    ...(widget.descending ? { descending: true as const } : {})
  }
}

/**
 * Walks a QGIS layer tree group and returns its children as normalized nodes,
 * resolving each leaf's LayerEntry (leaves whose layer id isn't in the
 * project are skipped, as before). A group holding nothing but one set of
 * geometry siblings is that set's layer, titled with the group's name.
 */
function walkQgsGroup(
  group: LayerGroup,
  layersById: Map<string, LayerEntry>,
  context: LayerContext
): NormalizedNode[] {
  const nodes: NormalizedNode[] = []

  for (const node of group.children) {
    if (node.kind === 'layer') {
      const layer = layersById.get(node.layerId)
      if (!layer) continue
      const normalized = layerToNormalized(layer, context)
      if (normalized) nodes.push(normalized)
    } else if (node.kind === 'group') {
      const siblings = wholeGroupSiblings(node, context.siblingsById)
      if (siblings) {
        nodes.push(siblingsToNormalized(siblings, node.name, context))
        continue
      }
      nodes.push({
        kind: 'group',
        id: slugify(node.name) || 'group',
        title: node.name,
        description: qgisPlaceholderDescription('group', node.name),
        ...(node.mutuallyExclusive ? { mutuallyExclusive: true } : {}),
        children: walkQgsGroup(node, layersById, context)
      })
    }
  }

  return nodes
}

/** The set of geometry siblings that is the whole of `group`'s contents, or null. */
function wholeGroupSiblings(
  group: LayerGroup,
  siblingsById: Map<string, readonly LayerEntry[]>
): readonly LayerEntry[] | null {
  const first = group.children[0]
  const siblings = first?.kind === 'layer' ? siblingsById.get(first.layerId) : undefined
  if (!siblings || group.children.length !== siblings.length) return null
  const isWholeGroup = group.children.every((child) => (
    child.kind === 'layer' && siblings.some((sibling) => sibling.id === child.layerId)
  ))
  return isWholeGroup ? siblings : null
}

/**
 * A layer's Collection: its own, or for a geometry sibling, the set's, which
 * its first sibling stands for, so a later sibling has none and gives null.
 */
function layerToNormalized(layer: LayerEntry, context: LayerContext): NormalizedLayer | null {
  const siblings = context.siblingsById.get(layer.id)
  if (!siblings) return qgsLayerToNormalized(layer, context)
  return siblings[0] === layer ? siblingsToNormalized(siblings, layer.name, context) : null
}

/**
 * One Collection for layers QGIS split out of one file by shape: the first
 * sibling's settings,
 * every sibling's extent, and a data asset keeping the siblings' shapes. With
 * all three shapes it keeps none, so the layer reads the whole file, features
 * with no shape included.
 */
function siblingsToNormalized(
  siblings: readonly LayerEntry[],
  title: string,
  context: LayerContext
): NormalizedLayer {
  const first = siblings[0]
  const shapes = readSiblingShapes(siblings)
  const wkbTypes = siblings.flatMap((layer) => layer.wkbType ? [layer.wkbType] : [])
  return {
    ...qgsLayerToNormalized(first, context, shapes.length === 3 ? null : shapes),
    title,
    description: first.resourceMetadata.abstract ?? qgisPlaceholderDescription('layer', title),
    bbox: unionExtent([...siblings], context.layerWgs84Extents),
    // A sibling that names no WKB type leaves the list unknown, so none is written.
    wkbTypes: wkbTypes.length === siblings.length ? wkbTypes : [],
    // QGIS Server names each sibling separately, so the one Collection has no name of its own.
    qgisServerNames: null
  }
}

/**
 * The names QGIS Server would give the layer if it served the project
 * (`QgsWmsLayerInfos::buildWmsLayerInfos`, `src/server/services/wms/qgswmslayerinfos.cpp`,
 * and `QgsMapLayerServerProperties::wfsTypeName`, `src/core/qgsmaplayerserverproperties.cpp`,
 * `qgis/QGIS@master`, read 2026-11-03). Its WMS name is its layer id where the
 * project ticks **Use layer ids as names**, else its short name, else its name,
 * and none where the project leaves it out of WMS. Its WFS type name, given
 * only where the project publishes it for WFS, is its short name or else its
 * name, with each space made `_` and each `:` and em dash made `-`.
 */
export function qgisServerNamesOf(layer: LayerEntry, context: { wmsPublishing: WmsPublishing | null; wfsTransactionLayers: WfsTransactionLayers | null }): QgisServerNames {
  const publishing = context.wmsPublishing
  const ownName = layer.shortName || layer.name
  const wmsName = publishing?.restrictedLayers.includes(layer.name)
    ? null
    : publishing?.useLayerIds ? layer.id : ownName
  const wfsPublished = context.wfsTransactionLayers?.published.includes(layer.id) ?? false
  const wfsTypeName = wfsPublished ? ownName.replace(/ /g, '_').replace(/[:\u2014]/g, '-') : null
  return { wmsName: wmsName || null, wfsTypeName: wfsTypeName || null }
}

/** The shape a file layer's own `|geometrytype=` keeps, as the list `quac:geometry_filter` holds. */
function geometryFilterOf(layer: LayerEntry): GeometryFilterShape[] | null {
  const shapes = readSiblingShapes([layer])
  return shapes.length > 0 ? shapes : null
}

function qgsLayerToNormalized(
  layer: LayerEntry,
  context: LayerContext,
  geometryFilter: GeometryFilterShape[] | null = geometryFilterOf(layer)
): NormalizedLayer {
  const geojson = context.companionByLayerId.get(layer.id) ?? null
  const { projectPath, layerWgs84Extents } = context
  const relatedTo = context.relationsByChildLayerId.get(layer.id)
  const valueRelations = context.valueRelationsByLayerId.get(layer.id)
  const bbox = effectiveWgs84Bbox(layer, layerWgs84Extents)
  const metadata = layer.resourceMetadata
  const ds = layer.dataSource
  const webMapLink = ds.kind === 'wms' ? buildWmsLink(ds) : ds.kind === 'wmts' ? buildWmtsLink(ds) : ds.kind === 'xyz' ? buildXyzLink(ds.url, ds.tiles) : null

  return {
    kind: 'layer',
    id: layer.id,
    title: layer.name,
    // Text written into the catalogue document, which carries the project's own name.
    description: metadata.abstract ?? qgisPlaceholderDescription('layer', layer.name),
    bbox,
    geometryType: layer.geometryType,
    wkbTypes: layer.wkbType ? [layer.wkbType] : [],
    qgisServerNames: qgisServerNamesOf(layer, context),
    tableColumns: deriveTableColumns(
      geojson,
      layer.fieldNames,
      layer.fieldAliases,
      layer.fieldValueMaps,
      layer.fieldAttachments,
      layer.fieldEditRules,
      valueRelations,
      layer.formLayout ?? null,
      layer.fieldIcons,
      layer.fieldControls
    ),
    formOrder: layer.formLayout?.fields.map((field) => field.name),
    assets: buildLayerAssets(layer, projectPath, geometryFilter),
    keywords: metadata.keywords.length > 0 ? metadata.keywords : undefined,
    license: metadata.license,
    providers: buildLayerProviders(layer),
    temporalInterval: metadata.temporalInterval,
    displayField: layer.displayField,
    visibilityChecked: layer.isVisible,
    // An image layer has no features to edit. An ArcGIS layer keeps the
    // project's own Read-only tick: that Groundwork writes no edits back to the
    // service is the app's edit rule, which a demo map sets aside.
    editable: ds.kind === 'wms' || ds.kind === 'wmts' || ds.kind === 'xyz' ? false : layer.editable,
    identifiable: layer.queryable,
    scaleRange: layer.scaleRange,
    opacity: layer.opacity,
    relatedTo,
    isPrivate: layer.isPrivate,
    legendImage: layer.legendImage,
    icon: layer.icon,
    locks: combineLocks(layer.locks ?? {}, wfsTransactionLocks(layer.id, context.wfsTransactionLayers)),
    filters: context.filtersByCollectionId.get(layer.id),
    vendorFields: buildVendorFields(layer, context.measurement),
    ...(webMapLink || context.projectFileName ? {
      links: [
        ...(webMapLink ? [webMapLink] : []),
        ...(context.projectFileName ? [projectLink(context.projectFileName)] : [])
      ]
    } : {}),
    ...(webMapLink ? { extensions: [WEB_MAP_LINKS_EXTENSION] } : {})
  }
}

/** The title of the `via` link to the QGIS project a layer's Collection was written from. */
export const QGIS_PROJECT_LINK_TITLE = 'QGIS project'

/** A `via` link to the project file, beside the Collection: where its details came from. */
function projectLink(projectFileName: string): StacLink {
  return { rel: 'via', href: `./${encodeAssetPath(projectFileName)}`, title: QGIS_PROJECT_LINK_TITLE }
}

const PLACEHOLDER_DESCRIPTION = /^Layer (group )?"[\s\S]*" from the QGIS project\.$/

/**
 * The description a Collection takes where its QGIS layer or group has no
 * abstract of its own, since STAC requires one. `isQgisPlaceholderDescription`
 * tells it apart from one the project wrote.
 */
export function qgisPlaceholderDescription(kind: 'layer' | 'group', name: string): string {
  return `${kind === 'group' ? 'Layer group' : 'Layer'} "${name}" from the QGIS project.`
}

/** Whether a description is the one `qgisPlaceholderDescription` writes. */
export function isQgisPlaceholderDescription(description: string | undefined): boolean {
  return description !== undefined && PLACEHOLDER_DESCRIPTION.test(description)
}

/**
 * The edits a layer published for WFS does not take: an unticked **Insert**
 * locks adding, **Update** both attributes and geometry, which WFS-T updates
 * together, and **Delete** deleting. A layer the project does not publish
 * locks nothing, so a project that publishes nothing is unchanged.
 */
function wfsTransactionLocks(layerId: string, layers: WfsTransactionLayers | null): LayerLocks {
  if (!layers?.published.includes(layerId)) return {}
  const locks: LayerLocks = {}
  if (!layers.insert.includes(layerId)) locks.add = true
  if (!layers.update.includes(layerId)) {
    locks.attributes = true
    locks.geometry = true
  }
  if (!layers.delete.includes(layerId)) locks.delete = true
  return locks
}

/** Either source's locks, where `true` from either wins over the other's expression. */
function combineLocks(first: LayerLocks, second: LayerLocks): LayerLocks {
  const locks: LayerLocks = { ...first }
  for (const [edit, lock] of Object.entries(second) as [LockedEdit, EditLock][]) {
    if (lock === true || !locks[edit]) locks[edit] = lock
  }
  return locks
}

/**
 * A layer's own providers: its `<attribution>` credit line as a `licensor`,
 * and each `<resourceMetadata><contact>` identifying an organisation or a person as
 * a `producer`. Neither is the project-wide author, which
 * `qgsProjectToNormalized` puts on the Catalog and `buildCollection` merges
 * onto every layer's providers separately.
 */
function buildLayerProviders(layer: LayerEntry): StacProvider[] | undefined {
  const providers: StacProvider[] = []

  if (layer.attribution) {
    providers.push({
      name: layer.attribution.text,
      roles: ['licensor'],
      ...(layer.attribution.href ? { url: layer.attribution.href } : {})
    })
  }

  for (const contact of layer.resourceMetadata.contacts) {
    const name = contact.organization || contact.name
    if (!name) continue
    providers.push({
      name,
      roles: ['producer'],
      ...(contact.email ? { url: `mailto:${contact.email}` } : {})
    })
  }

  return providers.length > 0 ? providers : undefined
}

/**
 * Declares the project's measurement units, an XYZ layer's deepest zoom
 * level as `quac:max_zoom`, a WFS-backed layer's service and feature
 * type as `quac:wfs_*` fields, and an ArcGIS layer's address and filter as
 * `quac:arcgis_*` fields, so a consumer reads them directly instead of taking
 * them back apart out of the asset href.
 */
function buildVendorFields(layer: LayerEntry, measurement: ProjectMeasurement | null): Record<string, unknown> {
  const ds = layer.dataSource
  const shared: Record<string, unknown> = measurement
    ? { [QUAC_MEASUREMENT_FIELD]: { area_unit: measurement.areaUnit, distance_unit: measurement.distanceUnit } }
    : {}
  if (ds.kind === 'xyz') return ds.maxZoom === null ? shared : { ...shared, 'quac:max_zoom': ds.maxZoom }
  // The same fields an ArcGIS Online layer's Collection carries, so one reader loads both.
  if (ds.kind === 'arcgis') {
    return { ...shared, 'quac:arcgis_layer_url': ds.url, ...(ds.where ? { 'quac:arcgis_where': ds.where } : {}) }
  }
  if (ds.kind !== 'wfs') return shared

  const fields: Record<string, unknown> = {
    ...shared,
    'quac:wfs_endpoint': ds.url,
    'quac:wfs_type_name': ds.typeName
  }
  if (ds.srsName) fields['quac:wfs_srs_name'] = ds.srsName
  return fields
}

/** The layer's data asset and its style set, in one namespace with no clashes. */
function buildLayerAssets(
  layer: LayerEntry,
  projectPath: string | undefined,
  geometryFilter: GeometryFilterShape[] | null
): Record<string, StacAsset> {
  const dataAssets = buildAssets(layer, geometryFilter)
  return { ...dataAssets, ...buildStyleAssets(layer, projectPath, dataAssets) }
}

function buildAssets(layer: LayerEntry, geometryFilter: GeometryFilterShape[] | null): Record<string, StacAsset> {
  const ds = layer.dataSource
  if (ds.kind === 'wms' || ds.kind === 'wmts') return {}
  if (ds.kind === 'xyz') {
    // A `{quadkey}` template has no `rel: "xyz"` link to go in, so it goes in
    // the data asset (`packages/quac/spec/README.md` § "A layer's data,
    // and the ways to reach it").
    if (buildXyzLink(ds.url)) return {}
    return {
      data: {
        href: ds.url,
        title: 'XYZ tile template',
        roles: ['data']
      }
    }
  }
  if (ds.kind === 'file') {
    return {
      data: {
        // The path the project gives, not just the file's name: a project
        // referencing `data/roads.geojson` publishes an href that finds it.
        // Relative to the Catalog's `self` link, which for a cloud project is
        // the folder it was published from.
        // An online file's own address; it is not beside the project.
        href: ds.url ?? `./${encodeAssetPath(ds.relPath)}`,
        type: declaredMediaTypeForFile(ds.filename, PROJECT_DATA_ROLES),
        title: ds.filename,
        roles: ['data'],
        ...(geometryFilter ? { [QUAC_GEOMETRY_FILTER]: geometryFilter } : {}),
        // Only a GeoPackage's: QGIS also writes `|layername=` for a GeoJSON
        // file, which holds one layer.
        ...(ds.layerName && isLayerFileOfFormat(ds.filename, 'geopackage') ? { [QUAC_LAYER_NAME]: ds.layerName } : {}),
        ...(ds.delimitedText ? { [QUAC_DELIMITED_TEXT]: delimitedTextField(ds.delimitedText) } : {}),
        ...(ds.featureFilter ? { [QUAC_FEATURE_FILTER]: featureFilterField(ds.featureFilter) } : {})
      }
    }
  }
  if (ds.kind === 'arcgis') {
    return { data: arcgisQueryAsset({ layerUrl: ds.url, where: ds.where }, layer.name) }
  }
  if (ds.kind === 'wfs') {
    return {
      data: {
        ...wfsGetFeatureAsset(ds.url, ds.typeName, ds.typeName),
        ...(ds.featureFilter ? { [QUAC_FEATURE_FILTER]: featureFilterField(ds.featureFilter) } : {})
      }
    }
  }
  // Unsupported source: a placeholder asset naming the provider. The data
  // source itself is not written, because a database connection string can
  // hold a user name and password.
  return {
    data: {
      href: '',
      title: `Unsupported source: ${ds.hint ?? 'unknown'}`,
      roles: ['data']
    }
  }
}

/**
 * Declares a layer's named styles as `style` assets, one per style the project
 * defines (`packages/quac/spec/README.md` § Styles). QGIS keeps them in its style
 * manager — "Asset Owner" and "Priority" on the graffiti sample — and they are
 * declared here rather than embedded, like every other style in the profile.
 *
 * **The active style is emitted first and has the `default` role**, because
 * QGIS records which style is current independently of the order they appear in
 * the file — emitting file order and leaving the default unmarked would hand a
 * consumer a different style from the one QGIS draws.
 *
 * A style QGIS defined but wrote no renderer for is skipped — there would be
 * nothing at the address to fetch.
 *
 * The address is a fragment into the project document, since that is where the
 * style is; there is no per-style file to point at. `projectPath` identifies that
 * document when the caller knows where it sits, and is omitted otherwise,
 * leaving a bare fragment — see the known gaps in the profile. The path and
 * both halves of the fragment are escaped, so a project or style whose name
 * holds a `#` still gives an address that can be taken back apart.
 *
 * `existing` is the assets already built for the layer, so a style named after
 * one of them takes a disambiguated key instead of replacing it.
 */
function buildStyleAssets(
  layer: LayerEntry,
  projectPath: string | undefined,
  existing: Record<string, StacAsset>
): Record<string, StacAsset> {
  const assets: Record<string, StacAsset> = {}
  // The first style with a renderer is the default — the active one, unless
  // QGIS wrote no renderer for it. Marked rather than left to its position,
  // because a style named `2024` takes an asset key JavaScript enumerates
  // ahead of every other, whenever it was written.
  let defaultMarked = false

  for (const style of orderActiveStyleFirst(layer.styles, layer.activeStyleIndex)) {
    if (!style.rendererV2RawXml && !style.vectorTileRendererRawXml) continue
    const fragment = `${encodeURIComponent(layer.id)}/${encodeURIComponent(style.name)}`
    assets[styleAssetKey({ ...existing, ...assets }, style.name)] = {
      href: `${projectPath ? `./${encodeAssetPath(projectPath)}` : ''}#${fragment}`,
      type: QML_STYLE_MEDIA_TYPE,
      title: style.name,
      roles: defaultMarked ? ['style'] : ['style', DEFAULT_STYLE_ROLE],
      // Written only for a categorised style, so a reader can tell which field
      // a style classifies by without fetching and converting the style itself.
      ...(style.categorisedField ? { [QUAC_CATEGORISED_FIELD]: style.categorisedField } : {})
    }
    defaultMarked = true
  }

  return assets
}

/**
 * A QGIS style asset's address, taken back apart — the counterpart of the href
 * `buildStyleAssets` writes, kept beside it so the two cannot drift.
 *
 * The address is `./project.qgs#<layer-id>/<style-name>`, with the document
 * path and both halves of the fragment percent-encoded, and the document absent
 * for a caller that did not know where the project file sat. Because the
 * document path is escaped, the first `#` is always the one starting the
 * fragment — a project named `Assets #2.qgs` has its `#` as `%23`, where
 * unescaped it would cut the address in half and leave every layer in that
 * project unstyled.
 *
 * Returns null for an href with no such fragment — a style file sitting
 * beside the data, which is the folder catalogue's shape and is dereferenced by
 * fetching it rather than by reading the project.
 */
export function parseQgisStyleAssetHref(href: string): {
  /** Path of the project document the style is in; null for a bare fragment. */
  documentPath: string | null
  layerId: string
  styleName: string
} | null {
  const hash = href.indexOf('#')
  if (hash < 0) return null

  const fragment = href.slice(hash + 1)
  const slash = fragment.indexOf('/')
  if (slash <= 0 || slash === fragment.length - 1) return null

  try {
    const document = href.slice(0, hash)
    return {
      documentPath: document ? decodeAssetPath(document) : null,
      layerId: decodeURIComponent(fragment.slice(0, slash)),
      styleName: decodeURIComponent(fragment.slice(slash + 1))
    }
  } catch {
    // A malformed escape sequence — not an address this wrote.
    return null
  }
}

/** The active style, then the rest in the order the project lists them. */
function orderActiveStyleFirst(styles: LayerStyle[], activeIndex: number): LayerStyle[] {
  const active = styles[activeIndex]
  if (!active) return styles
  return [active, ...styles.filter((style) => style !== active)]
}

/**
 * A layer's bbox in WGS84: QGIS's own `<wgs84extent>` when it wrote one,
 * otherwise the caller-supplied reprojection of `layer.extent` keyed by
 * layer id, otherwise null. `layer.extent` itself is in the layer's CRS and
 * is never published as it stands.
 */
function effectiveWgs84Bbox(
  layer: LayerEntry,
  layerWgs84Extents: Map<string, BoundingBox> | undefined
): BoundingBox | null {
  return layer.wgs84Extent ?? layerWgs84Extents?.get(layer.id) ?? null
}

/**
 * Returns the union of all layers' bboxes (preferring wgs84Extent, then a
 * caller-supplied reprojection), or null if no layer has any extent.
 */
function unionExtent(layers: LayerEntry[], layerWgs84Extents: Map<string, BoundingBox> | undefined): BoundingBox | null {
  return unionBboxes(layers.map((layer) => effectiveWgs84Bbox(layer, layerWgs84Extents)))
}

/**
 * Emits a `table:columns` array seeded by the canonical list of fields
 * QGIS declares in <fieldConfiguration>, enriched with whatever extra
 * metadata is available:
 *
 * - **name**       always — from `fieldNames` (or as a fallback, from
 *                  GeoJSON properties or alias keys, so callers that
 *                  haven't parsed fieldConfiguration still get something)
 * - **title**      from QGIS field aliases when set (non-empty)
 * - **type**       inferred from every GeoJSON property value when data
 *                  is available; omitted otherwise (QGIS doesn't declare
 *                  field types in the .qgs for WFS layers — the type
 *                  fills in once the WFS fetch resolves and the STAC
 *                  catalogue regenerates)
 * - **values**     a field's ValueMap picklist, when QGIS's edit widget
 *                  config declares one
 * - **quac:value_relation**
 *                  the Collection a field's choices are read from, when
 *                  QGIS's Value Relation edit widget names one the project holds
 * - **quac:attachment**
 *                  that the field holds a file's path, when QGIS's
 *                  Attachment edit widget declares one
 * - **quac:editable** / **quac:default** /
 *   **quac:constraints** / **quac:hidden** /
 *   **quac:reuse_last_value**
 *                  that the field cannot be changed, a value it is filled
 *                  with, that it must not be blank, that the form never
 *                  shows it, and that a new feature is offered its last
 *                  value, from QGIS's Attributes Form
 * - **quac:color**  that the field holds a colour, when QGIS's Color edit
 *                  widget declares one
 * - **quac:visible_when** / **quac:in_form** / **quac:editable_when**
 *                  the expressions that decide whether the form shows the
 *                  field, that the form layout does not place it, and the
 *                  expression that locks it while false, from
 *                  QGIS's Drag and Drop Designer
 * - **quac:icon**   the address of the icon drawn beside the field's name,
 *                  from the layer's `quac_icon_<field>` variable
 * - **quac:control** the control the edit form draws the field's choices
 *                  with, from the layer's `quac_control_<field>` variable
 *
 * The QGS fieldConfiguration is the source of truth for "what fields
 * exist": this means a hidden WFS layer's schema is fully visible to the
 * dev panel and to STAC clients before any data is fetched.
 */
function deriveTableColumns(
  geojson: FeatureCollection | null,
  fieldNames: string[],
  fieldAliases: Record<string, string>,
  fieldValueMaps: Record<string, FieldValueMapEntry[]> = {},
  fieldAttachments: Record<string, FieldAttachment> = {},
  fieldEditRules: Record<string, FieldEditRule> = {},
  fieldValueRelations: Record<string, TableColumnValueRelation> = {},
  formLayout: LayerFormLayout | null = null,
  fieldIcons: Record<string, string> = {},
  fieldControls: Record<string, FieldControl> = {}
): TableColumn[] {
  const observedTypes = new Map<string, TableColumnType>()
  const orderedFieldNames: string[] = []
  const seen = new Set<string>()
  const addFieldName = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    orderedFieldNames.push(name)
  }

  // Canonical order from QGIS fieldConfiguration.
  for (const name of fieldNames) addFieldName(name)
  // Pick up alias-only fields (rare) and GeoJSON-only fields (e.g. if QGIS
  // didn't write fieldConfiguration) so nothing is silently dropped.
  for (const name of Object.keys(fieldAliases)) addFieldName(name)

  if (geojson) {
    for (const feature of geojson.features) {
      const props = feature.properties
      if (!props) continue
      for (const [key, value] of Object.entries(props)) {
        addFieldName(key)
        if (value === null || value === undefined) continue
        const type = inferTableType(value)
        const observed = observedTypes.get(key)
        observedTypes.set(key, observed ? widenTableType(observed, type) : type)
      }
    }
  }

  const placedFields = new Map(formLayout?.fields.map((field) => [field.name, field]))
  return orderedFieldNames.map((name) => {
    const column: TableColumn = { name }
    const type = observedTypes.get(name)
    if (type) column.type = type
    const alias = fieldAliases[name]
    if (alias) column.title = alias
    const values = fieldValueMaps[name]
    if (values) column.values = values
    const valueRelation = fieldValueRelations[name]
    if (valueRelation) column['quac:value_relation'] = valueRelation
    const attachment = fieldAttachments[name]
    if (attachment) column['quac:attachment'] = attachmentToJson(attachment)
    const editRule = fieldEditRules[name]
    if (editRule?.readOnly) column['quac:editable'] = false
    if (editRule?.defaultValue) column['quac:default'] = defaultToJson(editRule.defaultValue)
    else if (editRule?.defaultExpression) {
      column['quac:default'] = { kind: 'expression', expression: editRule.defaultExpression.expression, on_update: editRule.defaultExpression.onUpdate }
    }
    if (editRule?.notNull || editRule?.unique || editRule?.constraintExpression) {
      const { constraintExpression } = editRule
      column['quac:constraints'] = {
        ...(editRule.notNull ? { not_null: editRule.notNull } : {}),
        ...(editRule.unique ? { unique: editRule.unique } : {}),
        ...(constraintExpression ? { expression: constraintExpressionToJson(constraintExpression) } : {})
      }
    }
    if (editRule?.hidden) column['quac:hidden'] = true
    if (editRule?.reuseLastValue) column['quac:reuse_last_value'] = true
    if (editRule?.duplicatePolicy) column['quac:duplicate_policy'] = editRule.duplicatePolicy
    if (editRule?.checkbox) {
      const { checkedValue, uncheckedValue, showStoredValue, allowNull } = editRule.checkbox
      column['quac:checkbox'] = {
        ...(checkedValue ? { checked: checkedValue } : {}),
        ...(uncheckedValue ? { unchecked: uncheckedValue } : {}),
        ...(showStoredValue ? { show_stored: true as const } : {}),
        ...(allowNull ? { allow_null: true as const } : {})
      }
    }
    if (editRule?.range) column['quac:range'] = { ...editRule.range }
    if (editRule?.dateFormat) column['quac:date_format'] = editRule.dateFormat
    if (editRule?.colour) column['quac:color'] = true
    const icon = fieldIcons[name]
    if (icon) column['quac:icon'] = icon
    const control = fieldControls[name]
    if (control) column['quac:control'] = control
    if (formLayout) {
      const placed = placedFields.get(name)
      if (!placed) column['quac:in_form'] = false
      else if (placed.visibleWhen.length > 0) column['quac:visible_when'] = [...placed.visibleWhen]
      if (placed?.editableWhen) column['quac:editable_when'] = placed.editableWhen
    }
    return column
  })
}

/** A field's constraint expression as `quac:constraints` stores it: a description the source left blank is left off. */
function constraintExpressionToJson(constraint: FieldConstraintExpression): NonNullable<TableColumnConstraints['expression']> {
  return {
    expression: constraint.expression,
    ...(constraint.description ? { description: constraint.description } : {}),
    strength: constraint.strength
  }
}

/** A field's default value as `quac:default` stores it. */
function defaultToJson(defaultValue: FieldDefaultValue): TableColumnDefault {
  switch (defaultValue.kind) {
    case 'now': return { kind: 'now', on_update: defaultValue.onUpdate }
    case 'uuid': return { kind: 'uuid', format: defaultValue.format, on_update: defaultValue.onUpdate }
    case 'fixed': return { kind: 'fixed', value: defaultValue.value, on_update: defaultValue.onUpdate }
  }
}

/**
 * A field's Attachment widget as `quac:attachment` stores it. A member
 * the source said nothing about is left off rather than written null.
 */
function attachmentToJson(attachment: FieldAttachment): TableColumnAttachment {
  return {
    ...(attachment.viewer ? { viewer: attachment.viewer } : {}),
    ...(attachment.filter ? { filter: attachment.filter } : {}),
    ...(attachment.defaultRoot ? { default_root: attachment.defaultRoot } : {}),
    relative_storage: attachment.relativeStorage
  }
}

/**
 * The narrowest type holding values of both types: `int` and `long` make
 * `long`, a whole number and a fraction make `double`, a date and a timestamp
 * make `timestamp`, and any other pair makes `string`.
 */
function widenTableType(a: TableColumnType, b: TableColumnType): TableColumnType {
  if (a === b) return a
  const pair = new Set([a, b])
  if (pair.has('double') && (pair.has('int') || pair.has('long'))) return 'double'
  if (pair.has('int') && pair.has('long')) return 'long'
  if (pair.has('date') && pair.has('timestamp')) return 'timestamp'
  return 'string'
}

/** The range of a 32-bit integer, the values an `int` column holds. */
const INT32_MIN = -(2 ** 31)
const INT32_MAX = 2 ** 31 - 1

function inferTableType(value: unknown): TableColumnType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return 'double'
    return value >= INT32_MIN && value <= INT32_MAX ? 'int' : 'long'
  }
  if (typeof value === 'string') {
    // ISO-8601 date or datetime sniffing — strict to avoid false positives.
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
      return value.length > 10 ? 'timestamp' : 'date'
    }
    return 'string'
  }
  return 'string'
}
