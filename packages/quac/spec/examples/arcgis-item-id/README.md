# `quac:arcgis_item_id`

**The source:** the ArcGIS Online Feature Service item `0123456789abcdef0123456789abcdef`, holding one layer, Trees.

**What the producer is given:** `layers.json`, the item and its layers as the application read them from ArcGIS Online. In this first stage the ArcGIS producer takes that parsed form, not the service's own description.

**What the catalogue says:** the top-level Catalog's `quac:arcgis_item_id` is the item's id. The Trees Collection carries the field that says where to read its features; a later example covers it.
