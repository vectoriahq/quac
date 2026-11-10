import type { LayerGroup, LayerTreeNode } from '../model/QgsProject.ts'

/**
 * Walks the QGIS layer tree and records each layer-leaf's effective `checked`
 * state, intersected with the checked state of every group above it.
 *
 * A layer id absent from the returned map was not found in the tree — either
 * the project has no `<layer-tree-group>`, the legend failed to parse, or the
 * leaf had no id. `parseQgsXml` reads such a layer as visible.
 */
export function collectLayerVisibility(group: LayerGroup): Map<string, boolean> {
  const out = new Map<string, boolean>()
  function walk(node: LayerTreeNode, parentChecked: boolean): void {
    if (node.kind === 'layer') {
      out.set(node.layerId, parentChecked && node.checked)
      return
    }
    for (const child of node.children) {
      walk(child, parentChecked && node.checked)
    }
  }
  walk(group, true)
  return out
}
