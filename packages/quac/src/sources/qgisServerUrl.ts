/**
 * Returns a copy of the URL with all query parameters stripped except the
 * named `keep` set. Used to derive a clean WFS endpoint from a WMS base
 * URL (we keep MAP because QGIS Server needs it to identify the project).
 */
export function stripQgisServerQuery(rawUrl: string, keep: string[]): string {
  const url = new URL(rawUrl)
  const keepSet = new Set(keep.map((k) => k.toLowerCase()))
  const drop: string[] = []
  url.searchParams.forEach((_, key) => {
    if (!keepSet.has(key.toLowerCase())) drop.push(key)
  })
  for (const key of drop) url.searchParams.delete(key)
  return url.toString()
}
