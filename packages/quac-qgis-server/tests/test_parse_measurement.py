"""`quac_server/parse/parse_measurement.py` gives the answers `parseMeasurement.ts` saved in `answers/parseMeasurement.json`."""

from __future__ import annotations

import unittest
from typing import Any, Optional
from xml.etree.ElementTree import fromstring  # nosec B405: the test's own projects.

from quac_server.model.qgs_project import ProjectMeasurement
from quac_server.parse.parse_measurement import MeasureFactors, measure_factors_of, parse_project_measurement

from .answers import load

ANSWERS = load('parseMeasurement')


def measurement_json(measurement: Optional[ProjectMeasurement]) -> Optional[dict[str, Any]]:
    return None if measurement is None else {'areaUnit': measurement.area_unit, 'distanceUnit': measurement.distance_unit}


def factors_json(factors: MeasureFactors) -> dict[str, Any]:
    return {'area': factors.area, 'distance': factors.distance}


class ParseMeasurementAgrees(unittest.TestCase):
    def test_reads_each_project(self) -> None:
        self.assertGreater(len(ANSWERS['parsed']), 0)
        for case in ANSWERS['parsed']:
            with self.subTest(project=case['project']):
                measurement = parse_project_measurement(fromstring(case['project']))  # nosec B314: the test's own projects.
                self.assertEqual(measurement_json(measurement), case['measurement'])
                self.assertEqual(factors_json(measure_factors_of(measurement)), case['factors'])

    def test_gives_each_unit_its_factor(self) -> None:
        for case in ANSWERS['factors']:
            with self.subTest(measurement=case['measurement']):
                measurement = ProjectMeasurement(area_unit=case['measurement']['areaUnit'], distance_unit=case['measurement']['distanceUnit'])
                self.assertEqual(factors_json(measure_factors_of(measurement)), case['factors'])

    def test_reads_no_measurement_as_the_defaults(self) -> None:
        for expected in ANSWERS['defaults']:
            self.assertEqual(factors_json(measure_factors_of(None)), expected)


if __name__ == '__main__':
    unittest.main()
