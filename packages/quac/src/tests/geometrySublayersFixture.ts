import annotationsProject from './fixtures/qgis/geometry-sublayers/annotations.qgs?raw'

type Shape = 'Point' | 'LineString' | 'Polygon'

const ALL_SHAPES: readonly Shape[] = ['Point', 'LineString', 'Polygon']

/**
 * The geometry-sublayers fixture project with only the per-shape layers for
 * `shapes`: each other layer's `<maplayer>` and its layers panel entry are
 * taken out, the rest left as QGIS saved them.
 */
export function annotationsProjectWith(shapes: readonly Shape[]): string {
  let project = annotationsProject
  for (const shape of ALL_SHAPES.filter((candidate) => !shapes.includes(candidate))) {
    const source = `./annotations.geojson|geometrytype=${shape}`
    project = project
      .replace(new RegExp(`\\s*<layer-tree-layer [^>]*source="${escape(source)}"[\\s\\S]*?</layer-tree-layer>`), '')
      .replace(new RegExp(`\\s*<maplayer [^>]*>\\s*<id>[^<]*</id>\\s*<datasource>${escape(source)}</datasource>[\\s\\S]*?</maplayer>`), '')
  }
  return project
}

/** The fixture project with one per-shape layer's data source spelled `source` instead. */
export function annotationsProjectWithSource(shape: Shape, source: string): string {
  const original = `./annotations.geojson|geometrytype=${shape}`
  return annotationsProject
    .replace(`source="${original}"`, `source="${source}"`)
    .replace(`<datasource>${original}</datasource>`, `<datasource>${source}</datasource>`)
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
