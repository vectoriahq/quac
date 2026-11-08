import { devLog } from '../util/devLog'

import type { LayerGroup, LayerTreeNode } from '../model/QgsProject'

/**
 * Parses the <layer-tree-group> root into a tree of groups + layer leaves.
 *
 * Structure:
 *   <layer-tree-group>
 *     <layer-tree-group name="Subgroup" checked="Qt::Checked" mutually-exclusive="1">
 *       <layer-tree-layer name="..." id="..." checked="Qt::Checked"/>
 *     </layer-tree-group>
 *     <layer-tree-layer name="..." id="..." checked="Qt::Checked"/>
 *     <custom-order .../>      ← ignored
 *     <customproperties.../>   ← ignored
 *   </layer-tree-group>
 *
 * The root group has no name attribute — we represent it with name = "".
 *
 * Returns an empty root group if parsing fails so the rest of the project
 * still loads.
 */
export function parseLegendTree(qgisRoot: Element): LayerGroup {
  const empty: LayerGroup = { kind: 'group', name: '', checked: true, children: [] }
  try {
    // The first layer-tree-group is the root.
    const root = qgisRoot.querySelector('layer-tree-group')
    if (!root) return empty
    return readGroup(root, /* isRoot */ true)
  } catch (err) {
    devLog('qgs/parseLegendTree', 'failed to parse layer tree', { error: String(err) })
    return empty
  }
}

function readGroup(node: Element, isRoot: boolean): LayerGroup {
  const name = isRoot ? '' : node.getAttribute('name') ?? ''
  const checked = parseChecked(node.getAttribute('checked'))
  const children: LayerTreeNode[] = []

  for (const child of Array.from(node.children)) {
    if (child.tagName === 'layer-tree-group') {
      children.push(readGroup(child, false))
    } else if (child.tagName === 'layer-tree-layer') {
      const layerId = child.getAttribute('id') ?? ''
      if (!layerId) continue
      children.push({
        kind: 'layer',
        layerId,
        name: child.getAttribute('name') ?? '',
        checked: parseChecked(child.getAttribute('checked'))
      })
    }
    // <custom-order> and <customproperties> intentionally skipped
  }

  // QGIS saves a mutually exclusive group with `mutually-exclusive="1"`
  // (`src/core/layertree/qgslayertreegroup.cpp`).
  const mutuallyExclusive = !isRoot && node.getAttribute('mutually-exclusive') === '1'
  return { kind: 'group', name, checked, ...(mutuallyExclusive ? { mutuallyExclusive } : {}), children }
}

function parseChecked(attr: string | null): boolean {
  // QGIS uses Qt's tri-state strings: "Qt::Checked", "Qt::Unchecked", "Qt::PartiallyChecked".
  // We treat PartiallyChecked as checked since at least one child is on.
  if (!attr) return true // default visible
  return attr === 'Qt::Checked' || attr === 'Qt::PartiallyChecked'
}
