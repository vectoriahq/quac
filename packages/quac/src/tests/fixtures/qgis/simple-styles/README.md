# Simple style QGIS fixture

Static fixture for simple QGIS project styles and SVG marker conversion. The companion GeoJSON and SLD files sit beside `sample.qgs` so the project can be opened locally as a complete fixture. The GeoJSON data is made up: each file keeps its fields, value types, shape types and area, and the category values its style draws by, with every other value and every shape invented.

Tests import these files directly. Change them only when the tested parser, styling or catalogue contract changes.
