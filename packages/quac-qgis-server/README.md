# QUAC for QGIS Server and QGIS Desktop

The QUAC plugin for QGIS Server and QGIS Desktop, and the Python it is built on. The plugin is in the QGIS plugin repository as [QUAC](https://plugins.qgis.org/plugins/quac/).

## The plugin

`quac/` is the plugin, one plugin for both. QGIS Server starts it through `serverClassFactory` and QGIS Desktop through `classFactory` (`quac/__init__.py`), and each imports only its own part: the server never loads `desktop.py`, which needs `qgis.gui`, and QGIS Desktop never loads `service.py`.

On a QGIS Server with it installed, `SERVICE=QUAC&REQUEST=GetCatalogue&MAP=<project>` answers the open project's catalogue as one STAC document with its Collections inlined. An installed copy holds `quac_server` inside its folder. `build_plugin.py` lays it out that way, both for the plugin's zip and for the QGIS Server job. The plugin's `icon.png` is `assets/quac-mark.svg` drawn at 128 pixels square.

- It reads the project's stored text and builds the catalogue with `quac_server`, taking from QGIS what the text does not hold: each field's type, the comment its data holds, such as a PostgreSQL column comment, its length and precision, whether its data fills it when a new feature leaves it empty, and whether it is part of the layer's primary key, and each layer's WGS84 box (`qgis_inputs.py`). A column's comment follows the spec's rule for a producer that has both the project's comment and the data's. The links name the address QGIS Server's own `QgsServerProjectUtils.wmsServiceUrl` gives.
- It keeps one copy per project, server address and modification time while QGIS's access controls allow a shared copy, which is while no access-control plugin gives a cache key (`QgsAccessControl.fillCacheKey`), and builds each answer afresh otherwise. The `X-QUAC-Cache` header says `hit`, `miss` or `off`.
- On any error it answers "The catalogue could not be built for this project. The server's log has the details." and writes the cause to QGIS Server's log, under the tag `QUAC`. A server address holding a password, in the address or in its `MAP`, is refused this way, with a hint to give the project an advertised WMS address or name its database through a pg_service file. So a project stored in PostgreSQL is served when `MAP` names it by service (`postgresql:///?service=…&schema=…&project=…`), not when `MAP` carries its user name and password.
- A project saved by a newer major version of QGIS than the server runs is served, with a warning in the log naming both versions: QGIS Server 3.44 does not read the server settings a QGIS 4 project saves, so the catalogue, which follows the project as saved, can list layers and services differently from what the server publishes.

- With an access-control plugin installed, each person gets the catalogue QGIS's combined access answers allow them (`access.py`):
  - A layer they may not read is left out, and so is a group left with no layer they may read.
  - A field they may not see is left out, and so is a primary key (`quac:primary_key`) holding one.
  - Each edit they may not make is locked in `quac:locks`.
  - A Value Relation whose lookup layer they may not read, or that uses a field of either layer they may not see, is left out.

  QGIS answers nothing finer than that per layer. So which fields a person sees but may not change, changing details but not moving shapes, and which features they may edit are not in the catalogue. The access plugin refuses such a save.

`quac/catalogue.py` and `quac/access.py` need no QGIS module, so `tests/test_catalogue.py` and `tests/test_access.py` check the answer, the cache, the warning and each person's catalogue anywhere.

## In QGIS Desktop

When a project is saved, the plugin writes its catalogue as STAC documents into a folder chosen in the project's settings, with each layer's data linked by a path relative to the document that links it. The folder can then be read by STAC software as it is: opened from disk, from a synced cloud folder, or from a copy on web storage. Choosing a folder inside the project's folder publishes the layers in it while the project file stays out of what is shared. It can also be written on demand, from the Project menu or by a Processing algorithm, which `qgis_process` runs from the command line.

### The settings

A QUAC page in Project Properties:

- **Write a STAC catalogue when the project is saved**, off until it is ticked.
- **Folder**, the project's own folder until another is chosen.
- **Root file**, the root document's name, shown and not editable.

Both are saved in the project (`QgsProject.writeEntry`, scope `quac`): the option as `catalogue/write_on_save`, and the folder as `catalogue/folder`, a path relative to the project file, empty for the project's own folder. So they travel with the project. A folder on another drive, which has no path relative to the project, is saved as it is. For a project not saved as a `.qgs` or `.qgz` file, such as one kept in a database, the page's controls are off and it says to save the project as a file first, and a save writes nothing.

### What it writes

For a project `Parks.qgz` with `publish/` chosen:

```
Parks Project/
├── Parks.qgz                        not in the chosen folder, so not shared
└── publish/                         the chosen folder
    ├── Parks.stac.json              the root Catalog
    ├── Parks.stac/
    │   ├── catalogs/
    │   │   └── recreation/
    │   │       ├── catalog.json
    │   │       └── collections/
    │   │           └── <layer id>.json
    │   ├── collections/
    │   │   └── <layer id>.json      a layer outside any group
    │   └── styles/
    │       └── <layer id>.qml
    └── vector/
        └── parks.geojson
```

- The root document is `<project>.stac.json`, `<project>` being the project file's name less `.qgs` or `.qgz`, and every other document is under `<project>.stac/`, laid out by `split_catalogue`. So several projects can publish into one folder. The documents follow the layer tree: a group's folder is its name through `slugify`, and a Collection's file is its QGIS layer id.
- The catalogue is the project file's (`generate_stac_catalogue`), with what QGIS gives for each column, by the same `with_field_type` the server route uses, and the layer's primary key (`primary_key_of`), less the names QGIS Server would give a layer. Each Collection's data asset names its data file, with the file's size as `file:size` and when it last changed as `updated`, as the file system gives them, or a web layer's own address, and a WMS, WMTS or XYZ layer's web map link names its service's address. The root's `quac:initial_view` is the map canvas's extent the project saves, converted to WGS84 by QGIS.
- Each layer's current style is written as `<project>.stac/styles/<the Collection's file name>.qml`, as QGIS writes a style (`QgsMapLayer.exportNamedStyle`), with only its drawing settings: symbols, labels, diagrams and rendering. A layer's form settings are left out, because a Value Relation's there names its lookup's data source, which can hold a password. The Collection gets a style asset with the `style` and `default` roles and the QML media type, keyed by the style's name as the spec's § Styles says, and with the `quac:categorised_field` of a categorised or graduated style. A style whose QML names the project's folder or the chosen folder is not written, with a warning.

### The folder rules

- A data file in the chosen folder or below it is linked by its path relative to the document, worked out from the project's folder and the chosen folder, so a Windows drive or an absolute path never reaches an href.
- A layer is left out, and the message bar names it, where its data file is outside the chosen folder, where its data is not in a file, such as a layer held in a database, where QGIS could not open its data, or where its web address holds a user name or password, which the server plugin refuses for its own address too. A layer from a web feature service or an ArcGIS service keeps its address, and so does a layer from a WMS, WMTS or XYZ service, in a web map link as the JavaScript's `generateStacCatalogue` writes it; one whose source holds a user name, a password or an `authcfg` is left out. A WMS, WMTS or XYZ layer is written whether or not QGIS opened it: QGIS opens a WMS or WMTS layer by reading its server's capabilities, so it cannot open one whose server it could not reach at that moment, such as in a project opened offline, while its address is still right and a reader contacts the server itself. Such a layer is written without the extent QGIS would work out for it, and without a style. A key written into a service's address, such as an `api_key` query parameter, is written as it is.
- Nothing names a layer left out: a `quac:value_relation` whose lookup was left out is not written, and the warning says what to do to keep it, and a relation in `quac:related_to` whose parent layer was left out is not written either, with a warning. A field's default, constraint, condition for showing it (`quac:visible_when`) or condition for editing it (`quac:editable_when`) whose expression names a layer not written, by its id or name in a text literal, is not written, with a warning; a text literal naming such a layer counts whatever the expression does with it. Where the initial active layer is left out, the root has no `quac:active_collection`. A group left with no layer is left out too. A layer the project leaves out of WMS is left out, as in the served catalogue, and so is every relation, filter and initial active layer naming it.
- An icon (`quac:icon`) whose web address holds a user name or password is not written, as the field reference says of any value that names no icon.
- An Attachment widget's default folder (`default_root` in `quac:attachment`) that is not a path relative to the project, such as an absolute path, a drive, a network share, `~` or a `file:` address, is not written, as no catalogue writes one, and the warning says to give the widget a path relative to the project's folder. QGIS's folder picker fills the setting with an absolute path.
- Each Collection's `via` link to the project file is written only where the project file is in the chosen folder or below it.

### How it writes

- Each file is written to a temporary file in its own folder and then renamed over the old one, so a sync client never uploads half a file. A file whose bytes have not changed is left as it is.
- An existing `<project>.stac.json` that is not a QUAC Catalog, because it is not JSON, is not `type: Catalog` or lists no QUAC schema in `stac_extensions`, is left as it is, nothing is written, and the message bar says so.
- After writing, the documents and styles under `<project>.stac/` that the previous catalogue linked and the new one does not are removed, found by walking the previous documents' `child` links and style assets. Nothing else is removed, and nothing outside `<project>.stac/`. A folder under `<project>.stac/` left empty is removed.
- A failure never stops the save. The message bar says what happened and what to do, and the details go to the QGIS log under the tag `QUAC`. A save that leaves layers out shows one warning listing them; any other shows a short message naming the root file.

### Writing on demand

The save, the menu action and the algorithm below write through one function, `write_catalogue` in `quac/desktop.py`, so they write the same files and give the same reasons for what they leave out. The menu action and the algorithm write whether or not the project writes its catalogue on save.

- **Project ▸ Write STAC catalogue now** writes the catalogue of the open project as it was last saved, into its chosen folder, without saving it: such as after its data has changed, which moves a layer's extent or fields. It reads the saved file into a project of its own, apart from the one on screen, so a change not yet saved does not reach the catalogue; where there is one, the message ends "It follows the project as last saved. To include your unsaved changes, save the project." For a project not saved as a `.qgs` or `.qgz` file the action stays in the menu and says to save the project as a file first.
- **Write QUAC catalogue** (`quac:writequaccatalogue`), in the QUAC provider of the Processing Toolbox, takes a project file (`PROJECT`) and, optionally, a folder (`FOLDER`); with no folder it writes into the project's chosen folder. It opens the project in a `QgsProject` of its own, never the one on screen, and releases its layers when it is done, so batch mode can run it over many project files from one table. It gives the root file's path (`ROOT_FILE`) and the number of layers written (`LAYERS_WRITTEN`) and left out (`LAYERS_LEFT_OUT`), and reports what was left out as a warning in its log, with the message bar's reasons and next steps. A file QGIS cannot read as a project, a folder that does not exist, or a root file in the way that is not a QUAC catalogue stops it with an error, and nothing is written. The folder is a folder input rather than a folder output: an empty one then means the project's chosen folder, where Processing would offer a temporary folder in its place for an output.

`qgis_process` runs the algorithm once the plugin is installed in the plugins folder of the QGIS profile it uses, `default`, and enabled for it: until then `qgis_process list` does not list it. These commands were run with `qgis_process` 3.34; on a machine with no display, set `QT_QPA_PLATFORM=offscreen` first, as `qgis_process` needs it there even to list its plugins.

```bash
qgis_process plugins enable quac
qgis_process help quac:writequaccatalogue
qgis_process run quac:writequaccatalogue -- PROJECT=/data/projects/Parks.qgz
qgis_process run quac:writequaccatalogue -- PROJECT=/data/projects/Parks.qgz FOLDER=/data/publish
```

`qgis_process run` exits with 1 where the algorithm stops with an error, and `--json` before `--` prints the results and the log as JSON. To write every project in a folder each night, a script such as this can be run by `cron` or another scheduler:

```bash
#!/bin/sh
export QT_QPA_PLATFORM=offscreen
for project in /data/projects/*.qgz; do
  qgis_process run quac:writequaccatalogue -- PROJECT="$project" || echo "Not written: $project" >&2
done
```

On Windows, `qgis_process` is started through a batch file in the `bin` folder of the QGIS installation: `qgis_process-qgis-ltr.bat` for a long-term release or `qgis_process-qgis.bat` for the latest, under `C:\Program Files\QGIS <version>\` for QGIS's own installer or `C:\OSGeo4W\` for OSGeo4W. Enable the plugin once, as the Windows user the scheduled task runs as, since each user has their own QGIS profile:

```bat
"C:\Program Files\QGIS 3.40\bin\qgis_process-qgis-ltr.bat" plugins enable quac
```

A batch file such as this, saved as `write-catalogues.cmd`, writes every project in a folder. Change the two paths to the installation's batch file and the projects' folder:

```bat
@echo off
set QGIS_PROCESS="C:\Program Files\QGIS 3.40\bin\qgis_process-qgis-ltr.bat"
for %%p in ("D:\GIS\Projects\*.qgz") do (
  call %QGIS_PROCESS% run quac:writequaccatalogue -- "PROJECT=%%~fp" || echo Not written: %%~fp 1>&2
)
```

Task Scheduler then runs it each night. This command, run once, creates the task:

```bat
schtasks /Create /SC DAILY /ST 02:00 /TN "Write QUAC catalogues" /TR "D:\GIS\write-catalogues.cmd"
```

The Windows commands follow the batch file names and folders QGIS's Windows installers use; they have not been run on Windows by this repository's checks.

### Limits

- STAC software that opens a cloud folder's share link cannot follow relative paths: the link names the folder, and a file inside it is reached through the provider's own API, given the link and the file's path. An application that reads cloud folders through each provider's API, or software that opens the synced folder from disk or a copy on web storage, can follow them.
- Every `.tif` or `.tiff` data file is given the Cloud Optimized GeoTIFF media type, `image/tiff; application=geotiff; profile=cloud-optimized`, whether or not it is one (`quac_server/util/catalogue_file_formats.py`). Software reading the whole file reads a plain GeoTIFF as usual. Software that trusts the label may request parts of the file over the web, which only a cloud-optimised GeoTIFF is laid out for, so on a plain GeoTIFF it can be slow or fail.
- The catalogue is as current as the last save with the option on, or the last time it was written on demand.
- It writes every setting the JavaScript's `generateStacCatalogue` writes for a QGIS project on a Collection and its columns, apart from the style assets, `via` link, providers and keywords that `port-exemptions.json` records: among them each field's name, alias, comment and type, its form settings (Value Map and Value Relation choices, Attachment, Checkbox, Range, Date/Time and Color widgets, defaults, constraints, read-only, hidden and Not searchable fields, Reuse last value, duplicate policy, Label on top and controls), the Drag and Drop Designer form's order and conditions, and the project's measurement units.

### Its code and checks

`quac/publish.py` works out what to write, from the saved project's bytes and what QGIS gives, with no QGIS module, `quac/desktop.py` reads those from QGIS, draws the settings page, adds the menu action and writes the files, and `quac/algorithm.py` is the Processing provider and its algorithm. `tests/test_publish.py` checks `publish.py` anywhere: the paths, the hrefs and the folder rules, Windows paths and the settings that name a layer left out among them, the styles, what an earlier catalogue leaves to remove and the messages, and that no document written for any fixture holds an absolute path, an Attachment widget's default folder on the computer among them, a user name or a password. It imports the plugin as QGIS installs it (`tests/installed_plugin.py`).

`tests/desktop/check_desktop.py` runs the Desktop part in QGIS's own Python: it starts the plugin through `classFactory` with a stand-in for QGIS's `iface`, saves a made-up project, with a field default and form conditions, one reading a layer left out, with the option off and on, after removing a layer and after a layer's data file is deleted, runs Project ▸ Write STAC catalogue now with the option off, with and without unsaved changes and for a project not saved as a file, runs the Processing algorithm on two project files one after the other and on a file that is not a project, and draws the settings page. It needs QGIS's Processing plugin, which it loads from QGIS's own `python/plugins` folder. The `QGIS Desktop` job of `.github/workflows/qgis-server.yml` runs it in the official `qgis/qgis` image. To run it where QGIS's Python bindings are installed:

```bash
cd packages/quac-qgis-server && QT_QPA_PLATFORM=offscreen python3 tests/desktop/check_desktop.py settings-page.png
```

## The Python

`quac_server` takes a QGIS project's stored text (a `.qgs`, a `.qgz`, or the zip QGIS keeps in a database) and the server's address, and returns the catalogue QGIS Server serves for it: the same catalogue as the JavaScript's `generateServerStacCatalogue` (`packages/quac/src/generate/serverStacCatalogue.ts`), holding only the fields the plugin declares. `quac_server/declared_fields.json` is that list, the plugin's first release, by the place each field sits. It also returns the layer tree QGIS Server publishes, as the JavaScript's `serverLayerTree` does, and `generate/split_catalogue.py` writes a catalogue as separate documents, each with its path, as the JavaScript's `splitCatalogue` does. The project file's catalogue the server route starts from, `generate_stac_catalogue`, gives each file, WFS or ArcGIS layer the data asset the JavaScript's `generateStacCatalogue` gives it, a file's by the path the project gives it; the server route replaces that asset with its own WFS request or drops it, so a served catalogue names no data file. It also carries settings the first release does not declare, such as `quac:related_to`, which the QGIS Desktop part writes; the server route keeps only the declared ones. It does not return the notes the JavaScript's `parseQgsXml` gives on the settings a catalogue does not carry: of a field's form settings, the served catalogue carries only a Value Map's list, as `quac:values`, and a Value Relation, as `quac:value_relation`, so the notes would not describe what it leaves out.

It uses Python's standard library only, so it runs in QGIS Server's own Python and anywhere else. Each module under `quac_server/parse/`, `generate/`, `model/` and `util/` mirrors the JavaScript module of the same name in `packages/quac/src/`, with the function names in Python's form (`parseWmsPublishing` is `parse_wms_publishing`). Two modules have no counterpart: `parse/xml_text.py` gives the answers the browser's DOM gives the JavaScript, and `js_compat.py` gives JavaScript's own answers for numbers and text. A port builds on them to keep the JavaScript's quirks. A layer's id and name, for example, come from the first `<id>` and `<layername>` anywhere inside its `<maplayer>`, as `querySelector` finds them, and a list property's values keep their spaces.

## How it is kept in agreement with the JavaScript

- `tests/test_parity.py` fails when a module in `packages/quac/src/parse/` or `generate/` has no Python module of the same name, or a function it exports has no Python function of the same name, and `port-exemptions.json` gives no reason. It also fails on an exemption that is no longer needed.
- `tests/test_catalogues.py` compares the catalogue with the one the JavaScript saved beside each whole-project fixture as `<name>.server.catalogue.json`, cut down to the declared fields, the `.qgz` included.
- `tests/test_first_tier.py` does the same for every QGIS project among the per-field examples in `packages/quac/spec/examples/`, against `packages/quac/src/tests/firstTierServer.catalogues.json`.
- `tests/test_fixtures.py` compares the layer tree with each fixture's `<name>.server.layers.json`.
- `tests/test_data_assets.py` compares each layer's data asset in the project file's catalogue with the one in each fixture's `<name>.catalogue.json`, and its `quac:` fields with each QGIS example's `expected.json`.
- `tests/test_catalogue_agreement.py` compares every Catalog and Collection `quac:` field and the whole of each Collection's `table:columns` in the project file's catalogue with each fixture's `<name>.catalogue.json`, and with each QGIS example's `expected.json`, listing any field it does not compare as a departure. The fixture `form-settings` holds the form settings the examples show one at a time, and their other forms.
- `tests/test_project_settings.py` does the same for the project's and each layer's settings, such as `quac:related_to`, `quac:filters` and `quac:icon`, and a style's `quac:categorised_field`.
- `tests/test_parse_measurement.py`, `test_qt_date_format.py`, `test_qt_regex.py`, `test_qgis_expression.py` and `test_sql_feature_filter.py` give each expression module's answers for the inputs in `packages/quac/src/tests/answers/<module>.json`, and compare them with the JavaScript's, which `packages/quac/src/tests/expressionAnswers.test.ts` saved there.
- `tests/test_split_catalogue.py` splits each fixture's `<name>.catalogue.json`, and the made-up catalogue in `packages/quac/src/tests/fixtures/split/`, and compares the documents with the ones the JavaScript saved beside it as `<name>.split.json`.

Where a Python function does what its JavaScript counterpart does in a different way, `port-exemptions.json` says so under `departures`, with the reason. A change to the JavaScript under `parse/` or `generate/` that moves a saved catalogue needs the same change here. Adding a field to the first release means its Python, its entry in `declared_fields.json`, and its first-tier example.

## The demo

[`demo/value-labels/`](demo/value-labels/) shows what `quac:values` and `quac:value_relation` give a web map that reads a layer over WFS: QGIS Server's WFS gives a Value Map or Value Relation field's stored values and its GetFeatureInfo their labels, and the catalogue lets the WFS client show the labels too. The QGIS Server workflow runs it.

## Running it

```bash
npm run test:server
```

```bash
python3 packages/quac-qgis-server/build_plugin.py dist
```

```bash
cd packages/quac-qgis-server && python3 -m quac_server ../quac/spec/examples/server-wms-crs/project.qgs https://qgis.example.com/ows
```

```bash
cd packages/quac-qgis-server && python3 -m quac_server --tree ../quac/src/tests/fixtures/qgis/server-groups/groups.qgs
```

The first runs the tests, the Desktop part's included; CI runs them in the `Test` job of `ci.yml`, which `main` requires. The second prints one project's catalogue, and the third its layer tree.

## Inside QGIS Server

`.github/workflows/qgis-server.yml` runs QGIS Server, in the official `qgis/qgis-server` image, on `main` and on each pull request that changes this folder, the fixtures, the examples or the JavaScript it mirrors. `tests/server/quac_spike_harness/` is a QGIS Server plugin used only by that job: it answers `SERVICE=QUACSPIKE&REQUEST=GetLayerTree` with the tree of the project QGIS Server has open, read from its stored text. `tests/server/check_qgis_server.py` lays out the projects and the plugins, asks the server, and compares the harness's answers with the JavaScript's and with QGIS Server's own GetProjectSettings, WFS GetCapabilities and DescribeFeatureType. `tests/server/check_catalogue.py` then checks the catalogue plugin on the same server:

- each served catalogue equals the one `quac_server` builds from the same text with the field types GetProjectSettings reports;
- each passes the leak checks in `tests/leaks.py`, which `tests/test_leaks.py` also runs on every fixture without a server;
- the cache serves a copy only where it may, and builds an edited project again;
- an address holding a password is refused with the failure message alone;
- a newer project's warning reaches the log.

`tests/server/quac_test_access/` is an access-control plugin used only by the job. While a request carries `TESTUSER`, it gives QGIS Server a cache key and refuses what `rules.py` lists for that test person. `check_catalogue.py` compares each person's catalogue with the one their answers give, and with GetProjectSettings for the same person. The run's summary holds both reports.

Reading the job's report:

- The report is printed in the job's log, before QGIS Server's own log, as well as written to the run's summary.
- QGIS's log may say "Permission denied" or "Read-only file system" for a data file a project names, because the job mounts the files read-only. In the runs of 2026-11-06 those layers still opened: the report counted none it could not open. Trust that count, not the warning.
- On QGIS 3.44.15 the step that stores a project in PostgreSQL printed that it had stored it, and GitHub still marked the step failed (2026-11-06). The cause was not found. The step now logs the script's exit code, and the PostgreSQL route is checked whatever that step reports.

## How fast it answers

Measured on 2026-11-07 by the QGIS Server workflow, before QUAC moved to this repository, in milliseconds:

| Layers | QGIS Server | Built for the request | Built with an access key, median of 3 | From the plugin's cache, median of 5 | GetProjectSettings, already answered once, median of 5 |
|---|---|---|---|---|---|
| 50 | 3.44.15 | 29.5 | 27.8 | 11.1 | 11.0 |
| 50 | 4.2.3 | 40.2 | 37.6 | 11.5 | 11.4 |
| 200 | 3.44.15 | 103.5 | 111.6 | 11.1 | 21.1 |
| 200 | 4.2.3 | 154.3 | 151.4 | 11.5 | 21.6 |
| 1000 | 3.44.15 | 705.2 | 659.0 | 12.0 | 87.3 |
| 1000 | 4.2.3 | 910.2 | 840.8 | 14.3 | 94.3 |

What the figures are:

- The projects are generated by `check_qgis_server.py`: point layers in groups of ten, each with 30 fields, all reading one small GeoJSON file.
- Each figure is the time for one `GetCatalogue` request, timed by the job's own client on the same machine as the server, so it holds no network distance.
- QGIS Server already had each project open from the job's earlier checks. "Built for the request" is the plugin's first request for that project, which builds the catalogue and keeps it. "Built with an access key" is a request that an access-control plugin gives a key, which builds the catalogue every time.
- The last column is QGIS Server's own GetProjectSettings for the same project, after its first answer, from the reading-route report in the same run.
- The machines are GitHub's shared ones, and the same job varies between runs: in a run earlier the same day, a catalogue built for 1000 layers took 467.1 on 4.2.3 and 927.4 on 3.44.15. Read the figures as a size, not as the speed of a client's server.

To measure again, run the "QGIS Server" workflow on `main` from the repository's Actions tab, or with the command below. Each server's job summary ends with "Cost of a catalogue request, by project size", and the reading-route report above it has the GetProjectSettings figures. Replace the table and its date together, and link the run.

```bash
gh workflow run qgis-server.yml --ref main
```

## Licence

Copyright 2026 Vectoria Pty Ltd. This folder is free software: you can redistribute it and modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 2 of the License or (at your option) any later version. It is distributed without any warranty; see [`LICENSE`](LICENSE). The installed plugin carries the same text in `quac/LICENSE`.
