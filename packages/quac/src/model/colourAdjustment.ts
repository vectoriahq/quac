import type { StacCollection } from './Stac.ts'

/**
 * The colour adjustments a Collection declares for its layer, each as its
 * `quac:` field states it. A reader applies them to every pixel's red, green
 * and blue values in QGIS's order: contrast, brightness, gamma, saturation.
 */
export interface ColourAdjustment {
  /** `quac:contrast`, from -1 to 1; 0 leaves the layer unchanged. */
  contrast: number
  /** `quac:brightness`, from -1 to 1; 0 leaves the layer unchanged. */
  brightness: number
  /** `quac:gamma`, from 0.1 to 10; 1 leaves the layer unchanged. */
  gamma: number
  /** `quac:saturation`, from -1 to 1; 0 leaves the layer unchanged. */
  saturation: number
}

/** What each field reads as when the Collection states nothing, and the range a value is brought into. */
const FIELDS = {
  contrast: { key: 'quac:contrast', unchanged: 0, min: -1, max: 1 },
  brightness: { key: 'quac:brightness', unchanged: 0, min: -1, max: 1 },
  gamma: { key: 'quac:gamma', unchanged: 1, min: 0.1, max: 10 },
  saturation: { key: 'quac:saturation', unchanged: 0, min: -1, max: 1 }
} as const

/**
 * The colour adjustments a Collection declares, or null where every one of
 * them leaves the layer unchanged, so a caller draws the layer as it is.
 *
 * A value that is not a finite number is read as stating nothing, as is a
 * gamma of 0 or below, which has no meaning. A value outside its field's range
 * is brought to the nearer end of it.
 */
export function readCollectionColourAdjustment(collection: StacCollection): ColourAdjustment | null {
  const adjustment = {} as ColourAdjustment
  let changes = false
  for (const [name, field] of Object.entries(FIELDS) as [keyof ColourAdjustment, (typeof FIELDS)[keyof ColourAdjustment]][]) {
    const value = collection[field.key]
    const stated = typeof value === 'number' && Number.isFinite(value) && !(name === 'gamma' && value <= 0)
    adjustment[name] = stated ? Math.min(field.max, Math.max(field.min, value)) : field.unchanged
    if (adjustment[name] !== field.unchanged) changes = true
  }
  return changes ? adjustment : null
}
