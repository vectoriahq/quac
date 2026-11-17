# Value labels over WFS

A web map that reads a QGIS Server layer over WFS gets the values its fields store, not the labels the project's Value Maps give them. This demo shows the gap and how the catalogue closes it. The data is invented.

## The gap

A **Value Map** widget (Layer Properties › Attributes Form) gives each stored value a label: `SW` is shown as *Swing*. QGIS Server applies it in one place and not in the others:

- **WMS GetFeatureInfo** gives the label. QGIS Server passes each value through the widget's formatter (`QgsRenderer::replaceValueMapAndRelation`, `src/server/services/wms/qgswmsrenderer.cpp`, `qgis/QGIS@master`, read 2026-11-17).
- **WFS GetFeature** gives the stored value. That is what a WFS client wants for filtering, joining and editing, but the client then has no label to show.
- **GetProjectSettings** names each field's widget, `editType="ValueMap"`, but not the widget's list.

So an application that turns a layer from WMS into WFS, to draw it in the browser, list its features in a table or filter them, shows `SW` where it used to show *Swing*. The usual workaround is a virtual field holding a `CASE` expression for each coded field.

The catalogue's `quac:values` gives each column's list as `{ value, label }`, so the application keeps the stored value and shows its label.

## The project

`playgrounds.qgs` has one layer, **Playground equipment**, points in `equipment.geojson`, published for WMS and WFS:

| Field | Value Map |
|---|---|
| `equipment`, text | `SW` Swing, `SL` Slide, `CF` Climbing frame, `SR` Spring rocker |
| `condition`, whole number | `1` Good, `2` Fair, `3` Poor, `4` Closed for repair, blank Not inspected |

## Running it

`show_value_labels.py` asks a QGIS Server for the project's GetProjectSettings, WMS GetFeatureInfo, WFS GetFeature and QUAC catalogue, and prints a table of each Value Map field of each feature. It exits with 1 where a label read through the catalogue differs from GetFeatureInfo's. It uses Python's standard library only.

```bash
python3 packages/quac-qgis-server/build_plugin.py dist
```

Install the zip's `quac_catalogue/` folder in the server's plugins folder, put this folder's `playgrounds.qgs` and `equipment.geojson` where the server can read them, and then:

```bash
python3 packages/quac-qgis-server/demo/value-labels/show_value_labels.py https://qgis.example.test /srv/qgis/playgrounds.qgs
```

The QGIS Server workflow, `.github/workflows/qgis-server.yml`, runs it on QGIS Server 3.44 and 4.2 and adds the table to the run's summary.

## What it showed

On QGIS Server 3.44.15, 2026-11-17, with the QUAC Catalogue plugin at version 0.1.3, which serves no `quac:values`:

| Feature | Field | WFS GetFeature | WMS GetFeatureInfo | WFS with `quac:values` |
|---|---|---|---|---|
| PG-001 | Equipment | `"SW"` | Swing | — (no list) |
| PG-001 | Condition | `1` | Good | — (no list) |
| PG-002 | Equipment | `"SL"` | Slide | — (no list) |
| PG-002 | Condition | `2` | Fair | — (no list) |
| PG-003 | Equipment | `"CF"` | Climbing frame | — (no list) |
| PG-003 | Condition | `4` | Closed for repair | — (no list) |
| PG-004 | Equipment | `"SR"` | Spring rocker | — (no list) |
| PG-004 | Condition | `null` | Not inspected | — (no list) |

With the plugin at version 0.2.0, which serves `quac:values`:

| Feature | Field | WFS GetFeature | WMS GetFeatureInfo | WFS with `quac:values` |
|---|---|---|---|---|
| PG-001 | Equipment | `"SW"` | Swing | Swing |
| PG-001 | Condition | `1` | Good | Good |
| PG-002 | Equipment | `"SL"` | Slide | Slide |
| PG-002 | Condition | `2` | Fair | Fair |
| PG-003 | Equipment | `"CF"` | Climbing frame | Climbing frame |
| PG-003 | Condition | `4` | Closed for repair | Closed for repair |
| PG-004 | Equipment | `"SR"` | Spring rocker | Spring rocker |
| PG-004 | Condition | `null` | Not inspected | Not inspected |

Two things to note when reading the list:

- **Compare as text.** WFS gives `condition` as the number `1`; the list holds the text `"1"`, as QGIS saves it. QGIS compares a value with the list as text, and so does the script.
- **A blank is `""`.** WFS gives a blank `condition` as `null`; the list's blank entry has the value `""`.

## The display field

The same run shows one more difference. GetProjectSettings gives the layer's display field as `Asset ID`, the field's alias, while WFS names the field `asset_id`. A WFS client cannot match the two. The catalogue's `quac:display_field` is `asset_id`, the name WFS uses, and the alias is the column's `title`.
