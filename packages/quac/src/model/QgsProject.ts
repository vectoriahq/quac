/**
 * Typed in-memory representation of a parsed QGIS project (.qgs) file.
 *
 * Every top-level type has an optional rawXml field — the original XML
 * node serialised back to a string. This lets future parsers (forms,
 * relations, virtual fields, joins) extract additional information without
 * re-parsing the .qgs from scratch.
 *
 * The model is intentionally a flat, plain-data representation: no methods,
 * no class instances, just JSON-shaped objects so that:
 *   - it serialises trivially with the workspace
 *   - it round-trips cleanly through tests
 *   - future server-side hosting can reuse the same types
 */

import type { DelimitedTextOptions } from './delimitedText'
import type { FeatureFilter } from './featureFilter'
import type { TableColumnValueRelation } from './Stac'

/** The unit names QGIS saves under <Measurement> (`QgsUnitTypes::encodeUnit`), such as `ha` and `meters`. */
export interface ProjectMeasurement {
  areaUnit: string
  distanceUnit: string
}

export interface QgsProject {
  /** QGIS version that wrote the project (e.g. "3.44.8-Solothurn"). */
  qgisVersion: string | null
  /** Project title from <title>; empty string if absent. */
  title: string
  /** Project CRS authority id (e.g. "EPSG:4326"); null if not declared. */
  projectCrs: string | null
  /** Initial map view extent from <mapcanvas><extent>. */
  mapExtent: MapExtent | null
  /** Vector / raster layers from <projectlayers>. Annotation layers are filtered out. */
  layers: LayerEntry[]
  /** Display tree from <layer-tree-group> — root group with children. */
  layerTree: LayerGroup
  /** Relations from <relations>, each joining a parent layer to a child layer. */
  relations?: QgsRelation[]
  /** Project-level <projectMetadata>, as far as Groundwork reads it. */
  metadata: ProjectMetadata
  /** The area and distance units `$area`, `$length` and `$perimeter` are given in; null where the project saves none. */
  measurement?: ProjectMeasurement | null
  /** The project colour labelled Brand, in QGIS's colour-string form (`parseBrandColour`); null or absent where the project has none. */
  brandColour?: string | null
  /** The project's own variables (Project Properties > Variables) by name (`parseProjectVariables`); absent or empty where it has none. */
  variables?: Record<string, string>
  /** The layer id QFieldSync names as the project's **Initial active layer** (`parseInitialActiveLayerId`); null or absent where it names none. */
  initialActiveLayerId?: string | null
  /**
   * The layers the project publishes for WFS from QGIS Server, and which of
   * them take each WFS-T operation (`parseWfsTransactionLayers`). Null or absent
   * where the project saves no WFS publishing.
   */
  wfsTransactionLayers?: WfsTransactionLayers | null
  /** The project's WMS publishing from QGIS Server (`parseWmsPublishing`); null or absent where it saves none. */
  wmsPublishing?: WmsPublishing | null
  /** The CRSs the project restricts its WMS layers to (`parseWmsCrsList`); absent or empty where it restricts none. */
  wmsCrsList?: string[]
  /**
   * The filters the Mergin Maps plugin sets up for the project, in its order
   * (`parseMerginFilters`); absent or empty where it sets none.
   */
  merginFilters?: PresetFilter[]
  /** Original full QGS XML, retained so future parsers can re-mine without re-loading. */
  rawXml: string | null
}

/**
 * The parts of QGIS's project-level `<projectMetadata>` Groundwork reads.
 * QGIS's own dialog (Project Properties > Metadata) writes the element on
 * every project, empty fields and all — `abstract` and `author` are null only
 * when the author left them blank, checked against `src/data/sample/sample.qgs`
 * and `packages/quac/src/tests/fixtures/qgis/graffiti/graffiti.qgs` on 2026-08-12.
 */
export interface ProjectMetadata {
  /** From `<projectMetadata><abstract>`; null when blank. */
  abstract: string | null
  /** From `<projectMetadata><author>`; null when blank. */
  author: string | null
}

/**
 * One `<relations><relation>` entry: two layers and the field pair(s) joining
 * them. QGIS's *referenced* layer is the parent and its *referencing* layer the
 * child, named here as parent and child.
 */
export interface QgsRelation {
  /** Relation id from the `id` attribute. */
  id: string
  /** Display name from the `name` attribute; empty when the project declares none. */
  name: string
  /** Layer id of the parent — QGIS's `referencedLayer`. */
  parentLayerId: string
  /** Layer id of the child — QGIS's `referencingLayer`. */
  childLayerId: string
  /** The field pairs joining the two, in file order. Several make one composite key. */
  fieldPairs: QgsRelationFieldPair[]
  /** QGIS's `strength` attribute as written; null when the project declares none. */
  strength: string | null
}

/** One `<fieldRef>` of a relation — one field on each side of the join. */
export interface QgsRelationFieldPair {
  /** Field on the parent layer — QGIS's `referencedField`. */
  parentField: string
  /** Field on the child layer — QGIS's `referencingField`. */
  childField: string
}

export interface MapExtent {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
  /** CRS authority id (falls back to project CRS when omitted at the canvas level). */
  crs: string | null
}

/** Bounding box without CRS — used inside layers, which have their own crs separately. */
export interface BoundingBox {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

export interface LayerEntry {
  /** Unique id from <id> — used to cross-reference layer-tree leaves. */
  id: string
  /** Display name from <layername>. */
  name: string
  /** Layer type from the maplayer's `type` attribute (e.g. "vector", "raster"). */
  type: string
  /** Geometry type as QGIS names it, from the `geometry` attribute (e.g. "Point", "Line"); null for non-vector. */
  geometryType: string | null
  /** WKB geometry type name from the `wkbType` attribute (e.g. "MultiLineString"); null or absent where the project writes none. */
  wkbType?: string | null
  /** The layer's **Short name**, from Layer Properties → QGIS Server; null or absent where it has none. */
  shortName?: string | null
  /** Layer-level CRS authority id (e.g. "EPSG:4326"). */
  crs: string | null
  /** Layer's declared bounding box, in the layer CRS. */
  extent: BoundingBox | null
  /**
   * Layer's bounding box in WGS84 (EPSG:4326), as captured by QGIS in
   * `<wgs84extent>`. Preferred over `extent` for STAC catalogue output
   * because STAC requires WGS84 bboxes. Null if QGIS didn't write it.
   */
  wgs84Extent: BoundingBox | null
  /** Parsed datasource descriptor — file, WFS, WMS, XYZ, WMTS or unsupported. */
  dataSource: DataSource
  /**
   * Field nominated by QGIS as the layer's display attribute (its title
   * field) — extracted from `<previewExpression>"fieldname"</previewExpression>`.
   * Null when no preview expression is set or the expression isn't a
   * simple field reference.
   */
  displayField: string | null
  /**
   * Whether the layer is checked in the QGIS layer tree. Computed by
   * walking the parsed `layerTree` and propagating parent-group state
   * through to leaves. Defaults to true if the layer isn't in the tree.
   */
  isVisible: boolean
  /**
   * Whether the layer is queryable for GetFeatureInfo / identify in QGIS
   * — extracted from `<flags><Identifiable>1</Identifiable></flags>`.
   * Defaults to true when the flags element is absent.
   */
  queryable: boolean
  /** Layer opacity 0..1 — from `<layerOpacity>`. Defaults to 1 when absent. */
  opacity: number
  /**
   * Whether the layer is editable. Negation of QGIS's `readOnly` attribute
   * on `<maplayer>`. Defaults to true when the attribute is absent or "0".
   */
  editable: boolean
  /**
   * Canonical list of field names declared in QGIS's <fieldConfiguration>.
   * Used as the seed for STAC `table:columns` so the schema is known even
   * before any feature data has loaded (relevant for WFS-backed layers).
   */
  fieldNames: string[]
  /**
   * Map of field name → human-readable alias as declared in QGIS's
   * <aliases> element. Empty entries (alias name="") are filtered out so
   * the field name itself becomes the display label by default. Used by
   * Phase 5 to populate the `title` field on STAC `table:columns`.
   */
  fieldAliases: Record<string, string>
  /**
   * The fields QGIS Server leaves out of WMS (GetProjectSettings, GetFeatureInfo)
   * and of WFS (DescribeFeatureType, GetFeature): the **WMS** and **WFS**
   * checkboxes in the Attributes Form's QGIS Server settings. Absent where the
   * layer hides none.
   */
  serverHiddenFields?: ServerHiddenFields
  /**
   * All named styles defined for the layer. QGIS allows multiple symbology
   * styles per layer (e.g. "Asset Owner" + "Priority") with one currently
   * applied. Phase 3+ uses the active one for rendering; the dev panel can
   * inspect them all.
   */
  styles: LayerStyle[]
  /** Index into styles[] of the active style; -1 if no styles were captured. */
  activeStyleIndex: number
  /** The layer's `<resourceMetadata>`, as far as Groundwork reads it. */
  resourceMetadata: LayerResourceMetadata
  /** The layer's `<attribution>` element — a credit line, separate from resourceMetadata. */
  attribution: LayerAttribution | null
  /**
   * ValueMap edit widget picklists, keyed by field name — the display label a
   * user sees mapped to the value QGIS stores. Fields with no ValueMap widget,
   * or a widget with no entries, are absent from the map.
   */
  fieldValueMaps: Record<string, FieldValueMapEntry[]>
  /**
   * Whether the layer's Private flag is ticked in QGIS (`<flags><Private>`),
   * which keeps it out of the legend. False when the flag is absent.
   */
  isPrivate: boolean
  /**
   * The legend placeholder image the layer embeds (*Layer Properties → Legend*,
   * saved as `legendPlaceholderImage`), as a `data:` URL. Null where the layer
   * sets none, or sets a file or a web address in place of an embedded image.
   */
  legendImage?: string | null
  /**
   * Value Relation edit widgets, keyed by field name — the fields whose
   * choices QGIS reads from another layer of the project. Fields with no such
   * widget are absent.
   */
  fieldValueRelations: Record<string, FieldValueRelation>
  /**
   * Attachment edit widgets, keyed by field name — the fields QGIS declares as
   * holding a file rather than text. Fields with no such widget are absent.
   */
  fieldAttachments: Record<string, FieldAttachment>
  /**
   * What the Attributes Form says about changing each field: whether its
   * Editable box is unticked, and a default value Groundwork can fill in.
   * Fields with neither are absent.
   */
  fieldEditRules: Record<string, FieldEditRule>
  /**
   * The address of the layer's own icon, from its `quac_icon` variable. Null
   * or absent where it sets none.
   */
  icon?: string | null
  /**
   * The address of each field's icon, from the layer's `quac_icon_<field>`
   * variables. Fields with none are absent.
   */
  fieldIcons?: Record<string, string>
  /**
   * The control each field's `quac_control_<field>` variable asks for. Fields
   * with none are absent.
   */
  fieldControls?: Record<string, FieldControl>
  /**
   * The fields the layer's Drag and Drop Designer form places, with the
   * visibility expressions around each. Null or absent where the layer's form
   * is not set to the Drag and Drop Designer.
   */
  formLayout?: LayerFormLayout | null
  /**
   * The scales the layer is drawn between, from QGIS's scale-dependent
   * visibility. Null when the layer has it switched off or sets no limit.
   */
  scaleRange: LayerScaleRange | null
  /**
   * The edits the QFieldSync plugin locks on the layer (`parseQfieldSyncLocks`).
   * Absent or empty where it locks none.
   */
  locks?: LayerLocks
  /** Full <maplayer> XML, retained so future parsers (forms, fields, etc.) can re-mine. */
  rawXml: string | null
}

/** An edit a lock can stop: adding a feature, changing its attributes or its geometry, or deleting it. */
export type LockedEdit = 'add' | 'attributes' | 'geometry' | 'delete'

/** A lock: on for every feature, or on for a feature while a QGIS expression comes out true for it. */
export type EditLock = true | { expression: string }

/** The edits locked on a layer. An edit with no entry is not locked. */
export type LayerLocks = Partial<Record<LockedEdit, EditLock>>

/** A filter a project sets up on one field of one layer, under the name it gives it. */
export interface PresetFilter {
  layerId: string
  field: string
  /** The name the filter is shown under; null where the project gives none. */
  name: string | null
}

/** From Project Properties → QGIS Server → WMS capabilities. */
export interface WmsPublishing {
  /** **Use layer ids as names** is ticked, so QGIS Server names each layer by its layer id. */
  useLayerIds: boolean
  /** The names of the layers left out of WMS. */
  restrictedLayers: string[]
}

/** Layer ids, from Project Properties → QGIS Server → WFS capabilities. */
export interface WfsTransactionLayers {
  /** The layers ticked **Published**. */
  published: string[]
  /** The published layers ticked **Insert**. */
  insert: string[]
  /** The published layers ticked **Update**. */
  update: string[]
  /** The published layers ticked **Delete**. */
  delete: string[]
}

/**
 * The parts of QGIS's per-layer `<resourceMetadata>` Groundwork reads.
 * `abstract`, `contacts` and `temporalInterval`'s `<period>` shape verified
 * against `src/data/sample/graffiti/graffiti.qgs`, whose `<resourceMetadata>`
 * has those fields written but empty on that fixture. `<license>` and
 * `temporalInterval`'s `<instant>` alternative are absent from every fixture
 * in this repo, so those shapes are verified instead against
 * `QgsLayerMetadata`'s XML read/write code (`src/core/metadata/qgslayermetadata.cpp`,
 * `qgis/QGIS@master`, read 2026-08-12). `<keywords>` is likewise absent from
 * every fixture, but its read/write code is in the base class instead
 * (`QgsAbstractMetadataBase::readMetadataXml`/`writeMetadataXml`,
 * `src/core/metadata/qgsabstractmetadatabase.cpp`, same commit).
 */
export interface LayerResourceMetadata {
  /** From `<resourceMetadata><abstract>`; null when blank. */
  abstract: string | null
  /**
   * The first non-blank `<resourceMetadata><license>` element's text — QGIS
   * writes each licence as its own sibling `<license>` element rather than a
   * wrapper holding several. Null when the layer declares none.
   */
  license: string | null
  /** Every `<keyword>` text inside any `<resourceMetadata><keywords>` block, deduplicated in order. */
  keywords: string[]
  /** Every `<resourceMetadata><contact>` with a name or organisation. */
  contacts: LayerContact[]
  /**
   * `<resourceMetadata><extent><temporal>`'s declared range, as ISO text —
   * a `<period><start>`/`<end>`, or a single `<instant>` read as both ends
   * (see `parseResourceMetadataTemporal` in `packages/quac/src/parse/parseLayers.ts`
   * for which of the two is fixture-verified and which is checked against
   * QGIS source only). Null when the layer declares neither.
   */
  temporalInterval: [string | null, string | null] | null
}

export interface LayerContact {
  name: string
  organization: string
  email: string
}

/** QGIS's per-layer `<attribution href="...">text</attribution>` — a credit line. */
export interface LayerAttribution {
  text: string
  href: string | null
}

/** One entry of a ValueMap edit widget's picklist. */
export interface FieldValueMapEntry {
  /** The value QGIS stores in the field. */
  value: string
  /** The label shown for that value. */
  label: string
}

/**
 * A field's Value Relation edit widget, as far as Groundwork reads it: the
 * lookup layer it names, the fields stored and shown, and how the list is
 * filtered and ordered. The widget's group, description, column count and
 * completer settings are not read.
 */
export interface FieldValueRelation {
  /** The lookup layer's id (`Layer`); empty when the widget names none. */
  layerId: string
  /** The lookup layer's name (`LayerName`), tried when no layer has `layerId`. */
  layerName: string
  /** The lookup field whose value is stored (`Key`). */
  keyField: string
  /** The lookup field whose value is shown (`Value`). */
  valueField: string
  /** The QGIS expression narrowing the list (`FilterExpression`); empty for none. */
  filterExpression: string
  /** Whether the list offers a blank choice (`AllowNull`). */
  allowNull: boolean
  /** Whether the field stores several keys (`AllowMulti`). */
  allowMulti: boolean
  /** What orders the list: its key, its shown value, or another field of the lookup. */
  orderBy: 'key' | 'value' | 'field'
  /** The lookup field the list is ordered by, where `orderBy` is `field`. */
  orderField: string | null
  /** Whether the order is reversed (`OrderByDescending`). */
  descending: boolean
}

/**
 * A field's Attachment edit widget, as far as Groundwork reads it. QGIS calls
 * the widget `ExternalResource`; the field holds a file's path rather than
 * text.
 */
export interface FieldAttachment {
  /** What QGIS's document viewer shows for the file. Null where the widget shows none. */
  viewer: 'image' | 'web' | 'audio' | 'video' | null
  /** The file-picker filter QGIS offers, e.g. `Images (*.jpg *.png)`. Null when unset. */
  filter: string | null
  /** The widget's declared root folder, verbatim. Null when unset. */
  defaultRoot: string | null
  /** What a stored path is relative to. */
  relativeStorage: 'absolute' | 'project' | 'default-root'
}

/** A layer's Drag and Drop Designer form, as far as Groundwork reads it: which fields it places, in its order. */
export interface LayerFormLayout {
  fields: FormLayoutField[]
}

/** A field the form places. */
export interface FormLayoutField {
  name: string
  /**
   * The visibility expressions of the containers around the field, outermost
   * first, each as QGIS wrote it. Only an enabled, non-blank expression is
   * listed; the field shows while all of them are true.
   */
  visibleWhen: string[]
  /**
   * The QGIS expression behind the field's data-defined Editable property:
   * the field is locked while it comes out false. A field-type property is the
   * field in double quotes, a static one `true` or `false`. Absent where the
   * field has no active property.
   */
  editableWhen?: string
}

/** What a field's form settings say about changing it. */
export interface FieldEditRule {
  /** True where the source shows the field but does not let anyone change it. */
  readOnly: boolean
  /** The value the field is filled with, or null where the source declares none Groundwork can fill. */
  defaultValue: FieldDefaultValue | null
  /**
   * The field's Not null constraint: `enforced` refuses a blank, `warn` lets
   * it save with a warning. Null where the source sets none.
   */
  notNull: 'enforced' | 'warn' | null
  /**
   * The field's Unique constraint: `enforced` refuses a value another feature
   * holds, `warn` lets it save with a warning. Null or absent where the source sets none.
   */
  unique?: 'enforced' | 'warn' | null
  /**
   * What the field does when a feature is duplicated: `default` takes the
   * field's default value, or stays blank where it has none; `unset` clears it.
   * Null or absent where the value is passed on, QGIS's `Duplicate`.
   */
  duplicatePolicy?: 'default' | 'unset' | null
  /**
   * The field's constraint expression, kept as the source wrote it. Null or
   * absent where the source sets none or sets one that `readQgisExpression`
   * cannot read.
   */
  constraintExpression?: FieldConstraintExpression | null
  /**
   * An expression that fills the field, kept as the source wrote it. Null or
   * absent where the default is another kind (`defaultValue`), the source
   * sets none, or its expression cannot be read.
   */
  defaultExpression?: FieldDefaultExpression | null
  /** True where the source's form never shows the field. */
  hidden: boolean
  /** True where a new feature or record is offered the value last entered in the field. */
  reuseLastValue: boolean
  /**
   * The field's Value Relation, where its choices come from another table and the
   * field stores one key. `allowNull` is the widget's Allow NULL value: the list
   * offers a blank choice. `relation` is the column's whole `quac:value_relation`,
   * for the edit form's filter. Null or absent where the field has none.
   */
  valueRelation?: { allowNull: boolean, relation?: TableColumnValueRelation } | null
  /** The field's Checkbox widget. Null or absent where it has none. */
  checkbox?: FieldCheckbox | null
  /** The limits and number format of a Range widget or an ArcGIS range domain. Null or absent where none is set. */
  range?: FieldRange | null
  /**
   * The format a text field stores its dates in, as a QGIS date pattern such
   * as `dd/MM/yyyy`. Null or absent where the field stores the default
   * `yyyy-MM-dd` or ISO 8601.
   */
  dateFormat?: string | null
  /** True where the field holds a colour: a QGIS Color widget. */
  colour?: boolean
  /** The `https://` address of the icon drawn beside the field's name. Null or absent where it has none. */
  icon?: string | null
  /** The control the edit form draws the field's choices with. Null or absent where the source asks for none. */
  control?: FieldControl | null
}

/** How the edit form draws a field's list of choices: a row of `buttons`, or a `dropdown`. */
export type FieldControl = 'buttons' | 'dropdown'

/**
 * A QGIS constraint expression. `enforced` refuses a save whose value is not
 * true, `warn` saves with a warning. `description` is the message the source
 * gives for it; absent where it gives none.
 */
export interface FieldConstraintExpression {
  expression: string
  description?: string
  strength: 'enforced' | 'warn'
}

/** A default value worked out from the feature's other values; `onUpdate` fills it on every save rather than only the one creating the feature. */
export interface FieldDefaultExpression {
  expression: string
  onUpdate: boolean
}

/**
 * A Checkbox widget. A state the widget leaves unset is null, and a boolean
 * field ignores both states.
 */
export interface FieldCheckbox {
  /** The value a ticked box writes to a text field. */
  checkedValue: string | null
  /** The value an unticked box writes to a text field. */
  uncheckedValue: string | null
  /** True where the project shows the stored value rather than true and false. */
  showStoredValue: boolean
  /** True where a blank is a third, partly ticked state. */
  allowNull: boolean
}

/**
 * A number field's limits and format. Each member is set only where the source
 * sets it: an absent one takes QGIS's default of 1 for the step, none for the
 * decimal places and none for the suffix.
 */
export interface FieldRange {
  min?: number
  max?: number
  step?: number
  /** The number of decimal places the field shows. */
  precision?: number
  /** Text shown after the number in the edit form. */
  suffix?: string
}

/**
 * A default value: `now` is the moment the feature is created, or saved where
 * `onUpdate` is set, written as the field's type holds it; `uuid` is a new
 * random identifier written in `format`; `fixed` is `value` as the source
 * wrote it.
 */
export type FieldDefaultValue =
  | { kind: 'now'; onUpdate: boolean }
  | { kind: 'uuid'; format: FieldUuidFormat; onUpdate: boolean }
  | { kind: 'fixed'; value: FieldFixedValue; onUpdate: boolean }

/**
 * How a `uuid` default is written, as QGIS's `uuid()` names its formats:
 * `{6f1e…}`, `6f1e…` with its hyphens, or 32 hex digits without them.
 */
export type FieldUuidFormat = 'with_braces' | 'without_braces' | 'id128'

/** A fixed default, typed as QGIS's expression parser reads the literal. */
export type FieldFixedValue = string | number | boolean | null

/**
 * A layer's visible scale range, as scale denominators (10000 is 1:10,000).
 * Named as QGIS names them: the layer draws once you zoom in past `minScale`
 * (exclusive) and stops after `maxScale` (inclusive, the most zoomed-in scale
 * it still draws at), so `minScale` is the larger number. Null on either side
 * means no limit that way. The two boundaries are the ones QGIS's own fields
 * are labelled with, "Minimum (exclusive)" and "Maximum (inclusive)"
 * (`QgsScaleRangeWidget`, `src/gui/qgsscalerangewidget.cpp`, `qgis/QGIS@master`,
 * read 2026-10-04).
 */
export interface LayerScaleRange {
  minScale: number | null
  maxScale: number | null
}

export interface LayerStyle {
  /** User-facing style name from QGIS's style manager (e.g. "Asset Owner"). */
  name: string
  /** True if this style is the one currently applied to the layer. */
  isActive: boolean
  /** Inline <renderer-v2> XML for this style; null if not present in the file. */
  rendererV2RawXml: string | null
  /**
   * The field a categorised renderer classifies by, as QGIS records it. Null for
   * every other renderer type, and for a style whose renderer is absent.
   */
  categorisedField: string | null
  /**
   * Inline vector tile `<renderer>` XML for this style, on a vector tile layer
   * whose file holds one: QGIS writes it in place of `<renderer-v2>`.
   */
  vectorTileRendererRawXml?: string
}

export type DataSource =
  | FileDataSource
  | WfsDataSource
  | WmsDataSource
  | XyzDataSource
  | WmtsDataSource
  | ArcgisFeatureServerDataSource
  | UnsupportedDataSource

export interface FileDataSource {
  kind: 'file'
  /** Basename of the data file — used for drag-drop companion matching. */
  filename: string
  /**
   * Full relative path as written in the QGS file, with backslashes normalised
   * to forward slashes (e.g. 'data/roads.geojson' or './data/roads.geojson').
   * Used by the remote project loader to match cloud folder listings.
   * May equal filename when the QGS was authored with no directory prefix.
   */
  relPath: string
  /** Optional sub-layer name (e.g. for GeoPackage); null if absent. */
  layerName: string | null
  /**
   * The address of an online file: a path QGIS reads through GDAL's
   * `/vsicurl/` prefix, or an `http`/`https` path. Absent for a file on disk.
   * `filename` is the address's last segment, and `relPath` the address.
   */
  url?: string
  /**
   * The one shape of feature the layer shows, from the source's
   * `|geometrytype=` option, as QGIS splits a file holding several shapes into
   * one layer per shape; null where the source names no shape this reads.
   */
  geometryTypeFilter: 'Point' | 'LineString' | 'Polygon' | null
  /**
   * How the file splits, where QGIS reads it with its Delimited Text provider
   * rather than OGR: the separators, quotes and header its data source names.
   */
  delimitedText?: DelimitedTextOptions
  /** The filter QGIS sets on the layer's data (Provider Feature Filter), so the layer holds only the features it keeps. */
  featureFilter?: FeatureFilter
  /** Original raw <datasource> string. */
  raw: string
}

export interface WfsDataSource {
  kind: 'wfs'
  url: string
  typeName: string
  srsName: string | null
  /** The filter QGIS sets on the layer (Provider Feature Filter): a QGIS expression, a `SELECT` statement or OGC Filter XML, which QGIS sends to the server as an OGC Filter. */
  featureFilter?: FeatureFilter
  /** Original raw <datasource> string. */
  raw: string
}

export interface WmsDataSource {
  kind: 'wms'
  url: string
  layers: string[]
  styles: string[]
  format: string
  crs: string
  version: '1.1.1' | '1.3.0' | null
  transparent: boolean
  dimensions: Record<string, string>
  raw: string
}

/**
 * A QGIS XYZ tile layer: the `wms` provider with `type=xyz` for image tiles,
 * or the `xyzvectortiles` provider for vector tiles.
 */
export interface XyzDataSource {
  kind: 'xyz'
  /** What each tile holds: an image, or vector features (Mapbox Vector Tile). */
  tiles: 'image' | 'vector'
  /**
   * Absolute tile URL template, with QGIS's `{q}` written as Bing's `{quadkey}`.
   * A vector template holds `{z}`, `{x}` and `{y}`.
   */
  url: string
  /** The deepest zoom level QGIS requests (`zmax`); null when the source states none. */
  maxZoom: number | null
  raw: string
}

/** A QGIS WMTS layer: the `wms` provider with `tileMatrixSet`. */
export interface WmtsDataSource {
  kind: 'wmts'
  /** The service address with its WMTS request parameters removed, or the address of its capabilities document. */
  url: string
  layer: string
  /** Style identifier; empty for the layer's default style. */
  style: string
  tileMatrixSet: string
  /** Tile image media type, e.g. `image/png`. */
  format: string
  /** Dimension values from QGIS's `tileDimensions`, e.g. `{ Time: '2024-01-01' }`. */
  dimensions: Record<string, string>
  raw: string
}

/**
 * A QGIS layer read through its `arcgisfeatureserver` provider: one layer of
 * an ArcGIS FeatureServer or MapServer, read through the service's query.
 */
export interface ArcgisFeatureServerDataSource {
  kind: 'arcgis'
  /** The service layer's address, `…/FeatureServer/{index}` or `…/MapServer/{index}`. */
  url: string
  /** The filter QGIS sets on the layer (Provider Feature Filter), which QGIS sends to the service as its `where` clause. Null for none. */
  where: string | null
  raw: string
}

export interface UnsupportedDataSource {
  kind: 'unsupported'
  /** Original raw <datasource> string for diagnostics. */
  raw: string
  /** Best-guess provider/protocol if detectable (e.g. "postgres", "wms"). */
  hint: string | null
}

/** A node in the layer panel display tree — either a group or a leaf referencing a layer. */
export type LayerTreeNode = LayerGroup | LayerTreeLeaf

export interface LayerGroup {
  kind: 'group'
  /** Group name; the root group has empty name "". */
  name: string
  /** Whether the group is checked in the layer panel. */
  checked: boolean
  /** True when QGIS shows only one of its children at a time (`mutually-exclusive="1"`). */
  mutuallyExclusive?: boolean
  children: LayerTreeNode[]
}

export interface LayerTreeLeaf {
  kind: 'layer'
  /** Layer id matching LayerEntry.id. */
  layerId: string
  /** Display name (typically equals LayerEntry.name). */
  name: string
  /** Whether the layer is checked in the layer panel. */
  checked: boolean
}

/** The fields of a layer QGIS Server hides, by the service that hides them. */
export interface ServerHiddenFields {
  wms: string[]
  wfs: string[]
}
