import { devLog } from '../util/devLog.ts'

import type { LayerScaleRange } from '../model/QgsProject.ts'
import type {
  WmsAttribute,
  WmsBoundingBox,
  WmsLayer,
  WmsLayerGroup,
  WmsLayerTreeNode,
  WmsProject,
  WmsStyle
} from '../model/WmsProject.ts'

/**
 * Parses a QGIS Server WMS GetProjectSettings XML response into a typed
 * WmsProject model.
 *
 * The response is a WMS_Capabilities document with QGIS-specific extensions
 * for `displayField`, `geometryType`, `visibilityChecked`, `<Attributes>`
 * and `<WFSLayers>`. We capture what's useful for STAC + app-config
 * generation and ignore what isn't (e.g. GetMap / GetPrint format lists).
 *
 * Throws when the XML is unparseable or has the wrong root element.
 * Sub-elements that fail to parse log via devLog and yield null/empty
 * rather than tripping the whole project.
 */
export function parseGetProjectSettings(xmlText: string): WmsProject {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`Failed to parse GetProjectSettings XML: ${parserError.textContent?.slice(0, 200) ?? 'unknown error'}`)
  }

  const root = doc.documentElement
  // Accept both WMS_Capabilities and WMT_MS_Capabilities (older variants).
  if (!root || (root.tagName !== 'WMS_Capabilities' && root.tagName !== 'WMT_MS_Capabilities')) {
    throw new Error(`Expected <WMS_Capabilities> root element, got <${root?.tagName ?? 'nothing'}>`)
  }

  const service = root.querySelector(':scope > Service')
  const title = service?.querySelector(':scope > Title')?.textContent?.trim() ?? ''
  const keywords = Array.from(service?.querySelectorAll(':scope > KeywordList > Keyword') ?? [])
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean)

  // Layers live under <Capability> as a tree of nested <Layer> elements.
  const capability = root.querySelector(':scope > Capability')
  const rootLayers = Array.from(capability?.querySelectorAll(':scope > Layer') ?? [])
  const layerTree = rootLayers.map((node) => parseLayerNode(node)).filter(notNull)

  const projectBbox = layerTree.length > 0 ? bboxOf(layerTree[0]) : null

  // <WFSLayers> lists which layer names are exposed via WFS GetFeature.
  const wfsLayerNames = Array.from(capability?.querySelectorAll(':scope > WFSLayers > WFSLayer') ?? [])
    .map((node) => node.getAttribute('name'))
    .filter((name): name is string => Boolean(name))

  devLog('qgs/parseGetProjectSettings', 'parsed WMS project', {
    title,
    rootLayerCount: layerTree.length,
    wfsLayerCount: wfsLayerNames.length
  })

  return {
    title,
    keywords,
    bbox: projectBbox,
    layerTree,
    wfsLayerNames,
    rawXml: xmlText
  }
}

function bboxOf(node: WmsLayerTreeNode): WmsBoundingBox | null {
  return node.kind === 'layer' ? node.bbox : node.bbox
}

/**
 * Parses one <Layer> element into either a group or leaf node. A `<Layer>`
 * is treated as a group when it has child `<Layer>` elements; otherwise
 * it's a leaf with attributes / styles. Both shapes share the QGIS Server
 * extension attributes (visibilityChecked, queryable etc.).
 */
function parseLayerNode(layerEl: Element): WmsLayerTreeNode | null {
  try {
    const childLayers = Array.from(layerEl.children).filter((c) => c.tagName === 'Layer')
    const treeName = layerEl.querySelector(':scope > TreeName')?.textContent?.trim() ?? ''
    const name = layerEl.querySelector(':scope > Name')?.textContent?.trim() ?? ''
    const title = layerEl.querySelector(':scope > Title')?.textContent?.trim() ?? ''
    const bbox = parseExGeographicBbox(layerEl)
    const visibilityChecked = layerEl.getAttribute('visibilityChecked') === '1'

    if (childLayers.length > 0) {
      const group: WmsLayerGroup = {
        kind: 'group',
        name,
        title,
        mutuallyExclusive: layerEl.getAttribute('mutuallyExclusive') === '1',
        visibilityChecked,
        bbox,
        treeName,
        children: childLayers.map((child) => parseLayerNode(child)).filter(notNull)
      }
      return group
    }

    return parseLeafLayer(layerEl, name, title, bbox, visibilityChecked, treeName)
  } catch (err) {
    devLog('qgs/parseGetProjectSettings', 'failed to parse a Layer node; skipping', { error: String(err) })
    return null
  }
}

function parseLeafLayer(
  layerEl: Element,
  name: string,
  title: string,
  bbox: WmsBoundingBox | null,
  visibilityChecked: boolean,
  treeName: string
): WmsLayer {
  const opacityAttr = layerEl.getAttribute('opacity')
  const opacity = opacityAttr === null ? 1 : Number(opacityAttr)

  const styles: WmsStyle[] = Array.from(layerEl.querySelectorAll(':scope > Style')).map((styleEl) => ({
    name: styleEl.querySelector(':scope > Name')?.textContent?.trim() ?? '',
    title: styleEl.querySelector(':scope > Title')?.textContent?.trim() ?? ''
  })).filter((s) => s.name)

  const attributes: WmsAttribute[] = Array.from(layerEl.querySelectorAll(':scope > Attributes > Attribute')).map((attrEl) => ({
    name: attrEl.getAttribute('name') ?? '',
    alias: attrEl.getAttribute('alias')?.trim() || null,
    type: attrEl.getAttribute('type') ?? '',
    typeName: attrEl.getAttribute('typeName') ?? '',
    length: Number(attrEl.getAttribute('length') ?? '0'),
    precision: Number(attrEl.getAttribute('precision') ?? '0'),
    editType: attrEl.getAttribute('editType') ?? '',
    comment: attrEl.getAttribute('comment') ?? ''
  })).filter((a) => a.name)

  const crsList = Array.from(layerEl.querySelectorAll(':scope > CRS'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean)

  return {
    kind: 'layer',
    name,
    title,
    displayField: layerEl.getAttribute('displayField') || null,
    geometryType: layerEl.getAttribute('geometryType') || null,
    queryable: layerEl.getAttribute('queryable') !== '0',
    visibilityChecked,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    bbox,
    scaleRange: parseScaleRange(layerEl),
    crsList,
    styles,
    attributes,
    treeName
  }
}

/**
 * The layer's own scale limits. WMS names them from the other end:
 * `MinScaleDenominator` is the most zoomed-in scale, which is `maxScale` here,
 * and `MaxScaleDenominator` the most zoomed-out (`qgswmsgetcapabilities.cpp`,
 * `qgis/QGIS@master`, read 2026-10-17). QGIS Server writes both only for a
 * layer with scale-dependent visibility switched on.
 */
function parseScaleRange(layerEl: Element): LayerScaleRange | null {
  const read = (tag: string): number | null => {
    const text = layerEl.querySelector(`:scope > ${tag}`)?.textContent?.trim()
    const value = text ? Number(text) : Number.NaN
    return Number.isFinite(value) && value > 0 ? value : null
  }
  const minScale = read('MaxScaleDenominator')
  const maxScale = read('MinScaleDenominator')
  return minScale === null && maxScale === null ? null : { minScale, maxScale }
}

/**
 * EX_GeographicBoundingBox is the WMS 1.3.0 form (children: westBoundLongitude
 * etc.). Older WMS used LatLonBoundingBox attributes — not produced by QGIS
 * Server, so we don't bother with that fallback.
 */
function parseExGeographicBbox(parent: Element): WmsBoundingBox | null {
  const node = parent.querySelector(':scope > EX_GeographicBoundingBox')
  if (!node) return null

  const west = readNumber(node, 'westBoundLongitude')
  const east = readNumber(node, 'eastBoundLongitude')
  const south = readNumber(node, 'southBoundLatitude')
  const north = readNumber(node, 'northBoundLatitude')
  if (west === null || east === null || south === null || north === null) return null
  return { westBoundLongitude: west, eastBoundLongitude: east, southBoundLatitude: south, northBoundLatitude: north }
}

function readNumber(parent: Element, tag: string): number | null {
  const text = parent.querySelector(`:scope > ${tag}`)?.textContent?.trim()
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function notNull<T>(value: T | null): value is T {
  return value !== null
}
