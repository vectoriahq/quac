# The demo catalogue

A small made-up project, published on the site at `https://vectoriahq.github.io/quac/demo/`. The data is invented: the trees, their codes and their inspections describe nothing real.

- `street-trees.qgs` is the QGIS project, with three layers:
  - **Street trees**, points in `trees.geojson`;
  - **Inspections**, records with no geometry in `inspections.geojson`, related to a tree by `tree_id`;
  - **Species**, a private lookup table in `species.geojson`.
- `catalogue.json` is the catalogue `generateStacCatalogue` writes for the project: one document, with its Collections inline.
- `catalog.json` and `collections/<id>.json` are the same catalogue with each Collection in a file of its own, linked by `rel: "child"`, for a STAC client that follows links. The one document's `child` links name these files.

The Street trees layer shows what QUAC carries for a form:

| Field | QGIS setting | In the catalogue |
|---|---|---|
| `tree_id` | Not null and Unique constraints | `quac:constraints` |
| `species` | Value Relation to the Species layer | `quac:value_relation` |
| `height` | Range from 0 to 40 m, a constraint expression that warns, and a Comment | `quac:range`, `quac:constraints` and the column's `description` |
| `condition` | Value Map, and a categorised style on the field | the column's `values`, and the style asset's `quac:categorised_field` |
| `heritage` | Checkbox storing `Y` and `N` | `quac:checkbox` |
| `planted` | Date/Time, and a default of `now()` | `quac:default` |
| `removal_reason` | In a Drag and Drop Designer group shown while `"condition" = 'D'`, with Label on top | `quac:visible_when` and `quac:label_on_top` |

`packages/quac/src/tests/demoCatalogue.test.ts` generates the catalogue from the project and checks every file here against it and against the schema. After a change to the project or the package, `npx vitest run -u src/tests/demoCatalogue.test.ts` in `packages/quac/` rewrites them, to be read as a diff.
