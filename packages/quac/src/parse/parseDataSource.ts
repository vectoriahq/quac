import { wmsEndpoint } from '../model/stacWms'
import { wmtsEndpoint } from '../model/stacWmts'

import type { DelimitedTextOptions } from '../model/delimitedText'
import type { FeatureFilter } from '../model/featureFilter'
import type { DataSource, FileDataSource } from '../model/QgsProject'

/**
 * Parses a QGIS <datasource> string into a typed descriptor.
 *
 * File, WFS, public WMS and public ArcGIS FeatureServer sources are recognised:
 *
 * 1. **File** (OGR provider) — typically `./relative/path.geojson`, optionally
 *    followed by `|layername=...` and other pipe-separated options. Examples:
 *      "./graffiti.json|layername=WA_Municipal_Graffiti_Vandalism_Register"
 *      "../data/roads.shp"
 *      "/abs/path/buildings.gpkg|layername=parcels"
 *
 *    The basename is stored as `filename` for drag-drop companion matching.
 *    The full normalised relative path is stored as `relPath` for cloud
 *    loaders that resolve files against a folder listing.
 *
 * 2. **WFS** — space-separated key='value' pairs. Example:
 *      pagingEnabled='true' restrictToRequestBBOX='1' srsname='EPSG:4326'
 *      typename='ns:layer' url='https://example/wfs' version='auto'
 *
 *    `url` and `typename` are required for the source to be considered WFS.
 *
 * 3. **WMS, XYZ and WMTS** — URL query parameters in QGIS's wms provider URI,
 *    which holds all three: `type=xyz` marks an XYZ tile layer and
 *    `tileMatrixSet` a WMTS one. Example:
 *      type=xyz&url=https://tile.openstreetmap.org/%7Bz%7D/%7Bx%7D/%7By%7D.png&zmax=19&zmin=0
 *
 *    The `xyzvectortiles` provider writes an XYZ vector tile layer in the same
 *    shape, with `type=xyz`. Its template must hold `{z}`, `{x}` and `{y}`.
 *
 * 4. **Delimited Text** — a `file:` URL whose query names how the file splits.
 *    Example:
 *      file:./data/types.csv?type=csv&delimiter=;&detectTypes=yes&geomType=none
 *
 *    Read as a file source carrying those options. Only `type=csv` (and its
 *    older name `plain`) is read; a whitespace or regular-expression split is
 *    unsupported.
 *
 * 5. **ArcGIS FeatureServer** — the `arcgisfeatureserver` provider, written in
 *    the same key='value' shape as WFS, with the filter as a trailing `sql=`.
 *    Example:
 *      url='https://gis.example.test/arcgis/rest/services/Kinders/FeatureServer/0'
 *
 * 6. **Unsupported** — anything else (PostGIS, a local vector tile file, a source needing
 *    credentials or custom headers, etc.). The raw string is retained for
 *    diagnostics.
 *
 * The provider element from the parent <maplayer> can be passed as a hint to
 * disambiguate edge cases; if omitted, content sniffing is used.
 */
export function parseDataSource(raw: string, providerHint: string | null = null): DataSource {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { kind: 'unsupported', raw, hint: providerHint }
  }

  if (providerHint?.toLowerCase() === 'wms') {
    const params = new URLSearchParams(trimmed)
    if (needsCredentialsOrHeaders(params)) return { kind: 'unsupported', raw, hint: providerHint }
    if (params.get('type') === 'xyz') return parseXyzDataSource(params, raw) ?? { kind: 'unsupported', raw, hint: providerHint }
    if (params.has('tileMatrixSet')) return parseWmtsDataSource(params, raw) ?? { kind: 'unsupported', raw, hint: providerHint }
    // Any other `type` is a tile format this does not read, such as a local MBTiles file.
    if (params.has('type')) return { kind: 'unsupported', raw, hint: providerHint }
    const url = params.get('url')
    const layers = params.getAll('layers').flatMap((value) => value.split(','))
    if (url && wmsEndpoint(url) && layers.length > 0 && layers.every((name) => name.trim().length > 0)) {
      const version = params.get('version')
      if (version && version !== '1.1.1' && version !== '1.3.0') {
        return { kind: 'unsupported', raw, hint: providerHint }
      }
      const dimensions: Record<string, string> = {}
      for (const key of ['time', 'elevation']) {
        const value = params.get(key)
        if (value) dimensions[key.toUpperCase()] = value
      }
      return {
        kind: 'wms', url, layers,
        styles: params.getAll('styles').flatMap((value) => value.split(',')),
        format: params.get('format') ?? 'image/png',
        crs: params.get('crs') ?? 'EPSG:3857',
        version: version === '1.1.1' || version === '1.3.0' ? version : null,
        transparent: params.get('transparent')?.toLowerCase() !== 'false',
        dimensions, raw
      }
    }
    return { kind: 'unsupported', raw, hint: providerHint }
  }

  if (providerHint?.toLowerCase() === 'xyzvectortiles') {
    return parseVectorXyzDataSource(new URLSearchParams(trimmed), raw) ?? { kind: 'unsupported', raw, hint: providerHint }
  }

  if (providerHint?.toLowerCase() === 'arcgisfeatureserver') {
    return parseArcgisFeatureServerDataSource(raw, trimmed) ?? { kind: 'unsupported', raw, hint: providerHint }
  }

  if (providerHint?.toLowerCase() === 'delimitedtext') {
    return parseDelimitedTextDataSource(raw, trimmed) ?? { kind: 'unsupported', raw, hint: providerHint }
  }

  // WFS detection: look for url=' or url=" along with typename=
  if (looksLikeWfs(trimmed)) {
    const { source, sql } = splitOffWfsSql(trimmed)
    const params = parseSpaceSeparatedKeyValues(source)
    const url = params.url
    const typeName = params.typename ?? params.typeName
    if (url && typeName) {
      // QGIS sends the server a `SELECT` statement where the source has one, and the `filter`
      // otherwise (`QgsWFSProvider::QgsWFSProvider`, `src/providers/wfs/qgswfsprovider.cpp`,
      // `qgis/QGIS@master`, read 2026-10-26).
      const filter = params.filter?.trim() ? params.filter : null
      // QGIS takes a `filter` that parses as XML for an OGC Filter as it is (`QgsWFSSharedData::computeFilter`);
      // one that starts with `<` is read as that here.
      const featureFilter: FeatureFilter | null = sql
        ? { expression: sql, dialect: 'wfs_sql' }
        : filter ? { expression: filter, dialect: filter.trim().startsWith('<') ? 'ogc_filter' : 'qgis_expression' } : null
      return {
        kind: 'wfs',
        url,
        typeName,
        srsName: params.srsname ?? params.srsName ?? null,
        ...(featureFilter ? { featureFilter } : {}),
        raw
      }
    }
  }

  // File detection: any non-key=value string is treated as a file path.
  // The provider hint "ogr" reinforces this but isn't required.
  if (looksLikeFilePath(trimmed) || providerHint === 'ogr') {
    return parseFileDataSource(raw, trimmed)
  }

  // Otherwise: unsupported. Try to sniff a hint for nicer diagnostics.
  return { kind: 'unsupported', raw, hint: providerHint ?? sniffProviderHint(trimmed) }
}

/**
 * Whether a wms-provider source names credentials or a header to send. QGIS
 * writes some of these keys with no value on sources needing neither — an XYZ
 * layer added from its browser panel carries `http-header:referer=` — so only
 * a key with a value counts.
 */
function needsCredentialsOrHeaders(params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (!value.trim()) continue
    if (['authcfg', 'username', 'password', 'referer'].includes(key) || key.startsWith('http-header:')) return true
  }
  return false
}

/**
 * An XYZ tile layer. QGIS's `{q}` is Bing's quadkey, written as the `{quadkey}`
 * the tile layer fills in. Null for a template that is not an absolute
 * `http`/`https` address holding `{z}` or a quadkey.
 */
function parseXyzDataSource(params: URLSearchParams, raw: string): DataSource | null {
  const url = params.get('url')?.replaceAll('{q}', '{quadkey}')
  if (!url || !/\{(z|quadkey)\}/.test(url)) return null
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
  } catch {
    return null
  }
  const zmax = params.get('zmax')
  const maxZoom = zmax && /^\d+$/.test(zmax) ? Number(zmax) : null
  return { kind: 'xyz', tiles: 'image', url, maxZoom, raw }
}

/**
 * An XYZ vector tile layer. Null for any other `type`, such as a local MBTiles
 * file, for a source needing credentials or headers, and for a template
 * without `{z}`, `{x}` and `{y}`.
 */
function parseVectorXyzDataSource(params: URLSearchParams, raw: string): DataSource | null {
  if (params.get('type') !== 'xyz' || needsCredentialsOrHeaders(params)) return null
  const parsed = parseXyzDataSource(params, raw)
  if (parsed?.kind !== 'xyz' || !['{z}', '{x}', '{y}'].every((placeholder) => parsed.url.includes(placeholder))) return null
  return { ...parsed, tiles: 'vector' }
}

/**
 * A WMTS layer. QGIS names one layer, one style and one tile matrix set; its
 * `tileDimensions` are `name=value` pairs separated by `;`.
 */
function parseWmtsDataSource(params: URLSearchParams, raw: string): DataSource | null {
  const url = wmtsEndpoint(params.get('url') ?? '')
  const layer = params.get('layers')?.trim()
  const tileMatrixSet = params.get('tileMatrixSet')?.trim()
  if (!url || !layer || !tileMatrixSet) return null
  const dimensions: Record<string, string> = {}
  for (const pair of (params.get('tileDimensions') ?? '').split(';')) {
    const separator = pair.indexOf('=')
    if (separator > 0) dimensions[pair.slice(0, separator)] = pair.slice(separator + 1)
  }
  return {
    kind: 'wmts', url, layer, tileMatrixSet,
    style: params.get('styles') ?? '',
    format: params.get('format') || 'image/png',
    dimensions, raw
  }
}

function looksLikeWfs(raw: string): boolean {
  return /\burl\s*=\s*['"]/.test(raw) && /\btypename\s*=\s*['"]/i.test(raw)
}

function looksLikeFilePath(raw: string): boolean {
  // No '=' before the first '|' or end → looks like a path with optional |layername
  const pathPart = raw.split('|')[0] ?? raw
  if (pathPart.includes('=')) return false
  // Has a path separator or a file extension or a parent ref
  return /[\\/.]/.test(pathPart) || pathPart.startsWith('.')
}

function parseFileDataSource(raw: string, trimmed: string): DataSource {
  const { source, subset } = splitOffSubset(trimmed)
  const [pathPart = '', ...optionParts] = source.split('|')
  const url = readOnlineFileUrl(pathPart.trim())
  const normalisedPath = url ?? pathPart.trim().replace(/\\/g, '/')
  const filename = url ? basename(new URL(url).pathname) : basename(normalisedPath)
  // Retain the full relative path for cloud loaders that need to resolve
  // files inside a folder share. Falls back to filename when no directory.
  const relPath = normalisedPath || filename
  let layerName: string | null = null
  for (const opt of optionParts) {
    const match = /^layername\s*=\s*(.*)$/i.exec(opt.trim())
    if (match) {
      layerName = match[1].trim()
      break
    }
  }
  return {
    kind: 'file', filename, relPath, layerName,
    ...(url ? { url } : {}),
    geometryTypeFilter: readGeometryTypeFilter(optionParts),
    ...(subset ? { featureFilter: { expression: subset, dialect: 'ogr_sql' as const } } : {}),
    raw
  }
}

/**
 * The address of an online file: the path after GDAL's `/vsicurl/` prefix,
 * which QGIS writes for a file it reads over HTTP, or a path that is itself an
 * `http`/`https` address. Null for a file on disk, and for an address with
 * credentials in it.
 */
function readOnlineFileUrl(path: string): string | null {
  const address = path.replace(/^\/vsicurl\//i, '')
  if (!/^https?:\/\//i.test(address)) return null
  try {
    const parsed = new URL(address)
    return parsed.username || parsed.password ? null : parsed.href
  } catch {
    return null
  }
}

/**
 * An OGR source's `|subset=` filter and the source without it. Everything
 * after the option is the filter, `|` included, as QGIS reads it
 * (`QgsOgrProviderMetadata::decodeUri`, `src/core/providers/ogr/qgsogrprovidermetadata.cpp`,
 * `qgis/QGIS@master`, read 2026-10-26), and the option's name is matched with
 * its case. A blank filter is none.
 */
function splitOffSubset(source: string): { source: string, subset: string | null } {
  const at = source.indexOf('|subset=')
  if (at === -1) return { source, subset: null }
  const subset = source.slice(at + '|subset='.length)
  return { source: source.slice(0, at), subset: subset.trim() ? subset : null }
}

/** A file source option `readGeometryTypeFilter` reads as `geometrytype=`, the type name captured. */
export const GEOMETRY_TYPE_OPTION = /^geometrytype=([a-zA-Z0-9]*)$/i

/**
 * The shape a file source's `|geometrytype=` option keeps, read as QGIS's OGR
 * provider reads it (qgis/QGIS@99f68421f54e473d777d6693b859ab91a06cce30,
 * `src/core/providers/ogr/`): the key in any case, the value matched exactly
 * against its type names (`ogrWkbGeometryTypeFromName`), then reduced to its
 * single-part, straight-edged shape (`ogrWkbSingleFlattenAndLinear`), so a
 * `MultiPoint` filter keeps points. `uniqueGeometryType=yes` turns the filter
 * off. Only the first `geometrytype=` counts, as in QGIS. A geometry
 * collection or `None` filter, and a name QGIS does not know, give no filter.
 */
function readGeometryTypeFilter(optionParts: readonly string[]): FileDataSource['geometryTypeFilter'] {
  let typeName: string | null = null
  for (const opt of optionParts) {
    const geometryType = GEOMETRY_TYPE_OPTION.exec(opt.trim())
    if (geometryType && typeName === null) typeName = geometryType[1]
    if (/^uniqueGeometryType=yes$/i.test(opt.trim())) return null
  }
  return typeName === null ? null : GEOMETRY_TYPE_FILTERS[typeName] ?? null
}

const GEOMETRY_TYPE_FILTERS: Record<string, FileDataSource['geometryTypeFilter']> = {
  Point: 'Point',
  MultiPoint: 'Point',
  Point25D: 'Point',
  MultiPoint25D: 'Point',
  LineString: 'LineString',
  MultiLineString: 'LineString',
  LineString25D: 'LineString',
  MultiLineString25D: 'LineString',
  CircularString: 'LineString',
  CircularStringZ: 'LineString',
  CompoundCurve: 'LineString',
  CompoundCurveZ: 'LineString',
  MultiCurve: 'LineString',
  MultiCurveZ: 'LineString',
  Polygon: 'Polygon',
  MultiPolygon: 'Polygon',
  Polygon25D: 'Polygon',
  MultiPolygon25D: 'Polygon',
  CurvePolygon: 'Polygon',
  CurvePolygonZ: 'Polygon',
  MultiSurface: 'Polygon',
  MultiSurfaceZ: 'Polygon'
}

/**
 * A Delimited Text source: the file its `file:` URL names, and the options its
 * query gives, read as `QgsDelimitedTextFile::setFromUrl` reads them
 * (`src/providers/delimitedtext/qgsdelimitedtextfile.cpp`, `qgis/QGIS@99f68421`,
 * read 2026-10-24). QGIS stores a relative path as `file:./data.csv?…`, and
 * reads one without the `file:` scheme too (`relativeToAbsoluteUri`,
 * `qgsdelimitedtextprovider.cpp`). A tab is written `\t`. Null where the split
 * is not `csv` or `plain`, or the URL names no file.
 */
function parseDelimitedTextDataSource(raw: string, trimmed: string): DataSource | null {
  const queryStart = trimmed.indexOf('?')
  const location = queryStart === -1 ? trimmed : trimmed.slice(0, queryStart)
  const query = new Map<string, string>()
  for (const pair of (queryStart === -1 ? '' : trimmed.slice(queryStart + 1)).split('&')) {
    if (!pair) continue
    const separator = pair.indexOf('=')
    const key = decodeQueryPart(separator === -1 ? pair : pair.slice(0, separator))
    // The first value wins, as `QUrlQuery::queryItemValue` gives it.
    if (!query.has(key)) query.set(key, separator === -1 ? '' : decodeQueryPart(pair.slice(separator + 1)))
  }

  const type = query.get('type') ?? query.get('delimiterType') ?? 'csv'
  if (type !== 'csv' && type !== 'plain') return null
  const path = filePathOfUrl(location)
  if (!path) return null

  const decodeChars = (chars: string) => chars.replaceAll('\\t', '\t')
  const isYes = (value: string | undefined, fallback: boolean) => (value === undefined ? fallback : !value.toUpperCase().startsWith('N'))
  const skipLines = Number.parseInt(query.get('skipLines') ?? '0', 10)
  const options: DelimitedTextOptions = {
    delimiter: decodeChars(query.get('delimiter') ?? ','),
    // `plain` is the older name, whose quotes were either kind and which had no escape.
    quote: decodeChars(query.get('quote') ?? (type === 'plain' ? '\'"' : '"')),
    escape: decodeChars(query.get('escape') ?? (type === 'plain' ? '' : '"')),
    skipLines: Number.isFinite(skipLines) && skipLines > 0 ? skipLines : 0,
    header: isYes(query.get('useHeader'), true),
    trim: query.has('trimFields') && isYes(query.get('trimFields'), false)
  }
  if (!options.delimiter) return null

  // The filter is a QGIS expression here, not GDAL's SQL.
  const subset = query.get('subset')?.trim() ? query.get('subset')! : null
  const file = parseFileDataSource(raw, path)
  return file.kind === 'file'
    ? { ...file, delimitedText: options, ...(subset ? { featureFilter: { expression: subset, dialect: 'qgis_expression' as const } } : {}) }
    : null
}

/** A query key or value with its percent-escapes decoded, kept as it is where one is malformed. */
function decodeQueryPart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * The path a `file:` URL names: `file:./data.csv` is relative, `file:///C:/x.csv`
 * a Windows drive and `file:///home/x.csv` an absolute path. A location
 * without the scheme is a path already.
 */
function filePathOfUrl(location: string): string {
  let path = location.replace(/^file:/i, '')
  if (path.startsWith('///')) path = path.slice(2)
  else if (path.startsWith('//')) path = path.slice(1)
  if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1)
  return decodeQueryPart(path.trim())
}

function basename(pathLike: string): string {
  // Handle both forward and back slashes since QGS authors run on any OS.
  const parts = pathLike.split(/[\\/]/)
  return parts[parts.length - 1] ?? pathLike
}

/**
 * Parses QGIS's WFS/PostGIS-style URI: space-separated key='value' or
 * key="value" pairs. Quotes are required around values that contain spaces.
 * QGIS escapes a quote or a backslash inside a value with a backslash
 * (`QgsDataSourceUri::escape`, `src/core/qgsdatasourceuri.cpp`,
 * `qgis/QGIS@master`, read 2026-10-26), as a WFS layer's `filter` needs.
 */
function parseSpaceSeparatedKeyValues(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Match key='...' or key="..."
  const re = /(\w+)\s*=\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const key = m[1]
    const value = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1')
    out[key] = value
  }
  return out
}

/**
 * A WFS source's `sql=` statement and the source without it. QGIS writes it
 * last and unquoted (`QgsDataSourceUri::uri`, same source as above), so the
 * first `sql=` that starts a word outside a quoted value begins it, and
 * everything after it is the statement.
 */
function splitOffWfsSql(source: string): { source: string, sql: string | null } {
  let quote: string | null = null
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at]!
    if (quote) {
      if (char === '\\') at += 1
      else if (char === quote) quote = null
    } else if (char === '\'' || char === '"') {
      quote = char
    } else if (source.startsWith('sql=', at) && (at === 0 || /\s/.test(source[at - 1]!))) {
      const sql = source.slice(at + 'sql='.length)
      return { source: source.slice(0, at), sql: sql.trim() ? sql : null }
    }
  }
  return { source, sql: null }
}

/**
 * A layer of an ArcGIS FeatureServer or MapServer. QGIS's provider reads the
 * service layer from `url`, signs in through `authcfg`, `urlprefix` or the
 * source's HTTP headers, keeps only features overlapping `bbox`, and sends
 * `sql=` to the service as the query's `where` (`QgsAfsProvider`,
 * `src/providers/arcgisrest/qgsafsprovider.cpp`, and `QgsAfsSharedData`,
 * beside it, `qgis/QGIS@master`, read 2026-11-05).
 *
 * Null for a source needing a sign-in or a header, for one limited to a box,
 * which this does not apply, and for an address that is not a service layer.
 */
function parseArcgisFeatureServerDataSource(raw: string, trimmed: string): DataSource | null {
  const { source, sql } = splitOffWfsSql(trimmed)
  const params = parseSpaceSeparatedKeyValues(source)
  if (['authcfg', 'urlprefix', 'referer', 'bbox'].some((key) => params[key]?.trim())) return null
  // `http-header:` keys hold a colon, which the key-value reader leaves out.
  if (/(?:^|\s)http-header:[\w-]+\s*=\s*(['"])(?!\1)/.test(source)) return null
  const url = params.url
  if (!url || !/\/(FeatureServer|MapServer)\/\d+\/?$/.test(url)) return null
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search) return null
  } catch {
    return null
  }
  return { kind: 'arcgis', url: url.replace(/\/$/, ''), where: sql?.trim() ? sql.trim() : null, raw }
}

function sniffProviderHint(raw: string): string | null {
  if (/\bdbname\s*=/.test(raw)) return 'postgres'
  if (/\bservice\s*=\s*['"]?(wms|wmts)/i.test(raw)) return 'wms'
  return null
}
