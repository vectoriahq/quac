import { generateStacFromNormalized, slugify, withSelfLink } from './normalizedProject.ts'
import { encodeAssetPath } from '../model/stacHref.ts'
import { FILE_EXTENSION, FILE_SIZE_FIELD } from '../model/stacSizeAndCount.ts'
import { DEFAULT_STYLE_ROLE, styleAssetKey } from '../model/stacStyles.ts'
import { declaredMediaTypeForFile } from '../util/catalogueFileFormats.ts'

import type { NormalizedLayer, NormalizedProject } from './normalizedProject.ts'
import type { StacAsset, StacCatalog } from '../model/Stac.ts'

/**
 * Generates a STAC Catalog for a cloud folder that holds layer files and no
 * catalogue file of its own:
 *   the folder     → top-level Catalog
 *   each data file → a Collection with a `data` asset
 *
 * Built from the folder's listing alone — no file is opened. A layer file
 * has no header describing itself, so its extent and field schema can only
 * be had by downloading and parsing the whole thing, which for a folder of
 * large files would be paid on every visit whether or not those layers are ever
 * switched on. Both are therefore left absent, which the profile already covers:
 * a Collection with no declared box takes the world extent, and one with no
 * declared schema simply has no `table:columns`. Both are read as each layer
 * loads, exactly as they do for a WFS service.
 *
 * The folder declares no author intent, so the shared presentation fields are left off
 * rather than invented — including `quac:editable`, which means nothing here forbids
 * editing a layer.
 *
 * Pure function — no side effects, no I/O.
 */

/** One data file the folder holds, as the caller read it from the listing. */
export interface FolderCatalogueFile {
  /** Path inside the published folder — the Collection's id. */
  relPath: string
  /** File name only, used as the asset's title. */
  name: string
  /** Display name derived from the file name. */
  layerName: string
  /** Media type for the `data` asset. */
  mediaType: string
  /** Path of the sibling style file, when the folder holds one for this layer. */
  styleRelPath: string | null
  /** The file's size in bytes from the listing, or null where the listing gives none. */
  size: number | null
}

export interface FolderStacCatalogueOptions {
  /** The published folder's name, used as the Catalog's title. */
  folderName: string
  /**
   * The folder's own share link, recorded as the Catalog's `self` link. For a
   * folder catalogue this is the only thing identifying where the layers come
   * from, since no project file speaks for them.
   */
  selfHref?: string
}

export function generateStacCatalogueFromFolder(
  files: FolderCatalogueFile[],
  options: FolderStacCatalogueOptions
): StacCatalog {
  return withSelfLink(
    generateStacFromNormalized(folderToNormalized(files, options)),
    options.selfHref
  )
}

function folderToNormalized(
  files: FolderCatalogueFile[],
  options: FolderStacCatalogueOptions
): NormalizedProject {
  return {
    id: slugify(options.folderName) || 'folder',
    title: options.folderName,
    description: 'Layers published from a cloud folder.',
    bbox: null,
    nodes: files.map(fileToNormalized)
  }
}

/** The style's name — the style file's own name, without folders or extension. */
function styleNameFromPath(relPath: string): string {
  const filename = relPath.split('/').pop() ?? relPath
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

function fileToNormalized(file: FolderCatalogueFile): NormalizedLayer {
  const assets: Record<string, StacAsset> = {
    data: {
      // The file's path in the folder, escaped: `#` and `?` are legal in a file
      // name and would otherwise end the path when the href is read back.
      href: `./${encodeAssetPath(file.relPath)}`,
      type: file.mediaType,
      title: file.name,
      roles: ['data']
    }
  }
  const hasSize = Number.isSafeInteger(file.size) && (file.size as number) > 0
  if (hasSize) assets.data[FILE_SIZE_FIELD] = file.size

  // A style is declared, never embedded — the app fetches it live on every load,
  // the same as a style a project file refers to. Keyed by the style file's name so
  // it reads as one entry in a style set, like every other source's styles.
  if (file.styleRelPath) {
    const styleName = styleNameFromPath(file.styleRelPath)
    // `data.qml` beside `data.geojson` names its style after the data asset;
    // keyed straight in, it would replace it and leave the layer unloadable.
    assets[styleAssetKey(assets, styleName)] = {
      href: `./${encodeAssetPath(file.styleRelPath)}`,
      type: declaredMediaTypeForFile(file.styleRelPath, 'style'),
      title: styleName,
      // The folder has one style per layer, so it is that layer's default.
      roles: ['style', DEFAULT_STYLE_ROLE]
    }
  }

  return {
    kind: 'layer',
    id: file.relPath,
    title: file.layerName,
    description: `Layer from ${file.name}.`,
    // Both read from the file at load time, not from the listing.
    bbox: null,
    geometryType: null,
    tableColumns: [],
    ...(hasSize ? { extensions: [FILE_EXTENSION] } : {}),
    assets,
    displayField: null,
    // The folder declares no author intent, so none of these are invented.
    visibilityChecked: null,
    editable: null
  }
}
