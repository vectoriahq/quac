/** Where a layer's features are read from: its FeatureServer layer, through the service's own query. */
export interface ArcgisLayerSource {
  layerUrl: string
  /** The Web Map's filter on the layer, in ArcGIS's SQL. Null where it sets none. */
  where: string | null
}

/**
 * Why a layer is left out.
 *
 * - `not-queryable`: the layer's service does not answer queries as GeoJSON.
 * - `not-a-feature-layer`: the layer is not a FeatureServer feature layer.
 * - `layer-unavailable`: the layer's service could not be read.
 */
export type ArcgisNotShownReason =
  | 'not-queryable'
  | 'not-a-feature-layer'
  | 'layer-unavailable'

interface ArcgisLayerBase {
  /** The Web Map's own layer id. A layer from no Web Map has `{itemId}_{layerIndex}`, or `{serviceUrl}_{layerIndex}` where the service names no item. */
  id: string
  title: string
  /** False only where the Web Map says so; a layer with no setting is visible. */
  visible: boolean
  /** 0 to 1. */
  opacity: number
  /** ArcGIS scale denominators. Null where the layer has no limit. */
  minScale: number | null
  maxScale: number | null
  /** The layer's FeatureServer URL, or null for a layer that has none. */
  layerUrl: string | null
  itemId: string | null
}

export interface ArcgisFieldMetadata {
  displayField: string | null
  /** In the service's declared order. */
  fields: ArcgisField[]
}

/** One field a FeatureServer layer declares, as the service declares it. */
export interface ArcgisField {
  name: string
  /** Null where the service gives no non-blank alias. */
  alias: string | null
  /** The service's own type name, such as `esriFieldTypeInteger`. Null where it gives none. */
  type: string | null
  /**
   * The field's coded-value domain. Null where the field has none, and where a
   * subtype gives the field a domain other than the field's own.
   */
  codedValues: ArcgisCodedValue[] | null
  /**
   * The field's range domain. Null where the field has none, where a subtype
   * gives the field a domain other than the field's own, and where the
   * service's range is not two finite numbers.
   */
  range?: ArcgisRange | null
}

/** A range domain's limits, both ends included. */
export interface ArcgisRange {
  min: number
  max: number
}

/** One entry of a coded-value domain: the code the field stores, and its name. */
export interface ArcgisCodedValue {
  code: string | number
  name: string
}

/** A box in the coordinates of the CRS it names. */
export interface ArcgisExtent {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
  /** `EPSG:<code>`, from the spatial reference's `latestWkid`, else its `wkid`. */
  crs: string
}

export type ArcgisResolvedLayer =
  | (ArcgisLayerBase & {
    status: 'shown'
    metadata?: ArcgisFieldMetadata
    /** The service's own geometry type name, such as `esriGeometryPolygon`. Null where it gives none. */
    geometryType?: string | null
    /** Null where the service gives no extent, or one with no numeric spatial reference. */
    extent?: ArcgisExtent | null
    /** The service layer's description, else the layer's item's summary and description, as text. Null where none says. */
    description?: string | null
    /** The layer's item's tags; empty where it has no item or its item cannot be read. */
    keywords?: string[]
    /** The layer's copyright text, else the layer's item's credits. Null where neither says. */
    credit?: string | null
    /** The layer's item's licence text, as text. Null where it gives none. */
    license?: string | null
    /** When the layer's item was created, as an ISO 8601 UTC time. Null where it does not say. */
    created?: string | null
    /** When the layer's item was last modified, as an ISO 8601 UTC time. Null where it does not say. */
    updated?: string | null
    /** When the layer's data was last edited, else the layer, as an ISO 8601 UTC time. Null where neither says. */
    dataUpdated?: string | null
    source: ArcgisLayerSource
    /**
     * Where the layer's style is read from: the Web Map's own style for the
     * layer where the map sets one, otherwise the FeatureServer layer's. Null
     * where neither has a renderer.
     */
    styleHref: string | null
  })
  | (ArcgisLayerBase & { status: 'not-shown'; reason: ArcgisNotShownReason })

/** A Web Map, Feature Service item, Hub dataset or FeatureServer URL, read down to its layers. */
export interface ArcgisLayerSet {
  kind: 'layers'
  title: string
  /** The Web Map's or Feature Service's item id. Null for a FeatureServer that reports none. */
  itemId: string | null
  itemType: 'Web Map' | 'Feature Service'
  layers: ArcgisResolvedLayer[]
  /**
   * The box a Web Map was saved showing: its `initialState.viewpoint.targetGeometry`.
   * Null for a Feature Service, and for a Web Map that saves none, or one with
   * no numeric spatial reference.
   */
  initialView: ArcgisExtent | null
  /** The item's short summary, as text. Null where it gives none, or names no item. */
  summary: string | null
}

/** A pasted OGC API or WFS URL, which goes to the existing source for it unchanged. */
export interface ArcgisPassthrough {
  kind: 'passthrough'
  source: { kind: 'ogcapi'; url: string } | { kind: 'wfs'; endpoint: string }
}

export type ArcgisResolution = ArcgisLayerSet | ArcgisPassthrough
