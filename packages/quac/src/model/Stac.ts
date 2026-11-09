/**
 * Minimal STAC type definitions for the documents Groundwork generates.
 *
 * The shape these types describe — a Catalog of Collections, one Collection
 * per layer, vendor fields under `quac:` —
 * is written up in `packages/quac/spec/README.md`.
 *
 * STAC core (Item / Catalog / Collection) is an OGC Community Standard since
 * Oct 2025. We model only the subset we emit — extension fields and unused
 * core fields are reachable via the index signature.
 *
 * If validation needs grow beyond structural assertions, swap to a typed
 * STAC library (e.g. stac-js or @radiantearth/stac-spec-typescript). For
 * Phase 5 the inline types keep the dep tree small.
 */

export const STAC_VERSION = '1.1.0' as const

/** Anything STAC-shaped — Catalog, Collection, or Item. */
export type StacObject = StacCatalog | StacCollection

export interface StacCatalog {
  type: 'Catalog'
  stac_version: typeof STAC_VERSION
  stac_extensions?: string[]
  id: string
  title?: string
  description: string
  links: StacLink[]
  /**
   * Phase 5 emits child Collections inline. A real server-side STAC endpoint
   * splits them into separate documents at the URLs in `links` (rel=child).
   * Keeping them inline here is convenient for dev-panel inspection.
   */
  collections?: StacCollection[]
  /** Nested Catalogs (used to model QGIS layer groups). */
  catalogs?: StacCatalog[]
  // Allow extension fields and provider-specific properties without
  // failing typing.
  [extension: string]: unknown
}

export interface StacCollection {
  type: 'Collection'
  stac_version: typeof STAC_VERSION
  stac_extensions?: string[]
  id: string
  title?: string
  description: string
  license: string
  /** Who produced, licensed or hosts the data — the source of the credit line. */
  providers?: StacProvider[]
  extent: StacExtent
  summaries?: Record<string, unknown>
  assets?: Record<string, StacAsset>
  links: StacLink[]
  [extension: string]: unknown
}

/**
 * An organisation that had a hand in the Collection's data. STAC's `roles` are
 * `licensor`, `producer`, `processor` and `host`. This is where credit lines
 * come from — the app builds the on-screen attribution out of these names and
 * URLs rather than storing a pre-written string.
 */
export interface StacProvider {
  name: string
  description?: string
  roles?: string[]
  url?: string
}

/**
 * A STAC Item — one record inside a Collection, and a GeoJSON Feature in its own
 * right. A STAC API puts its data here rather than on the Collection, which is
 * why `packages/quac/src/sources/stacItems.ts` exists: a Collection served by an API
 * has no downloadable asset, and the Items inside it have them all.
 *
 * Only the fields Groundwork reads are named. `properties.datetime` is what
 * orders an item list. An Item may have `start_datetime` / `end_datetime`
 * instead; which of the three STAC requires was not established here — no
 * specification document was reachable — so `readItemTimestamp` takes
 * `datetime`, falling back to `start_datetime`, and `itemAsCollection` reads
 * `end_datetime` for the interval end.
 */
export interface StacItem {
  type: 'Feature'
  stac_version: string
  stac_extensions?: string[]
  id: string
  collection?: string
  bbox?: number[]
  geometry: unknown
  properties: {
    datetime?: string | null
    start_datetime?: string
    end_datetime?: string
    title?: string
    description?: string
    [extension: string]: unknown
  }
  assets?: Record<string, StacAsset>
  links?: StacLink[]
  [extension: string]: unknown
}

export interface StacExtent {
  spatial: { bbox: number[][] }
  /**
   * STAC core marks `temporal` as required on Collection extents. Sources
   * that declare no temporal range emit the open interval `[[null, null]]`,
   * which the spec defines as "unbounded at both ends". Real intervals fill
   * in once a source declares one.
   */
  temporal: { interval: Array<Array<string | null>> }
}

export interface StacAsset {
  href: string
  type?: string
  title?: string
  description?: string
  roles?: string[]
  [extension: string]: unknown
}

export interface StacLink {
  rel: string
  href: string
  type?: string
  title?: string
  /**
   * Extension fields a relation type has — the web-map-links extension puts
   * `pmtiles:layers` on the link rather than on the entity.
   */
  [extension: string]: unknown
}

/** Table extension column descriptor (`table:columns`), at the version `TABLE_EXTENSION` names. */
export interface TableColumn {
  name: string
  /**
   * Human-readable field label declared by the source. Readers treat either
   * `title` or `description` as the display label, with `title` taking
   * precedence when both are present.
   */
  title?: string
  /** The column's type: the `TableColumnType` an adapter maps the source's type to, or, for a QGIS Server type Groundwork does not map, its lowercased type name. */
  type?: string
  /** The column's type as a STAC common metadata data type, written beside a `type` that maps to one. */
  data_type?: TableColumnDataType
  description?: string
  /** The values the source restricts the field to: a QGIS ValueMap widget or an ArcGIS coded-value domain. */
  values?: TableColumnValue[]
  /** Declares that the column holds a file's path rather than a value of its own. */
  'quac:attachment'?: TableColumnAttachment
  /** Declares that the column's choices are the records of another Collection of the same catalogue. */
  'quac:value_relation'?: TableColumnValueRelation
  /** Written only as `false`: the source shows the column but does not let anyone change it. */
  'quac:editable'?: false
  /** A value the column is filled with on its own. */
  'quac:default'?: TableColumnDefault
  /** The constraints the source checks a value against before it saves. */
  'quac:constraints'?: TableColumnConstraints
  /** Written only as `true`: the source's form never shows the column. */
  'quac:hidden'?: true
  /** Written only as `true`: a new feature is offered the value last entered in the column. */
  'quac:reuse_last_value'?: true
  /**
   * Written only when the column does not pass its value on to a duplicate of
   * a feature: `default` takes the column's default value, or stays blank where
   * it has none; `unset` clears it.
   */
  'quac:duplicate_policy'?: 'default' | 'unset'
  /** Declares that the column is a Checkbox: a yes/no field with the source's own spelling. */
  'quac:checkbox'?: TableColumnCheckbox
  /** The limits and number format of a number column, each member written only where the source sets it. */
  'quac:range'?: TableColumnRange
  /**
   * Written only for a text column that holds dates in a format other than
   * ISO 8601: a QGIS date pattern such as `dd/MM/yyyy`.
   */
  'quac:date_format'?: string
  /**
   * The QGIS expressions that decide whether the source's form shows the
   * column, outermost container first. Written only for a column inside
   * containers with an enabled visibility expression.
   */
  'quac:visible_when'?: string[]
  /** Written only as `false`: the source's form layout does not place the column. */
  'quac:in_form'?: false
  /** Written only as `true`: the column holds a colour. */
  'quac:color'?: true
  /**
   * A QGIS expression: the source's form locks the column while it comes out
   * false. Written only for a placed column in a Drag and Drop Designer form
   * with an active data-defined Editable property.
   */
  'quac:editable_when'?: string
  /** The `https://` address of the icon drawn beside the column's name. */
  'quac:icon'?: string
  /** The control the source asks the edit form to draw the column's choices with. */
  'quac:control'?: 'buttons' | 'dropdown'
}

/**
 * A column whose choices come from another Collection's records: `key` is the
 * lookup field stored in the column, and `value` the one shown for it. Every
 * other member is written only where it differs from the source's default, so
 * a list ordered by key, unfiltered, with no blank choice and one selection
 * carries just the first three.
 */
export interface TableColumnValueRelation {
  /** The id of the Collection holding the lookup records. */
  collection: string
  /** The lookup field whose value the column stores. */
  key: string
  /** The lookup field whose value is shown for a stored key. */
  value: string
  /** A QGIS expression narrowing the list. */
  filter?: string
  /** Written only as `true`: the list offers a blank choice. */
  allow_null?: true
  /** Written only as `true`: the column stores several keys. */
  allow_multi?: true
  /** What orders the list when it is not the key: the shown value, or the lookup field named in `order_field`. */
  order_by?: 'value' | 'field'
  /** The lookup field the list is ordered by, written with `order_by` `field`. */
  order_field?: string
  /** Written only as `true`: the order is reversed. */
  descending?: true
}

/**
 * A Checkbox column. Every member is written only where it differs from the
 * source's default, so `{}` is a checkbox with no states that allows no blank.
 */
export interface TableColumnCheckbox {
  /** The value a text column holds for ticked. */
  checked?: string
  /** The value a text column holds for unticked. */
  unchecked?: string
  /** Written only as `true`: the source shows the stored value rather than true and false. */
  show_stored?: true
  /** Written only as `true`: a blank is a third state. */
  allow_null?: true
}

/** A number column's limits and format. */
export interface TableColumnRange {
  min?: number
  max?: number
  step?: number
  /** Decimal places shown. */
  precision?: number
  /** Text shown after the number in the edit form. */
  suffix?: string
}

/**
 * A column's default value. `now` is the moment of the create or save, written
 * as the column's type holds it; `uuid` is a new random identifier written in
 * `format`; `fixed` is `value`; `expression` is a QGIS expression over the
 * feature's fields. `on_update` fills it on every save rather than only the
 * one creating the feature.
 */
export type TableColumnDefault =
  | { kind: 'now'; on_update: boolean }
  | { kind: 'uuid'; format: 'with_braces' | 'without_braces' | 'id128'; on_update: boolean }
  | { kind: 'fixed'; value: string | number | boolean | null; on_update: boolean }
  | { kind: 'expression'; expression: string; on_update: boolean }

/**
 * A column's constraints. `not_null` is `enforced` where a blank is refused
 * and `warn` where it saves with a warning; `unique` is `enforced` where a
 * value another feature holds is refused and `warn` where it saves with a
 * warning. `expression` is a QGIS expression over the feature's fields that must
 * be true, in `strength`'s terms; `description` is the message the source
 * gives for it.
 */
export interface TableColumnConstraints {
  not_null?: 'enforced' | 'warn'
  unique?: 'enforced' | 'warn'
  expression?: { expression: string; description?: string; strength: 'enforced' | 'warn' }
}

/** The column types Groundwork's adapters map a source's declared field types to. */
export type TableColumnType = 'string' | 'int' | 'long' | 'double' | 'boolean' | 'date' | 'time' | 'timestamp'

/**
 * The STAC common metadata data types a `TableColumnType` maps to. STAC names
 * only numeric types and gives `other` for the rest, such as text, booleans
 * and dates.
 */
export type TableColumnDataType = 'int32' | 'int64' | 'float64' | 'other'

/**
 * One entry of a `table:columns` picklist — a display label and the value it
 * stores, as the source stores it. An ArcGIS domain can store a number.
 */
export interface TableColumnValue {
  value: string | number
  label: string
  /**
   * The `https://` address of the value's icon, from the `icon` column of a
   * Value Relation's lookup. Filled only on the copy of a Collection a layer is
   * built from (`withValueRelationLists`); a catalogue never carries it.
   */
  icon?: string
}

/** A column whose value is a path to a file. An absent member means the source declared nothing. */
export interface TableColumnAttachment {
  /** How the file is meant to be shown. Absent where the source specifies no viewer. */
  viewer?: 'image' | 'web' | 'audio' | 'video'
  /** The file types the source supports, in the source's own wording. */
  filter?: string
  /** The folder the source declares the files live in. */
  default_root?: string
  /** What a stored path is relative to. */
  relative_storage: 'absolute' | 'project' | 'default-root'
}
