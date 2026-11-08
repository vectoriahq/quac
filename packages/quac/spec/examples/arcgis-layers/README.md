# `quac:arcgis_layer_url`, `quac:arcgis_where` and `quac:arcgis_not_shown`

**The source:** an ArcGIS Online Web Map with two layers. Vegetation zones is a FeatureServer layer, filtered in the Web Map to `zone = 'Hills'`. Imagery is a tile layer, which cannot be read as features.

**What the producer is given:** `layers.json`, the Web Map's layers as the application read them from ArcGIS Online. In this first stage the ArcGIS producer takes that parsed form, not the service's own description.

**What the catalogue says:** the Vegetation zones Collection has `quac:arcgis_layer_url`, its FeatureServer layer's address, and `quac:arcgis_where`, the Web Map's filter. The Imagery Collection has `quac:arcgis_not_shown: "not-a-feature-layer"` and no data, so it can still be listed with its reason.
