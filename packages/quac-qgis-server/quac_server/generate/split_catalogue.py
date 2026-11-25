"""Mirrors `packages/quac/src/generate/splitCatalogue.ts`.

Writes a catalogue as separate documents: the root Catalog, each nested
Catalog and each Collection in a document of its own, linked by `child`,
`parent` and `root` links, with no `collections` or `catalogs` arrays
(`packages/quac/spec/README.md` § "The document").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

from ..js_compat import encode_uri_component

_DEFAULT_ROOT_FILE_NAME = 'catalog.json'


def split_catalogue(catalogue: dict[str, Any], root_file_name: str = _DEFAULT_ROOT_FILE_NAME, children_folder: str = '') -> list[dict[str, Any]]:
    """
    The catalogue `catalogue` holds, one document holding the whole tree, as
    separate documents, each `{'path': ..., 'document': ...}`: the root first
    and then each child after its parent, in the order the parent's `child`
    links list them. A path is relative to the root document's folder, its
    file and folder names joined by `/` and not escaped, and always inside
    that folder.

    `root_file_name` is the root Catalog's file name, one file name ending in
    `.json`, and `children_folder` the folder every other document goes in,
    relative to the root document's folder; empty puts them beside it.

    A Catalog's Collections go in a `collections` folder beside it and its
    nested Catalogs in a `catalogs` folder, each in a folder of its own holding
    its `catalog.json`. The root's go in `children_folder`. A document's file
    or folder name is its id, made safe as a file name on any system
    (`_safe_name`), and where two in one folder would take the same name, in
    any case, the later one is given `-2`, `-3` and so on.

    Every relative href, in each link and asset, is rewritten from the
    document's own path. A `self`, `root` or `parent` link names that
    document's new path, and a `child` link whose href is a child's own `self`
    href names the child's. Every other relative href is resolved against the
    root document's folder, as the one document's hrefs are, so a data file
    keeps its place, even one outside that folder. An absolute href, one
    starting with `/`, and one holding only a query or a fragment are left as
    they are. A child that no `child` link names is given one.

    Raises ValueError where `root_file_name` or `children_folder` is not a
    safe relative path.
    """
    if not _is_safe_name(root_file_name) or not re.search(r'\.json\Z', root_file_name, re.IGNORECASE):
        raise ValueError(f"The root document's file name must be one safe file name ending in .json: {root_file_name!r}")
    folder = re.sub(r'/\Z', '', children_folder)
    folder_names = folder.split('/') if folder else []
    if not all(_is_safe_name(name) for name in folder_names) or (folder_names and folder_names[0].lower() == root_file_name.lower()):
        raise ValueError(f"The children's folder must be a relative path of safe folder names, apart from the root document: {children_folder!r}")

    root = _place_catalog(catalogue, root_file_name, folder_names)
    documents: list[dict[str, Any]] = []
    _write_documents(root, None, root, documents)
    return documents


@dataclass
class _Placed:
    """A document's place in the split catalogue: its path, and for a Catalog its children, each with the index of the `child` link naming it, or -1."""

    node: dict[str, Any]
    path: str
    children: list[tuple['_Placed', int]] = field(default_factory=list)


def _place_catalog(catalog: dict[str, Any], path: str, folder: list[str]) -> _Placed:
    """Places a Catalog at `path` and its children in `folder`, so every path is known before any href is written."""
    candidates = [*(catalog.get('collections') or []), *(catalog.get('catalogs') or [])]
    claimed: set[int] = set()
    ordered: list[tuple[dict[str, Any], int]] = []
    for link_index, link in enumerate(catalog['links']):
        if link.get('rel') != 'child':
            continue
        node = next((candidate for candidate in candidates if id(candidate) not in claimed and _self_href_of(candidate) == link.get('href')), None)
        if node is None:
            continue
        claimed.add(id(node))
        ordered.append((node, link_index))
    ordered += [(node, -1) for node in candidates if id(node) not in claimed]

    file_names: set[str] = set()
    folder_names: set[str] = set()
    children: list[tuple[_Placed, int]] = []
    for node, link_index in ordered:
        if node.get('type') == 'Collection':
            file_name = _unclaimed_name(_safe_name(node['id']), '.json', file_names)
            children.append((_Placed(node, '/'.join([*folder, 'collections', file_name])), link_index))
            continue
        child_folder = [*folder, 'catalogs', _unclaimed_name(_safe_name(node['id']), '', folder_names)]
        children.append((_place_catalog(node, '/'.join([*child_folder, 'catalog.json']), child_folder), link_index))
    return _Placed(catalog, path, children)


def _write_documents(placed: _Placed, parent: Optional[_Placed], root: _Placed, into: list[dict[str, Any]]) -> None:
    folder = [encode_uri_component(name) for name in placed.path.split('/')[:-1]]

    def href_to(other: _Placed) -> str:
        return _relative_href(folder, 0, [encode_uri_component(name) for name in other.path.split('/')])

    child_at = {link_index: child for child, link_index in placed.children if link_index >= 0}

    links: list[dict[str, Any]] = []
    for index, link in enumerate(placed.node['links']):
        href = link.get('href')
        if not _is_path_href(href):
            links.append(dict(link))
        elif index in child_at:
            links.append({**link, 'href': href_to(child_at[index])})
        elif link.get('rel') == 'self':
            links.append({**link, 'href': href_to(placed)})
        elif link.get('rel') == 'root':
            links.append({**link, 'href': href_to(root)})
        elif link.get('rel') == 'parent' and parent is not None:
            links.append({**link, 'href': href_to(parent)})
        else:
            links.append({**link, 'href': _rewrite_href(href, folder)})
    for child, link_index in placed.children:
        if link_index >= 0:
            continue
        title = child.node.get('title')
        links.append({'rel': 'child', 'href': href_to(child), 'type': 'application/json', **({} if title is None else {'title': title})})

    document: dict[str, Any] = {}
    for key, value in placed.node.items():
        if key in ('collections', 'catalogs'):
            continue
        if key == 'links':
            document[key] = links
        elif key == 'assets' and isinstance(value, dict):
            document[key] = {name: {**asset, 'href': _rewrite_href(asset['href'], folder)} if isinstance(asset, dict) and isinstance(asset.get('href'), str) else asset for name, asset in value.items()}
        else:
            document[key] = value
    into.append({'path': placed.path, 'document': document})

    for child, _link_index in placed.children:
        _write_documents(child, placed, root, into)


def _self_href_of(node: dict[str, Any]) -> Optional[str]:
    return next((link.get('href') for link in node.get('links') or [] if link.get('rel') == 'self'), None)


_SCHEME = re.compile(r'^[a-z][a-z0-9+.-]*:', re.IGNORECASE)


def _is_path_href(href: Any) -> bool:
    """
    Whether an href is a relative path, which moves with the document holding
    it: not an absolute address, not one starting with `/`, and not one
    holding only a query or a fragment, which names the document it is in.
    """
    return isinstance(href, str) and href != '' and not _SCHEME.match(href) and href[0] not in '/?#'


def _rewrite_href(href: str, folder: list[str]) -> str:
    """A relative href, which resolves against the root document's folder, rewritten from `folder`, a folder inside it."""
    if not _is_path_href(href):
        return href
    cut = re.search(r'[?#]', href)
    path = href[:cut.start()] if cut else href
    rest = href[cut.start():] if cut else ''
    ups, segments = _resolve_path(path)
    return _relative_href(folder, ups, segments) + rest


def _resolve_path(path: str) -> tuple[int, list[str]]:
    """A relative path resolved against the root document's folder, its `.` and `..` segments taken out: the folders above it, then the segments."""
    segments: list[str] = []
    ups = 0
    parts = path.split('/')
    for index, part in enumerate(parts):
        last = index == len(parts) - 1
        if part in ('.', '..'):
            if part == '..':
                if segments:
                    segments.pop()
                else:
                    ups += 1
            # A path ending in `.` or `..` names a folder.
            if last:
                segments.append('')
            continue
        segments.append(part)
    return ups, segments


def _relative_href(folder: list[str], ups: int, segments: list[str]) -> str:
    """The href naming the target `ups` folders above the root document's folder and then `segments`, from `folder`, a folder inside it."""
    if ups > 0:
        return '../' * (len(folder) + ups) + '/'.join(segments)
    target_folder = segments[:-1]
    shared = 0
    while shared < len(folder) and shared < len(target_folder) and folder[shared] == target_folder[shared]:
        shared += 1
    rest = '/'.join(segments[shared:])
    up = len(folder) - shared
    return '../' * up + rest if up > 0 else f'./{rest}'


# Characters no file name may hold on Windows, macOS or Linux: controls, `/`, and those Windows refuses.
_UNSAFE_CHARACTERS = re.compile(r'[\x00-\x1f\x7f"*/:<>?\\|]')

# The names Windows keeps for devices, with or without an extension.
_RESERVED_NAME = re.compile(r'^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|\Z)', re.IGNORECASE)


def _safe_name(identifier: str) -> str:
    """
    An id made a file or folder name that is safe on any system: each
    character a name may not hold, `/` among them, becomes `_`, as does each
    `.` or space at its end, which Windows drops; an empty name is `_`; and a
    name Windows keeps for a device, such as `con`, is given a leading `_`. So
    no name is empty, `.` or `..`.
    """
    name = _UNSAFE_CHARACTERS.sub('_', identifier)
    name = re.sub(r'[. ]+\Z', lambda end: '_' * len(end.group(0)), name)
    if name == '':
        name = '_'
    return f'_{name}' if _RESERVED_NAME.match(name) else name


def _is_safe_name(name: str) -> bool:
    return _safe_name(name) == name


def _unclaimed_name(name: str, suffix: str, taken: set[str]) -> str:
    """`name` and `suffix`, or with `-2`, `-3` and so on before the suffix, whichever is first not in `taken`, compared in lower case."""
    candidate = f'{name}{suffix}'
    count = 2
    while candidate.lower() in taken:
        candidate = f'{name}-{count}{suffix}'
        count += 1
    taken.add(candidate.lower())
    return candidate
