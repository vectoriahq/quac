import { propertyText, readPropertyBlock } from './projectProperties'

import type { ProjectMeasurement } from '../model/QgsProject'

/**
 * How many of a unit make up one square metre, for the area units QGIS saves
 * as `<Measurement><AreaUnits>` that Groundwork converts. The saved names are
 * `QgsUnitTypes::encodeUnit( Qgis::AreaUnit )` (`src/core/qgsunittypes.cpp`,
 * `qgis/QGIS@master`, read 2026-10-25). `deg2` is saved too and is left out: a
 * square degree is no fixed area.
 */
const AREA_UNITS_PER_SQUARE_METRE: Record<string, number> = {
  m2: 1,
  km2: 1e-6,
  ft2: 1 / 0.09290304,
  y2: 1 / 0.83612736,
  mi2: 1 / 2589988.110336,
  ha: 1e-4,
  ac: 1 / 4046.8564224,
  nm2: 1 / 3429904,
  cm2: 1e4,
  mm2: 1e6,
  in2: 1 / 0.00064516
}

/**
 * How many of a unit make up one metre, for the distance units QGIS saves as
 * `<Measurement><DistanceUnits>` that Groundwork converts. The saved names are
 * `QgsUnitTypes::encodeUnit( Qgis::DistanceUnit )`, same file. `degrees` and
 * the survey chains are left out.
 */
const DISTANCE_UNITS_PER_METRE: Record<string, number> = {
  meters: 1,
  km: 1e-3,
  feet: 1 / 0.3048,
  yd: 1 / 0.9144,
  mi: 1 / 1609.344,
  'nautical miles': 1 / 1852,
  cm: 100,
  mm: 1000,
  in: 1 / 0.0254
}

/** QGIS's own defaults for a project that saves no units (`QgsProject::clear`, `src/core/project/qgsproject.cpp`). */
export const DEFAULT_MEASUREMENT: ProjectMeasurement = { areaUnit: 'm2', distanceUnit: 'meters' }

/**
 * The factors that turn the metres and square metres Groundwork measures into
 * the project's units, or null for a unit it does not convert. An expression
 * that measures in a unit with no factor is unreadable.
 */
export interface MeasureFactors {
  area: number | null
  distance: number | null
}

export function measureFactorsOf(measurement: ProjectMeasurement | null | undefined): MeasureFactors {
  const { areaUnit, distanceUnit } = measurement ?? DEFAULT_MEASUREMENT
  return {
    area: Object.hasOwn(AREA_UNITS_PER_SQUARE_METRE, areaUnit) ? AREA_UNITS_PER_SQUARE_METRE[areaUnit]! : null,
    distance: Object.hasOwn(DISTANCE_UNITS_PER_METRE, distanceUnit) ? DISTANCE_UNITS_PER_METRE[distanceUnit]! : null
  }
}

/**
 * The project's area and distance units from `<properties><Measurement>`, as
 * QGIS writes them (`QgsProject::writeProject`, `src/core/project/qgsproject.cpp`).
 * Null where the project saves neither, which QGIS reads as square metres and
 * metres. The project's ellipsoid (`<Measure><Ellipsoid>`) is not read:
 * Groundwork measures on WGS 84 whatever the project says.
 */
export function parseProjectMeasurement(qgisRoot: Element): ProjectMeasurement | null {
  const block = readPropertyBlock(qgisRoot, 'Measurement')
  if (!block) return null
  const areaUnit = propertyText(block, 'AreaUnits')
  const distanceUnit = propertyText(block, 'DistanceUnits')
  if (!areaUnit && !distanceUnit) return null
  return {
    areaUnit: areaUnit ?? DEFAULT_MEASUREMENT.areaUnit,
    distanceUnit: distanceUnit ?? DEFAULT_MEASUREMENT.distanceUnit
  }
}
