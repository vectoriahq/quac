# QUAC

QUAC (Quite Useful Additions for Catalogs) is a profile of [STAC](https://stacspec.org) 1.1.0 for describing the layers of a map: where each layer's data comes from, how its fields are filled in and checked, how it is drawn, and how its layers relate. It is made by Vectoria.

## Where QUAC fits

Cloud-native geospatial publishes data as plain files rather than through a server. The data sits in object storage in formats built to be read over the web, such as GeoParquet, PMTiles and Cloud Optimized GeoTIFF, and a STAC catalogue says what each dataset is and where it lives. [Portolan](https://github.com/portolan-sdi/portolan-spec) specifies how to publish such a catalogue with no server or API to run. Query engines such as DuckDB read the files directly, and table formats such as Apache Iceberg keep their versions.

That stack says what data exists, where it is and how to read it. It does not say how a map should show the data or how people should edit it: which fields a form shows and in what order, what each field accepts and defaults to, which edits are locked, how one layer's records relate to another's, how each layer is drawn, and which layers are grouped or shown at the start. Today that lives in a QGIS project file, a GIS server's configuration or an ArcGIS Web Map, each in its own shape and read mainly by the software that wrote it.

QUAC puts it in the catalogue, beside the data. A QUAC Collection is an ordinary STAC Collection with `quac:` fields added, so:

- **A cloud-native catalogue can carry a map.** QUAC finds a layer's data the way Portolan addresses it, by the asset's `data` role, and reads PMTiles where Portolan registers them. Add QUAC fields to such a catalogue and an application reading it knows how to show each layer and what its form should hold.
- **A layer is described the same way wherever its data lives.** The fields for forms, rules, relations and styles are the same for a GeoParquet file, a QGIS Server or WFS layer, or an ArcGIS Feature Service. Only a field naming where the data is, such as `quac:wfs_endpoint`, belongs to one kind of source.
- **QUAC restates settings rather than inventing them.** A field that carries a setting QGIS, QField, Mergin Maps or an ArcGIS client already acts on is marked stable in the spec; a field whose meaning depends on Groundwork alone is marked experimental.
- **An application can take one field and ignore the rest.** Every field is optional, and an absent field means the source said nothing.

## What this repository holds

- **The spec**, the field reference and its per-field examples: [`packages/quac/spec/`](packages/quac/spec/).
- **The JavaScript package**, `@vectoriahq/quac`, which writes QUAC catalogues from QGIS projects and other sources and reads them back: [`packages/quac/`](packages/quac/).
- **The QGIS Server plugin**, which serves a project's QUAC catalogue from QGIS Server, with the Python port of the JavaScript reader it is built on: [`packages/quac-qgis-server/`](packages/quac-qgis-server/).

QUAC is pre-1.0 and not yet released. Its licence is not yet chosen.
