import { isTrueValue, readCustomProperty } from './customProperties.ts'
import { propertyChild, propertyList, propertyText, readPropertyBlock } from './projectProperties.ts'

import type { EditLock, LayerLocks, LockedEdit, WfsTransactionLayers } from '../model/QgsProject.ts'

/**
 * The layer the QFieldSync plugin names as the one a project opens with as
 * the active layer: **Initial active layer** on the QField tab of Project
 * Properties, saved as `<properties><qfieldsync><initialActiveLayer>`, a layer
 * id (`ProjectConfig.initial_active_layer`, `libqfieldsync/project.py`,
 * `opengisch/libqfieldsync@aad2ea6`).
 *
 * QFieldSync writes the key on every OK of Project Properties, but writes it
 * blank until an author picks a layer: the list offers no empty choice, and
 * opens on none where none is saved (`ProjectConfigurationWidget`,
 * `qfieldsync/gui/project_configuration_widget.py`,
 * `opengisch/qfieldsync@c8abedb`; `QgsMapLayerComboBox::setLayer`,
 * `src/gui/qgsmaplayercombobox.cpp`, `qgis/QGIS@16eddb2`). So a saved id is
 * an author's choice. Null where the project names none.
 */
export function parseInitialActiveLayerId(qgisRoot: Element): string | null {
  const block = readPropertyBlock(qgisRoot, 'qfieldsync')
  return block ? propertyText(block, 'initialActiveLayer') : null
}

/** The part of each lock's three keys that names the edit, as QFieldSync spells it. */
const LOCK_KEY_PARTS: Record<LockedEdit, string> = {
  add: 'feature_addition',
  attributes: 'attribute_editing',
  geometry: 'geometry_editing',
  delete: 'feature_deletion'
}

/**
 * The edits QFieldSync locks on a layer: **Disable feature addition**,
 * **Disable attribute editing**, **Disable geometry editing** and **Disable
 * feature deletion**, under Permissions on the QField tab of Layer Properties.
 * Each is three custom properties: the box, `QFieldSync/is_<edit>_locked`; the
 * switch of its data-defined button, `QFieldSync/is_<edit>_locked_expression_active`;
 * and the button's expression, `QFieldSync/<edit>_locked_expression`
 * (`LayerSource.apply`, `libqfieldsync/layer.py`, `opengisch/libqfieldsync@aad2ea6`).
 *
 * With the switch on and an expression that is not blank, the expression
 * decides in place of the box, and a true result locks the feature it is
 * evaluated for; otherwise the box decides (`QfFeatureModel`,
 * `src/core/qffeaturemodel.cpp`, `opengisch/QField@2cd8695`). The expression is
 * kept as QFieldSync saved it. A layer QFieldSync saved before 4.15 holds one
 * lock, `QFieldSync/is_geometry_locked` and its two companions, which QField
 * reads as adding, geometry editing and deleting locked, and attributes free.
 */
export function parseQfieldSyncLocks(maplayer: Element): LayerLocks {
  const properties = Array.from(maplayer.children).find((child) => child.tagName === 'customproperties')
  if (!properties) return {}
  const read = (key: string) => readCustomProperty(properties, `QFieldSync/${key}`)
  const lockOf = (part: string): EditLock | null => {
    const expression = isTrueValue(read(`is_${part}_locked_expression_active`)) ? read(`${part}_locked_expression`)?.trim() : null
    if (expression) return { expression }
    return isTrueValue(read(`is_${part}_locked`)) ? true : null
  }

  const locks: LayerLocks = {}
  if (read('is_geometry_locked') !== null) {
    const lock = lockOf('geometry')
    if (lock) for (const edit of ['add', 'geometry', 'delete'] as const) locks[edit] = lock
    return locks
  }
  for (const [edit, part] of Object.entries(LOCK_KEY_PARTS) as [LockedEdit, string][]) {
    const lock = lockOf(part)
    if (lock) locks[edit] = lock
  }
  return locks
}

/**
 * The layers a project publishes for WFS, and the WFS-T operations each takes:
 * **Published**, **Update**, **Insert** and **Delete** in Project Properties →
 * QGIS Server → WFS capabilities. QGIS saves them as lists of layer ids,
 * `<properties><WFSLayers>` and `<WFSTLayers><Update>`, `<Insert>` and
 * `<Delete>`, writing a layer to the last three only while it is published
 * (`QgsProjectProperties::apply`, `src/app/qgsprojectproperties.cpp`; read back
 * by `QgsServerProjectUtils::wfstUpdateLayerIds` and its siblings,
 * `src/server/qgsserverprojectutils.cpp`; `qgis/QGIS@16eddb2`). Null where the
 * project saves no `WFSLayers`.
 */
export function parseWfsTransactionLayers(qgisRoot: Element): WfsTransactionLayers | null {
  const properties = qgisRoot.querySelector(':scope > properties')
  if (!properties || !propertyChild(properties, 'WFSLayers')) return null
  const transactions = readPropertyBlock(qgisRoot, 'WFSTLayers')
  const listOf = (name: string) => transactions ? propertyList(transactions, name) : []
  return {
    published: propertyList(properties, 'WFSLayers'),
    insert: listOf('Insert'),
    update: listOf('Update'),
    delete: listOf('Delete')
  }
}
