import { GEOMETRY_TYPE_OPTION } from './parseDataSource'

import type { FileDataSource, LayerEntry, LayerGroup, QgsProject } from '../model/QgsProject'

/**
 * The project's layers that QGIS split out of one file by shape, which
 * Groundwork shows as one layer: file layers whose sources are the same but
 * for `|geometrytype=`, each naming a different shape. Keyed by each sibling's
 * layer id, the value lists the whole set in the project's layer order (the
 * layers panel, then layers it does not list, in file order), so its first
 * entry is the layer the set takes its settings from.
 *
 * A set needs two siblings or more. Layers on the same file with no
 * `geometrytype=`, or with any other difference in their source (another
 * option, `subset=`, another spelling of the path), are not siblings, and
 * neither are two naming the same shape: the set is then left as separate
 * layers.
 */
export function findGeometrySiblings(project: Pick<QgsProject, 'layers' | 'layerTree'>): Map<string, readonly LayerEntry[]> {
  const bySource = new Map<string, LayerEntry[]>()
  for (const layer of orderLayersAsListed(project)) {
    const ds = layer.dataSource
    if (ds.kind !== 'file' || ds.geometryTypeFilter === null) continue
    const key = sourceWithoutGeometryType(ds.raw)
    const set = bySource.get(key) ?? []
    set.push(layer)
    bySource.set(key, set)
  }

  const siblingsById = new Map<string, readonly LayerEntry[]>()
  for (const set of bySource.values()) {
    if (set.length < 2) continue
    if (new Set(readSiblingShapes(set)).size !== set.length) continue
    for (const layer of set) siblingsById.set(layer.id, set)
  }
  return siblingsById
}

/**
 * A file source with its first `geometrytype=` option taken out, the one QGIS
 * reads (`readGeometryTypeFilter` in `parseDataSource.ts`), the rest spelled as
 * written.
 */
function sourceWithoutGeometryType(raw: string): string {
  const parts = raw.trim().split('|')
  const index = parts.findIndex((part) => GEOMETRY_TYPE_OPTION.test(part.trim()))
  return parts.filter((_part, partIndex) => partIndex !== index).join('|')
}

/** The shape each sibling keeps, in their order. */
export function readSiblingShapes(siblings: readonly LayerEntry[]): Array<NonNullable<FileDataSource['geometryTypeFilter']>> {
  return siblings.flatMap((layer) => layer.dataSource.kind === 'file' && layer.dataSource.geometryTypeFilter ? [layer.dataSource.geometryTypeFilter] : [])
}

/** The id of the Collection a layer is in: the first sibling's, for a geometry sibling. */
export function siblingCollectionId(siblingsById: Map<string, readonly LayerEntry[]>, layerId: string): string {
  return siblingsById.get(layerId)?.[0].id ?? layerId
}

/** The layers in the layers panel's order, then those it does not list, in the order the file holds them. */
function orderLayersAsListed(project: Pick<QgsProject, 'layers' | 'layerTree'>): LayerEntry[] {
  const byId = new Map(project.layers.map((layer) => [layer.id, layer]))
  const ordered = new Set<LayerEntry>()
  const walk = (group: LayerGroup) => {
    for (const child of group.children) {
      if (child.kind === 'group') walk(child)
      else {
        const layer = byId.get(child.layerId)
        if (layer) ordered.add(layer)
      }
    }
  }
  walk(project.layerTree)
  for (const layer of project.layers) ordered.add(layer)
  return [...ordered]
}

/**
 * The shapes of the geometry siblings `layerId` belongs to, in their order, or
 * null where it is no sibling: the shapes the one layer they make holds.
 */
export function readGeometrySiblingShapes(
  project: Pick<QgsProject, 'layers' | 'layerTree'>,
  layerId: string
): Array<NonNullable<FileDataSource['geometryTypeFilter']>> | null {
  const siblings = findGeometrySiblings(project).get(layerId)
  return siblings ? readSiblingShapes(siblings) : null
}
