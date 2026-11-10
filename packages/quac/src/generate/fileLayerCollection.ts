import { generateStacFromNormalized, slugify } from './normalizedProject.ts'
import { QUAC_LAYER_NAME } from './stacCatalogue.ts'
import { encodeAssetPath } from '../model/stacHref.ts'
import { declaredMediaTypeForFile, GEOJSON_MEDIA_TYPE } from '../util/catalogueFileFormats.ts'

import type { StacCollection } from '../model/Stac.ts'

/**
 * The fields a Collection for a file dropped onto the map is built from.
 */
export interface DroppedFileCollectionOptions {
  /** The layer's collection id. */
  collectionId: string
  /** The file's path as dropped: its name for a loose file, or its folder path. */
  relativePath: string
  /** When the file was dropped, as an ISO 8601 UTC time. */
  uploadedAt: string
  /** The table read, where the file is a GeoPackage. */
  layerName?: string | null
}

/**
 * The fields a Collection for a GeoJSON file loaded from a pasted link is built from.
 */
export interface LinkedFileCollectionOptions {
  /** The layer's collection id. */
  collectionId: string
  /** The link the file was loaded from. */
  url: string
  /** The file's name, taken from the link. */
  filename: string
  /** When the file was loaded, as an ISO 8601 UTC time. */
  loadedAt: string
}

/**
 * Generates the Collection for one dropped file: a `data` asset naming the file
 * and its media type, `created` set to the drop time, and the world extent, which
 * a Collection with no declared box takes. The file is not opened, so nothing
 * here describes its contents, and it declares no title of its own.
 *
 * Pure function — no side effects, no I/O.
 */
export function generateCollectionForDroppedFile(options: DroppedFileCollectionOptions): StacCollection {
  const name = options.relativePath.split('/').pop() ?? options.relativePath
  return buildFileCollection({
    collectionId: options.collectionId,
    name,
    href: `./${encodeAssetPath(options.relativePath)}`,
    mediaType: declaredMediaTypeForFile(name, 'data'),
    createdAt: options.uploadedAt,
    layerName: options.layerName ?? null
  })
}

/**
 * Generates the Collection for one GeoJSON file loaded from a pasted link: the
 * same as a dropped file's, with the link as the `data` asset's address. The
 * link is only ever read as GeoJSON, whatever its file name says.
 *
 * Pure function — no side effects, no I/O.
 */
export function generateCollectionForLinkedFile(options: LinkedFileCollectionOptions): StacCollection {
  return buildFileCollection({
    collectionId: options.collectionId,
    name: options.filename,
    href: options.url,
    mediaType: GEOJSON_MEDIA_TYPE,
    createdAt: options.loadedAt
  })
}

function buildFileCollection(file: {
  collectionId: string
  name: string
  href: string
  mediaType: string
  createdAt: string
  layerName?: string | null
}): StacCollection {
  const catalogue = generateStacFromNormalized({
    id: slugify(file.name) || 'file',
    title: file.name,
    description: '',
    bbox: null,
    nodes: [{
      kind: 'layer',
      id: file.collectionId,
      title: file.name,
      description: '',
      bbox: null,
      geometryType: null,
      tableColumns: [],
      assets: {
        data: {
          href: file.href,
          type: file.mediaType,
          title: file.name,
          roles: ['data'],
          ...(file.layerName ? { [QUAC_LAYER_NAME]: file.layerName } : {})
        }
      },
      created: file.createdAt,
      displayField: null,
      visibilityChecked: null,
      editable: null
    }]
  })
  const collection = catalogue.collections![0]
  delete collection.title
  return collection
}
