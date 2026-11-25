/**
 * A print layout read from a QGIS project file's `<Layouts>` element, with
 * what an application needs to draw its first page.
 *
 * Positions and sizes are in millimetres, whatever unit the project saved
 * them in. A box's `x` and `y` are its top-left corner on the first page,
 * before the item's rotation.
 */
export interface PrintLayout {
  /** The layout's name, as QGIS's Layout Manager lists it. */
  name: string
  /** The first page's size. */
  page: LayoutSize
  /** How many pages the layout has. Only the first page's items are read. */
  pageCount: number
  /** The first page's items, in drawing order: the item drawn first comes first. */
  items: LayoutItem[]
  /** The layout's atlas; null when the atlas is off. */
  atlas: LayoutAtlas | null
}

export interface LayoutSize {
  width: number
  height: number
}

export interface LayoutBox extends LayoutSize {
  x: number
  y: number
}

/**
 * The kind of a layout item, named after QGIS's `QgsLayoutItemRegistry::ItemType`.
 * A frame of a multi-frame item, such as an attribute table, takes the
 * multi-frame's kind. `unknown` is a kind this package does not name, such as
 * an item a plugin adds.
 */
export type LayoutItemKind =
  | 'group'
  | 'map'
  | 'picture'
  | 'label'
  | 'legend'
  | 'shape'
  | 'polygon'
  | 'polyline'
  | 'scalebar'
  | 'frame'
  | 'html'
  | 'attributeTable'
  | 'textTable'
  | 'map3d'
  | 'manualTable'
  | 'marker'
  | 'elevationProfile'
  | 'chart'
  | 'unknown'

interface LayoutItemCommon {
  /** QGIS's number for the item's type, as the project saves it. */
  type: number
  /** The item's ID as set in QGIS's Item Properties; empty when none is set. */
  id: string
  uuid: string
  box: LayoutBox
  /** Clockwise, in degrees. */
  rotation: number
  isVisible: boolean
  /** Whether QGIS leaves the item out of a printed or exported page. */
  isExcludedFromExports: boolean
  /** The item's own XML, for what this model does not read. */
  xml: string
}

export interface LayoutLabel extends LayoutItemCommon {
  kind: 'label'
  /** The label's text as saved, with any `[% … %]` expressions unevaluated. */
  text: string
  /** Whether QGIS renders the text as HTML. */
  isHtml: boolean
}

export interface LayoutPicture extends LayoutItemCommon {
  kind: 'picture'
  /** The picture's file path or address, as the project holds it; empty when none is set. */
  path: string
  /**
   * The UUID of the map item whose rotation the picture follows, as a north
   * arrow does; null when it follows none.
   */
  rotatesWithMapUuid: string | null
}

export interface LayoutMap extends LayoutItemCommon {
  kind: 'map'
  /** The area shown, in the map item's CRS. */
  extent: { xmin: number; ymin: number; xmax: number; ymax: number }
  /** The map item's CRS as an authority ID, such as `EPSG:7855`; null when it uses the project's. */
  crs: string | null
  /**
   * The IDs of the layers the item keeps showing, in the order the project
   * saves them; null when it shows the project's visible layers.
   */
  layerIds: string[] | null
  /** The map theme the item follows; null when it follows none. */
  theme: string | null
  /** Clockwise, in degrees: the rotation of the map inside the item. */
  mapRotation: number
  /** Whether the atlas sets the item's extent to the current atlas feature. */
  isAtlasDriven: boolean
  /** The margin QGIS leaves around the atlas feature, as a fraction of its size. */
  atlasMargin: number
}

export interface LayoutShape extends LayoutItemCommon {
  kind: 'shape'
  shape: 'ellipse' | 'rectangle' | 'triangle'
}

export interface LayoutOtherItem extends LayoutItemCommon {
  kind: Exclude<LayoutItemKind, 'label' | 'picture' | 'map' | 'shape'>
}

export type LayoutItem = LayoutLabel | LayoutPicture | LayoutMap | LayoutShape | LayoutOtherItem

export interface LayoutAtlas {
  /** The ID of the layer whose features the atlas pages through; null when none is set. */
  coverageLayerId: string | null
  /** The coverage layer's name, as the layout saved it. */
  coverageLayerName: string
  /** Whether the coverage layer is hidden on the printed page. */
  hidesCoverage: boolean
  /** The expression that picks which features get a page; null when the atlas prints every feature. */
  featureFilter: string | null
  /** The expression that names each page; null when none is set. */
  pageNameExpression: string | null
}
