import type { QgsProject } from '../model/QgsProject'

/**
 * Wraps a layer's inline <renderer-v2> subtree into the standalone QML
 * envelope (<qgis> root) that geostyler-qgis-parser expects.
 *
 * Phase 1's parseStyle.ts captures only the renderer-v2 subtree; this
 * function reconstitutes the standalone QML form so the GeoStyler QGIS
 * parser can consume it.
 *
 * `styleIndex` selects which named style (some layers have multiple, e.g.
 * "Asset Owner" + "Priority") to render. Defaults to the active style.
 *
 * Returns null if the layer doesn't exist, the style index is out of range,
 * or the chosen style has no inline renderer — callers should treat null
 * as "fall back to default styling".
 */
export function qmlForLayer(
  project: QgsProject,
  layerId: string,
  styleIndex?: number
): string | null {
  const layer = project.layers.find((entry) => entry.id === layerId)
  if (!layer) return null

  const idx = styleIndex ?? layer.activeStyleIndex
  const style = layer.styles[idx]
  if (!style || !style.rendererV2RawXml) return null

  const version = project.qgisVersion ?? '3.44.0'
  // The DOCTYPE matches what QGIS Desktop writes for standalone .qml files
  // (see "Save Style → QML File"), giving the parser the same input shape.
  return [
    '<!DOCTYPE qgis PUBLIC \'http://mrcc.com/qgis.dtd\' \'SYSTEM\'>',
    `<qgis version="${escapeAttr(version)}" styleCategories="Symbology">`,
    style.rendererV2RawXml,
    '</qgis>'
  ].join('\n')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
