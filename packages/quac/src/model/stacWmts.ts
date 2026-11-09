import type { WmtsDataSource } from './QgsProject'
import type { StacCollection, StacLink } from './Stac'

/** A WMTS layer's settings as a `rel: "wmts"` web-map-links link holds them. */
export interface StacWmtsSource {
  /** The service address, or the address of its capabilities document for REST encoding. */
  url: string
  encoding: 'kvp' | 'rest'
  layer: string
  /** Style identifier; empty for the layer's default style. */
  style: string
  /** Null to take the layer's first tile matrix set. */
  tileMatrixSet: string | null
  /** Tile image media type; null to take the layer's first. */
  format: string | null
  dimensions: Record<string, string>
}

const REQUEST_PARAMETERS = new Set(['SERVICE', 'REQUEST', 'VERSION', 'LAYER', 'STYLE', 'FORMAT', 'TILEMATRIXSET', 'TILEMATRIX', 'TILEROW', 'TILECOL'])

/**
 * Whether an address is a capabilities document of its own — REST encoding,
 * such as `…/1.0.0/WMTSCapabilities.xml` — rather than a KVP service address.
 */
function isCapabilitiesDocument(url: URL): boolean {
  return url.pathname.toLowerCase().endsWith('.xml')
}

/**
 * Removes WMTS request parameters from a KVP service address while retaining
 * service-specific routing parameters. A capabilities document's address is
 * kept as it is. Null for anything but an `http`/`https` address with no
 * credentials in it.
 */
export function wmtsEndpoint(href: string): string | null {
  try {
    const url = new URL(href)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    if (!isCapabilitiesDocument(url)) {
      for (const key of Array.from(url.searchParams.keys())) {
        if (REQUEST_PARAMETERS.has(key.toUpperCase())) url.searchParams.delete(key)
      }
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/** The address the layer's capabilities document is requested from. */
export function wmtsCapabilitiesUrl(source: Pick<StacWmtsSource, 'url' | 'encoding'>): string {
  if (source.encoding === 'rest') return source.url
  const url = new URL(source.url)
  url.searchParams.set('SERVICE', 'WMTS')
  url.searchParams.set('REQUEST', 'GetCapabilities')
  return url.toString()
}

/**
 * The web-map-links v1.3.0 link for a QGIS WMTS layer. `quac:wmts_tile_matrix_set`
 * and `quac:wmts_style` keep the settings the extension does not define. A KVP
 * link states the tile format as its `type`; a REST link's `type` is its
 * capabilities document's, and the format comes from the document.
 */
export function buildWmtsLink(source: WmtsDataSource): StacLink | null {
  const href = wmtsEndpoint(source.url)
  if (!href) return null
  const rest = isCapabilitiesDocument(new URL(href))
  return {
    rel: 'wmts', href,
    type: rest ? 'application/xml' : source.format,
    'wmts:layer': source.layer,
    'wmts:encoding': rest ? 'rest' : 'kvp',
    ...(Object.keys(source.dimensions).length > 0 ? { 'wmts:dimensions': source.dimensions } : {}),
    'quac:wmts_tile_matrix_set': source.tileMatrixSet,
    ...(source.style ? { 'quac:wmts_style': source.style } : {})
  }
}

/** Reads the first WMTS link naming one layer. */
export function readCollectionWmts(collection: StacCollection): StacWmtsSource | null {
  for (const link of collection.links ?? []) {
    if (link.rel !== 'wmts') continue
    const url = wmtsEndpoint(link.href)
    const layers = link['wmts:layer']
    const layer = Array.isArray(layers) && layers.length === 1 ? layers[0] : layers
    const encoding = link['wmts:encoding'] ?? 'kvp'
    if (!url || typeof layer !== 'string' || !layer.trim() || (encoding !== 'kvp' && encoding !== 'rest')) continue
    const dimensions = link['wmts:dimensions'] ?? {}
    if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)
      || Object.values(dimensions).some((value) => typeof value !== 'string')
      || Object.keys(dimensions).some((key) => REQUEST_PARAMETERS.has(key.toUpperCase()))) continue
    const tileMatrixSet = link['quac:wmts_tile_matrix_set']
    const style = link['quac:wmts_style']
    return {
      url, encoding, layer,
      style: typeof style === 'string' ? style : '',
      tileMatrixSet: typeof tileMatrixSet === 'string' && tileMatrixSet ? tileMatrixSet : null,
      format: encoding === 'kvp' && link.type ? link.type : null,
      dimensions: dimensions as Record<string, string>
    }
  }
  return null
}
