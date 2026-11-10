<img src="assets/quac-mark.svg" alt="QUAC logo" width="96">

# QUAC

QUAC (Quite Useful Additions for Catalogs) is a profile of [STAC](https://stacspec.org) 1.1.0 for describing the layers of a map: where each layer's data comes from, how its fields are filled in and checked, how it is drawn, and how its layers relate. It is made by Vectoria.

## Where QUAC fits

Cloud-native geospatial publishes data as plain files rather than through a server. The data sits in object storage in formats built to be read over the web, such as GeoParquet, PMTiles and Cloud Optimized GeoTIFF, and a STAC catalogue says what each dataset is and where it lives. [Portolan](https://github.com/portolan-sdi/portolan-spec) specifies how to publish such a catalogue with no server or API to run. Query engines such as DuckDB read the files directly, and table formats such as Apache Iceberg keep their versions.

That stack says what data exists, where it is and how to read it. It does not say how a map should show the data or how people should edit it: which fields a form shows and in what order, what each field accepts and defaults to, which edits are locked, how one layer's records relate to another's, how each layer is drawn, and which layers are grouped or shown at the start. Today that lives in a QGIS project file, a GIS server's configuration or an ArcGIS Web Map, each in its own shape and read mainly by the software that wrote it.

QUAC puts it in the catalogue, beside the data. A QUAC Collection is an ordinary STAC Collection with `quac:` fields added, so:

- **A cloud-native catalogue can carry a map.** Add QUAC fields to a Portolan catalogue and an application reading it knows how to show each layer and what its form should hold. [QUAC and Portolan](#quac-and-portolan) says how the two fit.
- **A layer is described the same way wherever its data lives.** The fields for forms, rules, relations and styles are the same for a GeoParquet file, a QGIS Server or WFS layer, or an ArcGIS Feature Service. Only a field naming where the data is, such as `quac:wfs_endpoint`, belongs to one kind of source.
- **QUAC restates settings rather than inventing them.** A field that carries a setting QGIS, QField, Mergin Maps or an ArcGIS client already acts on is marked stable in the spec; a field whose meaning depends on Groundwork alone is marked experimental.
- **An application can take one field and ignore the rest.** Every field is optional, and an absent field means the source said nothing.

## QUAC and Portolan

Portolan sets the conventions a reader of a cloud-native catalogue relies on. QUAC follows them where they apply:

- **Data and tiles.** QUAC finds a layer's data by the asset's `data` role, and reads PMTiles from a `rel: "pmtiles"` link or a `visual` asset, the two places Portolan registers them.
- **Styles.** A style is a Collection asset with the `style` role, and the default style also carries the `default` role, as Portolan's core specification sets out.
- **Fields.** Portolan describes a dataset's columns with the [Table extension](https://github.com/stac-extensions/table)'s `table:columns`. QUAC's settings for a field sit on that field's entry.

[Portolan's core specification](https://github.com/portolan-sdi/portolan-spec/blob/main/specs/portolan/core.md) has no fields for forms, field rules, edit locks or relations between layers. Those are what QUAC adds, each under the `quac:` prefix, beside Portolan's fields and without changing them.

One difference in shape: a QUAC catalogue is one document, with each Catalog carrying its Collections inline, where a Portolan catalogue keeps each Collection in a file of its own, linked with `rel: "child"`. The package reads the one-document form. An application reading a catalogue split across files gathers it into one document first.

## What QUAC adds to a field

Two entries from a street-tree layer's `table:columns`, taken from [the example catalogue that carries every field](packages/quac/src/schema/examples/every-field.json). `name` and `type` are the Table extension's; the rest are QUAC's.

```json
[
  {
    "name": "species",
    "quac:control": "buttons",
    "quac:value_relation": {
      "collection": "species",
      "key": "code",
      "value": "common_name",
      "filter": "\"in_use\" = 1",
      "allow_null": true,
      "order_by": "field",
      "order_field": "sort_order",
      "descending": true
    }
  },
  {
    "name": "height",
    "type": "double",
    "quac:range": {
      "min": 0,
      "max": 80,
      "step": 0.5,
      "precision": 1,
      "suffix": " m"
    },
    "quac:constraints": {
      "not_null": "warn",
      "expression": {
        "expression": "\"height\" < 80",
        "description": "Taller than any tree in the city",
        "strength": "warn"
      }
    }
  }
]
```

The species field offers its choices as buttons, taken from the `species` layer of the same catalogue: it stores a species' `code` and shows its `common_name`. The height field takes a number from 0 to 80 metres, and a form warns when it is left blank or is 80 or more. The [field reference](packages/quac/spec/README.md) describes every field.

## What QUAC leaves out

QUAC says what an edit may do: which fields can be changed, what each accepts, and which edits are locked. It does not say how an edit is saved. That is left to the application and the source, such as a WFS-T service or a file the application can write to.

The JavaScript package makes no network request. It builds a catalogue from what an application has already fetched, such as a QGIS project's text or a QGIS Server GetProjectSettings response, and reads a catalogue it is given.

## Checking a catalogue

The schema is [`packages/quac/src/schema/quac.schema.json`](packages/quac/src/schema/quac.schema.json), a JSON Schema (draft-07) whose `$id` is `https://vectoriahq.github.io/quac/v0.1.0/schema.json`. Any draft-07 validator checks a Catalog with its Collections inline, or a single Collection, against it. It checks only `quac:` fields: any other field passes, and a `quac:` field the schema does not define fails. A catalogue says it follows QUAC by listing the schema's address in `stac_extensions`.

## What this repository holds

- **The spec**, the field reference and its per-field examples: [`packages/quac/spec/`](packages/quac/spec/).
- **The JavaScript package**, `@vectoriahq/quac`, which writes QUAC catalogues from QGIS projects and other sources and reads them back: [`packages/quac/`](packages/quac/).
- **The QGIS Server plugin**, which serves a project's QUAC catalogue from QGIS Server at `SERVICE=QUAC&REQUEST=GetCatalogue&MAP=<project>`, with the Python port of the JavaScript reader it is built on: [`packages/quac-qgis-server/`](packages/quac-qgis-server/).

## Where QUAC came from

QUAC began inside Groundwork, Vectoria's web app for capturing and editing spatial data. Groundwork reads each source a map connects to, from a QGIS project to an ArcGIS Web Map or a STAC catalogue, as a STAC catalogue, and QUAC holds what STAC has no field for. Groundwork is QUAC's first reader, which is why the spec marks a field experimental where Groundwork alone gives it meaning.

## Status

QUAC is pre-1.0. Version 0.1.0 of the JavaScript package is on npm as [`@vectoriahq/quac`](https://www.npmjs.com/package/@vectoriahq/quac). The QGIS Server plugin is not yet released.

## Licence

Copyright 2026 Vectoria Pty Ltd.

- **The spec, the schema, the examples and the JavaScript package** are under the [Apache License 2.0](LICENSE), the licence of the STAC specification and its extension template.
- **The QGIS Server plugin**, `packages/quac-qgis-server/`, is under the [GNU General Public License, version 2 or any later version](packages/quac-qgis-server/LICENSE), as the QGIS plugin repository asks of a plugin.
