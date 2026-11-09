import '../tests/linkedomDomParser'

import { describe, expect, it } from 'vitest'

import { parseQgsXml } from './parseQgsXml'
import fixtureXml from '../tests/fixtures/qgis/related-datasets/street-trees.qgs?raw'

/**
 * Every other `.qgs` in the repo has an empty `<relations/>`, so the street
 * trees fixture is the only authored relation there is to read.
 */
function projectWithRelations(relationsXml: string) {
  return parseQgsXml(
    '<qgis version="3.44.8-Solothurn"><title>Relations</title><projectlayers/>'
    + `${relationsXml}</qgis>`
  )
}

describe('parseProjectRelations — street trees fixture', () => {
  const project = parseQgsXml(fixtureXml)

  it('reads the one relation the project declares', () => {
    expect(project.relations).toHaveLength(1)
  })

  it('takes the referenced layer as the parent and the referencing layer as the child', () => {
    const relation = project.relations![0]
    expect(relation.id).toBe('tree_inspections_rel')
    expect(relation.name).toBe('Inspections')
    expect(relation.parentLayerId).toBe('street_trees_5b1d0a72_4e33_4c1a_9f6d_2c8b7a1e4d90')
    expect(relation.childLayerId).toBe('tree_inspections_0a4f9c81_7b26_4f55_8ad3_16e0f9b25c47')
  })

  it('reads the field pair and the strength attribute', () => {
    const relation = project.relations![0]
    expect(relation.fieldPairs).toEqual([{ parentField: 'tree_id', childField: 'tree_id' }])
    expect(relation.strength).toBe('Association')
  })
})

describe('parseProjectRelations', () => {
  it('keeps every fieldRef, in file order, as one composite key', () => {
    const project = projectWithRelations(
      '<relations>'
      + '<relation id="r1" name="Readings" referencedLayer="sites" referencingLayer="readings">'
      + '<fieldRef referencedField="site_code" referencingField="site"/>'
      + '<fieldRef referencedField="year" referencingField="reading_year"/>'
      + '</relation>'
      + '</relations>'
    )

    expect(project.relations![0].fieldPairs).toEqual([
      { parentField: 'site_code', childField: 'site' },
      { parentField: 'year', childField: 'reading_year' }
    ])
  })

  it('reads several relations naming the same child layer', () => {
    const project = projectWithRelations(
      '<relations>'
      + '<relation id="r1" name="Inspections" referencedLayer="trees" referencingLayer="jobs">'
      + '<fieldRef referencedField="tree_id" referencingField="tree_id"/></relation>'
      + '<relation id="r2" name="Crew jobs" referencedLayer="crews" referencingLayer="jobs">'
      + '<fieldRef referencedField="crew_id" referencingField="crew_id"/></relation>'
      + '</relations>'
    )

    expect(project.relations!.map((relation) => relation.parentLayerId)).toEqual(['trees', 'crews'])
  })

  it('reads several relations naming the same parent layer', () => {
    const project = projectWithRelations(
      '<relations>'
      + '<relation id="r1" name="Inspections" referencedLayer="trees" referencingLayer="inspections">'
      + '<fieldRef referencedField="tree_id" referencingField="tree_id"/></relation>'
      + '<relation id="r2" name="Maintenance" referencedLayer="trees" referencingLayer="maintenance">'
      + '<fieldRef referencedField="tree_id" referencingField="tree_id"/></relation>'
      + '</relations>'
    )

    expect(project.relations!.map((relation) => relation.parentLayerId)).toEqual(['trees', 'trees'])
    expect(project.relations!.map((relation) => relation.name)).toEqual(['Inspections', 'Maintenance'])
  })

  it('skips a relation with no field pair, no id, or a missing layer', () => {
    const project = projectWithRelations(
      '<relations>'
      + '<relation id="r1" name="No fields" referencedLayer="trees" referencingLayer="jobs"/>'
      + '<relation name="No id" referencedLayer="trees" referencingLayer="jobs">'
      + '<fieldRef referencedField="tree_id" referencingField="tree_id"/></relation>'
      + '<relation id="r3" name="No child" referencedLayer="trees">'
      + '<fieldRef referencedField="tree_id" referencingField="tree_id"/></relation>'
      + '</relations>'
    )

    expect(project.relations).toEqual([])
  })

  it('reads no relations from a project with an empty relations element', () => {
    expect(projectWithRelations('<relations/>').relations).toEqual([])
  })

  it('reads no relations from a project with no relations element', () => {
    expect(projectWithRelations('').relations).toEqual([])
  })
})
