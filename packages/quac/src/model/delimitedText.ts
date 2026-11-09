import { readDataAsset } from './stacAssetRoles'

import type { StacCollection } from './Stac'

/**
 * How a QGIS Delimited Text data source splits its file, and the catalogue
 * field that carries it.
 *
 * QGIS reads a CSV with its Delimited Text provider when it is added from the
 * Data Source Manager's Delimited Text tab, and with OGR when it is dragged
 * into the project. Only the first names its options, and only the first
 * cannot edit (`QgsDelimitedTextProvider::capabilities`,
 * `src/providers/delimitedtext/qgsdelimitedtextprovider.cpp`,
 * `qgis/QGIS@99f68421`, read 2026-10-24).
 */
export interface DelimitedTextOptions {
  /** Characters that each end a cell. */
  delimiter: string
  /** Characters that each open and close a quoted cell. */
  quote: string
  /** Characters that each make the next character literal. A quote character here escapes only itself. */
  escape: string
  /** Lines skipped before the header or the first row. */
  skipLines: number
  /** Whether the first row read holds the column names. */
  header: boolean
  /** Whether space around an unquoted cell is removed. */
  trim: boolean
}

/** QGIS's defaults for a Delimited Text source that names nothing (`QgsDelimitedTextFile::setFromUrl`). */
export const DEFAULT_DELIMITED_TEXT_OPTIONS: DelimitedTextOptions = {
  delimiter: ',',
  quote: '"',
  escape: '"',
  skipLines: 0,
  header: true,
  trim: false
}

/** The key a data asset takes for the options of a Delimited Text source. */
export const QUAC_DELIMITED_TEXT = 'quac:delimited_text'

/** The field as the catalogue writes it. */
export function delimitedTextField(options: DelimitedTextOptions): Record<string, unknown> {
  return {
    delimiter: options.delimiter,
    quote: options.quote,
    escape: options.escape,
    skip_lines: options.skipLines,
    header: options.header,
    trim: options.trim
  }
}

/**
 * A Collection's Delimited Text options, or null where its data asset names
 * none, which is a file QGIS reads with OGR or no CSV at all. A key the field
 * leaves out takes QGIS's default, and a field with no delimiter is no field.
 */
export function readCollectionDelimitedText(collection: StacCollection): DelimitedTextOptions | null {
  const value = readDataAsset(collection)?.[QUAC_DELIMITED_TEXT]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const field = value as Record<string, unknown>
  const text = (key: string, fallback: string) => (typeof field[key] === 'string' ? field[key] as string : fallback)
  const flag = (key: string, fallback: boolean) => (typeof field[key] === 'boolean' ? field[key] as boolean : fallback)
  const skipLines = field['skip_lines']
  const options: DelimitedTextOptions = {
    delimiter: text('delimiter', DEFAULT_DELIMITED_TEXT_OPTIONS.delimiter),
    quote: text('quote', DEFAULT_DELIMITED_TEXT_OPTIONS.quote),
    escape: text('escape', DEFAULT_DELIMITED_TEXT_OPTIONS.escape),
    skipLines: typeof skipLines === 'number' && Number.isInteger(skipLines) && skipLines > 0 ? skipLines : 0,
    header: flag('header', DEFAULT_DELIMITED_TEXT_OPTIONS.header),
    trim: flag('trim', DEFAULT_DELIMITED_TEXT_OPTIONS.trim)
  }
  return options.delimiter ? options : null
}
