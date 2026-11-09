import { generateStacFromNormalized, slugify, unionBboxes } from './normalizedProject'
import { DEFAULT_STYLE_ROLE, styleAssetKey } from '../model/stacStyles'
import { GEOJSON_MEDIA_TYPE } from '../util/catalogueFileFormats'

import type { NormalizedBbox, NormalizedLayer, NormalizedProject } from './normalizedProject'
import type { ArcgisField, ArcgisLayerSet, ArcgisLayerSource, ArcgisNotShownReason, ArcgisResolvedLayer } from '../model/arcgis'
import type { StacAsset, StacCatalog, StacCollection, StacLink, TableColumn, TableColumnType } from '../model/Stac'

/**
 * Generates a STAC Catalog from an ArcGIS Online Web Map or Feature Service,
 * already read down to its layers:
 *   the Web Map or item → top-level Catalog
 *   each layer          → Collection
 *
 * A layer that can be shown carries its FeatureServer layer's address and the
 * Web Map's filter on it, and declares its ArcGIS style as its default style
 * where it has one. A layer that can't carries `quac:arcgis_not_shown` and no
 * data asset, so it is still listed by name.
 *
 * Visibility, opacity, scale limits and a Web Map's saved view are written as
 * the same shared fields a QGIS project's are. Only a Web Map declares
 * visibility and opacity: a Feature Service item's layers have no author to
 * set them.
 *
 * Pure function — no side effects, no I/O.
 */
export interface ArcgisStacCatalogueOptions {
  /** Layer ids to emit, in the order given. Omit to emit every one. */
  layerIds?: string[]
  /**
   * Each layer's extent already in WGS84, keyed by layer id. This package
   * holds no reprojection, so a caller converts the service's extents and
   * passes them; a layer left out has no box of its own.
   */
  layerWgs84Extents?: Map<string, NormalizedBbox>
  /** The box the Web Map was saved showing, already in WGS84, for the same reason. */
  initialView?: NormalizedBbox | null
}

/** The name the layer's ArcGIS style is listed under. */
const ARCGIS_STYLE_NAME = 'default'

const NOT_SHOWN_REASONS: readonly ArcgisNotShownReason[] = [
  'not-queryable',
  'not-a-feature-layer',
  'layer-unavailable'
]

export function generateStacCatalogueFromArcgisLayers(
  layerSet: ArcgisLayerSet,
  options: ArcgisStacCatalogueOptions = {}
): StacCatalog {
  return generateStacFromNormalized(arcgisLayersToNormalized(layerSet, options))
}

/** The Web Map or Feature Service item the Catalog was generated from; null for a FeatureServer that reports none. */
export function readArcgisCatalogueItemId(catalogue: StacCatalog): string | null {
  const itemId = catalogue['quac:arcgis_item_id']
  return typeof itemId === 'string' && itemId ? itemId : null
}

/** Where a Collection's features are read from, or null for one that can't be shown. */
export function resolveArcgisCollectionSource(collection: StacCollection): ArcgisLayerSource | null {
  const layerUrl = collection['quac:arcgis_layer_url']
  if (typeof layerUrl !== 'string' || !layerUrl) return null
  const where = collection['quac:arcgis_where']
  return { layerUrl, where: typeof where === 'string' && where ? where : null }
}

/** Why a Collection's layer can't be shown, or null for one that can. */
export function readArcgisNotShownReason(collection: StacCollection): ArcgisNotShownReason | null {
  const reason = collection['quac:arcgis_not_shown']
  return NOT_SHOWN_REASONS.find((candidate) => candidate === reason) ?? null
}

function arcgisLayersToNormalized(layerSet: ArcgisLayerSet, options: ArcgisStacCatalogueOptions): NormalizedProject {
  const selected = selectLayers(layerSet.layers, options.layerIds)
  const hasAuthor = layerSet.itemType === 'Web Map'
  const nodes = selected.map((layer) => arcgisLayerToNormalized(layer, options.layerWgs84Extents?.get(layer.id) ?? null, hasAuthor))
  return {
    id: slugify(layerSet.title) || 'arcgis',
    title: layerSet.title,
    description: layerSet.summary ?? `STAC catalogue generated from the ArcGIS Online ${layerSet.itemType} "${layerSet.title}".`,
    bbox: unionBboxes(nodes.map((node) => node.bbox)),
    initialView: options.initialView ?? null,
    vendorFields: layerSet.itemId ? { 'quac:arcgis_item_id': layerSet.itemId } : {},
    nodes
  }
}

/** Resolves the requested ids against the layer set, preserving the caller's order. */
function selectLayers(layers: ArcgisResolvedLayer[], layerIds: string[] | undefined): ArcgisResolvedLayer[] {
  if (!layerIds) return layers
  const byId = new Map(layers.map((layer) => [layer.id, layer]))
  return layerIds
    .map((id) => byId.get(id))
    .filter((layer): layer is ArcgisResolvedLayer => Boolean(layer))
}

function arcgisLayerToNormalized(layer: ArcgisResolvedLayer, bbox: NormalizedBbox | null, hasAuthor: boolean): NormalizedLayer {
  const vendorFields: Record<string, unknown> = {}
  let assets: Record<string, StacAsset> = {}

  if (layer.status === 'not-shown') {
    vendorFields['quac:arcgis_not_shown'] = layer.reason
  } else {
    vendorFields['quac:arcgis_layer_url'] = layer.source.layerUrl
    if (layer.source.where) vendorFields['quac:arcgis_where'] = layer.source.where
    assets = { data: arcgisQueryAsset(layer.source, layer.title, layer.dataUpdated ?? null) }
    if (layer.styleHref) {
      assets[styleAssetKey(assets, ARCGIS_STYLE_NAME)] = {
        href: layer.styleHref,
        type: 'application/json',
        title: ARCGIS_STYLE_NAME,
        roles: ['style', DEFAULT_STYLE_ROLE]
      }
    }
  }

  return {
    kind: 'layer',
    // The Web Map's own layer id: one Web Map can list the same service layer
    // twice, so the layer's address would not tell the two apart.
    id: layer.id,
    title: layer.title,
    description: (layer.status === 'shown' ? layer.description : null) ?? `Layer "${layer.title}" of an ArcGIS Online map.`,
    bbox,
    geometryType: layer.status === 'shown' ? mapGeometryType(layer.geometryType) : null,
    wkbTypes: layer.status === 'shown' ? mapWkbTypes(layer.geometryType) : [],
    tableColumns: layer.status === 'shown' && layer.metadata ? layer.metadata.fields.map(fieldToColumn) : [],
    assets,
    ...(layer.status === 'shown' && layer.keywords?.length ? { keywords: layer.keywords } : {}),
    ...(layer.status === 'shown' && layer.credit ? { providers: [{ name: layer.credit, roles: ['licensor'] }] } : {}),
    ...(layer.status === 'shown' && layer.license ? { license: layer.license } : {}),
    ...(layer.status === 'shown' && layer.created ? { created: layer.created } : {}),
    ...(layer.status === 'shown' && layer.updated ? { updated: layer.updated } : {}),
    links: describeLayerLinks(layer),
    displayField: layer.status === 'shown' ? layer.metadata?.displayField ?? null : null,
    visibilityChecked: hasAuthor ? layer.visible : null,
    editable: null,
    scaleRange: layer.minScale === null && layer.maxScale === null
      ? null
      : { minScale: layer.minScale, maxScale: layer.maxScale },
    opacity: hasAuthor ? layer.opacity : null,
    vendorFields
  }
}

/** The layer's item page on ArcGIS Online, then its FeatureServer layer's own page, where it has each. */
function describeLayerLinks(layer: ArcgisResolvedLayer): StacLink[] {
  const links: StacLink[] = []
  if (layer.itemId) {
    links.push({ rel: 'about', href: `https://www.arcgis.com/home/item.html?id=${layer.itemId}`, type: 'text/html', title: 'ArcGIS Online page' })
  }
  if (layer.status === 'shown') {
    links.push({ rel: 'via', href: layer.source.layerUrl, type: 'text/html', title: 'Service description (technical)' })
  }
  return links
}

/**
 * ArcGIS geometry types mapped to the geometry type names a QGIS project
 * writes. A multipoint layer is a point layer, as QGIS counts it. A type
 * absent here has no geometry type.
 */
const ESRI_GEOMETRY_TYPES: Record<string, string> = {
  esriGeometryPoint: 'Point',
  esriGeometryMultipoint: 'Point',
  esriGeometryPolyline: 'Line',
  esriGeometryPolygon: 'Polygon'
}

function mapGeometryType(esriType: string | null | undefined): string | null {
  return esriType && Object.hasOwn(ESRI_GEOMETRY_TYPES, esriType) ? ESRI_GEOMETRY_TYPES[esriType] : null
}

/**
 * ArcGIS geometry types mapped to the one WKB type every feature of the layer
 * takes. A polyline or polygon layer has none: a feature with one part reads
 * as a LineString or Polygon and one with several as a MultiLineString or
 * MultiPolygon.
 */
const ESRI_WKB_TYPES: Record<string, string> = {
  esriGeometryPoint: 'Point',
  esriGeometryMultipoint: 'MultiPoint'
}

function mapWkbTypes(esriType: string | null | undefined): string[] {
  return esriType && Object.hasOwn(ESRI_WKB_TYPES, esriType) ? [ESRI_WKB_TYPES[esriType]] : []
}

/**
 * ArcGIS field types mapped to column types. A narrower type maps to the
 * column type that holds every value it can. A type absent here has no column
 * type.
 */
const ESRI_COLUMN_TYPES: Record<string, TableColumnType> = {
  esriFieldTypeSmallInteger: 'int',
  esriFieldTypeInteger: 'int',
  esriFieldTypeBigInteger: 'long',
  esriFieldTypeOID: 'long',
  esriFieldTypeSingle: 'double',
  esriFieldTypeDouble: 'double',
  esriFieldTypeString: 'string',
  esriFieldTypeGUID: 'string',
  esriFieldTypeGlobalID: 'string',
  esriFieldTypeDate: 'timestamp',
  esriFieldTypeDateOnly: 'date',
  esriFieldTypeTimeOnly: 'time',
  esriFieldTypeTimestampOffset: 'timestamp'
}

function fieldToColumn(field: ArcgisField): TableColumn {
  const column: TableColumn = { name: field.name }
  if (field.alias) column.title = field.alias
  if (field.type && Object.hasOwn(ESRI_COLUMN_TYPES, field.type)) column.type = ESRI_COLUMN_TYPES[field.type]
  if (field.codedValues) column.values = field.codedValues.map(({ code, name }) => ({ value: code, label: name }))
  // A range on a date field is in epoch milliseconds, which is no number a form could limit.
  if (field.range && (column.type === 'int' || column.type === 'long' || column.type === 'double')) {
    column['quac:range'] = { min: field.range.min, max: field.range.max }
  }
  return column
}

/**
 * A FeatureServer layer's data asset: its query for every feature the filter
 * keeps, as GeoJSON in WGS84. A QGIS project's ArcGIS layer is published with
 * the same asset.
 */
export function arcgisQueryAsset(source: ArcgisLayerSource, title: string, updated: string | null = null): StacAsset {
  const params = new URLSearchParams({ where: source.where ?? '1=1', outFields: '*', outSR: '4326', f: 'geojson' })
  return {
    href: `${source.layerUrl}/query?${params.toString()}`,
    type: GEOJSON_MEDIA_TYPE,
    title: `ArcGIS feature service query: ${title}`,
    roles: ['data'],
    ...(updated ? { updated } : {})
  }
}
