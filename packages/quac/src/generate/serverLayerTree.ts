import { qgisServerNamesOf } from './stacCatalogue.ts'

import type { LayerEntry, LayerGroup, QgsProject } from '../model/QgsProject.ts'

/** A project's layer tree as QGIS Server publishes it (`serverLayerTree`). */
export interface ServerLayerTree {
  /** **Use layer ids as names** is ticked, so each layer's WMS name is its layer id. */
  useLayerIds: boolean
  children: ServerLayerTreeNode[]
}

export type ServerLayerTreeNode = ServerLayerTreeGroup | ServerLayerTreeLayer

export interface ServerLayerTreeGroup {
  kind: 'group'
  name: string
  /** False where the project leaves the group out of WMS, which leaves out every layer inside it. */
  wmsPublished: boolean
  children: ServerLayerTreeNode[]
}

export interface ServerLayerTreeLayer {
  kind: 'layer'
  /** The QGIS layer id. */
  id: string
  /** The layer's name in the project. */
  name: string
  /** The name QGIS Server lists the layer under in WMS; null where the project leaves it out of WMS. */
  wmsName: string | null
  /** The type name QGIS Server gives the layer in WFS; null where the project does not publish it for WFS. */
  wfsTypeName: string | null
  /** The fields the project hides from each service. */
  hiddenFields: { wms: string[]; wfs: string[] }
}

/**
 * The layer tree QGIS Server reads from a project: each layer's WMS name and
 * WFS type name, and the fields the project hides from each service. It is
 * what the QUAC plugin's reading spike returns in Python, so that the two
 * languages are compared on the fixtures.
 *
 * A layer's names are `qgisServerNamesOf`'s, except that a layer inside a
 * group the project leaves out of WMS has no WMS name. A tree entry whose layer
 * the project does not hold is left out.
 */
export function serverLayerTree(project: QgsProject): ServerLayerTree {
  const layersById = new Map(project.layers.map((layer) => [layer.id, layer]))
  const restricted = new Set(project.wmsPublishing?.restrictedLayers ?? [])
  const context = { wmsPublishing: project.wmsPublishing ?? null, wfsTransactionLayers: project.wfsTransactionLayers ?? null }

  const readGroup = (group: LayerGroup, wmsPublished: boolean): ServerLayerTreeNode[] =>
    group.children.flatMap((node): ServerLayerTreeNode[] => {
      if (node.kind === 'group') {
        const published = wmsPublished && !restricted.has(node.name)
        return [{ kind: 'group', name: node.name, wmsPublished: published, children: readGroup(node, published) }]
      }
      const layer = layersById.get(node.layerId)
      return layer ? [serverLayer(layer, wmsPublished, context)] : []
    })

  return { useLayerIds: project.wmsPublishing?.useLayerIds ?? false, children: readGroup(project.layerTree, true) }
}

function serverLayer(layer: LayerEntry, inPublishedGroup: boolean, context: Parameters<typeof qgisServerNamesOf>[1]): ServerLayerTreeLayer {
  const names = qgisServerNamesOf(layer, context)
  return {
    kind: 'layer',
    id: layer.id,
    name: layer.name,
    wmsName: inPublishedGroup ? names.wmsName : null,
    wfsTypeName: names.wfsTypeName,
    hiddenFields: { wms: layer.serverHiddenFields?.wms ?? [], wfs: layer.serverHiddenFields?.wfs ?? [] }
  }
}

/** The ids of the layers the project publishes over WMS. */
export function wmsPublishedLayerIds(tree: ServerLayerTree): Set<string> {
  const ids = new Set<string>()
  const walk = (nodes: ServerLayerTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'group') walk(node.children)
      else if (node.wmsName !== null) ids.add(node.id)
    }
  }
  walk(tree.children)
  return ids
}
