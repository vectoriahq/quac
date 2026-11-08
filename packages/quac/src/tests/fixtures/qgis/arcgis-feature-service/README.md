# ArcGIS Feature Service QGIS fixture

`kinders.qgs` is a QGIS 4.2 project whose one layer, Kinders, reads a made-up Kindergartens layer on an ArcGIS feature service through QGIS's `arcgisfeatureserver` provider. Its points are drawn with a raster image marker stored in the project.

`kinders-responses.json` holds made-up answers in the shape such a service gives: `layerInfo` is the part of `…/Kinders/FeatureServer/0?f=json` that `ArcgisLayerInfo` reads, with each field's name, type and alias, and `query` is 3 features as `…/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson` returns them.

Tests import these files directly. Change them only when the tested parser or loader contract changes.
