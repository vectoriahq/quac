# `quac:wfs_endpoint`, `quac:wfs_version` and `quac:wfs_output_formats` on a Catalog

**The source:** a WFS service at `https://data.example.com/wfs`, whose GetCapabilities document answers in WFS 2.0.0 and lists `application/json` and `text/xml; subtype=gml/3.2` as the formats GetFeature can send.

**What the producer is given:** `capabilities.json`, the service's capabilities as the application parsed them. In this first stage the WFS producer takes that parsed form, not the document itself.

**What the catalogue says:** the top-level Catalog has `quac:wfs_endpoint`, `quac:wfs_version` and `quac:wfs_output_formats` from those three facts. The Benches Collection carries the fields that say how to read its own feature type; later examples cover them.
