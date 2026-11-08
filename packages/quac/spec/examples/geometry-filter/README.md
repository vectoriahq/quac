# `quac:geometry_filter`

**The QGIS setting:** none to tick. Adding a GeoJSON file that holds points and polygons, QGIS asks which geometry types to add and makes a layer per type; this project kept the points.

**What the project file holds:** a data source ending `|geometrytype=Point`: `./sites.geojson|geometrytype=Point`.

**What the catalogue says:** the Collection's data asset carries `quac:geometry_filter: ["Point"]`: only the file's points belong to it, multi-points included.
