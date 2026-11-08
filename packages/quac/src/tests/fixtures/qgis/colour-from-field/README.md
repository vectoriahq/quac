# Colour from a field QGIS fixture

Static fixture for QGIS data-defined colour overrides that read a field. `annotations.qgs` is `../geometry-sublayers/annotations.qgs` with a `color` field and one override on each layer: the point layer's fill colour and the polygon layer's fill colour read the field `color` as a field override, and the line layer's stroke colour reads it as the expression `"color"`. `annotations.geojson` is `../geometry-sublayers/annotations.geojson` with a `color` value on each feature, the last one not a colour.

The `data_defined_properties` blocks follow the one QGIS saved in [`tests/testdata/projects/old_bookmarks.qgs`](https://github.com/qgis/QGIS/blob/1c7cf7431bd5899e1f82538a86aa4ae9d4e46a54/tests/testdata/projects/old_bookmarks.qgs#L299-L311), an expression override on a stroke colour, with the expression changed. QGIS's test data holds no saved field override, so those blocks take the `field` member that `QgsProperty::toVariant` writes for one ([`src/core/qgsproperty.cpp`](https://github.com/qgis/QGIS/blob/1c7cf7431bd5899e1f82538a86aa4ae9d4e46a54/src/core/qgsproperty.cpp#L779-L814)).

Tests import these files directly. Change them only when the tested parser or catalogue contract changes.
