# `quac:measurement`

**The QGIS setting:** **Units for area measurement** set to hectares and **Units for distance measurement** set to kilometres, under Measurements on the General tab of Project Properties.

**What the project file holds:** `<properties><Measurement><AreaUnits>ha</AreaUnits><DistanceUnits>km</DistanceUnits></Measurement>`.

**What the catalogue says:** every layer's Collection has `quac:measurement: { area_unit: "ha", distance_unit: "km" }`, the names QGIS saves, because the setting is the project's.
