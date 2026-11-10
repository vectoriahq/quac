import { parseDataDefinedEditable } from './parseDataDefinedEditable.ts'

import type { LayerFormLayout } from '../model/QgsProject.ts'

/**
 * Reads a layer's Drag and Drop Designer form: the fields its `<attributeEditorForm>`
 * tree places, in the tree's order, each with the visibility expressions of the
 * containers around it.
 *
 * QGIS saves the tree under every layer but uses it only where `<editorlayout>`
 * is `tablayout` (`QgsEditFormConfig::readXml`, `src/core/editform/qgseditformconfig.cpp`,
 * `qgis/QGIS@master`, read 2026-10-24), so any other layout reads as none. A
 * `tablayout` whose tree is empty reads as none too: `readXml` then leaves the
 * tree to `setFields`, which places every field.
 *
 * Only `<attributeEditorContainer>` (tab, group box and row alike) and
 * `<attributeEditorField>` are read. A container's expression counts only when
 * its `visibilityExpressionEnabled` is non-zero and its `visibilityExpression`
 * is not blank, as `QgsAttributeEditorContainer::loadConfiguration` reads them.
 * The expression is kept as written, readable or not. Relation, action, text,
 * HTML, QML and spacer elements are skipped, as are collapsed expressions,
 * titles, columns and label styles. A field placed twice keeps its first place.
 *
 * A placed field also carries its active data-defined Editable property as
 * `editableWhen` (`parseDataDefinedEditable`). QGIS registers it only for a field
 * in this form, so a field the tree does not place, and every field of a layer
 * with no layout read, has none.
 */
export function parseFormLayout(maplayer: Element): LayerFormLayout | null {
  const layout = Array.from(maplayer.children).find((child) => child.tagName === 'editorlayout')
  if (layout?.textContent?.trim() !== 'tablayout') return null
  const form = Array.from(maplayer.children).find((child) => child.tagName === 'attributeEditorForm')
  if (!form || form.children.length === 0) return null

  const fields: LayerFormLayout['fields'] = []
  const placed = new Set<string>()
  collectFields(form, [], fields, placed)
  const editable = parseDataDefinedEditable(maplayer)
  return {
    fields: fields.map((field) => {
      const editableWhen = editable.get(field.name)
      return editableWhen ? { ...field, editableWhen } : field
    })
  }
}

function collectFields(parent: Element, visibleWhen: string[], fields: LayerFormLayout['fields'], placed: Set<string>): void {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === 'attributeEditorField') {
      const name = child.getAttribute('name')?.trim()
      if (!name || placed.has(name)) continue
      placed.add(name)
      fields.push({ name, visibleWhen })
    } else if (child.tagName === 'attributeEditorContainer') {
      const expression = child.getAttribute('visibilityExpression')?.trim()
      const enabled = Number.parseInt(child.getAttribute('visibilityExpressionEnabled') ?? '', 10)
      const inside = expression && Number.isFinite(enabled) && enabled !== 0 ? [...visibleWhen, expression] : visibleWhen
      collectFields(child, inside, fields, placed)
    }
  }
}
