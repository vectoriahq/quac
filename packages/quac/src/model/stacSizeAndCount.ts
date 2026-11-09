import { readDataAsset } from './stacAssetRoles'

import type { StacCollection } from './Stac'

/**
 * A Collection's declared file size and row count: `file:size` on its `data`
 * asset (File extension) and `table:row_count` on the Collection (Table
 * extension). Both are what the catalogue states, not what was measured, so a
 * count read here is for display and never one a load is checked against.
 */

export const FILE_EXTENSION = 'https://stac-extensions.github.io/file/v2.1.0/schema.json'
export const FILE_SIZE_FIELD = 'file:size'
export const TABLE_ROW_COUNT_FIELD = 'table:row_count'

/** The `data` asset's `file:size` in bytes, or null where it is absent or not a whole number above zero. */
export function readDataAssetFileSize(collection: StacCollection): number | null {
  const size = readDataAsset(collection)?.[FILE_SIZE_FIELD]
  return Number.isSafeInteger(size) && (size as number) > 0 ? size as number : null
}

/** The Collection's `table:row_count`, or null where it is absent or not a whole number of zero or more. */
export function readCollectionRowCount(collection: StacCollection): number | null {
  const count = collection[TABLE_ROW_COUNT_FIELD]
  return Number.isSafeInteger(count) && (count as number) >= 0 ? count as number : null
}
