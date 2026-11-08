import { devLog } from '../util/devLog'

import type { QgsRelation, QgsRelationFieldPair } from '../model/QgsProject'

/**
 * Parses `<qgis><relations>` into the project's declared relations.
 *
 * QGIS writes each one as
 *
 *     <relation id="…" name="…" referencedLayer="<parent layer id>"
 *               referencingLayer="<child layer id>" strength="…">
 *       <fieldRef referencedField="<parent field>" referencingField="<child field>"/>
 *     </relation>
 *
 * where the *referenced* layer is the parent and the *referencing* layer the
 * child, and several `<fieldRef>` children make one composite key. That shape is
 * recorded in `docs/plans/archive/related-datasets.md` § "What was verified, and when",
 * read out of QGIS's own `qgsrelation.cpp` on 2026-08-27.
 *
 * A relation missing its id, either layer id, or every field pair is skipped —
 * there is no complete join for it to describe.
 */
export function parseProjectRelations(qgisRoot: Element): QgsRelation[] {
  const block = qgisRoot.querySelector(':scope > relations')
  if (!block) return []

  const relations: QgsRelation[] = []
  for (const node of Array.from(block.children)) {
    if (node.tagName !== 'relation') continue

    const id = attribute(node, 'id')
    const parentLayerId = attribute(node, 'referencedLayer')
    const childLayerId = attribute(node, 'referencingLayer')
    const fieldPairs = parseFieldRefs(node)

    if (!id || !parentLayerId || !childLayerId || fieldPairs.length === 0) {
      devLog('qgs/parseRelations', 'skipping an incomplete relation', {
        id, parentLayerId, childLayerId, fieldPairCount: fieldPairs.length
      })
      continue
    }

    relations.push({
      id,
      name: attribute(node, 'name'),
      parentLayerId,
      childLayerId,
      fieldPairs,
      strength: attribute(node, 'strength') || null
    })
  }

  return relations
}

/** The `<fieldRef>` children of one `<relation>`, in file order. */
function parseFieldRefs(relation: Element): QgsRelationFieldPair[] {
  const pairs: QgsRelationFieldPair[] = []
  for (const node of Array.from(relation.children)) {
    if (node.tagName !== 'fieldRef') continue
    const parentField = attribute(node, 'referencedField')
    const childField = attribute(node, 'referencingField')
    if (!parentField || !childField) continue
    pairs.push({ parentField, childField })
  }
  return pairs
}

function attribute(element: Element, name: string): string {
  return element.getAttribute(name)?.trim() ?? ''
}
