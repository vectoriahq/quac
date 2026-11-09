# Related datasets QGIS fixture

Static fixture for an authored QGIS relation: `street-trees.qgs` holds a parent point layer, a child table with `"geometry": null` records, and one `<relations><relation>` joining them on `tree_id`. It covers relation parsing, the `quac:related_to` field the generated child Collection carries, and the catalogue plan routing that child away from the layer list.

The companion GeoJSON files sit beside the project so it can be opened locally as a complete fixture.

Tests import these files directly. Change them only when the tested parser, styling or catalogue contract changes.
