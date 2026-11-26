"""
What the plugin's QGIS Desktop part writes when a project is saved, with no
QGIS module, so its tests run anywhere. `desktop.py` reads the inputs from
QGIS and writes the files.

`plan_publication` takes the saved project's file name and bytes, the field
types and WGS84 boxes QGIS gives (`qgis_inputs.field_types` and
`layer_extents`), the project file's folder, the chosen folder, each layer's
current style as QML, a way to read a file already in the chosen folder, and
a way to give the map canvas extent the project saves in WGS84
(`qgis_inputs.wgs84_box`), the catalogue's `quac:initial_view`, and a way to
read a data file's size and last change (`read_data_file`).
It returns a `Publication`: the files to write, each by its path relative to
the chosen folder, the files to remove, and what was left out and why.

The catalogue is the project file's (`generate_stac_catalogue`), with what
QGIS gives for each column (`with_field_type`) and the layer's primary key
(`primary_key_of`), and less the names QGIS Server would give a layer. It
is written as separate documents (`split_catalogue`): the root Catalog as
`<project>.stac.json` in the chosen folder, every other document under
`<project>.stac/`, and each layer's style as
`<project>.stac/styles/<the Collection's file name stem>.qml`, with the
`quac:categorised_field` that style has in the project file.

The folder rules:

- A file layer's data asset names its file by a path relative to the
  document, worked out from the project's folder and the chosen folder. A
  layer whose file is not in the chosen folder or below it is left out. The
  asset carries the file's size as `file:size`, from the File extension, and
  when it last changed as `updated`, which STAC's common metadata gives an
  asset as the date of its data.
- A layer read from a web address keeps it, unless the address holds a user
  name or password (`server_wms_endpoint` refuses it), and then it is left out.
  So does a WMS, WMTS or XYZ layer, whose address is written as a web map link,
  or for an XYZ template addressed by `{quadkey}` as its data asset. One whose
  source holds a user name, a password or an `authcfg`, and a WFS layer whose
  source does (`wfs_source_signs_in`), is left out the same way: the catalogue
  never names the source, and it carries no link for it.
- A layer whose data is not in a file or at a web address, such as one held in
  a database, is left out.
- A layer QGIS could not open is left out, unless it is a WMS, WMTS or XYZ
  layer. QGIS opens a WMS or WMTS layer by reading its server's capabilities,
  so it cannot open one whose server it could not reach at that moment; such
  a layer is written with its address all the same, without the extent and
  field types QGIS would have given, or left out where its source holds a
  user name, a password or an `authcfg`.
- A Value Relation reading its choices from a layer left out is not written,
  nor is a relation whose parent layer is left out, nor the initial active
  layer (`quac:active_collection`) where it is left out. A field's default,
  constraint, condition for showing it or condition for editing it whose
  expression names a layer not written, by its id or name in a text literal,
  is not written either.
- An Attachment widget's default folder (`default_root` in
  `quac:attachment`) that is not a path relative to the project, such as an
  absolute path or a drive, which `generate_stac_catalogue` leaves out, is
  named in a warning saying how to keep it.
- Each Collection's `via` link to the project file is written only where the
  project file is in the chosen folder or below it.
"""

from __future__ import annotations

import json
import os
import posixpath
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import unquote

from .quac_server.generate.normalized_project import build_stac_extent
from .quac_server.js_compat import url_search_params
from .quac_server.generate.server_stac_catalogue import _SOURCE_FIELDS, _hidden_fields_of, _mentions_any, primary_key_of, server_wms_endpoint, with_field_type
from .quac_server.generate.split_catalogue import _safe_name, split_catalogue
from .quac_server.generate.stac_catalogue import QUAC_CATEGORISED_FIELD, generate_stac_catalogue, is_project_relative_folder, wms_excluded_layer_ids
from .quac_server.model.qgs_project import BoundingBox, LayerEntry, MapExtent
from .quac_server.model.quac_extension import QUAC_SCHEMA_URL, declare_quac_extension
from .quac_server.model.stac_href import encode_asset_path
from .quac_server.model.stac_size_and_count import FILE_EXTENSION, FILE_SIZE_FIELD
from .quac_server.model.stac_styles import DEFAULT_STYLE_ROLE, style_asset_key
from .quac_server.model.stac_wms import WEB_MAP_LINKS_EXTENSION
from .quac_server.parse.geometry_siblings import find_geometry_siblings, sibling_collection_id
from .quac_server.parse.parse_data_source import wfs_source_signs_in
from .quac_server.parse.parse_qgs_xml import parse_qgs_xml
from .quac_server.parse.read_project_file import read_project_xml
from .quac_server.util.catalogue_file_formats import CATALOGUE_FILE_FORMATS, QML_STYLE_MEDIA_TYPE, declared_media_type_for_file

# Where the project keeps the settings (`QgsProject.writeEntry`): on or off, and the folder relative to the project file.
SETTINGS_SCOPE = 'quac'
WRITE_ON_SAVE_KEY = 'catalogue/write_on_save'
FOLDER_KEY = 'catalogue/folder'
# How the project publishes: `link`, the default, links each layer's data where it is and writes on save;
# `export` copies every layer's data into the chosen folder, in the formats `catalogue/formats` lists, when it is written.
MODE_KEY = 'catalogue/mode'
LINK = 'link'
EXPORT = 'export'
FORMATS_KEY = 'catalogue/formats'

# The folder under the documents' folder that holds the copies.
COPIES_FOLDER = 'data'

# The File extension's checksum of a file, as a multihash in hex.
FILE_CHECKSUM_FIELD = 'file:checksum'

# Why a layer is left out.
OUTSIDE_FOLDER = 'outside_folder'
NOT_A_FILE = 'not_a_file'
HOLDS_CREDENTIALS = 'holds_credentials'
NOT_OPENED = 'not_opened'
NOT_COPIED = 'not_copied'
COPY_FAILED = 'copy_failed'

_REASONS = {
    OUTSIDE_FOLDER: 'its data file is outside the chosen folder',
    NOT_A_FILE: 'its data is not in a file, such as a layer held in a database',
    HOLDS_CREDENTIALS: 'its web address holds a user name or password',
    NOT_OPENED: 'QGIS could not open its data',
    NOT_COPIED: 'its data was not copied',
    COPY_FAILED: 'QGIS could not copy its data',
}

_NEXT_STEPS = {
    OUTSIDE_FOLDER: "To include a layer, move its data file into the chosen folder, or choose a folder that holds it.",
    NOT_A_FILE: 'To include a layer held in a database, save its data as a file in the chosen folder.',
    HOLDS_CREDENTIALS: 'To include a web layer, give it an address without a user name or password.',
    NOT_OPENED: 'To include a layer QGIS could not open, fix its data source in QGIS and save again.',
    COPY_FAILED: 'The QUAC tab of the Log Messages panel says why each copy failed.',
}

# The kinds of source written as a web map link, which a reader contacts itself: written whether or not QGIS opened the layer.
_WEB_MAP_KINDS = ('wms', 'wmts', 'xyz')

# The title of the `via` link to the project file, as the JavaScript's `QGIS_PROJECT_LINK_TITLE` writes it.
QGIS_PROJECT_LINK_TITLE = 'QGIS project'

# The names QGIS Server would give a layer, which the served catalogue reads and this one does not carry.
_SERVER_FIELDS = ('quac:qgis_server_wms_name', 'quac:qgis_server_wfs_type_name')

# The extent a Collection takes where its source gives no box.
_WHOLE_WORLD = [-180, -90, 180, 90]

# Any version of the QUAC schema, so a catalogue an earlier version wrote is still recognised.
_QUAC_SCHEMA = re.compile(r'^https://vectoriahq\.github\.io/quac/v[^/]+/schema\.json\Z')

_DRIVE = re.compile(r'^[A-Za-z]:([\\/]|\Z)')
_SCHEME = re.compile(r'^[A-Za-z][A-Za-z0-9+.-]+:')
# A path that is not relative: from the root, a drive, a share or the home folder, or an address such as `file:`.
# A QGIS expression's double-quoted field names, skipped, and its text literals, whose text is the first group.
_EXPRESSION_TEXT = re.compile(r'"(?:""|[^"])*"|\'((?:\'\'|\\.|[^\'\\])*)\'', re.DOTALL)
# The column settings holding an expression, and how a warning names each.
_SETTING_NAMES = {
    'quac:default': 'default value',
    'quac:constraints': 'constraint',
    'quac:visible_when': 'condition for showing it',
    'quac:editable_when': 'condition for editing it',
}

# An address whose authority holds a user name or password.
_USERINFO = re.compile(r'^[A-Za-z][A-Za-z0-9+.-]*:[/\\\\]*[^/\\\\?#]*@')


@dataclass(frozen=True)
class LayerStyle:
    """A layer's current style: its name in QGIS's style manager and the QML QGIS writes for it."""

    name: str
    qml: bytes


@dataclass(frozen=True)
class LeftOutLayer:
    name: str
    reason: str


@dataclass(frozen=True)
class DroppedChoices:
    """A Value Relation not written because the layer it reads its choices from was left out."""

    layer: str
    field: str
    lookup: str


@dataclass(frozen=True)
class DroppedRelation:
    """A relation not written because its parent layer was left out: the layer holding it, the relation's name, and the parent's."""

    layer: str
    relation: str
    parent: str


@dataclass(frozen=True)
class DroppedSetting:
    """A field's setting not written because its expression names a layer left out: the layer holding it, the field, the setting's key and the layer it names."""

    layer: str
    field: str
    setting: str
    lookup: str


@dataclass(frozen=True)
class DroppedForHiddenField:
    """A relation or a field's choices not written because it uses a field QGIS Server excludes, which a copy leaves out: the layer holding it and what it is, such as `the relation Inspections`."""

    layer: str
    what: str


@dataclass(frozen=True)
class CopyRequest:
    """A layer whose data an export copies: its id and title, and the fields QGIS Server excludes, which the copy leaves out."""

    layer_id: str
    title: str
    hidden_fields: frozenset[str] = frozenset()


@dataclass(frozen=True)
class CopiedData:
    """
    A layer's data copied into the chosen folder: its path relative to the
    folder, joined by `/` (`copy_path`), its size in bytes, its checksum as a
    multihash in hex, and when its data last changed where that is known.
    """

    path: str
    size: int
    checksum: str
    updated: Optional[str] = None


@dataclass(frozen=True)
class DroppedFolder:
    """An Attachment widget's default folder not written because it is not a path relative to the project: the layer and the field."""

    layer: str
    field: str


@dataclass
class Publication:
    root_file_name: str
    children_folder: str
    # Each file's path relative to the chosen folder, joined by `/`, and its bytes, in the order to write them: the root last.
    files: list[tuple[str, bytes]] = field(default_factory=list)
    # Files the previous catalogue linked under `children_folder` that this one does not.
    removals: list[str] = field(default_factory=list)
    left_out: list[LeftOutLayer] = field(default_factory=list)
    dropped_choices: list[DroppedChoices] = field(default_factory=list)
    dropped_relations: list[DroppedRelation] = field(default_factory=list)
    dropped_settings: list[DroppedSetting] = field(default_factory=list)
    dropped_folders: list[DroppedFolder] = field(default_factory=list)
    dropped_for_hidden_fields: list[DroppedForHiddenField] = field(default_factory=list)
    # Whether this is an export, which copies every layer's data.
    exported: bool = False
    # The layers whose data the export copied, by title.
    copied: list[str] = field(default_factory=list)
    # Whether the project asks for GeoParquet and this QGIS cannot write it, so the vector layers were copied as FlatGeobuf (`desktop.py` sets it).
    geoparquet_fallback: bool = False
    # The layers an export copies: every vector layer QGIS opened, and every raster layer but a WMS, WMTS or XYZ one.
    to_copy: list[CopyRequest] = field(default_factory=list)
    # Layers whose style was not written because its QML names a folder on this computer.
    skipped_styles: list[str] = field(default_factory=list)
    # Why nothing is written, where nothing is.
    refusal: Optional[str] = None
    # How many layers the catalogue holds.
    layer_count: int = 0

    def warnings(self) -> list[str]:
        """A sentence for each thing left out, for the log."""
        sentences = [f'{layer.name} was left out: {_REASONS[layer.reason]}.' for layer in self.left_out]
        reasons = {layer.name: layer.reason for layer in self.left_out}
        for dropped in self.dropped_choices:
            reason = reasons.get(dropped.lookup, OUTSIDE_FOLDER)
            step = f"Move {dropped.lookup}'s data into the chosen folder to keep them." if reason == OUTSIDE_FOLDER else _NEXT_STEPS[reason]
            sentences.append(f'The choices for {dropped.layer}, field {dropped.field}, were left out, because they come from {dropped.lookup}, which was left out. {step}')
        for relation in self.dropped_relations:
            sentences.append(f'The relation {relation.relation} of {relation.layer} was left out, because its parent layer, {relation.parent}, was left out.')
        for dropped in self.dropped_settings:
            sentences.append(f'The {_SETTING_NAMES[dropped.setting]} of {dropped.layer}, field {dropped.field}, was left out, because it reads {dropped.lookup}, which was left out.')
        for dropped in self.dropped_for_hidden_fields:
            sentences.append(f'{_capitalised(dropped.what)} of {dropped.layer} was left out, because it uses a field QGIS Server excludes, which the copy leaves out.')
        for dropped in self.dropped_folders:
            sentences.append(
                f"The attachment folder of {dropped.layer}, field {dropped.field}, was not written, because it is a folder on this computer. "
                "To keep it, give the field's Attachment widget a default path relative to the project's folder."
            )
        sentences += [f"The style of {name} was not written, because it names a folder on this computer." for name in self.skipped_styles]
        return sentences


def catalogue_names(project_file_name: str) -> tuple[str, str]:
    """
    The root document's file name and the folder beside it holding every other
    document, from the project file's name: `Parks.qgz` gives
    `Parks.stac.json` and `Parks.stac`. A character no file name may hold on
    some system becomes `_`.
    """
    base = re.split(r'[\\/]', project_file_name)[-1]
    stem = _safe_name(re.sub(r'\.(qgs|qgz)\Z', '', base, flags=re.IGNORECASE))
    return f'{stem}.stac.json', f'{stem}.stac'


def chosen_folder(project_folder: str, setting: str, path: Any = os.path) -> str:
    """The chosen folder from the saved setting: empty is the project's folder, and a relative path is relative to it."""
    if not setting:
        return path.normpath(project_folder)
    return path.normpath(setting if path.isabs(setting) else path.join(project_folder, setting))


def folder_setting(project_folder: str, folder: str, path: Any = os.path) -> str:
    """
    The setting saved for a chosen folder: its path relative to the project's
    folder, joined by `/`, or empty for the project's folder itself. A folder
    on another drive, which has no relative path, is saved as it is.
    """
    if not folder:
        return ''
    try:
        relative = path.relpath(folder, project_folder)
    except ValueError:
        return path.normpath(folder)
    if relative == path.curdir:
        return ''
    return relative.replace(path.sep, '/')


def plan_publication(
    project_file_name: str,
    project_bytes: bytes,
    field_types: dict[str, dict[str, dict[str, str]]],
    layer_wgs84_extents: dict[str, BoundingBox],
    project_folder: str,
    folder: str,
    styles: dict[str, LayerStyle],
    read_existing: Callable[[str], Optional[bytes]],
    path: Any = os.path,
    opened_layer_ids: Optional[set[str]] = None,
    wgs84_box: Optional[Callable[[MapExtent], Optional[BoundingBox]]] = None,
    data_file: Optional[Callable[[str], Optional[DataFile]]] = None,
    copies: Optional[dict[str, list[CopiedData]]] = None,
    copy_failures: Optional[set[str]] = None,
) -> Publication:
    """
    What to write into `folder`, the chosen folder, for a saved project.

    `project_folder` and `folder` are absolute paths, both read with `path`,
    `os.path` by default (`ntpath` or `posixpath` in the tests). `styles` holds
    each layer's current style by layer id. `read_existing` gives the bytes of
    a file in the chosen folder by its path relative to it, joined by `/`, or
    None where there is none. `opened_layer_ids` holds the layers QGIS opened,
    its valid layers; a layer of the project not in it is left out, unless it
    is a WMS, WMTS or XYZ layer. None takes every layer as opened.
    `wgs84_box` gives the project's map canvas extent in WGS84, or None where
    it cannot; with none given, the catalogue has no initial view.
    `data_file` gives a data file's size and last change by its absolute path,
    or None where it cannot; with none given, a data asset carries neither.

    With `copies`, an export: every vector layer QGIS opened, and every
    raster layer other than a WMS, WMTS or XYZ layer, wherever its data is, is
    published from the copies of its data an export made under
    `<project>.stac/data/`, by layer id, the first in each list the layer's
    data and any others copies in other formats. Every such layer is named in
    `to_copy`; one with no copy is left out, for its copy failing where its
    id is in `copy_failures`. A copied layer is read-only, and the fields
    QGIS Server excludes are left out of it, with whatever uses them.

    Where the chosen folder already holds a root document of that name that is
    not a QUAC Catalog, nothing is written and `refusal` says why.
    """
    root_file_name, children_folder = catalogue_names(project_file_name)
    publication = Publication(root_file_name, children_folder)
    previous_root = read_existing(root_file_name)
    previous: Optional[dict[str, Any]] = None
    if previous_root is not None:
        previous = _json_object(previous_root)
        if previous is None or not _is_quac_catalog(previous):
            publication.refusal = (
                f'The STAC catalogue was not written: {root_file_name} in the chosen folder is not a QUAC catalogue, so it was left as it is. '
                'Rename or move that file, or choose another folder, and save again.'
            )
            return publication

    project = parse_qgs_xml(read_project_xml(project_file_name, project_bytes))
    initial_view = wgs84_box(project.map_extent) if wgs84_box is not None and project.map_extent is not None else None
    catalogue = generate_stac_catalogue(project, layer_wgs84_extents, initial_view)
    layers_by_id = {layer.id: layer for layer in project.layers}
    project_folder = path.normpath(project_folder)
    folder = path.normpath(folder)

    publication.exported = copies is not None

    left_out_ids: set[str] = set()
    copied_hidden: dict[str, set[str]] = {}
    copy_paths: set[str] = set()
    titles: dict[str, str] = {}
    for collection in _collections(catalogue):
        titles[collection['id']] = collection.get('title', collection['id'])
        layer = layers_by_id.get(collection['id'])
        web_map = layer is not None and (layer.data_source.kind in _WEB_MAP_KINDS or (layer.data_source.kind == 'unsupported' and _web_map_source_holds_credentials(layer.data_source.raw, layer.data_source.hint)))
        if opened_layer_ids is not None and collection['id'] not in opened_layer_ids and not web_map:
            reason: Optional[str] = NOT_OPENED
        else:
            reason = _place_data(layer, collection, project_folder, folder, path, data_file)
        if copies is not None and reason != NOT_OPENED and layer is not None and (layer.type == 'vector' or (layer.type == 'raster' and not web_map)):
            publication.to_copy.append(CopyRequest(collection['id'], titles[collection['id']], frozenset(_hidden_fields_of(layer))))
            copied = copies.get(collection['id'])
            if not copied:
                reason = COPY_FAILED if copy_failures and collection['id'] in copy_failures else NOT_COPIED
            else:
                _place_copy(collection, copied)
                copied_hidden[collection['id']] = _hidden_fields_of(layer)
                copy_paths.update(copy.path.lower() for copy in copied)
                publication.copied.append(titles[collection['id']])
                reason = None
        if reason is not None:
            left_out_ids.add(collection['id'])
            publication.left_out.append(LeftOutLayer(collection.get('title', collection['id']), reason))
    _leave_out(catalogue, left_out_ids)
    if catalogue.get('quac:active_collection') in left_out_ids:
        del catalogue['quac:active_collection']

    project_href = _inside(path.join(project_folder, project_file_name), folder, path)
    unwritten = _unwritten_layers(project, catalogue)
    for collection in _collections(catalogue):
        for key in _SERVER_FIELDS:
            collection.pop(key, None)
        title = collection.get('title', collection['id'])
        relations = collection.get('quac:related_to')
        if isinstance(relations, list):
            kept_relations = []
            for relation in relations:
                parent = relation.get('parent_collection_id') if isinstance(relation, dict) else None
                if parent in left_out_ids:
                    publication.dropped_relations.append(DroppedRelation(title, relation.get('name') or relation.get('id'), titles.get(parent, parent)))
                elif _relation_uses_hidden(relation, copied_hidden.get(collection['id'], set()), copied_hidden.get(parent, set())):
                    publication.dropped_for_hidden_fields.append(DroppedForHiddenField(title, f"the relation {relation.get('name') or relation.get('id')}"))
                else:
                    kept_relations.append(relation)
            if kept_relations:
                collection['quac:related_to'] = kept_relations
            else:
                del collection['quac:related_to']
        columns = collection.get('table:columns')
        if isinstance(columns, list):
            types = field_types.get(collection['id'], {})
            entry = layers_by_id.get(collection['id'])
            project_comments = entry.field_comments if entry is not None else {}
            hidden = copied_hidden.get(collection['id'], set())
            kept = []
            for column in columns:
                if column['name'] in hidden:
                    continue
                relation = column.get('quac:value_relation')
                if isinstance(relation, dict) and relation.get('collection') in left_out_ids:
                    column = {key: value for key, value in column.items() if key != 'quac:value_relation'}
                    publication.dropped_choices.append(DroppedChoices(title, column['name'], titles.get(relation['collection'], relation['collection'])))
                elif isinstance(relation, dict) and _choices_use_hidden(relation, hidden, copied_hidden.get(relation.get('collection'), set())):
                    column = {key: value for key, value in column.items() if key != 'quac:value_relation'}
                    publication.dropped_for_hidden_fields.append(DroppedForHiddenField(title, f"the choices for field {column['name']}"))
                column = _without_unwritten_lookups(column, unwritten, title, publication)
                _note_local_folder(column, layers_by_id.get(collection['id']), title, publication)
                kept.append(with_field_type(column, types.get(column['name']), project_comments))
            collection['table:columns'] = kept
            if str(collection.get('quac:display_field')) in hidden:
                collection.pop('quac:display_field', None)
            primary_key = primary_key_of(kept, types)
            if primary_key:
                collection['quac:primary_key'] = primary_key
        if project_href is not None:
            collection['links'] = [*collection['links'], {'rel': 'via', 'href': f'./{encode_asset_path(project_href)}', 'title': QGIS_PROJECT_LINK_TITLE}]
    publication.layer_count = sum(1 for _ in _collections(catalogue))
    _refit_extent(catalogue)
    _declare_quac_again(catalogue)

    documents = split_catalogue(catalogue, root_file_name, children_folder)
    style_folders = [path.normpath(project_folder), folder]
    style_names: set[str] = set()
    style_files: list[tuple[str, bytes]] = []
    for entry in documents:
        document = entry['document']
        style = styles.get(document.get('id')) if document.get('type') == 'Collection' else None
        if style is None:
            continue
        if _names_a_folder(style.qml, style_folders):
            publication.skipped_styles.append(document.get('title', document['id']))
            continue
        stem = posixpath.basename(entry['path'])[:-len('.json')]
        style_path = f'{children_folder}/styles/{_unclaimed(stem, ".qml", style_names)}'
        assets = document.setdefault('assets', {})
        asset: dict[str, Any] = {
            'href': encode_asset_path(posixpath.relpath(style_path, posixpath.dirname(entry['path']))),
            'type': QML_STYLE_MEDIA_TYPE,
            'title': style.name,
            'roles': ['style', DEFAULT_STYLE_ROLE],
        }
        categorised_field = _categorised_field(layers_by_id.get(document['id']), style.name)
        if categorised_field:
            asset[QUAC_CATEGORISED_FIELD] = categorised_field
        assets[style_asset_key(assets, style.name)] = asset
        style_files.append((style_path, style.qml))

    publication.files = [*style_files, *((entry['path'], _encode(entry['document'])) for entry in documents[1:]), (documents[0]['path'], _encode(documents[0]['document']))]
    if previous is not None:
        written = {name.lower() for name, _data in publication.files} | copy_paths
        linked = _previously_linked(root_file_name, previous, children_folder, read_existing)
        publication.removals = sorted(name for name in linked if name.lower() not in written)
    return publication


def emptied_folders(removals: list[str], children_folder: str) -> list[str]:
    """The folders under `children_folder` that held a removed file, deepest first: the ones to remove where they are left empty."""
    folders: set[str] = set()
    for name in removals:
        parent = posixpath.dirname(name)
        while parent.startswith(f'{children_folder}/'):
            folders.add(parent)
            parent = posixpath.dirname(parent)
    return sorted(folders, key=lambda name: (-name.count('/'), name))


def message(publication: Publication) -> tuple[str, str]:
    """
    The message bar's one entry for a publication, `('info', text)` or
    `('warning', text)`: what was written, each layer left out and why, and
    what to do next.
    """
    if publication.refusal:
        return 'warning', publication.refusal
    sentences = [f"{'Exported' if publication.exported else 'Wrote'} the STAC catalogue {publication.root_file_name}."]
    if publication.copied:
        count = len(publication.copied)
        sentences.append(f"Copied the data of {'one layer' if count == 1 else f'{count} layers'}.")
    if not (publication.left_out or publication.dropped_choices or publication.dropped_relations or publication.dropped_settings or publication.dropped_folders or publication.dropped_for_hidden_fields or publication.skipped_styles or publication.geoparquet_fallback):
        return 'info', ' '.join(sentences)
    if publication.geoparquet_fallback:
        sentences.append("The vector layers were copied as FlatGeobuf, because this version of QGIS can't write GeoParquet.")
    if publication.left_out:
        count = len(publication.left_out)
        listed = ', '.join(f'{layer.name} ({_REASONS[layer.reason]})' for layer in publication.left_out)
        sentences.append(f"{'One layer was' if count == 1 else f'{count} layers were'} left out: {listed}.")
    if publication.dropped_choices:
        listed = ', '.join(f'{dropped.layer} ({dropped.field}, from {dropped.lookup})' for dropped in publication.dropped_choices)
        sentences.append(f'Choices that come from a layer left out were left out too: {listed}.')
    if publication.dropped_relations:
        listed = ', '.join(f'{relation.layer} ({relation.relation}, to {relation.parent})' for relation in publication.dropped_relations)
        sentences.append(f'Relations to a layer left out were left out too: {listed}.')
    if publication.dropped_settings:
        listed = ', '.join(f'{dropped.layer} ({dropped.field}, its {_SETTING_NAMES[dropped.setting]}, from {dropped.lookup})' for dropped in publication.dropped_settings)
        sentences.append(f'Field settings that read a layer left out were left out too: {listed}.')
    if publication.dropped_folders:
        listed = ', '.join(f'{dropped.layer} ({dropped.field})' for dropped in publication.dropped_folders)
        sentences.append(
            f"Attachment folders on this computer were not written: {listed}. "
            "To keep one, give the field's Attachment widget a default path relative to the project's folder."
        )
    if publication.dropped_for_hidden_fields:
        listed = ', '.join(f'{dropped.layer} ({dropped.what})' for dropped in publication.dropped_for_hidden_fields)
        sentences.append(f'Relations and choices that use a field QGIS Server excludes, which a copy leaves out, were left out too: {listed}.')
    if publication.skipped_styles:
        sentences.append(f"The style of {', '.join(publication.skipped_styles)} was not written, because it names a folder on this computer.")
    sentences += [_NEXT_STEPS[reason] for reason in (NOT_OPENED, COPY_FAILED, OUTSIDE_FOLDER, NOT_A_FILE, HOLDS_CREDENTIALS) if any(layer.reason == reason for layer in publication.left_out)]
    return 'warning', ' '.join(sentences)


def _unwritten_layers(project: Any, catalogue: dict[str, Any]) -> dict[str, str]:
    """
    The ids and names of the project's layers the catalogue does not write, a
    layer it leaves out of WMS among them, each with the layer's name. A
    geometry sibling is written where the Collection standing for its set is.
    """
    written = {collection['id'] for collection in _collections(catalogue)}
    excluded = wms_excluded_layer_ids(project)
    siblings = find_geometry_siblings(project)
    unwritten: dict[str, str] = {}
    for layer in project.layers:
        if layer.id in excluded or sibling_collection_id(siblings, layer.id) not in written:
            unwritten[layer.id] = layer.name
            if layer.name:
                unwritten[layer.name] = layer.name
    return unwritten


def _named_layer(expression: Any, unwritten: dict[str, str]) -> Optional[str]:
    """The name of the first layer not written that a text literal of the expression names by its id or name, as a lookup such as `aggregate` names a layer."""
    if not isinstance(expression, str):
        return None
    for match in _EXPRESSION_TEXT.finditer(expression):
        text = match.group(1)
        if text is None:
            continue
        text = re.sub(r'\\(.)', r'\1', text.replace("''", "'"), flags=re.DOTALL)
        for candidate in (text, text.strip()):
            if candidate in unwritten:
                return unwritten[candidate]
    return None


def _without_unwritten_lookups(column: dict[str, Any], unwritten: dict[str, str], title: str, publication: Publication) -> dict[str, Any]:
    """
    The column less each expression in `quac:default`, `quac:constraints`,
    `quac:visible_when` and `quac:editable_when` that names a layer not
    written: a constraint expression is taken out of `quac:constraints`, and a
    condition out of `quac:visible_when`, the field going where nothing is left.
    """
    if not unwritten:
        return column
    column = dict(column)

    def drop(setting: str, lookup: str) -> None:
        publication.dropped_settings.append(DroppedSetting(title, column['name'], setting, lookup))

    default = column.get('quac:default')
    lookup = _named_layer(default.get('expression'), unwritten) if isinstance(default, dict) else None
    if lookup is not None:
        del column['quac:default']
        drop('quac:default', lookup)
    constraints = column.get('quac:constraints')
    expression = constraints.get('expression') if isinstance(constraints, dict) else None
    lookup = _named_layer(expression.get('expression'), unwritten) if isinstance(expression, dict) else None
    if lookup is not None:
        kept = {key: value for key, value in constraints.items() if key != 'expression'}
        if kept:
            column['quac:constraints'] = kept
        else:
            del column['quac:constraints']
        drop('quac:constraints', lookup)
    conditions = column.get('quac:visible_when')
    if isinstance(conditions, list):
        kept_conditions = []
        for condition in conditions:
            lookup = _named_layer(condition, unwritten)
            if lookup is None:
                kept_conditions.append(condition)
            else:
                drop('quac:visible_when', lookup)
        if kept_conditions:
            column['quac:visible_when'] = kept_conditions
        else:
            del column['quac:visible_when']
    lookup = _named_layer(column.get('quac:editable_when'), unwritten)
    if lookup is not None:
        del column['quac:editable_when']
        drop('quac:editable_when', lookup)
    return column


def _note_local_folder(column: dict[str, Any], layer: Optional[LayerEntry], title: str, publication: Publication) -> None:
    """Notes an Attachment widget whose default folder the catalogue leaves out, as `generate_stac_catalogue` does one not relative to the project, so the message bar says how to keep it."""
    attachment = layer.field_attachments.get(column['name']) if layer is not None else None
    root = attachment.default_root if attachment is not None else None
    if root and not is_project_relative_folder(root):
        publication.dropped_folders.append(DroppedFolder(title, column['name']))


def _categorised_field(layer: Optional[LayerEntry], style_name: str) -> Optional[str]:
    """The field the layer's style of this name classifies by in the project file, where it is a categorised or graduated one."""
    if layer is None:
        return None
    return next((style.categorised_field for style in layer.styles if style.name == style_name), None)


def _place_data(layer: Optional[LayerEntry], collection: dict[str, Any], project_folder: str, folder: str, path: Any, data_file: Optional[Callable[[str], Optional[DataFile]]]) -> Optional[str]:
    """
    Rewrites a Collection's data asset for the chosen folder, or returns why
    the layer is left out. A file's href becomes its path from the chosen
    folder, which `split_catalogue` then writes from each document, and the
    asset takes the file's size and last change where `data_file` gives them.
    """
    if layer is None:
        return NOT_A_FILE
    source = layer.data_source
    data = (collection.get('assets') or {}).get('data')
    if source.kind in _WEB_MAP_KINDS:
        return None if source.url and server_wms_endpoint(source.url) else HOLDS_CREDENTIALS
    if source.kind == 'unsupported' and _web_map_source_holds_credentials(source.raw, source.hint):
        return HOLDS_CREDENTIALS
    if source.kind == 'unsupported' and (source.hint or '').lower() == 'wfs' and wfs_source_signs_in(source.raw):
        return HOLDS_CREDENTIALS
    if data is None:
        return NOT_A_FILE
    if source.kind in ('wfs', 'arcgis') or source.url is not None:
        return None if source.url and server_wms_endpoint(source.url) else HOLDS_CREDENTIALS
    written = source.rel_path or ''
    if not _DRIVE.match(written) and (_SCHEME.match(written) or written.lower().startswith('/vsi')):
        # An address the parser did not take as an online file: one holding a user name or password, or a GDAL virtual path.
        return HOLDS_CREDENTIALS if '@' in written else NOT_A_FILE
    if _DRIVE.match(written) and path.sep != '\\':
        # A Windows path, read on a system with no drives.
        return OUTSIDE_FOLDER
    target = path.normpath(path.join(project_folder, written))
    relative = _inside(target, folder, path)
    if relative is None:
        return OUTSIDE_FOLDER
    data['href'] = f'./{encode_asset_path(relative)}'
    facts = data_file(target) if data_file is not None else None
    if facts is not None:
        # A size of nothing is not written, as `readDataAssetFileSize` reads none.
        if facts.size > 0:
            data[FILE_SIZE_FIELD] = facts.size
            extensions = collection.setdefault('stac_extensions', [])
            if FILE_EXTENSION not in extensions:
                extensions.append(FILE_EXTENSION)
        data['updated'] = facts.updated
    return None


# PMTiles, per Portolan's media-type registry, as `PMTILES_MEDIA_TYPE` in the JavaScript's `stacPmtiles.ts` names it.
PMTILES_MEDIA_TYPE = 'application/vnd.pmtiles'


def tile_layer_name(layer_id: str) -> str:
    """The name of the one tile layer in a layer's PMTiles copy: its layer id, with a character no file name may hold as `_`."""
    return _safe_name(layer_id)


def copy_path(children_folder: str, layer_id: str, extension: str) -> str:
    """Where a layer's copied data goes, relative to the chosen folder: `<project>.stac/data/<layer id>.<extension>`."""
    return f'{children_folder}/{COPIES_FOLDER}/{_safe_name(layer_id)}.{extension}'


def _place_copy(collection: dict[str, Any], copied: list[CopiedData]) -> None:
    """
    Points a Collection's data asset, keyed `data`, at the first copy of its
    data, and adds each other copy as an asset keyed by its format's id, such
    as `flatgeobuf`, by its path from the chosen folder as `_place_data` writes
    a file's. A PMTiles copy is registered as Portolan does, by a
    `rel: "pmtiles"` link (web-map-links v1.3.0) naming its tile layer, and an
    asset keyed `pmtiles` with the `visual` role, which gives its size and
    checksum. Makes the layer read-only, since an edit to a copy is lost at the
    next export, and leaves out the fields that name where the layer's own
    data comes from, as the copy is the data.
    """
    assets = {key: value for key, value in (collection.get('assets') or {}).items() if key != 'data'}
    data_copies = [copy for copy in copied if not copy.path.lower().endswith('.pmtiles')]
    for copy in copied:
        href = f'./{encode_asset_path(copy.path)}'
        tiles = copy.path.lower().endswith('.pmtiles')
        asset: dict[str, Any] = {'href': href, 'type': PMTILES_MEDIA_TYPE if tiles else declared_media_type_for_file(copy.path, 'data'), 'roles': ['visual' if tiles else 'data']}
        if copy.size > 0:
            asset[FILE_SIZE_FIELD] = copy.size
        asset[FILE_CHECKSUM_FIELD] = copy.checksum
        if copy.updated:
            asset['updated'] = copy.updated
        if tiles:
            assets['pmtiles'] = asset
            collection['links'] = [*collection.get('links', []), {'rel': 'pmtiles', 'href': href, 'type': PMTILES_MEDIA_TYPE, 'pmtiles:layers': [tile_layer_name(collection['id'])]}]
        elif copy is data_copies[0]:
            assets = {'data': asset, **assets}
        else:
            assets[_format_id(copy.path)] = asset
    collection['assets'] = assets
    for key in _SOURCE_FIELDS:
        collection.pop(key, None)
    collection['quac:editable'] = False
    extensions = collection.setdefault('stac_extensions', [])
    for extension in (FILE_EXTENSION, WEB_MAP_LINKS_EXTENSION) if any(copy.path.lower().endswith('.pmtiles') for copy in copied) else (FILE_EXTENSION,):
        if extension not in extensions:
            extensions.append(extension)


def _format_id(file_path: str) -> str:
    """The id of a data file's format by its extension, such as `flatgeobuf` for a `.fgb`."""
    extension = file_path.rsplit('.', 1)[-1].lower()
    return next((str(format_['id']) for format_ in CATALOGUE_FILE_FORMATS if extension in format_['extensions']), extension)


def _relation_uses_hidden(relation: Any, child_hidden: set[str], parent_hidden: set[str]) -> bool:
    """Whether a relation pairs a field QGIS Server excludes from a copied layer, its own or its parent's."""
    if not isinstance(relation, dict):
        return False
    return any(
        isinstance(pair, dict) and (pair.get('child') in child_hidden or pair.get('parent') in parent_hidden)
        for pair in relation.get('fields') or []
    )


def _choices_use_hidden(relation: dict[str, Any], hidden: set[str], lookup_hidden: set[str]) -> bool:
    """Whether a Value Relation uses a field a copy leaves out: the lookup's key, value or order field, or in its filter, a field of either layer."""
    return (
        any(name is not None and name in lookup_hidden for name in (relation.get('key'), relation.get('value'), relation.get('order_field')))
        or _mentions_any(relation.get('filter'), lookup_hidden)
        or _mentions_any(relation.get('filter'), hidden)
    )


def _capitalised(text: str) -> str:
    return text[:1].upper() + text[1:]


@dataclass(frozen=True)
class DataFile:
    """A data file's size in bytes, and when it last changed as an RFC 3339 time in UTC, such as `2026-11-25T03:04:05Z`."""

    size: int
    updated: str


def read_data_file(file_path: str) -> Optional[DataFile]:
    """The size and last change the file system gives a file, or None where it cannot be read."""
    try:
        status = os.stat(file_path)
    except OSError:
        return None
    return DataFile(status.st_size, datetime.fromtimestamp(status.st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))


def _web_map_source_holds_credentials(raw: str, provider: Optional[str]) -> bool:
    """
    Whether a `wms` or `xyzvectortiles` source names a user name, a password or
    an `authcfg`, as its own keys or in its address, which `parse_data_source`
    reads as `unsupported`.
    """
    if (provider or '').lower() not in ('wms', 'xyzvectortiles'):
        return False
    params = url_search_params(raw.strip())
    if any(key in ('authcfg', 'username', 'password') and value.strip() for key, value in params):
        return True
    return any(key == 'url' and _USERINFO.match(value.strip()) for key, value in params)


def _inside(target: str, folder: str, path: Any) -> Optional[str]:
    """`target`'s path from `folder`, joined by `/`, where it is in `folder` or below it, and None otherwise."""
    try:
        relative = path.relpath(path.normpath(target), folder)
    except ValueError:
        return None
    if path.isabs(relative):
        return None
    parts = relative.replace(path.sep, '/').split('/')
    if any(part in ('', path.curdir, path.pardir) for part in parts) or _DRIVE.match(parts[0]):
        return None
    return '/'.join(parts)


def _collections(catalog: dict[str, Any]):
    yield from catalog.get('collections') or []
    for child in catalog.get('catalogs') or []:
        yield from _collections(child)


def _self_href(node: dict[str, Any]) -> Optional[str]:
    return next((link.get('href') for link in node.get('links') or [] if link.get('rel') == 'self'), None)


def _leave_out(catalog: dict[str, Any], ids: set[str]) -> bool:
    """Takes the Collections in `ids` out with their child links; false where a Catalog held a layer and now holds none, so its parent leaves it out."""
    held = any(True for _ in _collections(catalog))
    removed_hrefs: set[Any] = set()
    collections = []
    for collection in catalog.get('collections') or []:
        if collection['id'] in ids:
            removed_hrefs.add(_self_href(collection))
        else:
            collections.append(collection)
    catalogs = []
    for child in catalog.get('catalogs') or []:
        if _leave_out(child, ids):
            catalogs.append(child)
        else:
            removed_hrefs.add(_self_href(child))
    catalog['links'] = [link for link in catalog['links'] if not (link.get('rel') == 'child' and link.get('href') in removed_hrefs)]
    for key, kept in (('collections', collections), ('catalogs', catalogs)):
        if kept:
            catalog[key] = kept
        else:
            catalog.pop(key, None)
    return bool(collections or catalogs) or not held


def _refit_extent(catalogue: dict[str, Any]) -> None:
    """The top-level extent, worked out again from the layers written."""
    boxes = [collection['extent']['spatial']['bbox'][0] for collection in _collections(catalogue)]
    boxes = [box for box in boxes if box != _WHOLE_WORLD]
    if boxes:
        catalogue['extent'] = build_stac_extent(BoundingBox(min(box[0] for box in boxes), min(box[1] for box in boxes), max(box[2] for box in boxes), max(box[3] for box in boxes)))
    else:
        catalogue.pop('extent', None)


def _declare_quac_again(catalogue: dict[str, Any]) -> None:
    """Lists the QUAC schema afresh, now that the names QGIS Server would give a layer are taken out."""

    def clear(node: dict[str, Any]) -> None:
        extensions = [url for url in node.get('stac_extensions') or [] if url != QUAC_SCHEMA_URL]
        if extensions:
            node['stac_extensions'] = extensions
        else:
            node.pop('stac_extensions', None)
        for child in [*(node.get('collections') or []), *(node.get('catalogs') or [])]:
            clear(child)

    clear(catalogue)
    declare_quac_extension(catalogue)


def _names_a_folder(qml: bytes, folders: list[str]) -> bool:
    """Whether a style's QML holds the path of the project's folder or the chosen folder, written with either slash."""
    text = qml.decode('utf-8', errors='replace')
    for folder in folders:
        for spelling in {folder, folder.replace('\\', '/'), folder.replace('/', '\\')}:
            if len(spelling) > 3 and spelling in text:
                return True
    return False


def _unclaimed(name: str, suffix: str, taken: set[str]) -> str:
    """`name` and `suffix`, or with `-2`, `-3` and so on before the suffix, whichever is first not in `taken`, compared in lower case."""
    candidate = f'{name}{suffix}'
    count = 2
    while candidate.lower() in taken:
        candidate = f'{name}-{count}{suffix}'
        count += 1
    taken.add(candidate.lower())
    return candidate


def _encode(document: dict[str, Any]) -> bytes:
    return (json.dumps(document, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def _json_object(data: bytes) -> Optional[dict[str, Any]]:
    try:
        value = json.loads(data.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _is_quac_catalog(document: dict[str, Any]) -> bool:
    extensions = document.get('stac_extensions')
    return document.get('type') == 'Catalog' and isinstance(extensions, list) and any(isinstance(url, str) and _QUAC_SCHEMA.match(url) for url in extensions)


def _previous_documents(root_file_name: str, root: dict[str, Any], children_folder: str, read_existing: Callable[[str], Optional[bytes]]) -> list[tuple[str, Optional[dict[str, Any]]]]:
    """
    The root and each document the previous catalogue's `child` links reach
    under `children_folder`, from the root down, by its path, with its content,
    or None where it is not there or not a JSON object.
    """
    documents: list[tuple[str, Optional[dict[str, Any]]]] = [(root_file_name, root)]
    seen = {root_file_name.lower()}
    queue = [(root_file_name, root)]
    while queue:
        document_path, document = queue.pop()
        for link in document.get('links') or []:
            if not isinstance(link, dict) or link.get('rel') != 'child':
                continue
            target = _resolve_inside(link.get('href'), document_path, children_folder)
            if target is None or not target.lower().endswith('.json') or target.lower() in seen:
                continue
            seen.add(target.lower())
            data = read_existing(target)
            child = _json_object(data) if data is not None else None
            documents.append((target, child))
            if child is not None:
                queue.append((target, child))
    return documents


def _previously_linked(root_file_name: str, root: dict[str, Any], children_folder: str, read_existing: Callable[[str], Optional[bytes]]) -> set[str]:
    """
    The files under `children_folder` the previous catalogue linked: each
    document a `child` link names, from the root down, and each style asset
    and copied data and PMTiles asset of a Collection among them.
    """
    linked: set[str] = set()
    for document_path, document in _previous_documents(root_file_name, root, children_folder, read_existing):
        if document_path != root_file_name:
            linked.add(document_path)
        if document is not None and document.get('type') == 'Collection' and isinstance(document.get('assets'), dict):
            for asset in document['assets'].values():
                roles = (asset.get('roles') or []) if isinstance(asset, dict) else []
                if 'style' in roles or 'data' in roles or 'visual' in roles:
                    target = _resolve_inside(asset.get('href'), document_path, children_folder)
                    if target is not None:
                        linked.add(target)
    return linked


def _resolve_inside(href: Any, document_path: str, children_folder: str) -> Optional[str]:
    """A relative href in the document at `document_path`, as a path from the chosen folder, where it is under `children_folder`, and None otherwise."""
    if not isinstance(href, str) or not href or href[0] in '/?#' or _SCHEME.match(href) or _DRIVE.match(href):
        return None
    relative = unquote(re.split(r'[?#]', href, maxsplit=1)[0])
    if '\\' in relative or '\x00' in relative:
        return None
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(document_path), relative))
    return resolved if resolved.startswith(f'{children_folder}/') else None
