# QUAC field reference

QUAC (Quite Useful Additions for Catalogs) is a profile of [STAC](https://stacspec.org) 1.1.0 for describing the layers of a map: where each layer's data comes from, how its fields are filled in and checked, how it is drawn, and how its layers relate. This page is for a developer reading a QUAC catalogue. For each field it says what the field means, when it is present, which kinds of source write it, how settled it is, and gives an example.

QUAC is pre-1.0, and any field may change before 1.0. The schema is [`../src/schema/quac.schema.json`](../src/schema/quac.schema.json), a JSON Schema (draft-07) whose `$id` is `https://vectoriahq.github.io/quac/v0.1.0/schema.json`. [`../src/schema/examples/every-field.json`](../src/schema/examples/every-field.json) is a catalogue that carries every field once; the examples on this page are taken from it unless an entry says otherwise. [`examples/`](examples/README.md) holds, field by field, a source holding the one setting that writes the field and the catalogue it gives.

## The document

**A source is a Catalog.** A layer is a Collection, and a group of layers is a Catalog nested inside its parent. There are no Items: a layer's features are fetched as a whole, not catalogued one by one.

**Children are inlined.** A Catalog carries its child Collections in a `collections` array and its child Catalogs in a `catalogs` array, so one document holds the whole tree. It may also carry `rel: "child"` links to where each child would sit as a separate document. A reader takes the inlined children and does not follow the `child` links of a child it already holds.

**A catalogue says it follows QUAC** by listing the schema's address, `https://vectoriahq.github.io/quac/v0.1.0/schema.json`, in `stac_extensions`: always on the top-level Catalog, and on each nested Catalog or Collection that carries a `quac:` field of its own, whether on itself, in its summaries or on one of its assets, links or columns. That is how STAC lists an extension on each object that uses its fields, and it lets a reader learn which version of QUAC a document follows.

**An absent field means the source said nothing.** Every QUAC field is optional and written only where the source declares it, so a missing field is never a "no". Where an absent field has a reading, such as "editable" or "full opacity", the field's entry gives it. An application can therefore read one QUAC field and ignore the rest.

**QUAC uses STAC's own fields and extensions where one fits**, and adds a field only where none does. A layer's fields are `table:columns` from the [Table extension](https://github.com/stac-extensions/table); its GeoJSON geometry types are `vector:geometry_types` from the [Vector extension](https://github.com/stac-extensions/vector); its WMS, WMTS, XYZ and PMTiles addresses are links from the [Web Map Links extension](https://github.com/stac-extensions/web-map-links) v1.3.0; a data file's size is `file:size` from the [File extension](https://github.com/stac-extensions/file).

**Every field QUAC adds has the `quac:` prefix.** A field from a STAC extension keeps that extension's prefix, and QUAC adds no field without one. This follows STAC's suggestion of a prefix for each vendor's fields ([Prefixes](https://github.com/radiantearth/stac-spec/blob/v1.1.0/extensions/README.md#prefixes), STAC 1.1.0). A field holding a detail that only one kind of source has starts with that kind's name, such as `quac:wfs_endpoint` or `quac:arcgis_layer_url`.

### A layer's data, and the ways to reach it

A layer's data is **the asset carrying the `data` role**, whatever its key. A Collection may also offer rendering links: `rel: "wms"`, `rel: "wmts"`, `rel: "xyz"` and `rel: "pmtiles"`. A Collection can offer more than one of these, and the reading application chooses which to use: features from the data asset where it wants to select or edit them, or images or tiles from a link where it only draws the layer.

A tile template must hold `{z}`, `{x}` and `{y}` to be an `xyz` link. A template addressed by Bing's `{quadkey}` is therefore written as the data asset's href instead. An `xyz` link to vector tiles states `type: "application/vnd.mapbox-vector-tile"`, which stretches the extension: Web Map Links v1.3.0 describes an XYZ link's `type` as the image type the tiles come in (`stac-extensions/web-map-links` README at `v1.3.0`, read 2026-11-05).

An asset or link href that is relative is a URI reference against the document's `self` link, escaped per path segment, so a file named `Building #3.geojson` is `./Building%20%233.geojson`.

### Styles

**A Collection's styles are the assets carrying the `style` role.** An asset's `title` is the style's name and its `type` says what kind of style document sits behind the href. **The default style is the one asset that also carries the `default` role.** A Collection that marks none falls back to the first style listed, which depends on key order and is unsafe for a style whose name looks like a whole number, so a producer always marks one.

**A style kept inside a QGIS project is addressed by a fragment into the project document**, `./project.qgs#<layer-id>/<style-name>`, with type `application/x-qgis-qml+xml`. The document path and both halves of the fragment are percent-encoded, so the first `#` always starts the fragment. A producer that does not know where the project file sits leaves the document half off, giving `#<layer-id>/<style-name>`, which only a reader already holding the project can resolve. A style in a file of its own, such as a `.qml` or `.sld` beside the data, is an ordinary relative href.

### Collection ids

A Collection's id is its stable handle within its source: the same layer keeps the same id across loads, and the id is never slugified or escaped. It is unique within its source only, so an application holding several sources identifies a layer by the source and the id together.

| Source | Collection id |
|---|---|
| QGIS project | the QGIS layer id |
| QGIS Server | the layer's WMS name, as GetProjectSettings lists it |
| WFS service | the feature type name |
| OGC API Features | the id the service gives the collection |
| STAC | the id the source published |
| ArcGIS | the Web Map's layer id, or `{itemId}_{layerIndex}` for a layer of a Feature Service item, or `{serviceUrl}_{layerIndex}` for a layer of a FeatureServer that names no item |
| A folder of data files | the data file's path inside the folder |
| A single data file | the file's path as given, or for a file at a web address the file name taken from the address, lower-cased |

A group Catalog's id is slugified from its name, because a group has no id of its own.

A field that names another Collection, such as `quac:related_to`, `quac:value_relation` or `quac:active_collection`, names it by this id, never by an id of the source's own.

## Producers and maturity

**Each field names the kinds of source that write it**, so a reader knows where to expect it:

- **QGIS project**: a `.qgs` file, or the `.qgs` inside a `.qgz`.
- **QGIS Server**: a GetProjectSettings response, with the server's WFS capabilities where they are given.
- **WFS**: a WFS service's capabilities.
- **OGC API Features**: a service's collections. This producer writes no `quac:` field.
- **ArcGIS**: an ArcGIS Online Web Map or Feature Service item, or a FeatureServer.
- **STAC**: a catalogue fetched from somewhere else, which keeps every field the source declared.
- **A folder of data files**, with no project file, and **a single data file**.
- **Hand-written**: a field no producer writes, which a catalogue's author writes by hand.

In this first stage the WFS, ArcGIS and OGC API Features producers take an application's parsed form of the service's description, not the service's own document. The QGIS project and QGIS Server producers take the documents themselves.

**A producer states which fields it writes**, and is measured against its own list, not against every field this page defines.

**Each field is stable or experimental.** A field is **experimental** where its meaning depends on a single application, and **stable** where it restates a setting a source declares that other applications already act on, such as QGIS, QField, Mergin Maps or an ArcGIS client. Vectoria set this reading on 2026-11-05: only one application read QUAC then, so a field read by only one application would otherwise make every field experimental. Some stable fields are marked **name under review**: their names and value shapes will be reviewed before QUAC 1.0.

## On a top-level Catalog

### `quac:active_collection`

The id of the Collection whose layer the source opens as the active layer. Written from **Initial active layer** on the QField tab of a QGIS project's Project Properties, which the QFieldSync plugin adds and saves as `<properties><qfieldsync><initialActiveLayer>`, a layer id. QFieldSync writes the key on every OK but blank until an author picks a layer, so a saved id is a choice. The id is that of the Collection made from the layer: the first sibling's, for a layer QGIS split by shape. Present only where the Catalog holds that Collection.

Written by: QGIS project. Stable. Example: `"trees"`.

### `quac:initial_view`

The area the source's author saved the map showing, as a WGS84 box `[west, south, east, north]`. It is separate from the Catalog's `extent`, which says what the data covers: this is where the author chose to look.

From a QGIS project, the canvas extent `<mapcanvas><extent>`, which is in the canvas's own CRS (`<mapcanvas><destinationsrs>`, else the project CRS) and is converted to WGS84, held to ±180 longitude and to the latitudes Web Mercator can show. From an ArcGIS Web Map, `initialState.viewpoint.targetGeometry`, converted from the `EPSG:` code its spatial reference gives. Absent where the source saved no view, saved one with no CRS or a CRS that cannot be converted, or saved a viewpoint with no box, such as a scale alone.

Written by: QGIS project, ArcGIS (Web Map). Stable, name under review. Example: `[144.9, -37.9, 145.0, -37.8]`.

### `quac:wfs_endpoint`, `quac:wfs_version` and `quac:wfs_output_formats`

On a Catalog made from a WFS service: the service's address with no query, the WFS version it answered in, and the formats it can send features in.

Written by: WFS. Stable. Examples: `"https://example.com/wfs"`, `"2.0.0"`, `["application/gml+xml; version=3.2", "application/json"]`.

### `quac:arcgis_item_id`

The id of the ArcGIS Online Web Map or Feature Service item the catalogue was made from. Absent for a FeatureServer that reports no item.

Written by: ArcGIS. Stable. Example: `"0123456789abcdef0123456789abcdef"`.

## On a group Catalog

### `quac:mutually_exclusive`

The group shows only one of its children at a time: a QGIS mutually exclusive group. Written only as `true`, from a layer-tree group's `mutually-exclusive="1"` in a project or `mutuallyExclusive="1"` in GetProjectSettings.

Written by: QGIS project, QGIS Server. Stable. Example: `true`.

### `quac:visibility_checked`

Whether the group opens switched on.

Written by: hand-written only. Experimental. Example: `true`.

## On a Collection

### Shared layer defaults

These restate settings most layer sources have, and every producer that has the setting writes the same field.

#### `quac:display_field`

The field whose value names each feature. From a QGIS layer's Display Name where it names a single field, QGIS Server's display field, or an ArcGIS service layer's `displayField` where it matches a declared field. Absent, blank or not a declared field: absent.

Written by: QGIS project, QGIS Server, ArcGIS. Stable, name under review. Example: `"species"`.

#### `quac:visibility_checked`

Whether the layer opens switched on. Absent means it opens on. From the tick beside a QGIS layer, from QGIS Server, or from an ArcGIS Web Map layer's visibility; a Feature Service item's layers declare none.

Written by: QGIS project, QGIS Server, ArcGIS (Web Map). Stable, name under review. Example: `true`.

#### `quac:editable`

Whether the source lets the layer's features be edited. Absent means they can be. From a QGIS layer's **Read-only** setting, reversed. QGIS Server writes it only as `false`, on a layer it publishes over WMS and not for WFS. A QGIS project's layer read from an ArcGIS FeatureServer is written `false`.

Written by: QGIS project, QGIS Server. Stable, name under review. Example: `true`.

#### `quac:identifiable`

Whether the layer's features can be identified, as QGIS's identify tool and WMS GetFeatureInfo do, and so whether the layer can be the active layer. Absent means they can be. From a QGIS layer's **Identifiable** flag, or QGIS Server's `queryable` attribute. WMS calls the same thing `queryable`. Some desktop GIS, such as MapInfo, have a related setting called selectable, which decides whether a layer's features can be selected on the map; selecting is not the same as identifying.

Written by: QGIS project, QGIS Server. Stable, name under review. Example: `true`.

#### `quac:min_scale` and `quac:max_scale`

The most zoomed-out and the most zoomed-in scale the layer shows at, as denominators: `25000` is 1:25,000. Absent means no limit on that side.

A QGIS project writes them only where the layer has scale-dependent visibility switched on (`hasScaleBasedVisibilityFlag`), since QGIS saves both attributes on every layer either way. QGIS Server publishes the same limits as WMS `MinScaleDenominator` and `MaxScaleDenominator`, named from the other end: `MinScaleDenominator` is the most zoomed-in scale, so it becomes `quac:max_scale`. An ArcGIS layer takes its service's own range, narrowed by any limit its Web Map sets, since Esri's [`FeatureLayer.minScale`](https://developers.arcgis.com/javascript/latest/references/core/layers/FeatureLayer/) and `maxScale` should stay within the service's; a `0` from either is no limit.

Written by: QGIS project, QGIS Server, ArcGIS. Stable, name under review. Examples: `50000` and `500`.

#### `quac:opacity`

The opacity the layer is drawn at, from 0 to 1. Absent or `0` means full opacity, so a layer never opens invisible with nothing saying why. From QGIS's `<layerOpacity>` on every layer a project or QGIS Server describes, and an ArcGIS Web Map layer's `opacity`. Absent where the source has no author's setting, such as a Feature Service item.

Written by: QGIS project, QGIS Server, ArcGIS (Web Map). Stable, name under review. Example: `0.8`.

#### `quac:geometry_type`, in `summaries`

The layer's geometry type as QGIS names its kind of geometry, in a one-item array: `Point`, `Line` or `Polygon`, with a multi-part type counting as its single-part kind. From a QGIS layer's geometry, QGIS Server's WKB type name (so `MultiPolygonZ` is `Polygon`), or an ArcGIS layer's geometry type. A type with no equivalent, such as a geometry collection or an ArcGIS envelope, gives none. Beside it, `vector:geometry_types` lists the GeoJSON types of the layer's features.

Written by: QGIS project, QGIS Server, ArcGIS. Stable. Example: `["Point"]`.

### Where a layer's data comes from

#### `quac:wfs_endpoint` and `quac:wfs_type_name`

The layer is read from a WFS service: the service's address with no query, and the feature type name as the service publishes it. A reader takes them as they stand instead of taking a GetFeature URL apart. Present for a QGIS project's WFS layer, a QGIS Server layer whose WFS type the capabilities confirm, a WFS service's layer, and a fetched STAC Collection whose GetFeature data asset gives both where the source declared neither.

Written by: QGIS project, QGIS Server, WFS, STAC. Stable. Examples: `"https://example.com/wfs"` and `"ns:parks"`.

#### `quac:wfs_srs_name`

The coordinate reference system a QGIS project pins for a WFS layer.

Written by: QGIS project. Stable. Example: `"EPSG:7855"`.

#### `quac:wfs_default_srs`, `quac:wfs_supported_srs` and `quac:wfs_operations`

What a WFS service's capabilities declare for the feature type: its default CRS, every CRS it lists, and which of `Query`, `Insert`, `Update` and `Delete` it supports.

Written by: WFS. Stable. Examples: `"urn:ogc:def:crs:EPSG::7855"`, `["urn:ogc:def:crs:EPSG::7855", "urn:ogc:def:crs:EPSG::4326"]`, `{"Query": true, "Insert": true, "Update": true, "Delete": false}`.

#### `quac:qgis_server_wms_name` and `quac:qgis_server_wfs_type_name`

The names QGIS Server gives the layer, so an application reading QGIS Server beside the catalogue can match its layers to the Collections. Unlike `quac:wfs_type_name`, they do not say the layer is read from WFS.

- **`quac:qgis_server_wms_name`** is the layer's WMS name, which QGIS Server lists as its `<Name>`. From a project it is worked out as QGIS Server does (`QgsWmsLayerInfos::buildWmsLayerInfos`, `qgswmslayerinfos.cpp`, `qgis/QGIS@master`, read 2026-11-03): the layer id where the project ticks **Use layer ids as names**, else the layer's **Short name**, else its name. Absent for a layer the project leaves out of WMS.
- **`quac:qgis_server_wfs_type_name`** is the WFS type name, for a layer the project publishes for WFS. From a project it is the short name or else the name, with each space made `_` and each `:` and em dash made `-` (`QgsMapLayerServerProperties::wfsTypeName`). From QGIS Server it is the type name the WFS capabilities confirm.

A file the project splits into a layer per shape gets neither, because QGIS Server names each of those layers separately. Two layers with the same name or short name get the same name here; QGIS's own server check reports that as an error (`QgsProjectServerValidator`).

Written by: QGIS project, QGIS Server. Stable. Example: `"trees"` for both.

#### `quac:arcgis_layer_url`, `quac:arcgis_where` and `quac:arcgis_not_shown`

A layer read from ArcGIS:

- **`quac:arcgis_layer_url`** is the address of the layer, `…/FeatureServer/{index}`, or from a QGIS project's ArcGIS layer a MapServer layer's, `…/MapServer/{index}`. Absent on a layer that `quac:arcgis_not_shown` marks.
- **`quac:arcgis_where`** is the filter on the layer, in ArcGIS's SQL: the one an ArcGIS Web Map sets, or a QGIS layer's Provider Feature Filter, which QGIS sends to the service as the query's `where`.
- **`quac:arcgis_not_shown`** says why the layer cannot be read as features: `not-queryable`, `not-a-feature-layer` or `layer-unavailable`. The Collection is still written, with no data asset, so the layer can be listed with its reason.

A QGIS project writes the first two for a layer read through QGIS's `arcgisfeatureserver` provider, with `quac:editable: false`. A source needing a sign-in or a header, or limited to a box, gets neither.

Written by: ArcGIS; the first two also by QGIS project. `quac:arcgis_not_shown` is experimental, because its values are an application's reasons for not loading a layer, not ArcGIS's; the others are stable. Examples: `"https://services.arcgis.com/example/arcgis/rest/services/Species/FeatureServer/0"`, `"status = 'native'"`, `"not-a-feature-layer"`.

### Relations between layers

#### `quac:related_to`

The relations this Collection is the child side of: an array, because one set of records can hang off more than one parent. Each entry is an object:

| Key | Meaning |
|---|---|
| `id` | the relation's id within this catalogue |
| `name` | the relation's display name; absent when the source declares none |
| `parent_collection_id` | the id of the Collection holding the parent records |
| `fields` | the field pairs joining the two, in source order: an array of `{ parent, child }`, where several pairs make one composite key |

`parent` and `child` rather than QGIS's `referenced` and `referencing`, because the field does not belong to one kind of source. The relation is written on the child rather than kept as a list for the whole catalogue, so it travels with the Collection. A Collection carrying it is a set of records reached through a parent feature; whether it is also a map layer is decided by `quac:private`. A related Collection can itself be a parent, so a chain has no fixed depth.

From a QGIS project's **Relations**.

Written by: QGIS project. Stable. Example: `[{"id": "tree_inspections", "name": "Inspections", "parent_collection_id": "trees", "fields": [{"parent": "tree_id", "child": "tree_id"}]}]`.

#### `quac:private`

The source keeps the Collection off its map and legend, such as a table that only feeds a list. Written only as `true`, from a QGIS layer's **Private** flag (`<flags><Private>1</Private></flags>`; `QgsMapLayer::writeCommonStyle`, `src/core/qgsmaplayer.cpp`, `qgis/QGIS@master`, read 2026-10-24). It takes a Collection off the map and changes nothing about its data.

Written by: QGIS project. Stable. Example: `true`.

### Editing and forms

#### `quac:locks`

The edits the source locks, as `{ add?, attributes?, geometry?, delete? }`. Each member is `true`, locked for every feature, or `{ expression }`, locked for a feature while the QGIS expression is true for it. A member is written only for an edit that is locked, and the field only where one is, so a Collection without it locks nothing. `add` is decided before a new feature has values, so an expression on it locks every new feature. The field narrows what `quac:editable` allows and never widens it.

A QGIS project fills it from two settings, and either can lock an edit; `true` from either wins over an expression from the other.

- **Project Properties → QGIS Server → WFS capabilities**, for a layer ticked **Published** only: an unticked **Insert** locks `add`, **Update** both `attributes` and `geometry`, which a WFS-T update changes together, and **Delete** `delete`. QGIS saves the ticks as lists of layer ids, `<properties><WFSLayers>` and `<WFSTLayers><Insert>`, `<Update>` and `<Delete>`. A layer the project does not publish locks nothing.
- **The QFieldSync plugin's Permissions**, on the QField tab of Layer Properties: **Disable feature addition**, **Disable attribute editing**, **Disable geometry editing** and **Disable feature deletion**, each a box with a data-defined button. QFieldSync saves each as the layer custom properties `QFieldSync/is_<edit>_locked`, `QFieldSync/is_<edit>_locked_expression_active` and `QFieldSync/<edit>_locked_expression`. Where the button is active and its expression is not blank, the expression is written as QFieldSync saved it; otherwise the box decides. A layer saved by QFieldSync before 4.15 holds the one lock `QFieldSync/is_geometry_locked`, read as `add`, `geometry` and `delete`.

A layer QGIS split by shape takes its first sibling's locks.

Written by: QGIS project. Stable. Example: `{"add": {"expression": "\"status\" = 'surveyed'"}, "delete": true}`.

#### `quac:filters`

The filters the source sets up for the layer, in its order: a list of `{ field, name? }`, where `name` is shown in place of the field's own and is left out where the source gives none. A reader keeps the first entry on a field.

From the filters the Mergin Maps plugin saves on the **Mergin Maps** tab of a QGIS project's Project Properties, the project entries `Mergin/Filtering/Enabled` and `Mergin/Filtering/Filters`. They are read only while `Enabled` is true, as the Mergin Maps app reads them. Filters of the types `Number`, `Date`, `Checkbox`, `Single select` and `Multi select` are read; a `Text` filter is not. A filter lacking a layer, a field or an SQL template is left out, and the template itself is not read. A filter goes onto the Collection made from its layer, the first sibling's for a layer QGIS split by shape; one whose layer is not in the project, or lacks its field, goes nowhere.

Written by: QGIS project. Stable. Example: `[{"field": "status", "name": "Condition"}, {"field": "species"}]`.

#### `quac:measurement`

The units the source gives `$area`, `$length` and `$perimeter` in: `{ area_unit, distance_unit }`, each the name QGIS saves. Absent means square metres and metres.

A QGIS project sets one area unit and one distance unit for all its layers (**Project Properties → General → Measurements**), so it is written on every layer's Collection: `<properties><Measurement><AreaUnits>` and `<DistanceUnits>` (`QgsProject::writeProject`, `src/core/project/qgsproject.cpp`, `qgis/QGIS@master`, read 2026-10-25), as `QgsUnitTypes::encodeUnit` names them (`src/core/qgsunittypes.cpp`, same revision). A project that saves neither writes no field, which reads as QGIS's default of `m2` and `meters` (`QgsProject::clear`); one that saves only one writes the other as that default. The project's ellipsoid is not carried.

Written by: QGIS project. Stable. Example: `{"area_unit": "ha", "distance_unit": "meters"}`.

#### `quac:form_order`

The names of the fields the source's form layout places, in the layout's order. A column not listed is left out of the form and carries `quac:in_form: false`. Absent, the form places every field.

From QGIS's **Drag and Drop Designer** (`<editorlayout>tablayout</editorlayout>` and the `<attributeEditorForm>` tree under it). QGIS saves the tree under every layer but builds the form from it only for `tablayout`, so under `generatedlayout` or `uifilelayout` the tree is not read; nor is a `tablayout` tree with no elements, where QGIS places every field itself (`QgsEditFormConfig::readXml` and `setFields`, `src/core/editform/qgseditformconfig.cpp`, `qgis/QGIS@master`, read 2026-10-24). Each `<attributeEditorField>` places the field it names; a field placed twice keeps its first place. Containers (tabs, group boxes and rows, nested to any depth) are walked through and contribute only their visibility expressions, in `quac:visible_when`. Relation, action, text, HTML, QML and spacer elements, titles, columns and label styles are not read.

Written by: QGIS project. Stable. Example: `["tree_id", "species", "status", "label", "heritage", "photo", "removal_reason"]`.

### How a layer is shown

#### `quac:legend_image`

An image the source shows in place of every entry of the layer's legend, as a `data:image/…;base64,` URL. From a QGIS layer's **Legend placeholder image** (*Layer Properties → Legend*, the `legendPlaceholderImage` attribute of `<maplayer>`), when QGIS embeds it in the project: **Embed File…** saves it as `base64:` and its contents, and the type is read from the bytes it opens with (PNG, JPEG, GIF, WebP or SVG). A placeholder naming a file or a web address writes nothing (`QgsDefaultVectorLayerLegend::createLayerTreeModelLegendNodes`, `src/core/qgsmaplayerlegend.cpp`, `qgis/QGIS@master`, read 2026-10-25). A Collection made from QGIS's per-shape layers takes its first layer's.

Written by: QGIS project. Stable. Example: `"data:image/png;base64,iVBORw0KGgo…"`, shortened here.

#### `quac:icon`

The `https://` address of an icon drawn before the layer's name. A reader takes the address as it stands. From a QGIS layer variable named `quac_icon`, set in **Layer Properties › Variables**, whose value is one of:

- an `https://` address, written as it stands;
- `prefix:name`, an icon named as Iconify names it, from one of the libraries below, such as `lucide:tree-pine`;
- a bare name, such as `tree`, read as a Tabler icon.

A name becomes the address of the icon's file in the library's npm package on jsDelivr, `https://cdn.jsdelivr.net/npm/<package>@<major>/…`, pinned to the major version below so that a new release adds icons but never renames one. Where the file sits within the package follows that package's own layout. A name is lower-case letters and digits joined by single hyphens. A value of any other form, or naming any other library, writes nothing. QGIS's own layer list shows no such icon. A Collection made from QGIS's per-shape layers takes its first layer's.

| Prefix | Library | npm package | Major version |
|---|---|---|---|
| `tabler`, or none | Tabler Icons | `@tabler/icons` | 3 |
| `lucide` | Lucide | `lucide-static` | 1 |
| `heroicons` | Heroicons | `heroicons` | 2 |
| `ph` | Phosphor | `@phosphor-icons/core` | 2 |
| `bi` | Bootstrap Icons | `bootstrap-icons` | 1 |
| `material-symbols` | Material Symbols | `@material-symbols/svg-400` | 0 |
| `maki` | Maki | `@mapbox/maki` | 8 |
| `temaki` | Temaki | `@rapideditor/temaki` | 5 |

Written by: QGIS project. Experimental: the variable is QUAC's own. Example: `"https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/building-monument.svg"`, from the column entry, since the example file has none on a Collection.

#### `quac:light_style` and `quac:dark_style`

For a Collection drawn from style documents of type `application/vnd.mapbox.style+json`: the style drawn in a light theme and in a dark theme, each by its asset's `title`. Where the Collection names none, or names one it does not offer, the default style is drawn.

Written by: hand-written only. Experimental. Examples: `"Bright"`, `"Dark"`.

#### `quac:cross_origin`

For a Collection drawn from tiles: `true` to request the tiles with cross-origin access, so an exported map image can include them. A server that sends no cross-origin headers then draws nothing. Absent, the tiles are requested without it.

Written by: hand-written only. Experimental. Example: `true`.

#### `quac:max_zoom`

For a Collection drawn from tiles: the deepest tile level requested, as a whole number; past it, the last level's tiles are enlarged. Absent, there is no limit. From a QGIS XYZ layer's `zmax`.

Written by: QGIS project, hand-written. Stable. Example: `19`.

## On a link

### `quac:wms_crs` and `quac:wms_version`

On a `rel: "wms"` link: the CRS and WMS version the images are requested in, which Web Map Links does not define. From a QGIS WMS layer. A QGIS Server layer's WMS link gets `EPSG:3857` where the server offers that CRS, and otherwise the first CRS it offers, and no version. The server offers the CRSs the project's **CRS restrictions** list, or where it restricts none, the project's own CRS, `EPSG:4326` and `EPSG:3857`. An absent version is for the reader to negotiate with the service.

Written by: QGIS project, QGIS Server (`quac:wms_crs` only). Stable. Examples: `"EPSG:3857"` and `"1.3.0"`.

### `quac:wmts_tile_matrix_set` and `quac:wmts_style`

On a `rel: "wmts"` link: the tile matrix set and the style identifier the tiles are requested in, which Web Map Links does not define. From a QGIS WMTS layer. The style is absent where QGIS uses the default, and a link without a tile matrix set takes the layer's first.

Written by: QGIS project. Stable. Examples: `"GoogleMapsCompatible"` and `"default"`.

## On an asset

### `quac:categorised_field`

On a style asset: the field a QGIS **Categorized** style colours features by, QGIS's `<renderer-v2 attr>`. Written only for a renderer of type `categorizedSymbol`, so a reader can learn which field a style splits by without fetching and converting the style. Absent means the source said nothing, not that the style is uncategorised: a style file beside the data and a catalogue from somewhere else both leave it out.

Written by: QGIS project. Stable. Example: `"park_type"`.

### `quac:style_overrides`

On a style asset of type `application/vnd.mapbox.style+json`: overrides to merge into the style document before it is drawn, in order. Each entry is the address of a JSON document or the document itself. An override has the shape of the style document and holds only the values that differ. It merges as JSON Merge Patch ([RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)), except that `layers` merges by each layer's `id`: an override layer is merged into the style layer with the same `id`, and one whose `id` the style lacks is ignored. A layer is hidden by setting `layout.visibility` to `"none"`. An override names layers by `id`, so it belongs to the style it was written for.

Written by: hand-written only. Experimental. Example: `["basemap-overrides/openfreemap-bright.streets-cleanup.json"]`.

### `quac:geometry_filter`

On a data asset: the shapes of feature in the asset's file that belong to the Collection, as a list of `Point`, `LineString` and `Polygon`. A multi-part geometry counts as its single-part shape, and a feature with no geometry or a geometry collection belongs to none. Absent, the whole file does.

From a QGIS file source's `|geometrytype=` option, which QGIS writes when it splits a file holding several shapes into a layer per shape, such as `./annotations.geojson|geometrytype=Point`. No field is written where `uniqueGeometryType=yes` turns the filter off, or the option names a geometry collection or `None`. Where a project's per-shape layers over one file are written as one Collection, the field lists each of their shapes, and is absent where they are all three. It filters; `quac:geometry_type` states a shape and filters nothing.

Written by: QGIS project. Stable. Example: `["Point"]`.

### `quac:feature_filter`

On a data asset: the filter that keeps some of the data's features, as `{ expression, dialect }`. `expression` is the filter as the source writes it, and `dialect` its language: `ogr_sql` for GDAL's OGR SQL `WHERE` clause, `qgis_expression` for a QGIS expression, `wfs_sql` for the `SELECT` statement a QGIS WFS layer can carry, or `ogc_filter` for OGC Filter XML. Absent, all of the data belongs to the Collection.

From a QGIS layer's **Provider Feature Filter** (Layer Properties › Source › Query Builder). QGIS's OGR provider writes it as `|subset=` at the end of the data source, and everything after that option is the filter, as `QgsOgrProviderMetadata::decodeUri` reads it. The Delimited Text provider writes it as the `subset` query item, a QGIS expression. A WFS layer carries it as the `filter` parameter, a QGIS expression or, where it is XML, an OGC Filter, or as a `SELECT` statement after `sql=`.

Written by: QGIS project. Stable. Example: `{"expression": "\"status\" = 'approved'", "dialect": "ogr_sql"}`.

### `quac:delimited_text`

On a data asset: how the asset's CSV file splits, where QGIS reads it with its Delimited Text provider: `{ delimiter, quote, escape, skip_lines, header, trim }`. `delimiter`, `quote` and `escape` are each a set of characters, any of which counts; `skip_lines` is the number of lines before the header or first row; `header` says whether the first row read holds the column names; `trim` says whether space around an unquoted cell is removed. A key left out takes QGIS's default: `,`, `"`, `"`, 0, true and false. Absent, the file is read as GDAL's CSV driver reads it with no options, which is how QGIS reads a CSV it opens with OGR.

From a `delimitedtext` provider's data source, such as `file:./types.csv?type=csv&delimiter=;`, as `QgsDelimitedTextFile::setFromUrl` reads it. A split on whitespace or a regular expression writes nothing.

Written by: QGIS project. Stable. Example: `{"delimiter": ";", "quote": "\"", "escape": "\"", "skip_lines": 0, "header": true, "trim": false}`.

### `quac:layer_name`

On a data asset that is a GeoPackage: the table the Collection reads, such as `sites`. Absent, a GeoPackage holding one table is read whole. From a QGIS file source's `|layername=` option, for a GeoPackage only, since QGIS writes the option for a single-layer GeoJSON file too; and for each table of a GeoPackage read with no project.

Written by: QGIS project, a single data file. Stable. Example: `"parks"`.

## On a `table:columns` entry

These describe one field of the layer, and what a form may do with it. Each is read from the layer's own settings in a QGIS project, never a saved alternate style's. The settings are independent of each other. QGIS Server's GetProjectSettings publishes none of them. QGIS sources for this section are `qgis/QGIS@master`, read 2026-10-22 to 2026-10-26 as each entry says.

### `quac:editable`

Written only as `false`: the field is shown but no one can change it. From a field's unticked **Editable** box (`<editable><field editable="0">`), or a **UUID Generator** widget.

Written by: QGIS project. Stable. Example: `false`.

### `quac:default`

A value the field is filled with: `{ kind, value?, format?, expression?, on_update }`.

| `kind` | Filled with | Other members |
|---|---|---|
| `now` | the moment of the create or save: a date for a date field, a UTC date and time for a field holding times | none |
| `uuid` | a new random identifier | `format`: `with_braces` (`{6f1e…}`), `without_braces` (`6f1e…`, with its hyphens) or `id128` (32 hex digits); omitted or unrecognised reads as `with_braces` |
| `fixed` | `value`: a string, a number, a boolean or `null` | `value`, without which the default is left out |
| `expression` | the value of `expression`, a QGIS expression over the record's other values | `expression`, without which the default is left out |

`on_update` set means every save that adds or changes the feature fills the field again, over whatever it held; unset, only a blank field of a new feature is filled, as its form opens.

From a field's default value expression and **Apply default value on update** (`<defaults><default expression applyOnUpdate>`). `now()`, `$now`, `to_date(now())` and `to_datetime(now())` become `now`. `uuid()` and `$uuid` become `uuid`, with `uuid()`'s `format` argument by position or by name, and a `version` other than 4 left out (`fcnUuid`, `src/core/expression/qgsexpressionfunction.cpp`). A lone literal becomes `fixed`, read as QGIS's lexer reads it (`src/core/qgsexpressionlexer.ll`): a single-quoted string with `''` or a backslash escaping a quote, a number, and `TRUE`, `FALSE` or `NULL` in any case. Another expression the producer can read becomes `expression`, as the project wrote it; one it cannot read is left out. The overwrite on update is QGIS's own rule (`QgsVectorLayer::updateDefaultValues`, `src/core/vector/qgsvectorlayer.cpp`). A **UUID Generator** widget (`<editWidget type="UuidGenerator">`) gives a `uuid` default with braces, applied on creation only, unless a default expression on the field fills it first (`QgsUuidWidgetWrapper`, `src/gui/editorwidgets/qgsuuidwidgetwrapper.cpp`).

Written by: QGIS project. Stable. Example: `{"kind": "uuid", "format": "with_braces", "on_update": false}`.

### `quac:constraints`

What a value is checked against before a save: `{ not_null?, unique?, expression? }`.

- `not_null` is `enforced` where a blank is refused and `warn` where it is saved with a warning.
- `unique` is `enforced` where a value another feature holds is refused and `warn` where it is saved with a warning; a blank is never a duplicate.
- `expression` is `{ expression, description?, strength }`: a QGIS expression that must be true for the record's values, the message the source gives for it, and `enforced` or `warn`. It is left out where the expression is blank or the strength is neither.

From the **Constraints** group of the Attributes Form (`<constraints><constraint field constraints notnull_strength unique_strength exp_strength>` and `<constraintExpressions><constraint field exp desc>`). Bits 1, 2 and 4 of the `constraints` mask are not null, unique and expression; each strength of 1, or absent, is `enforced`, 2 is `warn`, and 0 leaves the member out (`QgsVectorLayer::readSymbology`, `src/core/vector/qgsvectorlayer.cpp`, and `QgsFieldConstraints`, `src/core/qgsfieldconstraints.h`, read 2026-10-23). A **Range** widget with `AllowNull` off, or a **Date/Time** widget with `allow_null` off, writes `not_null` as `enforced`. Both keys default to true, so an untouched widget writes nothing.

Written by: QGIS project. Stable. Example: `{"not_null": "warn", "expression": {"expression": "\"height\" < 80", "description": "Taller than any tree in the city", "strength": "warn"}}`.

### `quac:hidden`

Written only as `true`: the source's form never shows the field. From a **Hidden** widget (`<editWidget type="Hidden">`). It is the form's widget, not QGIS Server's settings that hide a field from WMS or WFS.

Written by: QGIS project. Stable. Example: `true`.

### `quac:searchable`

Written only as `false`: a search of the layer's features skips the field. The field is still shown, filtered on and edited as before. From **Not searchable** in the **Configuration** column of the Fields tab (`<field configurationFlags>` holding `NotSearchable`, with any other flags joined by `|`). QGIS's search of the active layer's features skips such a field (`QgsActiveLayerFeaturesLocatorFilter`, `src/app/locator/qgsactivelayerfeatureslocatorfilter.cpp`, read 2026-11-11).

Written by: QGIS project. Stable. Example: `false`.

### `quac:reuse_last_value`

Written only as `true`: a new feature is offered the value last entered in the field. From **Reuse last entered value**, in either form QGIS reads: the newer `<reuseLastValuePolicy><field name reuseLastValuePolicy="AllowedDefaultOn">`, or the older `<reuseLastValue><field name reuseLastValue="1">`, the newer winning where both name a field (`QgsEditFormConfig::readXml`, `src/core/editform/qgseditformconfig.cpp`). `AllowedDefaultOff` is left out.

Written by: QGIS project. Stable. Example: `true`.

### `quac:duplicate_policy`

What the field does when a feature is duplicated: `default` takes the field's default value, and stays blank where there is none; `unset` clears it. Absent, the value is passed on to the duplicate. From the field's **Duplicate** setting (`<duplicatePolicies><policy field policy>`): `DefaultValue` as `default` and `UnsetField` as `unset` (`QgsVectorLayer::readSymbology`, read 2026-10-23).

Written by: QGIS project. Stable. Example: `"default"`.

### `quac:checkbox`

A **Checkbox** widget (`<editWidget type="CheckBox">`): `{ checked?, unchecked?, show_stored?, allow_null? }`. `checked` and `unchecked` are the values a text field holds for ticked and unticked, from `CheckedState` and `UncheckedState`, each left out where the widget sets none; a boolean field ignores both. `show_stored` is written only as `true`, from `TextDisplayMethod` 1. `allow_null` is written only as `true`, from `AllowNullState`, where a blank is a third state. Written for every Checkbox widget, so `{}` is a plain checkbox (`QgsCheckboxConfigDlg`, `src/gui/editorwidgets/qgscheckboxconfigdlg.cpp`).

Written by: QGIS project. Stable. Example: `{"checked": "Y", "unchecked": "N", "show_stored": true, "allow_null": true}`.

### `quac:range`

A number's limits and format: `{ min?, max?, step?, precision?, suffix? }`, each written only where the source sets it. `step` is the spin box's step, `precision` a whole number of decimal places and `suffix` the text after the number. From a **Range** widget (`<editWidget type="Range">`), whose `Style` is not read, or an ArcGIS range domain on a numeric column, which writes `min` and `max`.

Written by: QGIS project, ArcGIS. Stable. Example: `{"min": 0, "max": 80, "step": 0.5, "precision": 1, "suffix": " m"}`.

### `quac:date_format`

The QGIS date pattern a text field stores its dates in, as a **Date/Time** widget's `field_format` writes it. Written only where it is not ISO 8601: left out where `field_iso_format` is on or the format is `yyyy-MM-dd`. A date or date-time column ignores it.

Written by: QGIS project. Stable. Example: `"dd/MM/yyyy"`.

### `quac:color`

Written only as `true`: the field holds a colour. From a **Color** widget (`<editWidget type="Color">`), which has no settings of its own (`QgsColorWidgetFactory::configWidget`, `src/gui/editorwidgets/qgscolorwidgetfactory.cpp`, read 2026-10-25). QGIS reads the stored text with Qt's `QColor`, so a `#rrggbb` value opens in QGIS's colour button.

Written by: QGIS project. Stable. Example: `true`.

### `quac:visible_when`

The QGIS expressions that decide whether the form shows the field, outermost container first, each as QGIS wrote it. The field shows while all are true. Written only for a field inside a Drag and Drop Designer container whose `visibilityExpressionEnabled` is non-zero and whose expression is not blank, as `QgsAttributeEditorContainer::loadConfiguration` reads them. An expression is kept whether or not a reader can evaluate it.

Written by: QGIS project. Stable. Example: `["\"status\" <> 'Healthy'", "\"heritage\" IS NULL"]`.

### `quac:in_form`

Written only as `false`: the source's form layout does not place the field. Present on every column a Drag and Drop Designer layout leaves out, beside the Collection's `quac:form_order`.

Written by: QGIS project. Stable. Example: `false`.

### `quac:editable_when`

One QGIS expression: the form locks the field while it is false. From a placed field's active data-defined **Editable** property (the **Data defined override** button beside **Editable**, `<dataDefinedFieldProperties><field name><Option … name="dataDefinedEditable">`): `type` 3 is its `expression`, `type` 2 its `field` as the field in double quotes, and `type` 1 its `val` as `true`, or `false` for empty, `0` or `false` (`QgsPropertyCollection::toVariant` and `QgsProperty::toVariant`, read 2026-10-25). QGIS registers it only for a field of the form (`QgsAttributeForm`, `src/gui/qgsattributeform.cpp`), so a field the layout does not place has none. `quac:editable: false` locks the field whatever this says.

Written by: QGIS project. Stable. Example: `"\"last_inspected\" IS NULL"`.

### `quac:icon`

The `https://` address of an icon drawn beside the field's name. From a layer variable named `quac_icon_` followed by the field's name, held in the layer's `variableNames` and `variableValues` custom properties (`QgsExpressionContextUtils::setLayerVariable`, `src/core/expression/qgsexpressioncontextutils.cpp`), including the form from before QGIS 3.20 (`src/core/qgsobjectcustomproperties.cpp`, read 2026-10-25). The value becomes an address as the Collection's `quac:icon` does. QGIS's own form shows no icon.

Written by: QGIS project. Experimental: the variable is QUAC's own. Example: `"https://cdn.jsdelivr.net/npm/@tabler/icons@3/icons/outline/building-monument.svg"`.

### `quac:control`

How the edit form draws the field's list of choices: `buttons` or `dropdown`. From a layer variable named `quac_control_` followed by the field's name, held in the same lists as `quac:icon`'s, compared without regard to case or surrounding spaces; any other value writes nothing. QGIS's own form has no such setting: a Value Map is always a combo box (`src/ui/editorwidgets/qgsvaluemapconfigdlgbase.ui`, read 2026-10-26).

Written by: QGIS project. Experimental: the variable is QUAC's own. Example: `"buttons"`.

### `quac:value_relation`

The field's choices are the records of another Collection of the same catalogue: `{ collection, key, value, filter?, allow_null?, allow_multi?, order_by?, order_field?, descending? }`.

- `collection` is that Collection's id, so a reader needs nothing from the source to follow it; `key` is its field the column stores and `value` the field shown for it.
- `filter` is the QGIS expression narrowing the list, as the project wrote it.
- `allow_null` and `allow_multi` are written only as `true`: the list offers a blank choice, and the column stores several keys.
- `order_by` is `value` where the list is ordered by its shown value and `field` where it is ordered by another field, named in `order_field`; absent, the list is ordered by its key. `descending` is written only as `true`.

A column whose `key`, `value` or `collection` is blank is read as having no value relation.

From a **Value Relation** widget (`<editWidget type="ValueRelation">`). `Layer` and `LayerName` find the lookup: the layer whose id is `Layer`, and where none has it the first layer named `LayerName`, as QGIS finds it (`QgsVectorLayerRef::resolveByIdOrNameOnly`, called from `QgsValueRelationFieldFormatter::resolveLayer`, `src/core/fieldformatter/qgsvaluerelationfieldformatter.cpp`). A widget whose lookup is in no layer of the project writes nothing. `OrderByValue` wins over `OrderByField`, which wins over the key, as `createCache` sorts. `Group`, `DisplayGroupName`, `Description`, `NofColumns`, `UseCompleter` and `CompleterMatchFlags` are not read.

Written by: QGIS project. Stable. Example: `{"collection": "species", "key": "code", "value": "common_name", "filter": "\"in_use\" = 1", "allow_null": true, "order_by": "field", "order_field": "sort_order", "descending": true}`.

### `quac:attachment`

The column holds a path to a file rather than a value of its own: `{ viewer?, filter?, default_root?, relative_storage }`.

| Key | Meaning |
|---|---|
| `viewer` | how the file is meant to be shown: `image`, `web`, `audio` or `video`; absent where the source names none |
| `filter` | the file types the source offers, in the source's own wording |
| `default_root` | the folder the source declares the files live in |
| `relative_storage` | what a stored path is relative to: `absolute`, `project` or `default-root`. Always written. `absolute` names a path on the author's own machine |

From a QGIS **Attachment** widget, which QGIS registers as `ExternalResource`: its `DocumentViewer`, `FileWidgetFilter`, `DefaultRoot` and `RelativeStorage`. The widget's other keys are not read.

Written by: QGIS project. Stable. Example: `{"viewer": "image", "filter": "Images (*.jpg *.png)", "default_root": "photos", "relative_storage": "project"}`.
