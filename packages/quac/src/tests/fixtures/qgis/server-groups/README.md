# Server groups QGIS fixture

A hand-written project holding layer groups and the QGIS Server settings that act on them, in the shape QGIS 4 saves its properties (`<properties name="…">`). It was not saved by QGIS Desktop, and its data files are not here: the QGIS Server job in `.github/workflows/qgis-server.yml` writes a stand-in for each before the server opens the project.

The layers and their settings, in QGIS's own words (`src/ui/qgsprojectpropertiesbase.ui` and `QgsField::readableConfigurationFlag`, `src/core/qgsfield.cpp`, `qgis/QGIS@master`, read 2026-11-06):

| Layer | Group | Setting | Server layer tree (`groups.server.layers.json`) |
|---|---|---|---|
| Water: bores | Water | **Published** under WFS or OAPIF capabilities, with Update; `owner` listed in the layer's `excludeAttributesWFS`, as QGIS 3.14 and older saved **Do not expose via WFS** | WMS name `Water: bores`, WFS type name `Water-_bores`, `owner` hidden from WFS |
| Sites | Monitoring, inside Water | Short name `monitoring_sites`; `contact` set to **Do not expose via WMS** and **Do not expose via WFS** | WMS name `monitoring_sites`, not published for WFS, `contact` hidden from both |
| Staff notes | Internal | The group Internal listed under **Exclude layers** in WMS capabilities; the layer **Published** for WFS; `author` listed in `excludeAttributesWMS` | no WMS name, WFS type name `Staff_notes`, `author` hidden from WMS |
