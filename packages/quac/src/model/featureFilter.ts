import { readDataAsset } from './stacAssetRoles.ts'

import type { StacCollection } from './Stac.ts'

/**
 * The filter a QGIS file layer sets on its data in Layer Properties > Source >
 * Provider Feature Filter, so the layer holds only the features it keeps, and
 * the catalogue field that carries it.
 *
 * Its language is the one the layer's provider reads. OGR writes it as
 * `|subset=` at the end of the data source and hands it to GDAL, whose SQL
 * this is for every file read through OGR (`QgsOgrProviderMetadata::decodeUri`,
 * `src/core/providers/ogr/qgsogrprovidermetadata.cpp`, `qgis/QGIS@master`, read
 * 2026-10-26). The Delimited Text provider writes it as the `subset` query
 * item and reads it as a QGIS expression (`QgsDelimitedTextProvider`,
 * `subsetStringDialect`, `src/providers/delimitedtext/qgsdelimitedtextprovider.cpp`,
 * same commit). The WFS provider writes it as the `filter` parameter, or as a
 * `SELECT` statement in `sql=`, and turns it into an OGC Filter for the server
 * (`QgsWFSSharedData::computeFilter`, `src/providers/wfs/qgswfsshareddata.cpp`,
 * same commit).
 */
export interface FeatureFilter {
  /** The filter as the project writes it. */
  expression: string
  dialect: FeatureFilterDialect
}

/**
 * `ogr_sql` is GDAL's OGR SQL `WHERE` clause; `qgis_expression` is a QGIS
 * expression; `wfs_sql` is the `SELECT` statement a QGIS WFS layer can carry
 * instead of an expression (`QgsWFSProvider::setSubsetString`,
 * `src/providers/wfs/qgswfsprovider.cpp`, `qgis/QGIS@master`, read 2026-10-26),
 * and `ogc_filter` the OGC Filter XML it can carry in place of either.
 */
export type FeatureFilterDialect = 'ogr_sql' | 'qgis_expression' | 'wfs_sql' | 'ogc_filter'

const DIALECTS: readonly FeatureFilterDialect[] = ['ogr_sql', 'qgis_expression', 'wfs_sql', 'ogc_filter']

/** The key a data asset takes for its source's feature filter. */
export const QUAC_FEATURE_FILTER = 'quac:feature_filter'

/** The field as the catalogue writes it. */
export function featureFilterField(filter: FeatureFilter): Record<string, unknown> {
  return { expression: filter.expression, dialect: filter.dialect }
}

/**
 * A Collection's feature filter, or null where its data asset names none, so
 * the file is read whole. A field with blank text, or a dialect this does not
 * know, is no field.
 */
export function readCollectionFeatureFilter(collection: StacCollection): FeatureFilter | null {
  const value = readDataAsset(collection)?.[QUAC_FEATURE_FILTER]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { expression, dialect } = value as Record<string, unknown>
  if (typeof expression !== 'string' || !expression.trim()) return null
  if (!DIALECTS.includes(dialect as FeatureFilterDialect)) return null
  return { expression, dialect: dialect as FeatureFilterDialect }
}
