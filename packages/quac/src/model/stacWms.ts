import type { WmsDataSource } from './QgsProject.ts'
import type { StacCollection, StacLink } from './Stac.ts'

/**
 * The CRS a QGIS Server layer is requested in: the map's own when the server
 * offers it, so the server draws it without the app reprojecting the image.
 */
export const PREFERRED_WMS_CRS = 'EPSG:3857'

/** The CRS a WMS link asks for from the CRSs its server offers: `PREFERRED_WMS_CRS` where it is offered or none is listed, else the first. */
export function chooseWmsCrs(crsList: readonly string[]): string {
  return crsList.length === 0 || crsList.includes(PREFERRED_WMS_CRS) ? PREFERRED_WMS_CRS : crsList[0]!
}

export const WEB_MAP_LINKS_EXTENSION = 'https://stac-extensions.github.io/web-map-links/v1.3.0/schema.json'

export type StacWmsSource = Omit<WmsDataSource, 'raw' | 'kind'>

/** The parameters of a WMS request, which an endpoint's address does not keep. */
export const WMS_REQUEST_PARAMETERS = new Set(['SERVICE', 'REQUEST', 'VERSION', 'LAYERS', 'STYLES', 'FORMAT', 'TRANSPARENT', 'CRS', 'SRS', 'BBOX', 'WIDTH', 'HEIGHT'])

/** Removes WMS request parameters while retaining service-specific routing parameters. */
export function wmsEndpoint(href: string): string | null {
  try {
    const url = new URL(href)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    for (const key of Array.from(url.searchParams.keys())) {
      if (WMS_REQUEST_PARAMETERS.has(key.toUpperCase())) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function buildWmsLink(source: WmsDataSource): StacLink | null {
  const href = wmsEndpoint(source.url)
  if (!href) return null
  return {
    rel: 'wms', href, type: source.format,
    'wms:layers': [source.layers.join(',')],
    'wms:styles': [source.styles.join(',')],
    'wms:transparent': source.transparent,
    'wms:dimensions': source.dimensions,
    'quac:wms_crs': source.crs,
    ...(source.version ? { 'quac:wms_version': source.version } : {})
  }
}

/** Reads a single WMS rendering group; array members in web-map-links are separate groups. */
export function readCollectionWms(collection: StacCollection): StacWmsSource | null {
  for (const link of collection.links ?? []) {
    if (link.rel !== 'wms') continue
    const url = wmsEndpoint(link.href)
    const layers = link['wms:layers']
    const styles = link['wms:styles'] ?? []
    const version = link['quac:wms_version']
    if (!url || !Array.isArray(layers) || layers.length !== 1
      || typeof layers[0] !== 'string' || !layers[0].trim()
      || !Array.isArray(styles) || styles.length > 1 || styles.some((value) => typeof value !== 'string')
      || (version !== undefined && version !== '1.1.1' && version !== '1.3.0')) continue
    const dimensions = link['wms:dimensions'] ?? {}
    if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)
      || Object.values(dimensions).some((value) => typeof value !== 'string')
      || Object.keys(dimensions).some((key) => WMS_REQUEST_PARAMETERS.has(key.toUpperCase()))) continue
    return {
      url, layers: layers[0].split(','), styles: (styles[0] ?? '').split(','),
      format: link.type ?? 'image/png',
      crs: typeof link['quac:wms_crs'] === 'string' ? link['quac:wms_crs'] : 'EPSG:3857',
      version: version ?? null,
      transparent: link['wms:transparent'] === true,
      dimensions: dimensions as Record<string, string>
    }
  }
  return null
}
