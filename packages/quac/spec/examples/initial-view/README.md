# `quac:initial_view`

**The QGIS setting:** none to tick. QGIS saves the area the map shows when the project is saved. Here the author saved it zoomed in on central Melbourne.

**What the project file holds:** `<mapcanvas><extent>` with `xmin` 144.95, `ymin` -37.82, `xmax` 144.98 and `ymax` -37.80, in the canvas's CRS, `EPSG:4326`.

**What the catalogue says:** the top-level Catalog's `quac:initial_view` is `[144.95, -37.82, 144.98, -37.8]`, west, south, east and north in WGS84. A canvas in another CRS is converted to WGS84 by the application before the producer writes it; this one is already in WGS84, so the example passes it through unchanged.
