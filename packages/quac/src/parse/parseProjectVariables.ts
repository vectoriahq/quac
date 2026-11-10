import { propertyList, readPropertyBlock } from './projectProperties.ts'

/**
 * The project's own variables (Project Properties > Variables), by name. QGIS
 * saves them as two parallel lists, `<Variables><variableNames>` and
 * `<Variables><variableValues>` (`QgsProject::setCustomVariables`,
 * `src/core/project/qgsproject.cpp`, `qgis/QGIS@master`, read 2026-10-25),
 * and reads none when the two differ in length, as this does. The global
 * variables QGIS lists beside them are not saved in the project.
 */
export function parseProjectVariables(qgisRoot: Element): Record<string, string> {
  const block = readPropertyBlock(qgisRoot, 'Variables')
  if (!block) return {}
  const names = propertyList(block, 'variableNames')
  const values = propertyList(block, 'variableValues')
  if (names.length !== values.length) return {}
  return Object.fromEntries(names.map((name, i) => [name, values[i]!]))
}
