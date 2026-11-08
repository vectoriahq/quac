import { collectLayerVisibility } from './collectLayerVisibility'
import { parseBrandColour } from './parseBrandColour'
import { parseMapExtent } from './parseExtent'
import { parseProjectLayers } from './parseLayers'
import { parseLegendTree } from './parseLegendTree'
import { parseProjectMeasurement } from './parseMeasurement'
import { parseMerginFilters } from './parseMergin'
import { parseProjectVariables } from './parseProjectVariables'
import { parseInitialActiveLayerId, parseWfsTransactionLayers } from './parseQfieldSync'
import { parseProjectRelations } from './parseRelations'
import { parseWmsCrsList, parseWmsPublishing } from './parseWmsPublishing'
import { devLog } from '../util/devLog'

import type { ProjectMetadata, QgsProject } from '../model/QgsProject'

/**
 * Top-level orchestrator: reads a .qgs XML string and returns a typed
 * QgsProject.
 *
 * Parsing strategy:
 *   1. DOMParser → DOM tree (jsdom in tests, real DOM in browser).
 *   2. Locate the root <qgis> element.
 *   3. Each sub-parser handles one concern and isolates its own failures —
 *      a malformed legend tree shouldn't take down the layer list, etc.
 *
 * Throws only when the XML itself is unparseable or has no <qgis> root.
 * Sub-parser failures yield empty / null fields rather than exceptions.
 */
export function parseQgsXml(xmlText: string): QgsProject {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')

  // DOMParser surfaces XML errors as a <parsererror> node in the document.
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error(`Failed to parse QGS XML: ${parserError.textContent?.slice(0, 200) ?? 'unknown error'}`)
  }

  const qgisRoot = doc.documentElement
  if (!qgisRoot || qgisRoot.tagName !== 'qgis') {
    throw new Error(`Expected <qgis> root element, got <${qgisRoot?.tagName ?? 'nothing'}>`)
  }

  const qgisVersion = qgisRoot.getAttribute('version') || null
  const title = qgisRoot.querySelector(':scope > title')?.textContent?.trim() ?? ''
  const projectCrs = readProjectCrs(qgisRoot)

  const mapExtent = parseMapExtent(qgisRoot, projectCrs)
  const rawLayers = parseProjectLayers(qgisRoot)
  const layerTree = parseLegendTree(qgisRoot)
  const relations = parseProjectRelations(qgisRoot)

  // Visibility flows from the layer tree (where checked state is stored), not
  // from the maplayer itself. Walk the tree once, build a layerId →
  // effective visibility map, and apply it to each LayerEntry.
  const visibilityByLayerId = collectLayerVisibility(layerTree)
  const layers = rawLayers.map((layer) => ({
    ...layer,
    isVisible: visibilityByLayerId.get(layer.id) ?? true
  }))

  devLog('qgs/parseQgsXml', 'parsed project', {
    qgisVersion,
    title,
    projectCrs,
    layerCount: layers.length,
    relationCount: relations.length
  })

  return {
    qgisVersion,
    title,
    projectCrs,
    mapExtent,
    layers,
    layerTree,
    relations,
    metadata: parseProjectMetadata(qgisRoot),
    measurement: parseProjectMeasurement(qgisRoot),
    brandColour: parseBrandColour(qgisRoot),
    variables: parseProjectVariables(qgisRoot),
    initialActiveLayerId: parseInitialActiveLayerId(qgisRoot),
    wfsTransactionLayers: parseWfsTransactionLayers(qgisRoot),
    wmsPublishing: parseWmsPublishing(qgisRoot),
    wmsCrsList: parseWmsCrsList(qgisRoot),
    merginFilters: parseMerginFilters(qgisRoot),
    rawXml: xmlText
  }
}

function readProjectCrs(qgisRoot: Element): string | null {
  // <qgis><projectCrs><spatialrefsys><authid>EPSG:4326</authid>
  return (
    qgisRoot.querySelector('projectCrs spatialrefsys authid')?.textContent?.trim() || null
  )
}

/**
 * Reads `<qgis><projectMetadata>` — separate from `<qgis><title>`, which
 * `parseQgsXml` reads directly above. QGIS's Project Properties > Metadata
 * dialog writes the element on every project, empty fields and all
 * (`src/tests/fixtures/qgis/simple-styles/sample.qgs`, `src/tests/fixtures/qgis/graffiti/graffiti.qgs`,
 * read 2026-08-12), so an absent element reads the same as one with nothing
 * filled in.
 */
function parseProjectMetadata(qgisRoot: Element): ProjectMetadata {
  const block = qgisRoot.querySelector(':scope > projectMetadata')
  const abstractText = block?.querySelector(':scope > abstract')?.textContent?.trim()
  const authorText = block?.querySelector(':scope > author')?.textContent?.trim()
  return {
    abstract: abstractText && abstractText.length > 0 ? abstractText : null,
    author: authorText && authorText.length > 0 ? authorText : null
  }
}

