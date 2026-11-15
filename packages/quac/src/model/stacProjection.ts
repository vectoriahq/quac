import { readDataAsset } from './stacAssetRoles.ts'

import type { StacCollection } from './Stac.ts'

/** STAC extension URL for the Projection extension, whose `proj:code` a layer's data asset carries. */
export const PROJECTION_EXTENSION = 'https://stac-extensions.github.io/projection/v2.0.0/schema.json'

/** The Projection extension's key for the coordinate system an asset's data is in, such as `EPSG:28355`. */
export const PROJ_CODE = 'proj:code'

/**
 * The coordinate system a layer's data is in, from its data asset's
 * `proj:code`: the one QGIS gives `$x`, `$y` and `$geometry` in. Null where the
 * Collection names none.
 */
export function readCollectionCrs(collection: StacCollection): string | null {
  const code = readDataAsset(collection)?.[PROJ_CODE]
  return typeof code === 'string' && code.trim() ? code.trim() : null
}
