const PATH_SEPARATOR_PATTERN = /[/\\]/

/**
 * Extracts the trailing filename segment from a path-like string.
 */
export function getFileNameFromPath(nameOrPath: string): string {
  const trimmedValue = nameOrPath.trim()
  if (!trimmedValue) return ''

  const pathSegments = trimmedValue.split(PATH_SEPARATOR_PATTERN)
  return pathSegments[pathSegments.length - 1] ?? ''
}

/**
 * Returns the lower-cased file extension (without dot), or null when absent.
 */
export function getLowerCaseExtension(nameOrPath: string): string | null {
  const fileName = getFileNameFromPath(nameOrPath)
  if (!fileName) return null

  const extensionMatch = /\.([^.]+)$/.exec(fileName)
  const extension = extensionMatch?.[1]?.trim().toLowerCase() ?? ''
  return extension || null
}

/**
 * Returns a trimmed, lower-cased basename without extension.
 */
export function getNormalisedFileBasename(nameOrPath: string): string {
  const fileName = getFileNameFromPath(nameOrPath)
  if (!fileName) return ''

  const extensionMatch = /\.([^.]+)$/.exec(fileName)
  const baseName = extensionMatch
    ? fileName.slice(0, Math.max(extensionMatch.index, 0))
    : fileName
  return baseName.trim().toLowerCase()
}

/**
 * The directory part of a path, or '' when there is none. Folder drops and file-layer
 * collection ids both have a relative path, so this is what tells `north/sites.geojson`
 * and `south/sites.geojson` apart.
 */
export function getParentFolderPath(nameOrPath: string): string {
  const forwardSlashPath = nameOrPath.trim().replace(/\\/g, '/')
  const lastSeparatorIndex = forwardSlashPath.lastIndexOf('/')
  return lastSeparatorIndex > 0 ? forwardSlashPath.slice(0, lastSeparatorIndex) : ''
}
