# `quac:feature_filter`

**The QGIS setting:** **Provider Feature Filter** on the Source tab of the Trees layer's Layer Properties, set in the Query Builder to `"status" = 'approved'`.

**What the project file holds:** a data source ending `|subset="status" = 'approved'`.

**What the catalogue says:** the data asset carries `quac:feature_filter: { expression: "\"status\" = 'approved'", dialect: "ogr_sql" }`. GDAL reads a filter on a file in OGR SQL, so the dialect says so.
