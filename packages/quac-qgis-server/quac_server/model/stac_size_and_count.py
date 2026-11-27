"""The File extension a data asset declares its file's size by, and the Table extension's row count of a Collection (`packages/quac/src/model/stacSizeAndCount.ts`)."""

# STAC extension URL for the File extension, whose `file:size` a data asset carries.
FILE_EXTENSION = 'https://stac-extensions.github.io/file/v2.1.0/schema.json'

# The key a data asset takes for its file's size in bytes.
FILE_SIZE_FIELD = 'file:size'

# The key a Collection takes for how many rows its data holds, from the Table extension.
TABLE_ROW_COUNT_FIELD = 'table:row_count'
