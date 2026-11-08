import { generateStacFromNormalized, slugify } from './normalizedProject'
import { GEOJSON_MEDIA_TYPE } from '../util/catalogueFileFormats'
import { WFS_CAPABILITIES_VERSION } from '../util/wfsVersions'


import type { NormalizedBbox, NormalizedLayer, NormalizedProject } from './normalizedProject'
import type { StacAsset, StacCatalog } from '../model/Stac'
import type { WfsCapabilities, WfsFeatureTypeSummary } from '../model/wfs'

/**
 * Generates a STAC Catalog tree from a WFS GetCapabilities response:
 *   the service           → top-level Catalog
 *   each <FeatureType>    → Collection with `quac:wfs_*` fields and a GetFeature asset
 *
 * A WFS service publishes a flat list of feature types, so the catalogue has
 * no nested Catalogs. It also declares no author intent — no default
 * visibility or display field — so those shared fields are left off the
 * Collections rather than invented.
 *
 * Field schemas are not part of the output: they come from
 * DescribeFeatureType, which is a per-layer fetch at load time rather than
 * something GetCapabilities provides.
 *
 * Pure function — no side effects, no I/O. The caller fetches and parses the
 * capabilities document (`fetchWfsCapabilities`) and passes the result in.
 * `WfsCapabilities` is a type-only import, so this keeps the package free of
 * runtime app dependencies.
 */
export interface WfsStacCatalogueOptions {
  /**
   * Feature type names to emit, in the order given. A name the service does
   * not publish is skipped. Omit to emit every advertised feature type.
   */
  typeNames?: string[]
  /** Service title override, used when the capabilities document declares none. */
  title?: string
}

export function generateStacCatalogueFromWfsCapabilities(
  endpoint: string,
  capabilities: WfsCapabilities,
  options: WfsStacCatalogueOptions = {}
): StacCatalog {
  return generateStacFromNormalized(wfsCapabilitiesToNormalized(endpoint, capabilities, options))
}

/** Projects a parsed WFS capabilities document into the source-agnostic normalized model. */
function wfsCapabilitiesToNormalized(
  endpoint: string,
  capabilities: WfsCapabilities,
  options: WfsStacCatalogueOptions
): NormalizedProject {
  const featureTypes = selectFeatureTypes(capabilities, options.typeNames)
  const title = capabilities.serviceTitle?.trim() || options.title?.trim() || ''

  const vendorFields: Record<string, unknown> = {
    'quac:wfs_endpoint': endpoint,
    'quac:wfs_version': capabilities.version
  }
  if (capabilities.getFeatureOutputFormats.length > 0) {
    vendorFields['quac:wfs_output_formats'] = capabilities.getFeatureOutputFormats
  }

  return {
    id: slugify(title || 'wfs-service') || 'wfs-service',
    title,
    description: title
      ? `STAC catalogue generated from the WFS GetCapabilities response for "${title}".`
      : 'STAC catalogue generated from a WFS GetCapabilities response.',
    bbox: unionBbox(featureTypes),
    vendorFields,
    nodes: featureTypes.map((featureType) => wfsFeatureTypeToNormalized(endpoint, featureType))
  }
}

/**
 * Resolves the requested type names against the published list, preserving the
 * caller's order. With no names given, every published feature type is emitted
 * in the order the service listed them.
 */
function selectFeatureTypes(
  capabilities: WfsCapabilities,
  typeNames: string[] | undefined
): WfsFeatureTypeSummary[] {
  if (!typeNames) return capabilities.featureTypes

  const byName = new Map(capabilities.featureTypes.map((featureType) => [featureType.name, featureType]))
  return typeNames
    .map((name) => byName.get(name))
    .filter((featureType): featureType is WfsFeatureTypeSummary => Boolean(featureType))
}

function wfsFeatureTypeToNormalized(
  endpoint: string,
  featureType: WfsFeatureTypeSummary
): NormalizedLayer {
  const title = featureType.title || featureType.name

  return {
    kind: 'layer',
    // The feature type name is the service's own handle for the layer and the
    // half of the layer's identity that the connection's endpoint completes.
    id: featureType.name,
    title,
    description: featureType.abstract?.trim()
      || `Layer "${title}" from a map server.`,
    bbox: wgs84BoxToNormalized(featureType.wgs84BoundingBox),
    // GetCapabilities does not declare geometry types; the geometry column and
    // its type come from DescribeFeatureType at load time.
    geometryType: null,
    tableColumns: [],
    assets: { data: wfsGetFeatureAsset(endpoint, featureType.name, featureType.name) },
    keywords: featureType.keywords,
    links: featureType.metadataUrls.map((href) => ({ rel: 'describedby', href })),
    displayField: null,
    visibilityChecked: null,
    editable: null,
    vendorFields: buildVendorFields(endpoint, featureType)
  }
}

/**
 * A WFS layer's data asset: a GetFeature request for one feature type as
 * GeoJSON, which an HTTP GET answers in full and `parseWfsGetFeatureUrl` reads
 * back. Every producer that publishes a WFS source writes it here.
 */
export function wfsGetFeatureAsset(endpoint: string, typeName: string, title: string): StacAsset {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: WFS_CAPABILITIES_VERSION,
    REQUEST: 'GetFeature',
    TYPENAMES: typeName,
    OUTPUTFORMAT: 'application/json'
  })
  const separator = endpoint.includes('?') ? '&' : '?'
  return {
    href: `${endpoint}${separator}${params.toString()}`,
    type: GEOJSON_MEDIA_TYPE,
    title: `WFS GetFeature: ${title}`,
    roles: ['data']
  }
}

function buildVendorFields(
  endpoint: string,
  featureType: WfsFeatureTypeSummary
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    'quac:wfs_endpoint': endpoint,
    'quac:wfs_type_name': featureType.name
  }
  if (featureType.defaultSrs) fields['quac:wfs_default_srs'] = featureType.defaultSrs
  if (featureType.supportedSrs.length > 0) fields['quac:wfs_supported_srs'] = featureType.supportedSrs
  // Advertised per-type operations say what the service will accept, which is
  // what decides whether the layer can be edited. Many servers omit the
  // element; the field is then absent rather than guessed.
  if (featureType.operations) fields['quac:wfs_operations'] = featureType.operations

  return fields
}

function wgs84BoxToNormalized(
  box: WfsFeatureTypeSummary['wgs84BoundingBox']
): NormalizedBbox | null {
  if (!box) return null
  return { xmin: box.minX, ymin: box.minY, xmax: box.maxX, ymax: box.maxY }
}

/** Union of every emitted feature type's WGS84 box, or null when none declares one. */
function unionBbox(featureTypes: WfsFeatureTypeSummary[]): NormalizedBbox | null {
  let union: NormalizedBbox | null = null

  for (const featureType of featureTypes) {
    const box = wgs84BoxToNormalized(featureType.wgs84BoundingBox)
    if (!box) continue
    if (!union) {
      union = box
      continue
    }
    union = {
      xmin: Math.min(union.xmin, box.xmin),
      ymin: Math.min(union.ymin, box.ymin),
      xmax: Math.max(union.xmax, box.xmax),
      ymax: Math.max(union.ymax, box.ymax)
    }
  }

  return union
}
