import type { StacAsset, StacCollection } from './Stac.ts'

/**
 * A Collection's styles — the assets with the `style` role.
 *
 * One rule covers every source (`packages/quac/spec/README.md` § Styles): a basemap's
 * MapLibre style documents, a QGIS layer's named styles, and a cloud folder's
 * sibling style files are all style assets on their Collection, and all read
 * through here. The asset's key is the style's name as its source records it,
 * and its media type says what kind of style document sits behind the address.
 *
 * The default is the asset with the `default` role alongside `style`, not
 * the one written first — see `DEFAULT_STYLE_ROLE` for why position cannot
 * express it. A source that marks none falls back to the first listed.
 */

export interface StacStyle {
  /** The style's name, as its source records it — the asset's title. */
  name: string
  /** Where the style document comes from; never the style itself. */
  href: string
  /** The style document's media type, when the source declares one. */
  type?: string
  /**
   * True when the Collection nominates this asset as its default, by the
   * `default` role. Absent means the source said nothing, never "not the
   * default" — see `getDefaultStyle`.
   */
  isDefault?: boolean
  /**
   * The field this style classifies by, when its source declared one — see
   * `QUAC_CATEGORISED_FIELD`. Absent means the source said nothing, never "this
   * style is not categorised": a folder's `.qml` and a catalogue written by
   * somebody else both leave it out, and a reader that needs the answer there
   * derives it from the converted style instead.
   */
  categorisedField?: string
  /**
   * The style overrides to merge into this style document, in order — see
   * `QUAC_STYLE_OVERRIDES`. Absent means none: the style draws as published.
   */
  overrides?: StyleOverrideReference[]
}

/**
 * One style override: the address of a JSON document, or the document itself.
 * Either holds the values to merge over the style document it is listed on.
 */
export type StyleOverrideReference = string | Record<string, unknown>

/** The key a style asset stores its categorised field under. */
const QUAC_CATEGORISED_FIELD = 'quac:categorised_field'

/** The key a style asset stores its style overrides under. */
const QUAC_STYLE_OVERRIDES = 'quac:style_overrides'

function readStyleOverrides(value: unknown): StyleOverrideReference[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry): StyleOverrideReference[] => {
    if (typeof entry === 'string') return entry.trim() ? [entry.trim()] : []
    return typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? [entry as Record<string, unknown>] : []
  })
}

/**
 * The role marking the asset a Collection nominates as its default style.
 *
 * The default cannot be expressed by the order the assets are written in, because
 * `assets` is a JSON object and JavaScript does not enumerate one in insertion
 * order: a key that looks like a whole number — a QGIS style named `2024` — is
 * yielded ahead of every other key, whenever it was written. So the document
 * says which asset is the default rather than implying it by position.
 */
export const DEFAULT_STYLE_ROLE = 'default'

/** MapLibre/Mapbox GL style document — a vector basemap's style. */
export const GL_STYLE_MEDIA_TYPE = 'application/vnd.mapbox.style+json'

/**
 * Every style a Collection declares.
 *
 * The style's name comes from the asset's `title`, falling back to its key. The
 * two are the same except where a source had to disambiguate the key — see
 * `styleAssetKey` — and there the title is the name the source actually gave
 * the style.
 *
 * The order is whatever `Object.entries` yields, which is *not* the order the
 * document was written in whenever a key looks like a whole number. Nothing
 * should read position from this list; `getDefaultStyle` is what answers
 * "which one is the default".
 */
export function collectCollectionStyles(collection: StacCollection): StacStyle[] {
  return Object.entries(collection.assets ?? {})
    .filter(([, asset]) => asset.roles?.includes('style'))
    .map(([key, asset]) => {
      const style: StacStyle = { name: asset.title ?? key, href: asset.href }
      if (asset.type) style.type = asset.type
      if (asset.roles?.includes(DEFAULT_STYLE_ROLE)) style.isDefault = true

      const categorisedField = asset[QUAC_CATEGORISED_FIELD]
      if (typeof categorisedField === 'string' && categorisedField.trim()) {
        style.categorisedField = categorisedField.trim()
      }

      const overrides = readStyleOverrides(asset[QUAC_STYLE_OVERRIDES])
      if (overrides.length > 0) style.overrides = overrides
      return style
    })
}

/**
 * A key for a style asset that does not displace one already in the set.
 *
 * Asset keys share one namespace per Collection, so a style whose name matches
 * a key already used — `data` most of all, which every data-bearing Collection
 * reserves — would otherwise overwrite it and leave the layer with no source to
 * load from. The style's real name is kept on the asset's `title`, which is what
 * `collectCollectionStyles` reads, so disambiguating the key changes nothing a
 * person sees.
 */
export function styleAssetKey(assets: Record<string, StacAsset>, name: string): string {
  if (!(name in assets)) return name

  let suffix = 2
  while (`${name} (${suffix})` in assets) suffix += 1
  return `${name} (${suffix})`
}

/**
 * The style used when nothing narrows the choice: the one the Collection marks
 * with the `default` role.
 *
 * Falls back to the first listed for a Collection that marks none — a document
 * written by somebody else, or one of ours from before the role existed. That
 * fallback has the ordering hazard `DEFAULT_STYLE_ROLE` describes, which is
 * why every generator here marks its default rather than relying on it.
 */
export function getDefaultStyle(styles: StacStyle[]): StacStyle | undefined {
  return styles.find((style) => style.isDefault) ?? styles[0]
}
