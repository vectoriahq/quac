# QUAC examples

One small example per field, each the one setting in a source that writes the field, and the catalogue it gives. A person checks each one against the [field reference](../README.md), one setting to one field.

Each folder holds:

- `README.md`: the setting, in the source's own words, what the source file holds, and what the catalogue says;
- the source: a QGIS project (`project.qgs`), read as a project file or, where `example.json` says `qgis-server`, as the catalogue a QGIS Server serves for it, a WFS service's capabilities as an application parsed them (`capabilities.json`), an ArcGIS item's layers as an application read them (`layers.json`), or, for a field no producer writes, a hand-written catalogue (`catalogue.json`);
- `example.json`: which fields the example shows and which kind of source it is;
- `expected.json`: the catalogue cut down to its tree, each Catalog's and Collection's id, and its `quac:` fields wherever they sit, on the Collection, in its summaries, on an asset, on a link or on a column.

A QGIS layer always carries some fields, such as `quac:editable` and `quac:opacity`, because QGIS saves those settings on every layer. They appear in every QGIS example, and have examples of their own.

`packages/quac/src/tests/firstTier.test.ts` generates each example's catalogue, checks it against the schema, and compares it with `expected.json`. It also saves the catalogue a QGIS Server serves for each QGIS project example, cut down the same way, in `packages/quac/src/tests/firstTierServer.catalogues.json`. That file is generated and read as a diff; the plugin's Python port must give the same.
