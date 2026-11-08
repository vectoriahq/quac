# QUAC for QGIS Server

The QUAC catalogue plugin for QGIS Server, and the Python it is built on (`docs/plans/quac-separation.md`, package 6).

## The plugin

`quac_catalogue/` is the plugin. On a QGIS Server with it installed, `SERVICE=QUAC&REQUEST=GetCatalogue&MAP=<project>` answers the open project's catalogue as one STAC document with its Collections inlined. An installed copy holds `quac_server` inside its folder; the CI job copies it in.

- It reads the project's stored text and builds the catalogue with `quac_server`, taking from QGIS what the text does not hold: each field's type and each layer's WGS84 box (`qgis_inputs.py`). The links name the address QGIS Server's own `QgsServerProjectUtils.wmsServiceUrl` gives.
- It keeps one copy per project, server address and modification time while QGIS's access controls allow a shared copy, which is while no access-control plugin gives a cache key (`QgsAccessControl.fillCacheKey`), and builds each answer afresh otherwise. The `X-QUAC-Cache` header says `hit`, `miss` or `off`.
- On any error it answers "The catalogue could not be built for this project. The server's log has the details." and writes the cause to QGIS Server's log, under the tag `QUAC`. A server address holding a password, in the address or in its `MAP`, is refused this way, with a hint to give the project an advertised WMS address or name its database through a pg_service file. So a project stored in PostgreSQL is served when `MAP` names it by service (`postgresql:///?service=…&schema=…&project=…`), not when `MAP` carries its user name and password.
- A project saved by a newer major version of QGIS than the server runs is served, with a warning in the log naming both versions: QGIS Server 3.44 does not read the server settings a QGIS 4 project saves, so the catalogue, which follows the project as saved, can list layers and services differently from what the server publishes.

- With an access-control plugin installed, such as Castlegate (`docs/plans/qgis-server-access-control.md`), each person gets the catalogue QGIS's combined access answers allow them (`access.py`):
  - A layer they may not read is left out, and so is a group left with no layer they may read.
  - A field they may not see is left out.
  - Each edit they may not make is locked in `quac:locks`.

  QGIS answers nothing finer than that per layer. So which fields a person sees but may not change, changing details but not moving shapes, and which features they may edit are not in the catalogue. The access plugin refuses such a save.

`quac_catalogue/catalogue.py` and `quac_catalogue/access.py` need no QGIS module, so `tests/test_catalogue.py` and `tests/test_access.py` check the answer, the cache, the warning and each person's catalogue anywhere.

## The Python

`quac_server` takes a QGIS project's stored text (a `.qgs`, a `.qgz`, or the zip QGIS keeps in a database) and the server's address, and returns the catalogue QGIS Server serves for it: the same catalogue as the JavaScript's `generateServerStacCatalogue` (`packages/quac/src/generate/serverStacCatalogue.ts`), holding only the fields the plugin declares. `quac_server/declared_fields.json` is that list, the plugin's first release, by the place each field sits. It also returns the layer tree QGIS Server publishes, as the JavaScript's `serverLayerTree` does.

It uses Python's standard library only, so it runs in QGIS Server's own Python and anywhere else. Each module under `quac_server/parse/`, `generate/`, `model/` and `util/` mirrors the JavaScript module of the same name in `packages/quac/src/`, with the function names in Python's form (`parseWmsPublishing` is `parse_wms_publishing`). Two modules have no counterpart: `parse/xml_text.py` gives the answers the browser's DOM gives the JavaScript, and `js_compat.py` gives JavaScript's own answers for numbers and text. A port builds on them to keep the JavaScript's quirks. A layer's id and name, for example, come from the first `<id>` and `<layername>` anywhere inside its `<maplayer>`, as `querySelector` finds them, and a list property's values keep their spaces.

## How it is kept in agreement with the JavaScript

- `tests/test_parity.py` fails when a module in `packages/quac/src/parse/` or `generate/` has no Python module of the same name, or a function it exports has no Python function of the same name, and `port-exemptions.json` gives no reason. It also fails on an exemption that is no longer needed.
- `tests/test_catalogues.py` compares the catalogue with the one the JavaScript saved beside each whole-project fixture as `<name>.server.catalogue.json`, cut down to the declared fields, the `.qgz` included.
- `tests/test_first_tier.py` does the same for every QGIS project among the per-field examples in `packages/quac/spec/examples/`, against `packages/quac/src/tests/firstTierServer.catalogues.json`.
- `tests/test_fixtures.py` compares the layer tree with each fixture's `<name>.server.layers.json`.

Where a Python function does what its JavaScript counterpart does in a different way, `port-exemptions.json` says so under `departures`, with the reason. A change to the JavaScript under `parse/` or `generate/` that moves a saved catalogue needs the same change here. Adding a field to the first release means its Python, its entry in `declared_fields.json`, and its first-tier example.

## Running it

```bash
npm run test:quac-server
```

```bash
cd packages/quac-qgis-server && python3 -m quac_server ../quac/spec/examples/server-wms-crs/project.qgs https://qgis.example.com/ows
```

```bash
cd packages/quac-qgis-server && python3 -m quac_server --tree ../quac/src/tests/fixtures/qgis/server-groups/groups.qgs
```

The first runs the tests; CI runs them in the `Test` job of `ci.yml`, which `main` requires. The second prints one project's catalogue, and the third its layer tree.

## Inside QGIS Server

A cloud session cannot run QGIS Server, so `.github/workflows/quac-qgis-server.yml` does, in the official `qgis/qgis-server` image, on each push of a branch that changes this folder, the fixtures, the examples or the JavaScript it mirrors. `tests/server/quac_spike_harness/` is a QGIS Server plugin used only by that job: it answers `SERVICE=QUACSPIKE&REQUEST=GetLayerTree` with the tree of the project QGIS Server has open, read from its stored text. `tests/server/check_qgis_server.py` lays out the projects and the plugins, asks the server, and compares the harness's answers with the JavaScript's and with QGIS Server's own GetProjectSettings, WFS GetCapabilities and DescribeFeatureType. `tests/server/check_catalogue.py` then checks the catalogue plugin on the same server:

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

Measured on 2026-11-07 in [run 42419303174](https://github.com/vectoriahq/groundwork/actions/runs/42419303174), on `main` at commit `6f17482ec`, in milliseconds:

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
- The machines are GitHub's shared ones, and the same job varies between runs: in [run 42353522114](https://github.com/vectoriahq/groundwork/actions/runs/42353522114), earlier the same day, a catalogue built for 1000 layers took 467.1 on 4.2.3 and 927.4 on 3.44.15. Read the figures as a size, not as the speed of a client's server.

To measure again, run the "QUAC QGIS Server" workflow on `main` from the repository's Actions tab, or with the command below. Each server's job summary ends with "Cost of a catalogue request, by project size", and the reading-route report above it has the GetProjectSettings figures. Replace the table, its date and its run link together.

```bash
gh workflow run quac-qgis-server.yml --ref main
```
