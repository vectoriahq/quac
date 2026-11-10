import { devLog } from '../util/devLog.ts'

import type { LayerStyle } from '../model/QgsProject.ts'

/**
 * Captures all named styles defined for a layer, plus the index of the
 * active one.
 *
 * QGIS layer style structure:
 *   <maplayer>
 *     ...
 *     <map-layer-style-manager current="Priority">
 *       <map-layer-style name="Asset Owner">
 *         <style ...><renderer-v2 ...>...</renderer-v2>...</style>
 *       </map-layer-style>
 *       <map-layer-style name="Priority"/>      ← empty: active style's
 *     </map-layer-style-manager>                  contents are duplicated
 *     ...                                         at the maplayer level
 *     <renderer-v2 ...>...</renderer-v2>          ← the active style's renderer
 *   </maplayer>
 *
 * If <map-layer-style-manager> is absent (older or simpler projects), we
 * fall back to a single anonymous "default" style sourced from the direct-
 * child <renderer-v2>.
 *
 * A vector tile layer (`type="vector-tile"`) has a `<renderer>` in place of
 * `<renderer-v2>`, in the same places, and its XML is kept as
 * `vectorTileRendererRawXml` instead.
 *
 * Returns { styles: [], activeIndex: -1 } when nothing is found, so callers
 * can downgrade gracefully to default styling.
 */
export function parseLayerStyles(maplayer: Element): { styles: LayerStyle[], activeIndex: number } {
  try {
    const manager = directChild(maplayer, 'map-layer-style-manager')
    const tag = maplayer.getAttribute('type') === 'vector-tile' ? 'renderer' : 'renderer-v2'

    if (!manager) {
      const direct = captureMaplayerRenderer(maplayer, tag)
      if (!direct) return { styles: [], activeIndex: -1 }
      return { styles: [{ name: 'default', isActive: true, ...rendererFields(direct, tag) }], activeIndex: 0 }
    }

    const currentName = manager.getAttribute('current') ?? ''
    const styles: LayerStyle[] = []
    let activeIndex = -1

    for (const node of Array.from(manager.children)) {
      if (node.tagName !== 'map-layer-style') continue
      const name = node.getAttribute('name') ?? ''
      const isActive = name === currentName

      // Active style's renderer-v2 is duplicated at the maplayer level (the
      // <map-layer-style> for the active style is typically empty).
      // Non-active styles store their renderer inside <map-layer-style>/<style>/<renderer-v2>.
      const renderer = isActive
        ? captureMaplayerRenderer(maplayer, tag)
        : captureNestedRenderer(node, tag)

      if (isActive) activeIndex = styles.length
      styles.push({ name, isActive, ...rendererFields(renderer, tag) })
    }

    return { styles, activeIndex }
  } catch (err) {
    devLog('qgs/parseStyle', 'failed to capture layer styles', { error: String(err) })
    return { styles: [], activeIndex: -1 }
  }
}

/**
 * Lifts the `tag` renderer element directly inside a <maplayer>. This is the
 * shape the active style takes. Falls back to a renderer nested inside
 * <map-layer-style-manager><map-layer-style> in the rare case where QGIS
 * stores the active renderer there too.
 */
function captureMaplayerRenderer(maplayer: Element, tag: RendererTag): Element | null {
  const direct = directChild(maplayer, tag)
  if (direct) return direct

  const manager = directChild(maplayer, 'map-layer-style-manager')
  if (manager) {
    const nested = manager.querySelector(tag)
    if (nested) return nested
  }
  return null
}

/** The element a layer's renderer is written as: `renderer` for a vector tile layer. */
type RendererTag = 'renderer-v2' | 'renderer'

/** A style's renderer fields, from its renderer element or none. */
function rendererFields(renderer: Element | null, tag: RendererTag): Pick<LayerStyle, 'rendererV2RawXml' | 'categorisedField' | 'vectorTileRendererRawXml'> {
  if (tag === 'renderer') {
    return { rendererV2RawXml: null, categorisedField: null, ...(renderer ? { vectorTileRendererRawXml: serialise(renderer) } : {}) }
  }
  return { rendererV2RawXml: renderer ? serialise(renderer) : null, categorisedField: readCategorisedField(renderer) }
}

/**
 * The field a categorised or graduated renderer classifies by — QGIS writes it
 * as the renderer's `attr`, which the graffiti fixture's two categorised styles
 * have. A graduated renderer identifies the same field by the same attribute, one
 * range per rule rather than one value — `geostyler-qgis-parser`'s
 * `QGISStyleParser.js` reads `renderer-v2`'s `attr` for both its categories and
 * ranges branches.
 *
 * Read only from those two renderer types. Another renderer type with an
 * `attr` would not mean the same thing by it, so the gate is on the type
 * rather than on the attribute being present.
 */
function readCategorisedField(renderer: Element | null): string | null {
  if (!renderer) return null
  const type = renderer.getAttribute('type')
  if (type !== 'categorizedSymbol' && type !== 'graduatedSymbol') return null
  return renderer.getAttribute('attr')?.trim() || null
}

/**
 * Lifts the `tag` renderer element nested inside a non-active <map-layer-style>.
 * QGIS embeds the full standalone-QML <qgis> document inside each non-active
 * <map-layer-style>, with the renderer as a descendant — we just need
 * any such element inside the map-layer-style element.
 */
function captureNestedRenderer(mapLayerStyle: Element, tag: RendererTag): Element | null {
  return mapLayerStyle.querySelector(tag)
}

function directChild(parent: Element, tag: string): Element | null {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) return child
  }
  return null
}

function serialise(el: Element): string {
  return new XMLSerializer().serializeToString(el)
}
