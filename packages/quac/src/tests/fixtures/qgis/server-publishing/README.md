# Server publishing QGIS fixture

A hand-written project holding the QGIS Server settings the QUAC plugin's route applies. It was not saved by QGIS Desktop: each setting is written as QGIS saves it, per the sources cited in `packages/quac/src/generate/serverStacCatalogue.ts` and `packages/quac/src/parse/parseLayers.ts`. `publishing.qgz` is a zip holding `publishing.qgs`, and a test checks the two hold the same project.

The layers and their settings, in QGIS's own words (`src/ui/qgsprojectpropertiesbase.ui` and `QgsField::readableConfigurationFlag`, `src/core/qgsfield.cpp`, `qgis/QGIS@master`, read 2026-11-06):

| Layer | Setting | Project file catalogue (`publishing.catalogue.json`) | Server catalogue (`publishing.server.catalogue.json`) |
|---|---|---|---|
| Parcels | **Published** under WFS or OAPIF capabilities, with Insert, Update and Delete; `owner_phone` set to **Do not expose via WFS** and `valuation` to **Do not expose via WMS** | every field | `owner_phone` and `valuation` left out |
| Parcels | `zone_code` is a **Value Relation** to Zones, and a **Relation** joins it to Zones | both written, naming Zones | both dropped, because Zones is not served |
| Survey notes | Not ticked **Published** under WFS or OAPIF capabilities | a Collection like any other | a WMS link, no data asset, `quac:editable: false` |
| Zones | Listed under **Exclude layers** in WMS capabilities, and **Published** for WFS | a Collection like any other | left out |
| Assets | A PostGIS layer whose connection string holds a user name and password | listed as an unsupported source, with no connection string | served through the server, with no connection string |

The ids differ by route: the project file's catalogue uses the QGIS layer ids, and the server's the WMS names.
