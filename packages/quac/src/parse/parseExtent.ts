import { devLog } from '../util/devLog'

import type { MapExtent } from '../model/QgsProject'

/**
 * Reads the initial map view extent from <mapcanvas><extent>.
 *
 * The mapcanvas element looks like:
 *   <mapcanvas annotationsVisible="1" name="theMapCanvas">
 *     <units>degrees</units>
 *     <extent>
 *       <xmin>...</xmin> <ymin>...</ymin> <xmax>...</xmax> <ymax>...</ymax>
 *     </extent>
 *     ...
 *   </mapcanvas>
 *
 * Returns null if no usable extent is found — caller falls back to layer
 * extents or defaults.
 */
export function parseMapExtent(qgisRoot: Element, projectCrs: string | null): MapExtent | null {
  try {
    // Pick the first <mapcanvas>. Projects can technically have multiple, but
    // the first is the primary view.
    const mapcanvas = qgisRoot.querySelector('mapcanvas')
    if (!mapcanvas) return null

    const extent = mapcanvas.querySelector('extent')
    if (!extent) return null

    const xmin = readNumber(extent, 'xmin')
    const ymin = readNumber(extent, 'ymin')
    const xmax = readNumber(extent, 'xmax')
    const ymax = readNumber(extent, 'ymax')
    if (xmin === null || ymin === null || xmax === null || ymax === null) return null

    // The mapcanvas may have its own CRS via <destinationsrs>. Fall back to
    // project CRS otherwise, since most projects render in the project CRS.
    const canvasCrs = mapcanvas.querySelector('destinationsrs spatialrefsys authid')?.textContent?.trim() || null
    return { xmin, ymin, xmax, ymax, crs: canvasCrs ?? projectCrs }
  } catch (err) {
    devLog('qgs/parseExtent', 'failed to read map extent', { error: String(err) })
    return null
  }
}

function readNumber(parent: Element, tag: string): number | null {
  const text = parent.querySelector(tag)?.textContent?.trim()
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}
