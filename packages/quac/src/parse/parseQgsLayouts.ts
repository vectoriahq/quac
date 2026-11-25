import { readQgisRoot } from './readQgisRoot.ts'
import { devLog } from '../util/devLog.ts'

import type {
  LayoutAtlas,
  LayoutBox,
  LayoutItem,
  LayoutItemKind,
  PrintLayout
} from '../model/PrintLayout.ts'

/**
 * QGIS's numbers for its layout item types: `QgsLayoutItemRegistry::ItemType`
 * (`src/core/layout/qgslayoutitemregistry.h`, `qgis/QGIS@master`, read
 * 2026-11-25), which starts at `QGraphicsItem::UserType + 100`, 65636. The
 * header warns that the values must not move, so a project from an older QGIS
 * uses the same numbers.
 */
const ITEM_KINDS: ReadonlyMap<number, LayoutItemKind> = new Map([
  [65637, 'group'],
  [65639, 'map'],
  [65640, 'picture'],
  [65641, 'label'],
  [65642, 'legend'],
  [65643, 'shape'],
  [65644, 'polygon'],
  [65645, 'polyline'],
  [65646, 'scalebar'],
  [65647, 'frame'],
  [65648, 'html'],
  [65649, 'attributeTable'],
  [65650, 'textTable'],
  [65651, 'map3d'],
  [65652, 'manualTable'],
  [65653, 'marker'],
  [65654, 'elevationProfile'],
  [65655, 'chart']
])

const PAGE_TYPE = 65638

/** `QgsLayoutItemShape::Shape`, in its order. */
const SHAPES = ['ellipse', 'rectangle', 'triangle'] as const

/** The resolution QGIS gives a layout that saves none (`QgsLayoutRenderContext`). */
const DEFAULT_DPI = 300

/**
 * Reads the print layouts of a .qgs XML string: each layout's first page and
 * the items on it. Reports and other layout kinds are not read.
 *
 * Throws only when the XML is unparseable or has no `<qgis>` root. A layout
 * that cannot be read is left out, and an item that cannot be read is left
 * out of its layout.
 */
export function parseQgsLayouts(xmlText: string): PrintLayout[] {
  const qgisRoot = readQgisRoot(xmlText)
  const serializer = typeof XMLSerializer === 'undefined' ? null : new XMLSerializer()
  const layouts = Array.from(qgisRoot.querySelectorAll(':scope > Layouts > Layout'))
    .map((element) => readLayout(element, serializer))
    .filter((layout): layout is PrintLayout => layout !== null)

  devLog('qgs/parseQgsLayouts', 'read print layouts', {
    layoutCount: layouts.length,
    itemCounts: layouts.map((layout) => layout.items.length)
  })
  return layouts
}

function readLayout(element: Element, serializer: XMLSerializer | null): PrintLayout | null {
  const name = element.getAttribute('name') ?? ''
  try {
    const dpi = positiveNumber(element.getAttribute('printResolution')) ?? DEFAULT_DPI
    const pages = Array.from(element.querySelectorAll(':scope > PageCollection > LayoutItem'))
      .filter((page) => Number(page.getAttribute('type')) === PAGE_TYPE)
      .map((page) => readBox(page, dpi))
      .filter((box): box is LayoutBox => box !== null)
    const firstPage = pages[0]
    if (!firstPage) {
      devLog('qgs/parseQgsLayouts', 'layout has no page; skipping', { name })
      return null
    }

    const multiFrameKinds = readMultiFrameKinds(element)
    const items = Array.from(element.querySelectorAll(':scope > LayoutItem'))
      .map((itemElement) => readItem(itemElement, dpi, firstPage, multiFrameKinds, serializer))
      .filter((entry): entry is { item: LayoutItem; zValue: number } => entry !== null)
      .sort((a, b) => a.zValue - b.zValue)
      .map((entry) => entry.item)

    return {
      name,
      page: { width: firstPage.width, height: firstPage.height },
      pageCount: pages.length,
      items,
      atlas: readAtlas(element.querySelector(':scope > Atlas'))
    }
  } catch (err) {
    devLog('qgs/parseQgsLayouts', 'failed to read a layout; skipping', { name, error: String(err) })
    return null
  }
}

/** The kind of each multi-frame item, such as an attribute table, by its UUID. */
function readMultiFrameKinds(layoutElement: Element): Map<string, LayoutItemKind> {
  const kinds = new Map<string, LayoutItemKind>()
  for (const multiFrame of Array.from(layoutElement.querySelectorAll(':scope > LayoutMultiFrame'))) {
    const uuid = multiFrame.getAttribute('uuid')
    if (uuid) kinds.set(uuid, ITEM_KINDS.get(Number(multiFrame.getAttribute('type'))) ?? 'unknown')
  }
  return kinds
}

function readItem(
  element: Element,
  dpi: number,
  firstPage: LayoutBox,
  multiFrameKinds: Map<string, LayoutItemKind>,
  serializer: XMLSerializer | null
): { item: LayoutItem; zValue: number } | null {
  try {
    const box = readBox(element, dpi)
    // Pages sit one below another in the layout's coordinates, so an item
    // whose top is below the first page's foot is on a later page.
    if (!box || box.y >= firstPage.y + firstPage.height) return null

    const type = Number(element.getAttribute('type'))
    let kind = ITEM_KINDS.get(type) ?? 'unknown'
    if (kind === 'frame') kind = multiFrameKinds.get(element.getAttribute('multiFrame') ?? '') ?? 'frame'

    const common = {
      type,
      id: element.getAttribute('id') ?? '',
      uuid: element.getAttribute('uuid') ?? '',
      box: { ...box, x: box.x - firstPage.x, y: box.y - firstPage.y },
      rotation: Number(element.getAttribute('itemRotation')) || 0,
      isVisible: element.getAttribute('visibility') !== '0',
      isExcludedFromExports: element.getAttribute('excludeFromExports') === '1',
      xml: serializer?.serializeToString(element) ?? ''
    }
    const zValue = Number(element.getAttribute('zValue')) || 0

    switch (kind) {
      case 'label':
        return {
          zValue,
          item: {
            ...common,
            kind,
            text: element.getAttribute('labelText') ?? '',
            isHtml: element.getAttribute('htmlState') === '1'
          }
        }
      case 'picture':
        return {
          zValue,
          item: {
            ...common,
            kind,
            path: element.getAttribute('file') ?? '',
            rotatesWithMapUuid: element.getAttribute('mapUuid') || null
          }
        }
      case 'map':
        return { zValue, item: { ...common, kind, ...readMapProperties(element) } }
      case 'shape':
        return {
          zValue,
          item: { ...common, kind, shape: SHAPES[Number(element.getAttribute('shapeType'))] ?? 'rectangle' }
        }
      default:
        return { zValue, item: { ...common, kind } }
    }
  } catch (err) {
    devLog('qgs/parseQgsLayouts', 'failed to read a layout item; skipping', {
      uuid: element.getAttribute('uuid'),
      error: String(err)
    })
    return null
  }
}

/**
 * A map item's own settings, as `QgsLayoutItemMap::writePropertiesToElement`
 * saves them (`src/core/layout/qgslayoutitemmap.cpp`, `qgis/QGIS@master`,
 * read 2026-11-25).
 */
function readMapProperties(element: Element) {
  const extentElement = element.querySelector(':scope > Extent')
  const extent = {
    xmin: Number(extentElement?.getAttribute('xmin')),
    ymin: Number(extentElement?.getAttribute('ymin')),
    xmax: Number(extentElement?.getAttribute('xmax')),
    ymax: Number(extentElement?.getAttribute('ymax'))
  }
  if (!Object.values(extent).every(Number.isFinite)) throw new Error('map item has no readable extent')

  const layerIds = element.getAttribute('keepLayerSet') === 'true'
    ? Array.from(element.querySelectorAll(':scope > LayerSet > Layer'))
      .map((layer) => layer.textContent?.trim() ?? '')
      .filter(Boolean)
    : null
  const atlasMap = element.querySelector(':scope > AtlasMap')

  return {
    extent,
    crs: element.querySelector(':scope > crs spatialrefsys authid')?.textContent?.trim() || null,
    layerIds,
    theme: element.getAttribute('followPreset') === 'true' ? element.getAttribute('followPresetName') || null : null,
    mapRotation: Number(element.getAttribute('mapRotation')) || 0,
    isAtlasDriven: atlasMap?.getAttribute('atlasDriven') === '1',
    atlasMargin: Number(atlasMap?.getAttribute('margin')) || 0
  }
}

function readAtlas(element: Element | null): LayoutAtlas | null {
  if (!element || element.getAttribute('enabled') !== '1') return null
  return {
    coverageLayerId: element.getAttribute('coverageLayer') || null,
    coverageLayerName: element.getAttribute('coverageLayerName') ?? '',
    hidesCoverage: element.getAttribute('hideCoverage') === '1',
    featureFilter: element.getAttribute('filterFeatures') === '1' ? element.getAttribute('featureFilter') || null : null,
    pageNameExpression: element.getAttribute('pageNameExpression') || null
  }
}

/**
 * QGIS's reference points (`QgsLayoutItem::ReferencePoint`), in its order: the
 * point of the item its saved position names, as fractions of its width and
 * height from the top-left corner.
 */
const REFERENCE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.5, 0], [1, 0],
  [0, 0.5], [0.5, 0.5], [1, 0.5],
  [0, 1], [0.5, 1], [1, 1]
]

/**
 * An item's top-left corner and size in millimetres, from its saved
 * `position`, `size` and `referencePoint` (`QgsLayoutItem::writeXml`,
 * `src/core/layout/qgslayoutitem.cpp`, `qgis/QGIS@master`, read 2026-11-25).
 */
function readBox(element: Element, dpi: number): LayoutBox | null {
  const position = readPair(element.getAttribute('position'), dpi)
  const size = readPair(element.getAttribute('size'), dpi)
  if (!position || !size) return null
  const [fx, fy] = REFERENCE_POINTS[Number(element.getAttribute('referencePoint'))] ?? REFERENCE_POINTS[0]
  return {
    x: position[0] - fx * size[0],
    y: position[1] - fy * size[1],
    width: size[0],
    height: size[1]
  }
}

/** A saved `x,y,unit` or `width,height,unit`, in millimetres. */
function readPair(encoded: string | null, dpi: number): [number, number] | null {
  const parts = encoded?.split(',')
  if (!parts || parts.length !== 3) return null
  const first = layoutLengthToMillimetres(Number(parts[0]), parts[2], dpi)
  const second = layoutLengthToMillimetres(Number(parts[1]), parts[2], dpi)
  return first === null || second === null ? null : [first, second]
}

/**
 * A length in one of QGIS's layout units (`QgsUnitTypes::encodeUnit`), in
 * millimetres, as `QgsLayoutMeasurementConverter` converts it: a pixel is
 * 25.4 / `dpi` millimetres, where `dpi` is the layout's print resolution.
 * Null for a unit QGIS does not save or a value that is not a number.
 */
export function layoutLengthToMillimetres(value: number, unit: string, dpi: number): number | null {
  if (!Number.isFinite(value)) return null
  switch (unit) {
    case 'mm': return value
    case 'cm': return value * 10
    case 'm': return value * 1000
    case 'in': return value * 25.4
    case 'ft': return value * 304.8
    case 'pt': return value * 0.352777778
    case 'pi': return value * 4.23333333
    case 'px': return (value * 25.4) / dpi
    default: return null
  }
}

function positiveNumber(text: string | null): number | null {
  const value = Number(text)
  return text !== null && Number.isFinite(value) && value > 0 ? value : null
}

