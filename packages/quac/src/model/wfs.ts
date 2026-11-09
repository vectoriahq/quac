import type { FeatureFilter } from './featureFilter'

/**
 * Supported high-level WFS operation names used by the app.
 */
export type WfsOperationName = 'GetCapabilities' | 'DescribeFeatureType' | 'GetFeature' | 'Transaction'

/**
 * Summary of supported operations advertised by the service.
 */
export interface WfsOperationsSupport {
  GetCapabilities: boolean
  DescribeFeatureType: boolean
  GetFeature: boolean
  Transaction: boolean
}

/**
 * Per-feature-type operation support advertised in GetCapabilities (when provided by the server).
 */
export interface WfsFeatureTypeOperationsSupport {
  Query: boolean
  Insert: boolean
  Update: boolean
  Delete: boolean
}

/**
 * Parsed WGS84 bounding box (lon/lat order).
 */
export interface WfsWgs84BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Lightweight feature type metadata from WFS GetCapabilities.
 */
export interface WfsFeatureTypeSummary {
  name: string
  title: string
  abstract: string | null
  keywords: string[]
  defaultSrs: string | null
  otherSrs: string[]
  supportedSrs: string[]
  wgs84BoundingBox: WfsWgs84BoundingBox | null
  operations: WfsFeatureTypeOperationsSupport | null
  /** Addresses of the layer's metadata records, from its `MetadataURL` elements. */
  metadataUrls: string[]
}

/**
 * Parsed WFS service capabilities used by the layer control UI.
 */
export interface WfsCapabilities {
  version: string
  serviceTitle: string | null
  operations: WfsOperationsSupport
  getFeatureOutputFormats: string[]
  featureTypes: WfsFeatureTypeSummary[]
}

/**
 * Primitive XSD field categories used for validation and form hints.
 */
export type WfsFieldKind =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'dateTime'
  | 'geometry'
  | 'unknown'

/**
 * Parsed field definition from DescribeFeatureType.
 */
export interface WfsFieldSchema {
  name: string
  xsdType: string
  xsdLocalType: string
  kind: WfsFieldKind
  minOccurs: number
  maxOccurs: number | 'unbounded'
  nillable: boolean
  isGeometry: boolean
}

/**
 * Parsed schema information for a WFS feature type.
 */
export interface WfsDescribeFeatureTypeSchema {
  requestedTypeName: string
  featureTypeName: string
  targetNamespace: string
  targetPrefix: string
  geometryFieldName: string | null
  fields: WfsFieldSchema[]
}

/**
 * Client-side validation error for a single field.
 */
export interface WfsValidationError {
  field: string
  message: string
}

/**
 * Active WFS layer metadata bound to the currently loaded GeoJSON data.
 */
export interface ActiveWfsLayer {
  endpoint: string
  featureType: WfsFeatureTypeSummary
  schema: WfsDescribeFeatureTypeSchema
  getFeatureOutputFormat: string | null
  getFeatureSrsName: string
  transactionSrsName: string
  /** The version the service's capabilities document advertised. */
  version: string
  /** Map projection at the time the layer was loaded. Captured per-layer to support future multi-CRS map views. */
  sourceMapSrsName: string
  /**
   * The QGIS project's filter on the layer, sent with every request for its
   * features. A layer with one is read-only (`layerViewOnlyReason`).
   */
  featureFilter?: FeatureFilter
}

/**
 * WFS Transaction result summary (when the server returns a standard response).
 *
 * Counts are optional in the WFS schema, and OpenLayers' parser only sets a
 * property when its element is present — so an omitted count is `undefined`
 * here, not zero. A caller reading one must tell those apart: absent means the
 * outcome is unknown, zero means the server changed nothing.
 */
export interface WfsTransactionSummary {
  totalInserted: number | undefined
  totalUpdated: number | undefined
  totalDeleted: number | undefined
}

/** The change a transaction was posted to make, used to read the matching count back. */
export type WfsTransactionOperation = 'insert' | 'update' | 'delete'

/**
 * Parsed result from a posted WFS transaction.
 */
export interface WfsTransactionResult {
  summary: WfsTransactionSummary | null
  insertIds: string[]
  rawXml: string
}
