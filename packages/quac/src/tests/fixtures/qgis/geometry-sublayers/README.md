# Geometry sublayers QGIS fixture

Static fixture for a QGIS project that splits one GeoJSON holding several shapes into one layer per shape. `annotations.geojson` holds a point, a line, a polygon and a multipoint. `annotations.qgs` holds three layers named `annotations` in a group named `Annotations`, each over the same file with a `|geometrytype=` option: `Point`, `LineString` and `Polygon`. It has the shape of the project described in `docs/plans/archive/qgis-geometry-sublayers.md` § "What the test showed" (issue #2199).

Tests import these files directly. Change them only when the tested parser or catalogue contract changes.
