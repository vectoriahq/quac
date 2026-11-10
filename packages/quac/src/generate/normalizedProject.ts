import { readHttpsAddress } from '../model/fieldIconAddress.ts'
import { declareQuacExtension } from '../model/quacExtension.ts'
import { STAC_VERSION } from '../model/Stac.ts'
import { collectCatalogueCollections } from '../model/stacTreeWalk.ts'

import type { EditLock, LayerLocks, LockedEdit, FieldAttachment, FieldCheckbox, FieldConstraintExpression, FieldDefaultExpression, FieldDefaultValue, FieldEditRule, FieldFixedValue, FieldRange, FormLayoutField, LayerFormLayout, LayerScaleRange, ProjectMeasurement } from '../model/QgsProject.ts'
import type { StacAsset, StacCatalog, StacCollection, StacExtent, StacLink, StacProvider, TableColumn, TableColumnAttachment, TableColumnDataType, TableColumnType, TableColumnValue, TableColumnValueRelation } from '../model/Stac.ts'

/**
 * Source-agnostic intermediate model + the single STAC generator that
 * consumes it.
 *
 * Both source pipelines — the static `.qgs` path (QgsProject) and the live
 * QGIS Server path (WmsProject) — project their model into a
 * `NormalizedProject`, then hand it to `generateStacFromNormalized`. All the
 * shared tree-walk / catalog / collection / link assembly is here once;
 * the per-source wording, id fallbacks, bbox field names, `table:columns`
 * derivation and asset shapes are resolved by the source adapters *before*
 * they build the normalized tree, so this core has no source
 * conditionals.
 *
 * This is the convergence point for the STAC data-model direction: new
 * source types only need a `*ToNormalized` adapter, not a fresh generator.
 */

/**
 * STAC extension URL for the Table extension. Pinned to the version we wrote
 * against — changes here imply schema review since the extension is still
 * maturing.
 */
export const TABLE_EXTENSION = 'https://stac-extensions.github.io/table/v1.3.0/schema.json'

/** STAC extension URL for the Vector extension, whose `vector:geometry_types` a Collection carries. */
export const VECTOR_EXTENSION = 'https://stac-extensions.github.io/vector/v0.1.0/schema.json'

/**
 * The key a Collection takes for the relations that make it a related dataset
 * rather than a map layer (`packages/quac/spec/README.md`). Its value is
 * an array, because one set of records can hang off more than one parent.
 */
export const QUAC_RELATED_TO_FIELD = 'quac:related_to'

/**
 * The key a Collection takes when its source keeps it out of the legend: a QGIS
 * layer's Private flag (`packages/quac/spec/README.md`). Written only as
 * `true`.
 */
export const QUAC_PRIVATE_FIELD = 'quac:private'

/**
 * The key a Collection takes for the edits its source locks: `{ add?,
 * attributes?, geometry?, delete? }`, each `true` or `{ expression }`. Written
 * only where the source locks an edit.
 */
export const QUAC_LOCKS_FIELD = 'quac:locks'

/**
 * The key a Collection takes for the filters its source sets up: a list of
 * `{ field, name? }`, in the source's order. Written only where it sets one.
 */
export const QUAC_FILTERS_FIELD = 'quac:filters'
export const QUAC_LEGEND_IMAGE_FIELD = 'quac:legend_image'

/**
 * The key a Collection takes for the icon drawn beside its name: an `https://`
 * address, the same form as a column's `quac:icon`.
 */
export const QUAC_ICON_FIELD = 'quac:icon'

/**
 * The key a Collection takes for the area and distance units its source gives
 * `$area`, `$length` and `$perimeter` in: `{ area_unit, distance_unit }`, each
 * the name QGIS saves.
 */
export const QUAC_MEASUREMENT_FIELD = 'quac:measurement'

/**
 * The key a Collection takes for the fields its source's form layout places, in
 * the layout's order: a QGIS Drag and Drop Designer form
 * (`packages/quac/spec/README.md`). A Collection whose source has no such layout has no such field.
 */
export const QUAC_FORM_ORDER_FIELD = 'quac:form_order'

/**
 * The key a group Catalog takes when its source shows only one of its children
 * at a time: a QGIS mutually exclusive group. Written only when true.
 */
export const QUAC_MUTUALLY_EXCLUSIVE_FIELD = 'quac:mutually_exclusive'

/**
 * The key a top-level Catalog takes for the box its source's author saved the
 * map showing, in WGS84, as STAC writes a bbox.
 */
const INITIAL_VIEW_FIELD = 'quac:initial_view'

/**
 * The key a top-level Catalog takes for the id of the Collection its source
 * names as the one the map opens with as the active layer.
 */
export const QUAC_ACTIVE_COLLECTION_FIELD = 'quac:active_collection'

/**
 * One relation a Collection declares in `quac:related_to`: the parent
 * Collection its records hang off, the field pair(s) joining them, and the name
 * the relation is shown under.
 */
export interface CollectionRelation {
  /** The relation's id within its catalogue. */
  id: string
  /** Display name for the relation; empty when the source declares none. */
  name: string
  /** Id of the Collection holding the parent records. */
  parentCollectionId: string
  /** The field pairs joining this Collection to the parent. Several make one composite key. */
  fields: CollectionRelationField[]
}

/** One field on each side of a relation's join. */
export interface CollectionRelationField {
  /** Field name on the parent Collection. */
  parent: string
  /** Field name on the Collection holding the relation. */
  child: string
}

/** Bounding box in WGS84, CRS-free — the shape both source bboxes normalise to. */
export interface NormalizedBbox {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

/** A node in the normalized tree — either a group container or a leaf layer. */
export type NormalizedNode = NormalizedGroup | NormalizedLayer

export interface NormalizedGroup {
  kind: 'group'
  /** Slugified catalog id — the adapter has already applied any 'group' fallback. */
  id: string
  /**
   * Raw group title (may be empty). The generator uses `title || undefined`
   * for the catalog's `title`, and the raw value for the child link's title —
   * matching the two source pipelines' original behaviour.
   */
  title: string
  /** Fully-built catalog description (source-specific wording resolved by the adapter). */
  description: string
  /** True when the source shows only one of its children at a time. */
  mutuallyExclusive?: boolean
  children: NormalizedNode[]
}

/**
 * The names QGIS Server gives a layer: its WMS layer name, and its WFS type
 * name where the project publishes it for WFS. Null where the route does not
 * know a name.
 */
export interface QgisServerNames {
  wmsName: string | null
  wfsTypeName: string | null
}

export interface NormalizedLayer {
  kind: 'layer'
  /** Collection id. */
  id: string
  /** Collection title — also used verbatim as the child link's title. */
  title: string
  /** Fully-built collection description. */
  description: string
  /** WGS84 bbox; null falls back to the world extent in `buildStacExtent`. */
  bbox: NormalizedBbox | null
  /** The geometry type as QGIS names it, written as `quac:geometry_type`. */
  geometryType: string | null
  /**
   * The WKB type names the layer's features take, such as `MultiPolygon` or
   * `PointZ`: one for most layers, one per shape for a file the project splits
   * into a layer per shape. Written as `vector:geometry_types` where each is a
   * GeoJSON type. Empty or absent where the source does not give them.
   */
  wkbTypes?: readonly string[]
  /** The names QGIS Server gives the layer, written as `quac:qgis_server_wms_name` and `quac:qgis_server_wfs_type_name`. */
  qgisServerNames?: QgisServerNames | null
  /** Already-derived `table:columns`; empty array omits the Table extension. */
  tableColumns: TableColumn[]
  /** Already-built STAC assets for this layer. */
  assets: Record<string, StacAsset>
  /** Free-text keywords the source declares; omitted from the Collection when empty. */
  keywords?: string[]
  /** SPDX identifier or free text the source declares; falls back to `'other'` when absent. */
  license?: string | null
  /** Who produced, licensed or hosts this layer's data, beyond the project-wide defaults. */
  providers?: StacProvider[]
  /** When the source says its description of the layer was created, as an ISO 8601 UTC time; omitted when it does not. */
  created?: string
  /** When the source says its description of the layer was last changed, as an ISO 8601 UTC time; omitted when it does not. */
  updated?: string
  /** Temporal range the source declares; falls back to the open interval when absent. */
  temporalInterval?: [string | null, string | null] | null
  displayField: string | null
  /**
   * Whether the source has this layer switched on. Records the project author's
   * intent, so a source that declares none of it — a bare WFS service or a
   * folder of files — passes null and the field is left off the
   * Collection entirely.
   */
  visibilityChecked: boolean | null
  /**
   * Emits `quac:editable` when non-null. The WMS path passes null because
   * GetProjectSettings doesn't expose readOnly, so it omits the field.
   */
  editable: boolean | null
  /**
   * Emits `quac:identifiable` when non-null: false means the layer can be shown on
   * the map but never become the active layer. A source with no such
   * declaration leaves it off.
   */
  identifiable?: boolean | null
  /**
   * The scales the source draws the layer between. Emitted as
   * `quac:min_scale` and `quac:max_scale`, each only when it sets a limit.
   */
  scaleRange?: LayerScaleRange | null
  /**
   * The opacity the source draws the layer at, from 0 to 1. Emitted as
   * `quac:opacity` when non-null; a source with no author behind it leaves it off.
   */
  opacity?: number | null
  /**
   * Relations with this layer as the child. Emitted as
   * `quac:related_to`; a layer with none has no such field.
   */
  relatedTo?: CollectionRelation[]
  /** Emitted as `quac:private` when true: the source keeps the layer out of its legend. */
  isPrivate?: boolean
  /** Emitted as `quac:legend_image`: the image the source shows in place of the layer's legend, as a `data:` URL. */
  legendImage?: string | null
  /** Emitted as `quac:icon`: the `https://` address of the icon drawn beside the layer's name. */
  icon?: string | null
  /** Emitted as `quac:locks` where it locks an edit. */
  locks?: LayerLocks
  /** Emitted as `quac:filters` where the source sets one up. */
  filters?: CollectionFilter[]
  /**
   * The names of the fields the source's form layout places, in its order.
   * Emitted as `quac:form_order`; absent for a source with no form layout.
   */
  formOrder?: string[]
  /**
   * Source-declaring fields copied straight onto the Collection, such as
   * the `quac:wfs_*` keys the profile defines. Omitted keys simply don't appear on the
   * Collection.
   */
  vendorFields?: Record<string, unknown>
  links?: StacLink[]
  extensions?: string[]
}

export interface NormalizedProject {
  /** Slugified catalog id — adapter has applied any project-level fallback. */
  id: string
  /** Raw project title; the catalog's `title` becomes `title || undefined`. */
  title: string
  /** Fully-built top-level catalog description. */
  description: string
  /** Catalog-level WGS84 bbox, covering the data; null omits the extent entirely. */
  bbox: NormalizedBbox | null
  /**
   * The WGS84 box the source's author saved the map showing. A different fact
   * from `bbox`; null or absent where the source saves no view.
   */
  initialView?: NormalizedBbox | null
  /**
   * The id of the Collection the source names as the map's opening active
   * layer. Written only where the tree holds a Collection with that id; null
   * or absent where the source names none.
   */
  activeCollectionId?: string | null
  /** Vendor-namespaced fields copied straight onto the top-level Catalog. */
  vendorFields?: Record<string, unknown>
  /**
   * Project-wide providers — the project's own author, say — merged onto
   * every Collection the tree produces, alongside whatever that layer
   * declares of its own.
   */
  providers?: StacProvider[]
  /** Ordered top-level tree (the source root group's children, flattened one level). */
  nodes: NormalizedNode[]
}

/**
 * Records where a catalogue came from as the Catalog's `self` link, so the
 * document says it rather than the app holding it alongside. Sources with no
 * address of their own leave it off.
 */
export function withSelfLink(catalogue: StacCatalog, selfHref: string | undefined): StacCatalog {
  if (!selfHref) return catalogue
  catalogue.links = [
    ...catalogue.links.filter((link) => link.rel !== 'self'),
    { rel: 'self', href: selfHref, type: 'application/json' }
  ]
  return catalogue
}

/**
 * Builds a STAC Catalog tree from a NormalizedProject, listing the QUAC schema
 * in `stac_extensions` where `declareQuacExtension` says:
 *   NormalizedProject   → top-level Catalog
 *   group nodes         → nested Catalogs
 *   layer nodes         → Collections
 */
export function generateStacFromNormalized(project: NormalizedProject): StacCatalog {
  const { collections, catalogs, links } = walkNodes(project.nodes, project.providers ?? [])

  const catalog: StacCatalog = {
    type: 'Catalog',
    stac_version: STAC_VERSION,
    id: project.id,
    title: project.title || undefined,
    description: project.description,
    links: [
      { rel: 'self', href: './catalog.json' },
      { rel: 'root', href: './catalog.json' },
      ...links
    ]
  }

  if (project.bbox) {
    catalog['extent'] = buildStacExtent(project.bbox)
  }

  if (project.initialView) {
    const { xmin, ymin, xmax, ymax } = project.initialView
    catalog[INITIAL_VIEW_FIELD] = [xmin, ymin, xmax, ymax]
  }

  for (const [key, value] of Object.entries(project.vendorFields ?? {})) {
    catalog[key] = value
  }

  if (collections.length > 0) catalog.collections = collections
  if (catalogs.length > 0) catalog.catalogs = catalogs

  const activeCollectionId = project.activeCollectionId
  if (activeCollectionId && collectCatalogueCollections(catalog).some((collection) => collection.id === activeCollectionId)) {
    catalog[QUAC_ACTIVE_COLLECTION_FIELD] = activeCollectionId
  }

  return declareQuacExtension(catalog)
}

interface WalkResult {
  catalogs: StacCatalog[]
  collections: StacCollection[]
  links: StacLink[]
}

function walkNodes(nodes: NormalizedNode[], defaultProviders: StacProvider[]): WalkResult {
  const collections: StacCollection[] = []
  const catalogs: StacCatalog[] = []
  const links: StacLink[] = []

  for (const node of nodes) {
    if (node.kind === 'layer') {
      const collection = buildCollection(node, defaultProviders)
      collections.push(collection)
      links.push({
        rel: 'child',
        href: `./collections/${collection.id}.json`,
        type: 'application/json',
        title: collection.title
      })
    } else {
      const sub = walkNodes(node.children, defaultProviders)
      const subCatalog: StacCatalog = {
        type: 'Catalog',
        stac_version: STAC_VERSION,
        id: node.id,
        title: node.title || undefined,
        description: node.description,
        links: [
          { rel: 'self', href: `./catalogs/${node.id}/catalog.json` },
          { rel: 'parent', href: '../../catalog.json' },
          { rel: 'root', href: '../../catalog.json' },
          ...sub.links
        ]
      }
      if (node.mutuallyExclusive) subCatalog[QUAC_MUTUALLY_EXCLUSIVE_FIELD] = true
      if (sub.collections.length > 0) subCatalog.collections = sub.collections
      if (sub.catalogs.length > 0) subCatalog.catalogs = sub.catalogs
      catalogs.push(subCatalog)
      links.push({
        rel: 'child',
        href: `./catalogs/${node.id}/catalog.json`,
        type: 'application/json',
        title: node.title
      })
    }
  }

  return { collections, catalogs, links }
}

function buildCollection(layer: NormalizedLayer, defaultProviders: StacProvider[]): StacCollection {
  const stacExtensions: string[] = [...(layer.extensions ?? [])]
  if (layer.tableColumns.length > 0) {
    stacExtensions.push(TABLE_EXTENSION)
  }

  const vectorGeometryTypes = geoJsonGeometryTypes(layer.wkbTypes ?? [])
  if (vectorGeometryTypes) stacExtensions.push(VECTOR_EXTENSION)

  const summaries: Record<string, unknown> = {}
  if (layer.geometryType) summaries['quac:geometry_type'] = [layer.geometryType]

  const providers = [...defaultProviders, ...(layer.providers ?? [])]

  const collection: StacCollection = {
    type: 'Collection',
    stac_version: STAC_VERSION,
    id: layer.id,
    title: layer.title,
    description: layer.description,
    license: layer.license ?? 'other',
    providers: providers.length > 0 ? providers : undefined,
    extent: buildStacExtent(layer.bbox, layer.temporalInterval ?? undefined),
    summaries: Object.keys(summaries).length > 0 ? summaries : undefined,
    assets: layer.assets,
    links: [
      { rel: 'self', href: `./collections/${layer.id}.json` },
      { rel: 'parent', href: '../catalog.json' },
      { rel: 'root', href: '../catalog.json' },
      ...(layer.links ?? [])
    ]
  }

  if (layer.keywords && layer.keywords.length > 0) collection['keywords'] = layer.keywords
  if (layer.created) collection['created'] = layer.created
  if (layer.updated) collection['updated'] = layer.updated

  // Per-layer source declarations that STAC core does not model. Attached
  // directly on the Collection (not under summaries) since they're single
  // values per layer, not facet ranges.
  if (layer.displayField) collection['quac:display_field'] = layer.displayField
  if (layer.visibilityChecked !== null) collection['quac:visibility_checked'] = layer.visibilityChecked
  if (layer.editable !== null) collection['quac:editable'] = layer.editable
  if (layer.identifiable != null) collection['quac:identifiable'] = layer.identifiable
  if (layer.scaleRange?.minScale) collection['quac:min_scale'] = layer.scaleRange.minScale
  if (layer.scaleRange?.maxScale) collection['quac:max_scale'] = layer.scaleRange.maxScale
  if (layer.opacity != null) collection['quac:opacity'] = layer.opacity

  // A Collection with this is a related dataset rather than a map layer,
  // and the field states what its records hang off.
  if (layer.relatedTo && layer.relatedTo.length > 0) {
    collection[QUAC_RELATED_TO_FIELD] = layer.relatedTo.map(relationToJson)
  }

  if (layer.isPrivate) collection[QUAC_PRIVATE_FIELD] = true
  if (layer.locks && Object.keys(layer.locks).length > 0) collection[QUAC_LOCKS_FIELD] = { ...layer.locks }
  if (layer.filters && layer.filters.length > 0) {
    collection[QUAC_FILTERS_FIELD] = layer.filters.map(({ field, name }) => (name ? { field, name } : { field }))
  }
  if (layer.legendImage) collection[QUAC_LEGEND_IMAGE_FIELD] = layer.legendImage
  if (layer.icon) collection[QUAC_ICON_FIELD] = layer.icon
  if (layer.formOrder) collection[QUAC_FORM_ORDER_FIELD] = layer.formOrder

  // Source-declaring vendor fields (`quac:wfs_*`), copied verbatim so a consumer reads the source structurally rather than by
  // sniffing the asset href.
  for (const [key, value] of Object.entries(layer.vendorFields ?? {})) {
    collection[key] = value
  }

  if (stacExtensions.length > 0) collection.stac_extensions = stacExtensions
  if (vectorGeometryTypes) collection['vector:geometry_types'] = vectorGeometryTypes
  if (layer.qgisServerNames?.wmsName) collection['quac:qgis_server_wms_name'] = layer.qgisServerNames.wmsName
  if (layer.qgisServerNames?.wfsTypeName) collection['quac:qgis_server_wfs_type_name'] = layer.qgisServerNames.wfsTypeName
  if (layer.tableColumns.length > 0) collection['table:columns'] = layer.tableColumns.map(withDataType)

  return collection
}

/** The geometry types GeoJSON defines, the only values `vector:geometry_types` takes. */
const GEOJSON_GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'])

/**
 * The GeoJSON geometry types of WKB type names, each once: a name less any Z,
 * M, ZM or 25D suffix, where that is a GeoJSON type. Null where there are no
 * names, or where one has no GeoJSON type, such as `CompoundCurve` or
 * `NoGeometry`, since a list missing it would misstate the layer.
 */
function geoJsonGeometryTypes(wkbTypes: readonly string[]): string[] | null {
  const types = new Set<string>()
  for (const wkbType of wkbTypes) {
    const base = wkbType.replace(/(ZM|Z|M|25D)$/, '')
    if (!GEOJSON_GEOMETRY_TYPES.has(base)) return null
    types.add(base)
  }
  return types.size > 0 ? [...types] : null
}

/**
 * The STAC common metadata data type each column type holds its values in
 * (`commons/common-metadata.md` § Data Types, `radiantearth/stac-spec@master`,
 * read 2026-11-03). `int` is a 32-bit integer, as Qt's `int` and ArcGIS's
 * integer field are; `long` is 64-bit and `double` a 64-bit float.
 */
const DATA_TYPE_BY_COLUMN_TYPE: Record<TableColumnType, TableColumnDataType> = {
  int: 'int32',
  long: 'int64',
  double: 'float64',
  string: 'other',
  boolean: 'other',
  date: 'other',
  time: 'other',
  timestamp: 'other'
}

/**
 * The column with `data_type` written beside its `type`, as the Table
 * extension recommends. A `type` outside `TableColumnType`, such as a QGIS
 * Server type name Groundwork does not map, gets no `data_type`.
 */
export function withDataType(column: TableColumn): TableColumn {
  const type = column.type
  if (!type || !Object.hasOwn(DATA_TYPE_BY_COLUMN_TYPE, type)) return column
  return { ...column, data_type: DATA_TYPE_BY_COLUMN_TYPE[type as TableColumnType] }
}

/**
 * Reads `quac:active_collection` back off a Catalog: the id of the Collection
 * the map opens with as the active layer, or null where the source names none.
 */
export function readCatalogueActiveCollection(catalog: StacCatalog): string | null {
  const value: unknown = catalog[QUAC_ACTIVE_COLLECTION_FIELD]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Reads `quac:initial_view` back off a Catalog.
 *
 * Returns null for a Catalog that declares nothing, which is what every source
 * with no saved view behind it publishes. Null means "the source said nothing
 * about where to open", so a caller frames the map its own way rather than
 * reading a missing field as an instruction.
 */
export function readCatalogueInitialView(catalog: StacCatalog): NormalizedBbox | null {
  const value: unknown = catalog[INITIAL_VIEW_FIELD]
  if (!Array.isArray(value) || value.length !== 4) return null
  const numbers = (value as unknown[]).filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)
  )
  if (numbers.length !== 4) return null

  const [xmin, ymin, xmax, ymax] = numbers as [number, number, number, number]
  // A box with no width or height frames nothing, and an inverted one frames
  // the whole world — neither is a view, so neither is read as one.
  if (xmin >= xmax || ymin >= ymax) return null
  return { xmin, ymin, xmax, ymax }
}

/**
 * Reads shared source declarations back off a Collection.
 *
 * Each returns null for a Collection that declares nothing, which is what every
 * source with no author behind it publishes. Null means "the source said
 * nothing", never "the source said no", so a caller supplies its own default
 * rather than reading a missing field as `false`.
 */

/** The field the source nominates as the layer's title attribute. */
export function readCollectionDisplayField(collection: StacCollection): string | null {
  const value = collection['quac:display_field']
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Field display labels from STAC Table column titles or descriptions. */
export function readCollectionFieldAliases(collection: StacCollection): Record<string, string> {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return {}

  const aliases: Record<string, string> = {}
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue
    const candidate = column as Record<string, unknown>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    const description = typeof candidate.description === 'string' ? candidate.description.trim() : ''
    const alias = title || description
    if (name && alias) aliases[name] = alias
  }
  return aliases
}

/**
 * Every field name a Collection declares, in the order it declares them.
 * Empty for a Collection with no `table:columns`. Read from the catalogue
 * alone, so it lists a column no loaded record holds, which
 * `collectFieldNames` does not.
 */
export function readCollectionFieldNames(collection: StacCollection): string[] {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return []

  const names: string[] = []
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue
    const name = (column as Record<string, unknown>).name
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  return names
}

/** Each declared column `type`, keyed by field name. A column with no `type` is absent. */
export function readCollectionFieldTypes(collection: StacCollection): Record<string, string> {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return {}

  const types: Record<string, string> = {}
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue
    const candidate = column as Record<string, unknown>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const type = typeof candidate.type === 'string' ? candidate.type.trim() : ''
    if (name && type) types[name] = type
  }
  return types
}

/**
 * Each column's `values` picklist, keyed by field name. A value is returned as
 * stored, string or number. An entry with no label, or with a value of any
 * other kind, is dropped, and a column left with no entries is absent.
 */
export function readCollectionFieldValues(collection: StacCollection): Record<string, TableColumnValue[]> {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return {}

  const picklists: Record<string, TableColumnValue[]> = {}
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue
    const candidate = column as Record<string, unknown>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!name || !Array.isArray(candidate.values)) continue

    const entries: TableColumnValue[] = []
    for (const entry of candidate.values) {
      if (!entry || typeof entry !== 'object') continue
      const { value, label, icon } = entry as Record<string, unknown>
      const isValue = typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
      if (!isValue || typeof label !== 'string' || !label.trim()) continue
      const address = readHttpsAddress(icon)
      entries.push(address ? { value, label, icon: address } : { value, label })
    }
    if (entries.length > 0) picklists[name] = entries
  }
  return picklists
}

/**
 * Each column's `quac:value_relation`, keyed by field name — the
 * counterpart of the write in `stacCatalogue.ts`. A column declaring none is
 * absent from the result. An entry missing its Collection id, `key` or `value`
 * is dropped, and an `order_by` that is not `value`, or `field` without an
 * `order_field`, reads as ordered by key.
 */
export function readCollectionFieldValueRelations(collection: StacCollection): Record<string, TableColumnValueRelation> {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return {}

  const relations: Record<string, TableColumnValueRelation> = {}
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue
    const candidate = column as Record<string, unknown>
    const name = readTrimmedString(candidate.name)
    const declared = candidate['quac:value_relation']
    if (!name || !declared || typeof declared !== 'object') continue

    const entry = declared as Record<string, unknown>
    const lookup = readTrimmedString(entry.collection)
    const key = readTrimmedString(entry.key)
    const value = readTrimmedString(entry.value)
    if (!lookup || !key || !value) continue

    const filter = readTrimmedString(entry.filter)
    const orderField = readTrimmedString(entry.order_field)
    const orderBy = entry.order_by === 'value' ? 'value' : entry.order_by === 'field' && orderField ? 'field' : null
    relations[name] = {
      collection: lookup,
      key,
      value,
      ...(filter ? { filter } : {}),
      ...(entry.allow_null === true ? { allow_null: true as const } : {}),
      ...(entry.allow_multi === true ? { allow_multi: true as const } : {}),
      ...(orderBy ? { order_by: orderBy } : {}),
      ...(orderBy === 'field' ? { order_field: orderField } : {}),
      ...(entry.descending === true ? { descending: true as const } : {})
    }
  }
  return relations
}

/**
 * The units a Collection's source measures in, or null where it names none or
 * names anything this does not read, which is read as QGIS's default of square
 * metres and metres.
 */
export function readCollectionMeasurement(collection: StacCollection | null | undefined): ProjectMeasurement | null {
  const value = collection?.[QUAC_MEASUREMENT_FIELD] as { area_unit?: unknown, distance_unit?: unknown } | null | undefined
  if (typeof value?.area_unit !== 'string' || typeof value.distance_unit !== 'string') return null
  return { areaUnit: value.area_unit, distanceUnit: value.distance_unit }
}

/** The image a Collection shows in place of its legend (`quac:legend_image`), or null where it names none a browser draws. */
export function readCollectionLegendImage(collection: StacCollection | null | undefined): string | null {
  const image = collection?.[QUAC_LEGEND_IMAGE_FIELD]
  return typeof image === 'string' && /^data:image\/[\w+.-]+;base64,/.test(image) ? image : null
}

/** The icon drawn beside a Collection's name (`quac:icon`), or null where it names no `https://` address. */
export function readCollectionIcon(collection: StacCollection | null | undefined): string | null {
  return readHttpsAddress(collection?.[QUAC_ICON_FIELD])
}

const LOCKED_EDITS: readonly LockedEdit[] = ['add', 'attributes', 'geometry', 'delete']

/**
 * Reads `quac:locks` back off a Collection: the edits it locks, each `true` or
 * `{ expression }`. A member that is neither, or an expression that is blank,
 * is not read, so the edit stays as the rest of the Collection allows.
 */
export function readCollectionLocks(collection: StacCollection): LayerLocks {
  const value: unknown = collection[QUAC_LOCKS_FIELD]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const locks: LayerLocks = {}
  for (const edit of LOCKED_EDITS) {
    const lock = readEditLock((value as Record<string, unknown>)[edit])
    if (lock) locks[edit] = lock
  }
  return locks
}

function readEditLock(value: unknown): EditLock | null {
  if (value === true) return true
  if (!value || typeof value !== 'object') return null
  const expression: unknown = (value as Record<string, unknown>)['expression']
  return typeof expression === 'string' && expression.trim() !== '' ? { expression } : null
}

/** A filter a Collection's source sets up: the field, and the name it is shown under, null where the source gives none. */
export interface CollectionFilter {
  field: string
  name: string | null
}

/**
 * Reads `quac:filters` back off a Collection, in order. An entry with no
 * field is not read, and a later entry on a field already read is dropped,
 * since a layer holds one filter per field.
 */
export function readCollectionFilters(collection: StacCollection): CollectionFilter[] {
  const value: unknown = collection[QUAC_FILTERS_FIELD]
  if (!Array.isArray(value)) return []
  const filters: CollectionFilter[] = []
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object') continue
    const { field, name } = entry as Record<string, unknown>
    if (typeof field !== 'string' || field === '' || filters.some((filter) => filter.field === field)) continue
    filters.push({ field, name: typeof name === 'string' && name.trim() !== '' ? name : null })
  }
  return filters
}

/** Whether a Collection is private: its source keeps it out of the legend. */
export function readCollectionPrivate(collection: StacCollection): boolean {
  return collection[QUAC_PRIVATE_FIELD] === true
}

/**
 * The fields a Collection declares as holding a file, keyed by field name —
 * the counterpart of the `quac:attachment` write in `stacCatalogue.ts`.
 * A column declaring none is absent from the result.
 *
 * An omitted `viewer`, `filter` or `default_root` reads as null, and an
 * omitted or unrecognised `relative_storage` as absolute.
 */
export function readCollectionFieldAttachments(collection: StacCollection): Record<string, FieldAttachment> {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return {}

  const attachments: Record<string, FieldAttachment> = {}
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue
    const candidate = column as Record<string, unknown>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const declared = candidate['quac:attachment']
    if (!name || !declared || typeof declared !== 'object' || Array.isArray(declared)) continue
    const fields = declared as Partial<TableColumnAttachment>

    attachments[name] = {
      viewer: ATTACHMENT_VIEWERS.includes(fields.viewer as never) ? fields.viewer ?? null : null,
      filter: readNonBlank(fields.filter),
      defaultRoot: readNonBlank(fields.default_root),
      relativeStorage: ATTACHMENT_RELATIVE_STORAGE.includes(fields.relative_storage as never)
        ? fields.relative_storage ?? 'absolute'
        : 'absolute'
    }
  }
  return attachments
}

/**
 * What each column says about changing it, keyed by field name — the
 * counterpart of the `quac:editable`, `quac:default`,
 * `quac:constraints`, `quac:hidden` and
 * `quac:reuse_last_value` writes in `stacCatalogue.ts`. A column
 * declaring none of them is absent from the result.
 *
 * Only `quac:editable: false` makes a field read-only, and only
 * `quac:hidden: true`, `quac:reuse_last_value: true` and `quac:color: true`
 * set theirs. A `quac:icon` that is not an `https://` address is left out, as
 * is a `quac:control` other than `buttons` or `dropdown`.
 * A default of an unrecognised `kind`, or a `fixed` one without a `value`, is
 * left out; a `uuid` one of an omitted or unrecognised `format` reads as
 * `with_braces`. A `not_null` or `unique` other than `enforced` or `warn` reads
 * as none, and a `quac:duplicate_policy` other than `default` or `unset`
 * reads as none. A constraint `expression` or a default of `kind` `expression`
 * with no expression text is left out.
 */
export function readCollectionFieldEditRules(collection: StacCollection): Record<string, FieldEditRule> {
  const columns = collection['table:columns']
  if (!Array.isArray(columns)) return {}

  const relations = readCollectionFieldValueRelations(collection)
  const rules: Record<string, FieldEditRule> = {}
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue
    const candidate = column as Record<string, unknown>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!name) continue

    const readOnly = candidate['quac:editable'] === false
    const defaultValue = readColumnDefault(candidate['quac:default'])
    const constraints = readObject(candidate['quac:constraints'])
    const notNull = constraints?.not_null === 'enforced' || constraints?.not_null === 'warn' ? constraints.not_null : null
    const unique = constraints?.unique === 'enforced' || constraints?.unique === 'warn' ? constraints.unique : null
    const constraintExpression = readConstraintExpression(constraints?.expression)
    const hidden = candidate['quac:hidden'] === true
    const reuseLastValue = candidate['quac:reuse_last_value'] === true
    const duplicatePolicy = candidate['quac:duplicate_policy'] === 'default' || candidate['quac:duplicate_policy'] === 'unset'
      ? candidate['quac:duplicate_policy']
      : null
    const checkbox = readColumnCheckbox(candidate['quac:checkbox'])
    const range = readColumnRange(candidate['quac:range'])
    const dateFormat = readNonBlank(candidate['quac:date_format'])
    const colour = candidate['quac:color'] === true
    const icon = readHttpsAddress(candidate['quac:icon'])
    const control = candidate['quac:control'] === 'buttons' || candidate['quac:control'] === 'dropdown' ? candidate['quac:control'] : null
    const defaultExpression = readDefaultExpression(candidate['quac:default'])
    const relation = relations[name]
    // A field storing several keys gets no list, so no rule about its blank choice.
    const valueRelation = relation && relation.allow_multi !== true ? { allowNull: relation.allow_null === true, relation } : null
    if (valueRelation || readOnly || defaultValue || defaultExpression || notNull || unique || constraintExpression || hidden || reuseLastValue || duplicatePolicy || checkbox || range || dateFormat || colour || icon || control) {
      rules[name] = {
        readOnly, defaultValue, notNull, unique, hidden, reuseLastValue, duplicatePolicy,
        ...(constraintExpression ? { constraintExpression } : {}),
        ...(defaultExpression ? { defaultExpression } : {}),
        ...(checkbox ? { checkbox } : {}),
        ...(range ? { range } : {}),
        ...(dateFormat ? { dateFormat } : {}),
        ...(colour ? { colour } : {}),
        ...(icon ? { icon } : {}),
        ...(control ? { control } : {}),
        ...(valueRelation ? { valueRelation } : {})
      }
    }
  }
  return rules
}

/** A Collection's form layout: the fields it places, in its order, and the columns it leaves out. */
export interface CollectionFormLayout extends LayerFormLayout {
  /** The columns the layout does not place. The form leaves them out. */
  unplaced: string[]
}

/**
 * The form layout the source declared, counterpart of the `quac:form_order`,
 * `quac:visible_when`, `quac:in_form` and `quac:editable_when` writes in `stacCatalogue.ts`. Null for
 * a Collection with no `quac:form_order`, whose form places every field.
 *
 * A placed field's `visibleWhen` is its column's `quac:visible_when`, with a
 * blank or non-text entry left out and each expression kept as written: whether
 * it can be read is for the caller. A name in the order that is not text is
 * skipped. Its `editableWhen` is its column's `quac:editable_when`, as written.
 * A column is unplaced only when it says `quac:in_form: false` and the
 * order does not list it.
 */
export function readCollectionFormLayout(collection: StacCollection): CollectionFormLayout | null {
  const order = collection[QUAC_FORM_ORDER_FIELD]
  if (!Array.isArray(order)) return null

  const columns = new Map<string, Record<string, unknown>>()
  const declared = collection['table:columns']
  for (const column of Array.isArray(declared) ? declared : []) {
    const candidate = readObject(column)
    const name = readNonBlank(candidate?.name)
    if (candidate && name) columns.set(name, candidate)
  }

  const fields: FormLayoutField[] = []
  const placed = new Set<string>()
  for (const entry of order) {
    const name = readNonBlank(entry)
    if (!name || placed.has(name)) continue
    placed.add(name)
    const chain = columns.get(name)?.['quac:visible_when']
    const visibleWhen = Array.isArray(chain) ? chain.flatMap((expression) => readNonBlank(expression) ?? []) : []
    const editableWhen = readNonBlank(columns.get(name)?.['quac:editable_when'])
    fields.push({ name, visibleWhen, ...(editableWhen ? { editableWhen } : {}) })
  }
  const unplaced = Array.from(columns).filter(([name, column]) => column['quac:in_form'] === false && !placed.has(name)).map(([name]) => name)
  return { fields, unplaced }
}

/** The `expression` of `quac:constraints`; one with no expression text, or a strength other than `enforced` or `warn`, is left out. */
function readConstraintExpression(declared: unknown): FieldConstraintExpression | null {
  const fields = readObject(declared)
  const expression = readNonBlank(fields?.expression)
  if (!fields || !expression || (fields.strength !== 'enforced' && fields.strength !== 'warn')) return null
  const description = readNonBlank(fields.description)
  return { expression, ...(description ? { description } : {}), strength: fields.strength }
}

/** A `quac:default` of `kind` `expression`; one with no expression text is left out. */
function readDefaultExpression(declared: unknown): FieldDefaultExpression | null {
  const fields = readObject(declared)
  const expression = readNonBlank(fields?.expression)
  return fields?.kind === 'expression' && expression ? { expression, onUpdate: fields.on_update === true } : null
}

/** A `quac:checkbox`. Any object reads as a checkbox: its members default to unset, show Yes and No, and no blank. */
function readColumnCheckbox(declared: unknown): FieldCheckbox | null {
  const fields = readObject(declared)
  if (!fields) return null
  return {
    checkedValue: readNonBlank(fields.checked),
    uncheckedValue: readNonBlank(fields.unchecked),
    showStoredValue: fields.show_stored === true,
    allowNull: fields.allow_null === true
  }
}

/** A `quac:range`; a member that is not a finite number, or a suffix that is not text, is left out. */
function readColumnRange(declared: unknown): FieldRange | null {
  const fields = readObject(declared)
  if (!fields) return null
  const range: FieldRange = {}
  for (const key of ['min', 'max', 'step'] as const) {
    const value = fields[key]
    if (typeof value === 'number' && Number.isFinite(value)) range[key] = value
  }
  const precision = fields.precision
  if (typeof precision === 'number' && Number.isInteger(precision) && precision >= 0) range.precision = precision
  if (typeof fields.suffix === 'string' && fields.suffix) range.suffix = fields.suffix
  return Object.keys(range).length > 0 ? range : null
}

function readColumnDefault(declared: unknown): FieldDefaultValue | null {
  const fields = readObject(declared)
  if (!fields) return null
  const onUpdate = fields.on_update === true
  switch (fields.kind) {
    case 'now': return { kind: 'now', onUpdate }
    case 'uuid': return { kind: 'uuid', format: UUID_FORMATS.find((format) => format === fields.format) ?? 'with_braces', onUpdate }
    case 'fixed': return isFixedValue(fields.value) ? { kind: 'fixed', value: fields.value, onUpdate } : null
    default: return null
  }
}

const UUID_FORMATS = ['with_braces', 'without_braces', 'id128'] as const

function isFixedValue(value: unknown): value is FieldFixedValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const ATTACHMENT_VIEWERS = ['image', 'web', 'audio', 'video'] as const
const ATTACHMENT_RELATIVE_STORAGE = ['absolute', 'project', 'default-root'] as const

function readNonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Whether the source declares the layer editable. */
export function readCollectionEditable(collection: StacCollection): boolean | null {
  const value = collection['quac:editable']
  return typeof value === 'boolean' ? value : null
}

/** Whether the source lets the layer be the active layer. */
export function readCollectionIdentifiable(collection: StacCollection): boolean | null {
  const value = collection['quac:identifiable']
  return typeof value === 'boolean' ? value : null
}

/** Whether the source has the layer, or the group a Catalog stands for, switched on. */
export function readCollectionVisibility(collection: StacCollection | StacCatalog): boolean | null {
  const value = collection['quac:visibility_checked']
  return typeof value === 'boolean' ? value : null
}

/** The layer's geometry type as QGIS names it ("Point", "Line", "Polygon", "No geometry"); null when the source gives none. */
export function readCollectionGeometryType(collection: StacCollection): string | null {
  const summary = collection.summaries?.['quac:geometry_type']
  const value = Array.isArray(summary) ? summary[0] : null
  return typeof value === 'string' ? value : null
}

/** The scales the source draws the layer between; null when it sets no limit. */
export function readCollectionScaleRange(collection: StacCollection): LayerScaleRange | null {
  const minScale = readScaleDenominator(collection['quac:min_scale'])
  const maxScale = readScaleDenominator(collection['quac:max_scale'])
  if (minScale === null && maxScale === null) return null
  return { minScale, maxScale }
}

function readScaleDenominator(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * The opacity a Collection declares for its layer, as `quac:opacity` (0 to 1).
 *
 * Null for a Collection that states none, which is every source with no
 * project author behind it, and for a value that is not a number above 0: a
 * layer declared fully transparent would open invisible with nothing saying
 * why, so it is read as stating nothing. A caller draws a layer that states
 * none at full opacity.
 */
export function readCollectionOpacity(collection: StacCollection): number | null {
  return statedOpacity(collection['quac:opacity'])
}

/** A layer's opacity as `readCollectionOpacity` reads it, for a source that holds the number without a Collection. */
export function statedOpacity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.min(1, value)
}

/** One relation as `quac:related_to` stores it. */
function relationToJson(relation: CollectionRelation): Record<string, unknown> {
  return {
    id: relation.id,
    ...(relation.name ? { name: relation.name } : {}),
    parent_collection_id: relation.parentCollectionId,
    fields: relation.fields.map((field) => ({ parent: field.parent, child: field.child }))
  }
}

/**
 * The relations a Collection declares — the counterpart of the
 * `quac:related_to` write in `buildCollection` above, kept beside it so
 * the two cannot drift.
 *
 * An empty result means the Collection is a map layer like any other. A relation
 * missing its id, its parent Collection id or every field pair is dropped, since
 * none of those describes a join a reader could follow.
 */
export function readCollectionRelatedTo(collection: StacCollection): CollectionRelation[] {
  const value = collection[QUAC_RELATED_TO_FIELD]
  if (!Array.isArray(value)) return []

  const relations: CollectionRelation[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const id = readTrimmedString(candidate.id)
    const parentCollectionId = readTrimmedString(candidate.parent_collection_id)
    const fields = readRelationFields(candidate.fields)
    if (!id || !parentCollectionId || fields.length === 0) continue
    relations.push({ id, name: readTrimmedString(candidate.name), parentCollectionId, fields })
  }
  return relations
}

function readRelationFields(value: unknown): CollectionRelationField[] {
  if (!Array.isArray(value)) return []

  const fields: CollectionRelationField[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const parent = readTrimmedString(candidate.parent)
    const child = readTrimmedString(candidate.child)
    if (!parent || !child) continue
    fields.push({ parent, child })
  }
  return fields
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The box covering every given box, or null when none is given. */
export function unionBboxes(boxes: Array<NormalizedBbox | null>): NormalizedBbox | null {
  let union: NormalizedBbox | null = null
  for (const box of boxes) {
    if (!box) continue
    union = union
      ? {
        xmin: Math.min(union.xmin, box.xmin),
        ymin: Math.min(union.ymin, box.ymin),
        xmax: Math.max(union.xmax, box.xmax),
        ymax: Math.max(union.ymax, box.ymax)
      }
      : { ...box }
  }
  return union
}

/**
 * STAC's `extent.spatial.bbox` is an array of bboxes. We emit one, falling
 * back to the world extent when no bbox is known.
 *
 * `temporal` is required on a Collection extent, so it is always emitted.
 * A source that declares no temporal range gets the open interval
 * `[[null, null]]` — the spec's "unbounded at both ends".
 */
export function buildStacExtent(
  bbox: NormalizedBbox | null,
  interval: Array<string | null> = [null, null]
): StacExtent {
  return {
    spatial: {
      bbox: bbox
        ? [[bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax]]
        : [[-180, -90, 180, 90]]
    },
    temporal: { interval: [interval] }
  }
}

/**
 * Lower-cases, replaces non-alphanumerics with hyphens, collapses repeats.
 * STAC ids should be URL-safe; this is a conservative slugifier.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
