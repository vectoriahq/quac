import { propertyList, propertyText } from './projectProperties'

import type { WmsPublishing } from '../model/QgsProject'

/**
 * The project's WMS publishing, from Project Properties → QGIS Server → WMS
 * capabilities: **Use layer ids as names**, saved as `WMSUseLayerIDs`, and the
 * layers left out of WMS, saved by name as `WMSRestrictedLayers`
 * (`QgsServerProjectUtils::wmsUseLayerIds` and `wmsRestrictedLayers`,
 * `src/server/qgsserverprojectutils.cpp`, `qgis/QGIS@master`, read
 * 2026-11-03). Null where the project saves neither.
 */
export function parseWmsPublishing(qgisRoot: Element): WmsPublishing | null {
  const properties = qgisRoot.querySelector(':scope > properties')
  if (!properties) return null
  const useLayerIds = propertyText(properties, 'WMSUseLayerIDs')
  const restrictedLayers = propertyList(properties, 'WMSRestrictedLayers')
  if (useLayerIds === null && restrictedLayers.length === 0) return null
  return { useLayerIds: useLayerIds === 'true', restrictedLayers }
}

/**
 * The CRSs the project offers its WMS layers in, from Project Properties → QGIS
 * Server → WMS capabilities → **CRS restrictions**: the `WMSCrsList` it saves,
 * else the EPSG codes of the older `WMSEpsgList`, as
 * `QgsServerProjectUtils::wmsOutputCrsList` reads them
 * (`src/server/qgsserverprojectutils.cpp`, `qgis/QGIS@master`, read
 * 2026-11-07). Empty where the project restricts none; QGIS Server then offers
 * the project's own CRS, EPSG:4326 and EPSG:3857, which the server route works
 * out from the project's CRS.
 */
export function parseWmsCrsList(qgisRoot: Element): string[] {
  const properties = qgisRoot.querySelector(':scope > properties')
  if (!properties) return []
  const crsList = propertyList(properties, 'WMSCrsList').filter((crs) => crs !== '')
  if (crsList.length > 0) return crsList
  return propertyList(properties, 'WMSEpsgList').flatMap((code) => /^\s*[+-]?\d+\s*$/.test(code) ? [`EPSG:${Number(code)}`] : [])
}
