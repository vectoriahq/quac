import {
  slugify,
  generateStacFromNormalized
} from './normalizedProject'
import { wfsGetFeatureAsset } from './wfsStacCatalogue'
import { chooseWmsCrs, WEB_MAP_LINKS_EXTENSION, wmsEndpoint } from '../model/stacWms'
import { GEOJSON_MEDIA_TYPE } from '../util/catalogueFileFormats'

import type { NormalizedBbox, NormalizedLayer, NormalizedNode, NormalizedProject } from './normalizedProject'
import type { StacAsset, StacCatalog, StacLink, TableColumn, TableColumnType } from '../model/Stac'
import type { WfsCapabilities } from '../model/wfs'
import type { WmsAttribute, WmsBoundingBox, WmsLayer, WmsLayerTreeNode, WmsProject } from '../model/WmsProject'

/**
 * Generates a STAC Catalog tree from a parsed WmsProject (from QGIS Server
 * GetProjectSettings). Shares the generator core with the static-QGS path:
 *   WmsProject              → top-level Catalog
 *   layer-tree groups       → nested Catalogs
 *   leaf data layers        → Collections
 *   <Attribute>s            → table:columns (with proper type info — richer
 *                             than the .qgs path because GetProjectSettings
 *                             exposes typeName for every field)
 *
 * This is a thin wrapper: `wmsProjectToNormalized` resolves the WMS-specific
 * wording, assets and columns into the shared `NormalizedProject`, and
 * `generateStacFromNormalized` (see normalizedProject.ts) builds the catalogue.
 */
export interface WmsStacCatalogueOptions {
  /**
   * The WFS endpoint serving this project's published feature types — the
   * same base URL with every query parameter but `MAP` stripped. When given,
   * each WFS-published layer's Collection has `quac:wfs_endpoint`, and
   * `quac:wfs_type_name` when `wfsCapabilities` resolves it.
   */
  wfsEndpoint?: string
  /**
   * The parsed WFS GetCapabilities response for `wfsEndpoint`. QGIS Server
   * sanitises WFS type names ("Graffiti Reports" → "Graffiti_Reports"), so a
   * WMS layer's feature type is resolved by matching: the feature type whose
   * title equals the WMS layer's title, then the one whose title equals the
   * WMS name, then the one whose name equals the WMS name. An unmatched
   * published layer still has `quac:wfs_endpoint` but gets no `quac:wfs_type_name`.
   *
   * Type-only import — the caller fetches the capabilities, so this package
   * has no runtime app dependencies.
   */
  wfsCapabilities?: WfsCapabilities
  /**
   * The project address the WMS GetProjectSettings was read from. When given,
   * each layer not published for WFS has a `rel: "wms"` link requesting it
   * from the same address, so it is drawn as a WMS image.
   */
  wmsEndpoint?: string
}

export function generateStacCatalogueFromWms(
  project: WmsProject,
  options: WmsStacCatalogueOptions = {}
): StacCatalog {
  return generateStacFromNormalized(wmsProjectToNormalized(project, options))
}

/**
 * Resolves the WFS endpoint and feature type name a WMS layer's features come
 * from, per the matching rules `WmsStacCatalogueOptions.wfsCapabilities`
 * documents. Null when the layer is not WFS-published or no endpoint is known.
 */
type WfsSourceResolver = (layer: WmsLayer) => { endpoint: string, typeName: string | null } | null

function buildWfsSourceResolver(project: WmsProject, options: WmsStacCatalogueOptions): WfsSourceResolver {
  const endpoint = options.wfsEndpoint
  if (!endpoint) return () => null

  const wfsPublished = new Set(project.wfsLayerNames)
  const featureTypes = options.wfsCapabilities?.featureTypes ?? []
  const featureTypeByTitle = new Map(featureTypes.map((ft) => [ft.title, ft]))
  const featureTypeByName = new Map(featureTypes.map((ft) => [ft.name, ft]))

  return (layer) => {
    if (!wfsPublished.has(layer.name)) return null
    const featureType = featureTypeByTitle.get(layer.title)
      ?? featureTypeByTitle.get(layer.name)
      ?? featureTypeByName.get(layer.name)
    return { endpoint, typeName: featureType?.name ?? null }
  }
}

/** Projects a parsed WmsProject into the source-agnostic normalized model. */
function wmsProjectToNormalized(project: WmsProject, options: WmsStacCatalogueOptions): NormalizedProject {
  return {
    id: slugify(project.title || 'qgis-server-project') || 'qgis-server-project',
    title: project.title,
    description: project.title
      ? `STAC catalogue generated from QGIS Server WMS GetProjectSettings for "${project.title}".`
      : 'STAC catalogue generated from a QGIS Server WMS GetProjectSettings response.',
    bbox: project.bbox ? wmsBboxToNormalized(project.bbox) : null,
    nodes: walkWmsNodes(project.layerTree, {
      resolveWfsSource: buildWfsSourceResolver(project, options),
      wfsPublished: new Set(project.wfsLayerNames),
      wmsEndpoint: options.wmsEndpoint ? wmsEndpoint(options.wmsEndpoint) : null
    })
  }
}

interface WmsWalkContext {
  resolveWfsSource: WfsSourceResolver
  wfsPublished: ReadonlySet<string>
  /** The project address without its WMS request parameters; null when none was given or it cannot be read. */
  wmsEndpoint: string | null
}

function walkWmsNodes(nodes: WmsLayerTreeNode[], context: WmsWalkContext): NormalizedNode[] {
  const out: NormalizedNode[] = []

  for (const node of nodes) {
    if (node.kind === 'layer') {
      const wmsLink = context.wmsEndpoint && !context.wfsPublished.has(node.name)
        ? buildQgisServerWmsLink(context.wmsEndpoint, node)
        : null
      out.push(wmsLink ? wmsOnlyLayerToNormalized(node, wmsLink) : wmsLayerToNormalized(node, context.resolveWfsSource(node)))
    } else {
      const subId = slugify(node.title || node.name || 'group') || 'group'
      out.push({
        kind: 'group',
        id: subId,
        title: node.title || node.name,
        description: `Layer group "${node.title || node.name || subId}" from the QGIS Server project.`,
        ...(node.mutuallyExclusive ? { mutuallyExclusive: true } : {}),
        children: walkWmsNodes(node.children, context)
      })
    }
  }

  return out
}

function wmsLayerToNormalized(
  layer: WmsLayer,
  wfsSource: ReturnType<WfsSourceResolver>
): NormalizedLayer {
  return {
    kind: 'layer',
    id: layer.name,
    title: layer.title || layer.name,
    description: `Layer "${layer.title || layer.name}" from the QGIS Server project.`,
    bbox: layer.bbox ? wmsBboxToNormalized(layer.bbox) : null,
    geometryType: mapWkbGeometryType(layer.geometryType),
    wkbTypes: layer.geometryType ? [layer.geometryType] : [],
    qgisServerNames: { wmsName: layer.name, wfsTypeName: wfsSource?.typeName ?? null },
    tableColumns: layer.attributes.length > 0 ? deriveTableColumnsFromAttributes(layer.attributes) : [],
    assets: buildAssets(layer, wfsSource),
    displayField: layer.displayField,
    visibilityChecked: layer.visibilityChecked,
    // GetProjectSettings does not expose readOnly, so we don't emit
    // `quac:editable` from this path.
    editable: null,
    identifiable: layer.queryable,
    scaleRange: layer.scaleRange,
    opacity: layer.opacity,
    vendorFields: buildVendorFields(wfsSource)
  }
}

/**
 * A GetMap link for a layer QGIS Server publishes only over WMS. The style is
 * left empty, which asks the server for the layer's default style. No version
 * is stated, so the app asks the server for it when the layer is first shown.
 */
function buildQgisServerWmsLink(endpoint: string, layer: WmsLayer): StacLink {
  return {
    rel: 'wms',
    href: endpoint,
    type: 'image/png',
    'wms:layers': [layer.name],
    'wms:styles': [''],
    'wms:transparent': true,
    'quac:wms_crs': chooseWmsCrs(layer.crsList)
  }
}

/**
 * A layer QGIS Server publishes only over WMS: an image layer, so it has no data
 * asset, fields or editing, as a QGIS project's WMS layer has none.
 */
function wmsOnlyLayerToNormalized(layer: WmsLayer, wmsLink: StacLink): NormalizedLayer {
  return {
    kind: 'layer',
    id: layer.name,
    title: layer.title || layer.name,
    description: `Layer "${layer.title || layer.name}" from the QGIS Server project.`,
    bbox: layer.bbox ? wmsBboxToNormalized(layer.bbox) : null,
    geometryType: mapWkbGeometryType(layer.geometryType),
    wkbTypes: layer.geometryType ? [layer.geometryType] : [],
    qgisServerNames: { wmsName: layer.name, wfsTypeName: null },
    tableColumns: [],
    assets: {},
    displayField: null,
    visibilityChecked: layer.visibilityChecked,
    editable: false,
    identifiable: layer.queryable,
    scaleRange: layer.scaleRange,
    opacity: layer.opacity,
    vendorFields: {},
    links: [wmsLink],
    extensions: [WEB_MAP_LINKS_EXTENSION]
  }
}

function buildVendorFields(wfsSource: ReturnType<WfsSourceResolver>): Record<string, unknown> {
  if (!wfsSource) return {}
  const fields: Record<string, unknown> = { 'quac:wfs_endpoint': wfsSource.endpoint }
  if (wfsSource.typeName) fields['quac:wfs_type_name'] = wfsSource.typeName
  return fields
}

function wmsBboxToNormalized(bbox: WmsBoundingBox): NormalizedBbox {
  return {
    xmin: bbox.westBoundLongitude,
    ymin: bbox.southBoundLatitude,
    xmax: bbox.eastBoundLongitude,
    ymax: bbox.northBoundLatitude
  }
}

function buildAssets(layer: WmsLayer, wfsSource: ReturnType<WfsSourceResolver>): Record<string, StacAsset> {
  if (wfsSource?.typeName) return { data: wfsGetFeatureAsset(wfsSource.endpoint, wfsSource.typeName, layer.name) }
  // Without a resolved type the href is left empty: the live URL is
  // server-specific and is constructed by the QgisServerAdapter at fetch
  // time, so the asset entry only documents that the data is available.
  return {
    data: {
      href: '',
      type: GEOJSON_MEDIA_TYPE,
      // Text written into the catalogue document, which carries the project's own name.
      title: `WFS GetFeature: ${layer.name}`,
      roles: ['data']
    }
  }
}

/**
 * Maps QGIS Qt types from GetProjectSettings into STAC Table extension
 * type strings. The table extension uses byte/short/int/long/float/double/
 * boolean/string/timestamp/date/time.
 */
function deriveTableColumnsFromAttributes(attributes: WmsAttribute[]): TableColumn[] {
  return attributes.map((attr) => {
    const column: TableColumn = { name: attr.name }
    if (attr.alias) column.title = attr.alias
    const stacType = mapQtTypeToStacTableType(attr.type, attr.typeName)
    if (stacType) column.type = stacType
    return column
  })
}

/**
 * QGIS's geometry kind for each WKB type name QGIS Server writes, less any Z,
 * M, ZM or 25D suffix (`qgswkbtypes.cpp`, `qgis/QGIS@master`, read
 * 2026-10-17), named as a QGIS project file names it. A name absent here, such
 * as `GeometryCollection`, has no geometry type.
 */
const GEOMETRY_TYPE_BY_WKB_NAME: Record<string, string> = {
  Point: 'Point',
  MultiPoint: 'Point',
  LineString: 'Line',
  MultiLineString: 'Line',
  CircularString: 'Line',
  CompoundCurve: 'Line',
  NurbsCurve: 'Line',
  MultiCurve: 'Line',
  Polygon: 'Polygon',
  MultiPolygon: 'Polygon',
  Triangle: 'Polygon',
  CurvePolygon: 'Polygon',
  MultiSurface: 'Polygon',
  PolyhedralSurface: 'Polygon',
  TIN: 'Polygon',
  NoGeometry: 'No geometry'
}

function mapWkbGeometryType(wkbName: string | null): string | null {
  const base = wkbName?.replace(/(ZM|Z|M|25D)$/, '')
  return base && Object.hasOwn(GEOMETRY_TYPE_BY_WKB_NAME, base) ? GEOMETRY_TYPE_BY_WKB_NAME[base] : null
}

/**
 * Qt type names, as QGIS Server writes them, mapped to column types. They're
 * more deterministic than the human typeName, which can vary by locale.
 */
const QT_COLUMN_TYPES: Record<string, TableColumnType> = {
  int: 'int',
  qlonglong: 'long',
  double: 'double',
  float: 'double',
  bool: 'boolean',
  QDateTime: 'timestamp',
  QDate: 'date',
  QTime: 'time',
  QString: 'string'
}

export function mapQtTypeToStacTableType(qtType: string, typeName: string): string | undefined {
  if (Object.hasOwn(QT_COLUMN_TYPES, qtType)) return QT_COLUMN_TYPES[qtType]
  // Fall back to the human name for unfamiliar types.
  if (typeName) return typeName.toLowerCase()
  return undefined
}
