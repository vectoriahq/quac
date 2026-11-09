# A WFS feature type's fields

**The source:** a WFS service at `https://data.example.com/wfs` publishing the feature type `city:parks`. Its capabilities give the type's default CRS, `urn:ogc:def:crs:EPSG::7855`, a second CRS it can serve, and the operations it allows on the type: query, insert and update, but not delete.

**What the producer is given:** `capabilities.json`, the capabilities as the application parsed them. In this first stage the WFS producer takes that parsed form, not the document itself.

**What the catalogue says:** the `city:parks` Collection has `quac:wfs_endpoint` and `quac:wfs_type_name`, saying where its features are read, and `quac:wfs_default_srs`, `quac:wfs_supported_srs` and `quac:wfs_operations`, restating what the capabilities declare for the type.
