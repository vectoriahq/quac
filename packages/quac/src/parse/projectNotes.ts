import type { FieldValueRelation, LayerEntry, PresetFilter, ProjectNote, ProjectNoteReason, QgsRelation } from '../model/QgsProject.ts'

/**
 * The rules that decide whether a setting naming another layer reaches the
 * catalogue, and the notes for those that do not. `generateStacCatalogue`
 * applies the same rules through these functions, so a note and the catalogue
 * cannot disagree.
 */

/**
 * The layer a Value Relation widget reads its choices from: the layer whose
 * id the widget names, and where none has it the first layer with the name it
 * names, as QGIS finds it (`QgsVectorLayerRef::resolveByIdOrNameOnly`,
 * `src/core/qgsvectorlayerref.cpp`, `qgis/QGIS@master`). Undefined where the
 * project holds neither.
 */
export function findValueRelationLookup(
  widget: FieldValueRelation,
  layers: readonly LayerEntry[],
  layersById: ReadonlyMap<string, LayerEntry>
): LayerEntry | undefined {
  return layersById.get(widget.layerId) ?? layers.find((candidate) => candidate.name === widget.layerName)
}

/** Whether the project holds both of a relation's layers. */
export function isRelationInProject(relation: QgsRelation, layersById: ReadonlyMap<string, LayerEntry>): boolean {
  return layersById.has(relation.parentLayerId) && layersById.has(relation.childLayerId)
}

/** Whether the project holds a filter's layer and that layer has its field. */
export function isFilterInProject(filter: PresetFilter, layersById: ReadonlyMap<string, LayerEntry>): boolean {
  return layersById.get(filter.layerId)?.fieldNames.includes(filter.field) ?? false
}

/**
 * The notes for the settings that name another layer and do not reach the
 * catalogue: Value Relations, relations and filters, in that order, and each
 * in the project's order. `textFilters` are the Mergin Maps `Text` filters
 * `parseMerginFilters` passes over.
 */
export function crossLayerNotes(
  layers: readonly LayerEntry[],
  relations: readonly QgsRelation[],
  filters: readonly PresetFilter[],
  textFilters: readonly PresetFilter[]
): ProjectNote[] {
  const layersById = new Map(layers.map((layer) => [layer.id, layer]))
  const noteFor = (layerId: string, field: string | null, reason: ProjectNoteReason, text: string | null): ProjectNote => (
    { layerId, layerName: layersById.get(layerId)?.name ?? '', field, reason, text }
  )

  const notes: ProjectNote[] = []
  for (const layer of layers) {
    for (const [field, widget] of Object.entries(layer.fieldValueRelations)) {
      if (!findValueRelationLookup(widget, layers, layersById)) notes.push(noteFor(layer.id, field, 'value-relation', widget.layerName || widget.layerId))
    }
  }
  for (const relation of relations) {
    if (!isRelationInProject(relation, layersById)) notes.push(noteFor(relation.childLayerId, null, 'relation', relation.name || relation.id))
  }
  for (const filter of filters) {
    if (!isFilterInProject(filter, layersById)) notes.push(noteFor(filter.layerId, filter.field, 'filter', null))
  }
  for (const filter of textFilters) notes.push(noteFor(filter.layerId, filter.field, 'filter', 'Text'))
  return notes
}
