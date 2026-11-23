import { serverLayerTree, wmsPublishedLayerIds } from './serverLayerTree.ts'
import { readSqlFeatureTest } from '../parse/sqlFeatureFilter.ts'

import type { QgsProject } from '../model/QgsProject.ts'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

/**
 * Why a layer's features are not published: the project leaves the layer out
 * of what QGIS Server serves (**Exclude layers**, or a group it excludes), the
 * layer has a feature filter this cannot read, or the project has no such layer.
 */
export type PublishRefusal = 'excluded' | 'unreadable-filter' | 'unknown-layer'

export type PublishedLayer<G extends Geometry | null = Geometry | null> =
  | { kind: 'published', features: FeatureCollection<G> }
  | { kind: 'refused', reason: PublishRefusal }

/**
 * A layer's features as QGIS Server would publish them from the project: none
 * for a layer it does not serve, only those the layer's feature filter keeps,
 * and without the fields it hides from WMS or WFS. For a layer whose data
 * Groundwork, not QGIS Server, hands to the public, so the public gets no more
 * than a QGIS Server would give them.
 *
 * It fails closed: a layer the project leaves out, or one whose filter is not a
 * GDAL SQL filter this reads (`readSqlFeatureTest`), is refused rather than
 * published whole. The layer is matched by its QGIS layer id.
 */
export function publishLayerFeatures<G extends Geometry | null>(
  project: QgsProject,
  layerId: string,
  collection: FeatureCollection<G>
): PublishedLayer<G> {
  const layer = project.layers.find((candidate) => candidate.id === layerId)
  if (!layer) return { kind: 'refused', reason: 'unknown-layer' }
  if (!wmsPublishedLayerIds(serverLayerTree(project)).has(layer.id)) return { kind: 'refused', reason: 'excluded' }

  const filter = 'featureFilter' in layer.dataSource ? layer.dataSource.featureFilter ?? null : null
  const test = filter ? readSqlFeatureTest(filter) : null
  if (test?.kind === 'unreadable') return { kind: 'refused', reason: 'unreadable-filter' }

  const hidden = new Set([...(layer.serverHiddenFields?.wms ?? []), ...(layer.serverHiddenFields?.wfs ?? [])])
  const features = collection.features
    .filter((feature) => !test || test.keeps(feature.properties))
    .map((feature) => withoutFields(feature, hidden))
  return { kind: 'published', features: { ...collection, features } }
}

function withoutFields<G extends Geometry | null>(feature: Feature<G>, hidden: ReadonlySet<string>): Feature<G> {
  if (hidden.size === 0 || !feature.properties) return feature
  const properties = Object.fromEntries(Object.entries(feature.properties).filter(([name]) => !hidden.has(name)))
  return { ...feature, properties }
}
