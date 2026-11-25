import type { LayerScaleRange } from './QgsProject.ts'

/**
 * Typed in-memory representation of a QGIS Server WMS GetProjectSettings
 * response. Parallel to QgsProject (parsed from a static .qgs file) but
 * sourced from the live server XML — Phase 8's QgisServerAdapter projects
 * this into the same STAC catalogue shape a parsed .qgs file produces.
 *
 * GetProjectSettings is QGIS Server's WMS extension that bundles much of
 * what we need: layer tree, bbox, full attribute schema, named styles,
 * displayField, visibility, queryable / mutuallyExclusive flags. It does
 * NOT include: form layouts or per-style XML (use GetStyles separately for
 * that). Field aliases are captured when the server exposes them.
 */

export interface WmsProject {
  /** Project title from <Service><Title>; "" if not declared. */
  title: string
  /** Project-level KeywordList (often signals 'export=true' for QGIS Server). */
  keywords: string[]
  /** WGS84 bounding box of the root layer container; null if not declared. */
  bbox: WmsBoundingBox | null
  /** Layer tree mirrored from the nested <Layer> structure. */
  layerTree: WmsLayerTreeNode[]
  /** Names of layers exposed via WFS (subset of the layer tree). */
  wfsLayerNames: string[]
  /** The print layouts the server can print with GetPrint, in the order it lists them. */
  printLayouts: WmsPrintLayout[]
  /** Full source XML, retained so future enhancements can re-mine. */
  rawXml: string | null
}

/**
 * A print layout as GetProjectSettings lists it, in `<ComposerTemplates>`
 * (`getComposerTemplatesElement`, `src/server/services/wms/qgswmsgetcapabilities.cpp`,
 * `qgis/QGIS@master`, read 2026-11-25). Sizes are in millimetres.
 */
export interface WmsPrintLayout {
  /** The layout's name: GetPrint's `TEMPLATE`. */
  name: string
  /** The first page's width. */
  width: number
  /** The first page's height. */
  height: number
  /** Whether the layout's atlas is on: GetPrint's `ATLAS_PK` then prints chosen features. */
  isAtlasEnabled: boolean
  /** The atlas's coverage layer, by the name GetPrint's `LAYERS` uses; null when none is listed. */
  atlasCoverageLayer: string | null
  /** The layout's map items. */
  maps: WmsPrintLayoutMap[]
  /** The IDs of the layout's labels; a label with no ID is not listed. */
  labelIds: string[]
}

export interface WmsPrintLayoutMap {
  /** The map item's name in GetPrint parameters, such as `map0` in `map0:EXTENT`. */
  name: string
  /** The map item's name in the layout, as QGIS shows it. */
  itemName: string
  width: number
  height: number
}

export interface WmsBoundingBox {
  westBoundLongitude: number
  eastBoundLongitude: number
  southBoundLatitude: number
  northBoundLatitude: number
}

/** A node in the WMS layer tree — either a group container or a leaf data layer. */
export type WmsLayerTreeNode = WmsLayerGroup | WmsLayer

export interface WmsLayerGroup {
  kind: 'group'
  /** Internal name; may be empty for the root container. */
  name: string
  title: string
  /** When true, only one child can be visible at a time (radio-style). */
  mutuallyExclusive: boolean
  /** Whether the group is checked in the layer tree. */
  visibilityChecked: boolean
  bbox: WmsBoundingBox | null
  treeName: string
  children: WmsLayerTreeNode[]
}

export interface WmsLayer {
  kind: 'layer'
  /** Internal layer name (used as the WFS typeName). */
  name: string
  /** Human-readable title. */
  title: string
  /** Field nominated as the layer's display attribute (its title field). */
  displayField: string | null
  /** Geometry type as QGIS Server writes it: a WKB type name, such as `MultiPolygon`. */
  geometryType: string | null
  /**
   * Whether the layer is queryable for GetFeatureInfo. QGIS Server writes it
   * from the layer's Identifiable flag (`qgswmslayerinfos.cpp`, `qgis/QGIS@master`,
   * read 2026-10-19), and a layer that states nothing counts as queryable.
   */
  queryable: boolean
  /** Whether the layer is checked in the QGIS layer tree by default. */
  visibilityChecked: boolean
  /** Layer opacity 0..1. */
  opacity: number
  /** WGS84 bbox. */
  bbox: WmsBoundingBox | null
  /** The scales the layer is drawn between, as the QGIS project sets them; null where it sets none. */
  scaleRange: LayerScaleRange | null
  /** CRSes the layer can be requested in. */
  crsList: string[]
  /** Named styles ("default", "Asset Owner", "Priority" etc.). */
  styles: WmsStyle[]
  /** Attribute schema (vector layers; empty for raster). */
  attributes: WmsAttribute[]
  /** Display name in the layer panel. */
  treeName: string
}

export interface WmsStyle {
  /** Internal style name (e.g. "default"). */
  name: string
  /** Human-readable title. */
  title: string
}

export interface WmsAttribute {
  /** Field name. */
  name: string
  /** QGIS field alias, when GetProjectSettings exposes one. */
  alias: string | null
  /** Qt type (e.g. "QString", "int", "double", "bool", "QDateTime"). */
  type: string
  /** Human-readable type name (e.g. "String", "Integer", "DateTime"). */
  typeName: string
  /** Maximum length for string fields; 0 for unbounded or non-string. */
  length: number
  /** Decimal precision for numeric fields; 0 for non-numeric. */
  precision: number
  /** Editor widget hint from QGIS (e.g. "TextEdit", "Range", "DateTime", "CheckBox"). */
  editType: string
  /**
   * The comment the field's data gives, such as a PostgreSQL column comment:
   * QGIS Server writes `QgsField::comment()`, not the custom comment a project
   * sets (`qgswmsgetcapabilities.cpp`, `qgis/QGIS@master`, read 2026-11-19).
   * Empty where there is none.
   */
  comment: string
}
