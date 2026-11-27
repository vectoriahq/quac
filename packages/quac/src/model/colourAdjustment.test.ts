import { describe, expect, it } from 'vitest'

import { readCollectionColourAdjustment } from './colourAdjustment.ts'

import type { StacCollection } from './Stac.ts'

function collection(fields: Record<string, unknown>): StacCollection {
  return {
    type: 'Collection',
    stac_version: '1.1.0',
    id: 'aerial',
    description: 'Aerial imagery.',
    license: 'other',
    extent: { spatial: { bbox: [[-180, -90, 180, 90]] }, temporal: { interval: [[null, null]] } },
    links: [],
    ...fields
  }
}

describe('readCollectionColourAdjustment', () => {
  it('reads every stated field, and the rest as leaving the layer unchanged', () => {
    expect(readCollectionColourAdjustment(collection({ 'quac:gamma': 1.8, 'quac:saturation': -0.2 }))).toEqual({
      contrast: 0,
      brightness: 0,
      gamma: 1.8,
      saturation: -0.2
    })
  })

  it('is null for a Collection that states none', () => {
    expect(readCollectionColourAdjustment(collection({}))).toBeNull()
  })

  it('is null where every stated value leaves the layer unchanged', () => {
    expect(readCollectionColourAdjustment(collection({ 'quac:contrast': 0, 'quac:brightness': 0, 'quac:gamma': 1, 'quac:saturation': 0 }))).toBeNull()
  })

  it('brings a value outside its range to the nearer end of it', () => {
    expect(readCollectionColourAdjustment(collection({ 'quac:brightness': 3, 'quac:contrast': -2, 'quac:gamma': 50 }))).toEqual({
      contrast: -1,
      brightness: 1,
      gamma: 10,
      saturation: 0
    })
    expect(readCollectionColourAdjustment(collection({ 'quac:gamma': 0.01 }))?.gamma).toBe(0.1)
  })

  it('reads a value that is not a number, and a gamma of 0 or below, as stating nothing', () => {
    expect(readCollectionColourAdjustment(collection({ 'quac:saturation': '-0.2', 'quac:brightness': Number.NaN, 'quac:gamma': 0 }))).toBeNull()
    expect(readCollectionColourAdjustment(collection({ 'quac:gamma': -2 }))).toBeNull()
  })
})
