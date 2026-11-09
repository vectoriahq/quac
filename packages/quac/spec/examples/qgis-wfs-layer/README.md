# `quac:wfs_srs_name`

**The QGIS setting:** a WFS layer added from **Layer › Add Layer › Add WFS / OGC API - Features Layer**, reading `city:parks` from `https://data.example.com/wfs`, with the layer's CRS set to `EPSG:7855`.

**What the project file holds:** a `WFS` provider data source with `typename='city:parks'`, `url='https://data.example.com/wfs'` and `srsname='EPSG:7855'`.

**What the catalogue says:** the Parks Collection has `quac:wfs_srs_name: "EPSG:7855"`, the CRS the project pinned for the layer, beside `quac:wfs_endpoint` and `quac:wfs_type_name`, which say where it is read from.
