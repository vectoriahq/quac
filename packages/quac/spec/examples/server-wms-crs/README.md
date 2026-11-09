# `quac:wms_crs` on a QGIS Server layer

**The QGIS setting:** **CRS restrictions** ticked under WMS capabilities on the QGIS Server tab of Project Properties, listing `EPSG:28350` and `EPSG:4326`. The project's own CRS is `EPSG:28350`.

**What the project file holds:** `<properties><WMSCrsList>` with the values `EPSG:28350` and `EPSG:4326`.

**What the catalogue says:** this is the catalogue a QGIS Server serves for the project, so the Collection's id is the layer's WMS name, `Street trees`, and its `quac:editable` is `false` because the project does not publish it for WFS. Its `rel: "wms"` link asks for `quac:wms_crs: "EPSG:28350"`, the first CRS the project lists, because `EPSG:3857` is not one of them. Where the list holds `EPSG:3857`, or the project restricts no CRS, the link asks for `EPSG:3857`, which QGIS Server then always offers.
