import { buildStacExtent, unionBboxes, withDataType } from './normalizedProject'
import { serverLayerTree, wmsPublishedLayerIds } from './serverLayerTree'
import { generateStacCatalogue } from './stacCatalogue'
import { wfsGetFeatureAsset } from './wfsStacCatalogue'
import { mapQtTypeToStacTableType } from './wmsStacCatalogue'
import { declareQuacExtension, QUAC_SCHEMA_URL } from '../model/quacExtension'
import { chooseWmsCrs, WEB_MAP_LINKS_EXTENSION, WMS_REQUEST_PARAMETERS } from '../model/stacWms'

import type { BoundingBox, LayerEntry, QgsProject } from '../model/QgsProject'
import type { StacCatalog, StacCollection, StacLink, TableColumn } from '../model/Stac'

/**
 * The catalogue a QGIS Server would serve for a project: the QUAC plugin's
 * route, as a pure function of the project's text and the server's address, so
 * that the plugin's Python port has one function to agree with
 * (`docs/plans/quac-separation.md`, package 3). Nothing in Groundwork calls it.
 *
 * It starts from the catalogue a project file gives (`generateStacCatalogue`)
 * and applies the project's own QGIS Server settings, as GetProjectSettings
 * does:
 *
 * - A layer or group whose name the project leaves out of WMS
 *   (`WMSRestrictedLayers`) is left out, with every layer inside the group. A
 *   layer published for WFS but left out of WMS is left out too, because a
 *   server's Collection id is the WMS name (D1). A file the project splits into
 *   a layer per shape is left out: the project route writes it as one
 *   Collection, and QGIS Server names each of its layers separately.
 * - Each Collection's id is the layer's WMS name, and every reference to
 *   another Collection is rewritten to that id or, where that Collection is not
 *   served, dropped.
 * - Its data is reached through the server only: a WFS GetFeature data asset
 *   where the project publishes the layer for WFS, and a WMS link always, in
 *   the CRS `chooseWmsCrs` picks from `serverWmsCrsList`. No
 *   file path, style asset, `via` link or detail of the layer's own data source
 *   is written, nor an Attachment widget's default folder.
 * - A field the project hides from WMS or from WFS is left out of
 *   `table:columns`, and every mention of it is dropped: from the form order,
 *   the preset filters, the display field, a relation's join, and any
 *   expression that uses it, except that a lock's expression becomes `true`
 *   and a field editable only while an expression holds becomes read-only, so
 *   that hiding a field never unlocks an edit.
 *
 * - The top-level Catalog's extent covers the served layers only, so a layer the
 *   project keeps off the web does not widen it.
 *
 * Two inputs come from QGIS Server rather than the project's text, which does
 * not hold them: each field's type, as GetProjectSettings reports it, which
 * gives the column its `type`; and the WGS84 box of a layer whose project saves
 * no `<wgs84extent>`. A field or layer left out of them has none.
 *
 * The access answers of the person asking are not applied; the plugin applies
 * them to this function's result.
 *
 * Throws for a server address that `serverWmsEndpoint` refuses: one that is not
 * an `http` or `https` address, has no host, holds a space or a control
 * character, or holds a user name or password, which every served data address
 * would repeat.
 */
export function generateServerStacCatalogue(project: QgsProject, options: ServerCatalogueOptions): StacCatalog {
  const wmsHref = serverWmsEndpoint(options.serverAddress)
  if (!wmsHref) throw new Error('The server address must be an http or https address with a host, and hold no user name, password, space or control character, in its query either.')
  const layerWgs84Extents = options.layerWgs84Extents ?? {}
  const catalogue = generateStacCatalogue(project, [], { layerWgs84Extents: new Map(Object.entries(layerWgs84Extents)) })
  const layersById = new Map(project.layers.map((layer) => [layer.id, layer]))
  const restricted = new Set(project.wmsPublishing?.restrictedLayers ?? [])
  const servedLayerIds = wmsPublishedLayerIds(serverLayerTree(project))
  const wfsPublished = new Set(project.wfsTransactionLayers?.published ?? [])

  const servedIds = new Map<string, string>()
  const walkIds = (node: StacCatalog): void => {
    for (const collection of node.collections ?? []) {
      const wmsName = collection['quac:qgis_server_wms_name']
      if (servedLayerIds.has(collection.id) && typeof wmsName === 'string') servedIds.set(collection.id, wmsName)
    }
    for (const child of node.catalogs ?? []) walkIds(child)
  }
  walkIds(catalogue)

  const context: ServeContext = {
    layersById,
    servedIds,
    wfsPublished,
    serverAddress: options.serverAddress,
    wmsHref,
    wmsCrs: chooseWmsCrs(serverWmsCrsList(project)),
    fieldTypes: options.fieldTypes ?? {}
  }

  const serveCatalog = (node: StacCatalog): StacCatalog => {
    const collections = (node.collections ?? []).filter((collection) => servedIds.has(collection.id)).map((collection) => serveCollection(collection, context))
    const catalogs = (node.catalogs ?? []).filter((child) => !restricted.has(child.title ?? '')).map(serveCatalog)
    const served: StacCatalog = { ...node, links: [...node.links.filter((link) => link.rel !== 'child'), ...childLinks(collections, catalogs)] }
    delete served.collections
    delete served.catalogs
    delete served.stac_extensions
    if (collections.length > 0) served.collections = collections
    if (catalogs.length > 0) served.catalogs = catalogs
    return served
  }

  const served = serveCatalog(catalogue)
  const servedBox = unionBboxes([...servedIds.keys()].map((layerId) => layersById.get(layerId)?.wgs84Extent ?? layerWgs84Extents[layerId] ?? null))
  if (servedBox) served['extent'] = buildStacExtent(servedBox)
  else delete served['extent']
  const active = served['quac:active_collection']
  const activeId = typeof active === 'string' ? servedIds.get(active) : undefined
  if (activeId) served['quac:active_collection'] = activeId
  else delete served['quac:active_collection']
  return declareQuacExtension(served)
}

/**
 * The address a served layer's WMS link names: the server's address as
 * written, its scheme lower-cased, less its fragment and any query parameter a
 * WMS request sets, such as `SERVICE` or `REQUEST`. Other parameters, such as
 * `MAP`, are kept as written. The rule is spelled out rather than left to the
 * `URL` class, so that the plugin's Python gives the same address
 * (`docs/plans/quac-separation.md`, package 6). Null for an address that is not
 * `http` or `https`, has no host, holds a user name or password, or holds a
 * space or a control character. A query holding `@` or the word `password`,
 * in any case and escaped or not, is refused too: it may hold a project's
 * database connection, such as `MAP=postgresql://user:secret@db/…`, which every
 * served address would repeat.
 */
export function serverWmsEndpoint(serverAddress: string): string | null {
  if ([...serverAddress].some((char) => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f)) return null
  const match = /^(https?):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(serverAddress)
  if (!match) return null
  const [, scheme, authority, path, query] = match as unknown as [string, string, string, string, string | undefined]
  if (!authority || authority.includes('@')) return null
  if (/@|%40|password/i.test(query ?? '')) return null
  const kept = (query ?? '').split('&').filter((pair) => pair !== '' && !WMS_REQUEST_PARAMETERS.has(pair.split('=')[0]!.toUpperCase()))
  return `${scheme.toLowerCase()}://${authority}${path}${kept.length > 0 ? `?${kept.join('&')}` : ''}`
}

/** A field's type as GetProjectSettings reports it: its Qt type name, such as `qlonglong`, and its provider's type name. */
export interface QgisFieldType {
  type: string
  typeName: string
}

export interface ServerCatalogueOptions {
  /** The address QGIS Server serves the project from, as its own `wmsServiceUrl` gives it. */
  serverAddress: string
  /** Each layer's field types, by layer id and then field name. */
  fieldTypes?: Record<string, Record<string, QgisFieldType>>
  /** The WGS84 box of a layer whose project saves no `<wgs84extent>`, by layer id. */
  layerWgs84Extents?: Record<string, BoundingBox>
}

interface ServeContext {
  layersById: Map<string, LayerEntry>
  /** The project's layer id of each served Collection, mapped to its WMS name. */
  servedIds: Map<string, string>
  wfsPublished: Set<string>
  serverAddress: string
  wmsHref: string
  /** The CRS every layer's WMS link asks for. */
  wmsCrs: string
  fieldTypes: Record<string, Record<string, QgisFieldType>>
}

/**
 * The CRSs QGIS Server offers a project's WMS layers in: the project's
 * restriction where it saves one, else the project's own CRS, EPSG:4326 and
 * EPSG:3857 (`QgsServerProjectUtils::wmsOutputCrsList`,
 * `src/server/qgsserverprojectutils.cpp`, `qgis/QGIS@master`, read
 * 2026-11-07). The list is the same for every layer.
 */
export function serverWmsCrsList(project: QgsProject): string[] {
  if (project.wmsCrsList && project.wmsCrsList.length > 0) return [...project.wmsCrsList]
  const projectCrs = project.projectCrs ?? ''
  const crsList = [projectCrs]
  if (projectCrs.toUpperCase() !== 'EPSG:4326') crsList.push('EPSG:4326')
  if (projectCrs.toUpperCase() !== 'EPSG:3857') crsList.push('EPSG:3857')
  return crsList
}

function childLinks(collections: StacCollection[], catalogs: StacCatalog[]): StacLink[] {
  return [
    ...collections.map((collection) => ({ rel: 'child', href: `./collections/${encodeURIComponent(collection.id)}.json`, type: 'application/json', title: collection.title })),
    ...catalogs.map((catalog) => ({ rel: 'child', href: `./catalogs/${encodeURIComponent(catalog.id)}/catalog.json`, type: 'application/json', title: catalog.title }))
  ]
}

/** The fields of a layer QGIS Server hides from either service. */
function hiddenFieldsOf(layer: LayerEntry | undefined): Set<string> {
  return new Set([...(layer?.serverHiddenFields?.wms ?? []), ...(layer?.serverHiddenFields?.wfs ?? [])])
}

/**
 * Whether an expression names one of the fields, in double quotes or bare.
 * It errs towards yes: a word inside a string literal that matches a field name
 * counts, so a hidden name is never kept by mistake.
 */
function mentionsAny(expression: unknown, fields: Set<string>): boolean {
  if (typeof expression !== 'string' || fields.size === 0) return false
  for (const field of fields) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(expression)) return true
  }
  return false
}

/** Fields that name where a layer's own data comes from, which a server's catalogue never carries. */
const SOURCE_FIELDS = ['quac:wfs_endpoint', 'quac:wfs_type_name', 'quac:wfs_srs_name', 'quac:arcgis_layer_url', 'quac:arcgis_where', 'quac:max_zoom']

function serveCollection(source: StacCollection, context: ServeContext): StacCollection {
  const layerId = source.id
  const layer = context.layersById.get(layerId)
  const hidden = hiddenFieldsOf(layer)
  const wmsName = context.servedIds.get(layerId)!
  const wfsTypeName = context.wfsPublished.has(layerId) ? source['quac:qgis_server_wfs_type_name'] : undefined

  const collection: StacCollection = { ...source, id: wmsName, links: [], assets: {} }
  for (const field of SOURCE_FIELDS) delete collection[field]

  const links: StacLink[] = [{ rel: 'wms', href: context.wmsHref, type: 'image/png', 'wms:layers': [wmsName], 'wms:styles': [''], 'wms:transparent': true, 'quac:wms_crs': context.wmsCrs }]
  collection.links = links

  if (typeof wfsTypeName === 'string') {
    collection.assets = { data: wfsGetFeatureAsset(context.serverAddress, wfsTypeName, wmsName) }
    collection['quac:wfs_endpoint'] = context.serverAddress
    collection['quac:wfs_type_name'] = wfsTypeName
  } else {
    delete collection.assets
    collection['quac:editable'] = false
  }

  const extensions = (source.stac_extensions ?? []).filter((url) => url !== QUAC_SCHEMA_URL && url !== WEB_MAP_LINKS_EXTENSION)
  extensions.push(WEB_MAP_LINKS_EXTENSION)
  if (extensions.length > 0) collection.stac_extensions = extensions
  else delete collection.stac_extensions

  if (hidden.has(String(collection['quac:display_field']))) delete collection['quac:display_field']
  serveFormOrder(collection, hidden)
  serveFilters(collection, hidden)
  serveRelations(collection, hidden, context)
  serveLocks(collection, hidden)
  serveColumns(collection, hidden, context, layerId)
  return collection
}

function serveFormOrder(collection: StacCollection, hidden: Set<string>): void {
  const order = collection['quac:form_order']
  if (Array.isArray(order)) collection['quac:form_order'] = order.filter((name) => !hidden.has(String(name)))
}

function serveFilters(collection: StacCollection, hidden: Set<string>): void {
  const filters = collection['quac:filters']
  if (!Array.isArray(filters)) return
  const kept = filters.filter((filter: { field?: unknown }) => !hidden.has(String(filter.field)))
  if (kept.length > 0) collection['quac:filters'] = kept
  else delete collection['quac:filters']
}

function serveRelations(collection: StacCollection, hidden: Set<string>, context: ServeContext): void {
  const relations = collection['quac:related_to']
  if (!Array.isArray(relations)) return
  const kept = relations.flatMap((relation: { parent_collection_id: string; fields: Array<{ parent: string; child: string }> }) => {
    const parentId = context.servedIds.get(relation.parent_collection_id)
    if (!parentId) return []
    const parentHidden = hiddenFieldsOf(context.layersById.get(relation.parent_collection_id))
    if (relation.fields.some((pair) => hidden.has(pair.child) || parentHidden.has(pair.parent))) return []
    return [{ ...relation, parent_collection_id: parentId }]
  })
  if (kept.length > 0) collection['quac:related_to'] = kept
  else delete collection['quac:related_to']
}

function serveLocks(collection: StacCollection, hidden: Set<string>): void {
  const locks = collection['quac:locks']
  if (!locks || typeof locks !== 'object') return
  const served: Record<string, unknown> = {}
  for (const [edit, lock] of Object.entries(locks as Record<string, unknown>)) {
    served[edit] = lock && typeof lock === 'object' && mentionsAny((lock as { expression?: unknown }).expression, hidden) ? true : lock
  }
  collection['quac:locks'] = served
}

function serveColumns(collection: StacCollection, hidden: Set<string>, context: ServeContext, layerId: string): void {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return
  const fieldTypes = context.fieldTypes[layerId] ?? {}
  const kept = (columns as TableColumn[])
    .filter((column) => !hidden.has(column.name))
    .map((column) => withFieldType(serveColumn(column, hidden, context), fieldTypes[column.name]))
  if (kept.length > 0) collection['table:columns'] = kept
  else delete collection['table:columns']
}

/** The column with the `type` QGIS Server reports for its field, and the `data_type` beside it, where QGIS Server reports one. */
function withFieldType(column: TableColumn, fieldType: QgisFieldType | undefined): TableColumn {
  const type = fieldType ? mapQtTypeToStacTableType(fieldType.type, fieldType.typeName) : undefined
  return type ? withDataType({ ...column, type }) : column
}

function serveColumn(source: TableColumn, hidden: Set<string>, context: ServeContext): TableColumn {
  const column: Record<string, unknown> = { ...source }

  const visibleWhen = column['quac:visible_when']
  if (Array.isArray(visibleWhen)) {
    const kept = visibleWhen.filter((expression) => !mentionsAny(expression, hidden))
    if (kept.length > 0) column['quac:visible_when'] = kept
    else delete column['quac:visible_when']
  }
  // The expression locks the field while it is false, so dropping it alone
  // would unlock the field: it becomes read-only instead.
  if (mentionsAny(column['quac:editable_when'], hidden)) {
    delete column['quac:editable_when']
    column['quac:editable'] = false
  }

  // The folder an Attachment widget saves is a path on the author's machine.
  const attachment = column['quac:attachment'] as Record<string, unknown> | undefined
  if (attachment && 'default_root' in attachment) {
    const served = { ...attachment }
    delete served.default_root
    column['quac:attachment'] = served
  }

  const fieldDefault = column['quac:default'] as { kind?: unknown; expression?: unknown } | undefined
  if (fieldDefault?.kind === 'expression' && mentionsAny(fieldDefault.expression, hidden)) delete column['quac:default']

  const constraints = column['quac:constraints'] as Record<string, unknown> | undefined
  if (constraints && mentionsAny((constraints.expression as { expression?: unknown } | undefined)?.expression, hidden)) {
    const rest = { ...constraints }
    delete rest.expression
    if (Object.keys(rest).length > 0) column['quac:constraints'] = rest
    else delete column['quac:constraints']
  }

  const relation = column['quac:value_relation'] as { collection: string; key: string; value: string; filter?: string; order_field?: string } | undefined
  if (relation) {
    const lookupId = context.servedIds.get(relation.collection)
    const lookupHidden = hiddenFieldsOf(context.layersById.get(relation.collection))
    const usesHidden = [relation.key, relation.value, relation.order_field].some((field) => field !== undefined && lookupHidden.has(field))
      || mentionsAny(relation.filter, lookupHidden)
      || mentionsAny(relation.filter, hidden)
    if (!lookupId || usesHidden) delete column['quac:value_relation']
    else column['quac:value_relation'] = { ...relation, collection: lookupId }
  }

  return column as unknown as TableColumn
}
