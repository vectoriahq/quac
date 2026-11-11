/**
 * The parts of an OGC API - Features service's JSON this package reads. Kept
 * apart from any OGC API - Features client so the STAC generators can describe a
 * collection without importing anything that fetches.
 */

export interface OgcLink {
  rel: string
  href: string
  type?: string
  title?: string
}

/**
 * What a collection holds. `feature` is the only kind that holds features to load —
 * `record` is a catalogue's index of itself (OGC API - Records) and `coverage`
 * is raster, which has no `items` endpoint to read.
 */
export type OgcItemType = 'feature' | 'record' | 'coverage' | string

export interface OgcCollection {
  id: string
  title?: string
  description?: string
  itemType?: OgcItemType
  keywords?: string[]
  extent?: {
    spatial?: { bbox?: number[][]; crs?: string }
    temporal?: { interval?: (string | null)[][] }
  }
  crs?: string[]
  links?: OgcLink[]
  [key: string]: unknown
}

export interface OgcCollectionsDocument {
  collections: OgcCollection[]
  links?: OgcLink[]
}
