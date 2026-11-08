# `quac:wms_crs` and `quac:wms_version`

**The QGIS setting:** a WMS layer added from **Layer › Add Layer › Add WMS/WMTS Layer**, requesting the `parcels` layer from `https://maps.example.com/wms` in `EPSG:3857`, with the connection's WMS version 1.3.0.

**What the project file holds:** a `wms` provider data source with `crs=EPSG:3857`, `layers=parcels`, `url=https://maps.example.com/wms` and `version=1.3.0`.

**What the catalogue says:** the Parcels Collection has a `rel: "wms"` link carrying `quac:wms_crs: "EPSG:3857"` and `quac:wms_version: "1.3.0"`, the two settings Web Map Links does not define.
