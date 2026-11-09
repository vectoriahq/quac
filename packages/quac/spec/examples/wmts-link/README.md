# `quac:wmts_tile_matrix_set` and `quac:wmts_style`

**The QGIS setting:** a WMTS layer added from **Layer › Add Layer › Add WMS/WMTS Layer**, choosing the `imagery` layer, its `natural` style and the `GoogleMapsCompatible` tile matrix set.

**What the project file holds:** a `wms` provider data source with `layers=imagery`, `styles=natural`, `tileMatrixSet=GoogleMapsCompatible`, and `url=` the service's capabilities document.

**What the catalogue says:** the Imagery Collection has a `rel: "wmts"` link carrying `quac:wmts_tile_matrix_set: "GoogleMapsCompatible"` and `quac:wmts_style: "natural"`. A data source whose `styles=` is empty has no `quac:wmts_style`; one that names the style, even `default`, keeps it.
