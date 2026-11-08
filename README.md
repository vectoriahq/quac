# QUAC

QUAC (Quite Useful Additions for Catalogs) is a profile of [STAC](https://stacspec.org) 1.1.0 for describing the layers of a map: where each layer's data comes from, how its fields are filled in and checked, how it is drawn, and how its layers relate. It is made by Vectoria.

This repository holds three parts:

- **The spec**, the field reference and its per-field examples: [`packages/quac/spec/`](packages/quac/spec/).
- **The JavaScript package**, `@vectoriahq/quac`, which writes QUAC catalogues from QGIS projects and other sources and reads them back: [`packages/quac/`](packages/quac/).
- **The QGIS Server plugin**, which serves a project's QUAC catalogue from QGIS Server, with the Python port of the JavaScript reader it is built on: [`packages/quac-qgis-server/`](packages/quac-qgis-server/).

QUAC is pre-1.0 and not yet released. Its licence is not yet chosen.
