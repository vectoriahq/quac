"""Mirrors `packages/quac/src/parse/parseMeasurement.ts`."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from xml.etree.ElementTree import Element  # nosec B405

from ..model.qgs_project import ProjectMeasurement
from .project_properties import property_text, read_property_block

# How many of a unit make up one square metre, for the area units QGIS saves
# as `<Measurement><AreaUnits>` that this package converts. The saved names
# are `QgsUnitTypes::encodeUnit( Qgis::AreaUnit )` (`src/core/qgsunittypes.cpp`,
# `qgis/QGIS@master`, read 2026-10-25). `deg2` is saved too and is left out: a
# square degree is no fixed area.
AREA_UNITS_PER_SQUARE_METRE: dict[str, float] = {
    'm2': 1,
    'km2': 1e-6,
    'ft2': 1 / 0.09290304,
    'y2': 1 / 0.83612736,
    'mi2': 1 / 2589988.110336,
    'ha': 1e-4,
    'ac': 1 / 4046.8564224,
    'nm2': 1 / 3429904,
    'cm2': 1e4,
    'mm2': 1e6,
    'in2': 1 / 0.00064516,
}

# How many of a unit make up one metre, for the distance units QGIS saves as
# `<Measurement><DistanceUnits>` that this package converts. The saved names
# are `QgsUnitTypes::encodeUnit( Qgis::DistanceUnit )`, same file. `degrees`
# and the survey chains are left out.
DISTANCE_UNITS_PER_METRE: dict[str, float] = {
    'meters': 1,
    'km': 1e-3,
    'feet': 1 / 0.3048,
    'yd': 1 / 0.9144,
    'mi': 1 / 1609.344,
    'nautical miles': 1 / 1852,
    'cm': 100,
    'mm': 1000,
    'in': 1 / 0.0254,
}

# QGIS's own defaults for a project that saves no units (`QgsProject::clear`, `src/core/project/qgsproject.cpp`).
DEFAULT_MEASUREMENT = ProjectMeasurement(area_unit='m2', distance_unit='meters')


@dataclass
class MeasureFactors:
    """
    The factors that turn metres and square metres into the project's units,
    or None for a unit it does not convert. An expression that measures in a
    unit with no factor is unreadable.
    """

    area: Optional[float]
    distance: Optional[float]


def measure_factors_of(measurement: Optional[ProjectMeasurement]) -> MeasureFactors:
    chosen = measurement or DEFAULT_MEASUREMENT
    return MeasureFactors(
        area=AREA_UNITS_PER_SQUARE_METRE.get(chosen.area_unit),
        distance=DISTANCE_UNITS_PER_METRE.get(chosen.distance_unit),
    )


def parse_project_measurement(qgis_root: Element) -> Optional[ProjectMeasurement]:
    """
    The project's area and distance units from `<properties><Measurement>`, as
    QGIS writes them (`QgsProject::writeProject`, `src/core/project/qgsproject.cpp`).
    None where the project saves neither, which QGIS reads as square metres and
    metres. The project's ellipsoid (`<Measure><Ellipsoid>`) is not read.
    """
    block = read_property_block(qgis_root, 'Measurement')
    if block is None:
        return None
    area_unit = property_text(block, 'AreaUnits')
    distance_unit = property_text(block, 'DistanceUnits')
    if not area_unit and not distance_unit:
        return None
    return ProjectMeasurement(
        area_unit=area_unit if area_unit is not None else DEFAULT_MEASUREMENT.area_unit,
        distance_unit=distance_unit if distance_unit is not None else DEFAULT_MEASUREMENT.distance_unit,
    )
