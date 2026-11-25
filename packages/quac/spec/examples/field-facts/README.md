# `quac:primary_key`, `quac:length`, `quac:precision` and `quac:filled_by_data` on a QGIS Server layer

**The data:** a GeoPackage layer, `sites`, whose `name` field holds at most 50 characters and whose `height` field holds numbers of at most 6 digits, 2 of them after the decimal point. Its feature id column, `fid`, is its primary key, and the GeoPackage numbers each new feature itself.

**What the project file holds:** the layer's fields by name, and nothing of their sizes, its key or what its data fills. These come from QGIS, which opens the data: `example.json` gives them under `fieldTypes`, by the layer's id and each field's name, as the QUAC plugin reads them from QGIS.

**What the catalogue says:** this is the catalogue a QGIS Server with the QUAC plugin serves for the project, so the Collection's id is the layer's WMS name, `Survey sites`. Its `quac:primary_key` is `["fid"]`. The `fid` column has `quac:filled_by_data`, and no length, as QGIS gives none for it. The `name` column has `quac:length: 50`, and the `height` column `quac:length: 6` and `quac:precision: 2`.
