# `quac:qgis_server_wms_name` and `quac:qgis_server_wfs_type_name`

**The QGIS setting:** the layer's name, `Street trees: 2024`, with no **Short name** set under QGIS Server in Layer Properties, and the layer ticked **Published** under WFS or OAPIF capabilities on the QGIS Server tab of Project Properties.

**What the project file holds:** `<layername>Street trees: 2024</layername>`, no `<shortname>`, and the layer's id in `<properties><WFSLayers>`.

**What the catalogue says:** `quac:qgis_server_wms_name` is `Street trees: 2024`, the name QGIS Server lists for WMS. `quac:qgis_server_wfs_type_name` is `Street_trees-_2024`: QGIS Server's WFS type name makes each space `_` and each colon `-`. A **Short name**, where set, is used in place of the name for both.
