import { getLowerCaseExtension } from './fileName.ts'

/**
 * What a catalogue says about each file format: its extensions and the media
 * type an asset of that format declares. What an application does with a
 * format, such as its name on screen or whether a layer from it saves, is the
 * application's own.
 */

/**
 * What a file is for: a layer's data, a table a project reads, a style for a
 * layer, or a project of layers. A table is read where a project names it, as
 * a lookup, a related dataset or a layer, and never on its own.
 */
export type LayerFileRole = 'data' | 'table' | 'style' | 'project'

/** The roles of a file a project layer's data source can name. */
export const PROJECT_DATA_ROLES: readonly LayerFileRole[] = ['data', 'table']

/** One role, or any of several. */
export type RoleFilter = LayerFileRole | readonly LayerFileRole[]

export function hasRole(format: { role: LayerFileRole }, role: RoleFilter | undefined): boolean {
  if (!role) return true
  return typeof role === 'string' ? format.role === role : role.includes(format.role)
}

export type LayerFileFormatId =
  | 'geojson'
  | 'geoparquet'
  | 'flatgeobuf'
  | 'cog'
  | 'csv'
  | 'geopackage'
  | 'shapefile'
  | 'sld'
  | 'qml'
  | 'qgis-project'

export interface CatalogueFileFormat {
  id: LayerFileFormatId
  role: LayerFileRole
  /** Lower-case, no leading dot. The first is the one written when a file is named. */
  extensions: readonly string[]
  /** Null for a project, which no Collection asset declares. */
  mediaType: string | null
}

export const GEOJSON_MEDIA_TYPE = 'application/geo+json'

/** GeoParquet and plain Parquet, per Portolan's media-type registry. */
export const PARQUET_MEDIA_TYPE = 'application/vnd.apache.parquet'

/**
 * FlatGeobuf, as Portolan's CLI registers `.fgb`
 * (`portolan_cli/extension_registry.py`, `portolan-sdi/portolan-cli@main`,
 * read 2026-10-04).
 */
export const FLATGEOBUF_MEDIA_TYPE = 'application/vnd.flatgeobuf'

/**
 * COG (Cloud Optimized GeoTIFF), per Portolan's media-type registry. Stored as
 * the Collection's `data`-role asset.
 */
export const COG_MEDIA_TYPE = 'image/tiff; application=geotiff; profile=cloud-optimized'

/**
 * GeoPackage, as IANA registers it with OGC as change controller
 * (`iana.org/assignments/media-types/application/geopackage+sqlite3`, read
 * 2026-10-26).
 */
export const GEOPACKAGE_MEDIA_TYPE = 'application/geopackage+sqlite3'

/** CSV, as IANA registers it (RFC 4180). Portolan's registry names no CSV. */
export const CSV_MEDIA_TYPE = 'text/csv'

/** QGIS layer style. QML has no registered media type, so this is an unregistered one. */
export const QML_STYLE_MEDIA_TYPE = 'application/x-qgis-qml+xml'

/** In the order `LAYER_FILE_FORMATS` lists them, which is the order a lookup by extension tries. */
export const CATALOGUE_FILE_FORMATS: readonly CatalogueFileFormat[] = [
  { id: 'geojson', role: 'data', extensions: ['geojson', 'json'], mediaType: GEOJSON_MEDIA_TYPE },
  { id: 'geoparquet', role: 'data', extensions: ['parquet'], mediaType: PARQUET_MEDIA_TYPE },
  { id: 'flatgeobuf', role: 'data', extensions: ['fgb'], mediaType: FLATGEOBUF_MEDIA_TYPE },
  { id: 'geopackage', role: 'data', extensions: ['gpkg'], mediaType: GEOPACKAGE_MEDIA_TYPE },
  { id: 'cog', role: 'data', extensions: ['tif', 'tiff'], mediaType: COG_MEDIA_TYPE },
  { id: 'csv', role: 'table', extensions: ['csv'], mediaType: CSV_MEDIA_TYPE },
  { id: 'shapefile', role: 'data', extensions: ['shp'], mediaType: 'application/x-esri-shape' },
  { id: 'sld', role: 'style', extensions: ['sld'], mediaType: 'application/vnd.ogc.sld+xml' },
  { id: 'qml', role: 'style', extensions: ['qml'], mediaType: QML_STYLE_MEDIA_TYPE },
  { id: 'qgis-project', role: 'project', extensions: ['qgs', 'qgz'], mediaType: null }
]

/** The format a file name's last extension belongs to, optionally only where it has the given role. */
function findCatalogueFileFormatByName(nameOrPath: string, role?: RoleFilter): CatalogueFileFormat | undefined {
  const extension = getLowerCaseExtension(nameOrPath)
  if (!extension) return undefined
  return CATALOGUE_FILE_FORMATS.find((format) => format.extensions.includes(extension) && hasRole(format, role))
}

/** Whether a file name is in the given format, whatever route it came by. */
export function isLayerFileOfFormat(nameOrPath: string, id: LayerFileFormatId): boolean {
  return findCatalogueFileFormatByName(nameOrPath)?.id === id
}

/** The media type a file is declared as in a catalogue, or `application/octet-stream`. */
export function declaredMediaTypeForFile(filename: string, role: RoleFilter): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  if (!extension) return 'application/octet-stream'
  return CATALOGUE_FILE_FORMATS.find((format) => format.extensions.includes(extension) && hasRole(format, role))?.mediaType
    ?? 'application/octet-stream'
}
