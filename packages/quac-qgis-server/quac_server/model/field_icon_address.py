"""Mirrors `packages/quac/src/model/fieldIconAddress.ts`.

The icon libraries a field's or layer's icon is named from, each on jsDelivr
and pinned to the major version of its package.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Optional

from ..js_compat import _percent_encode, js_trim, split_url, url_to_string

JSDELIVR_NPM = 'https://cdn.jsdelivr.net/npm/'

# An icon name as Iconify spells one: lower-case letters and digits joined by single hyphens.
_ICON_NAME_PATTERN = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*\Z')

_PHOSPHOR_WEIGHTS = ('thin', 'light', 'bold', 'fill', 'duotone')


@dataclass(frozen=True)
class IconLibrary:
    """An icon library: its npm package, without its version, the major version read, and the file in the package for the icon of a name."""

    package_name: str
    major: int
    path: Callable[[str], str]


def _tabler_path(name: str) -> str:
    return f'icons/filled/{name[:-len("-filled")]}.svg' if name.endswith('-filled') else f'icons/outline/{name}.svg'


def _heroicons_path(name: str) -> str:
    for suffix, folder in (('-20-solid', '20/solid'), ('-16-solid', '16/solid'), ('-solid', '24/solid')):
        if name.endswith(suffix):
            return f'{folder}/{name[:-len(suffix)]}.svg'
    return f'24/outline/{name}.svg'


def _phosphor_path(name: str) -> str:
    # Phosphor's files carry their weight in the name, as Iconify's do: `tree-structure-bold.svg`.
    weight = next((weight for weight in _PHOSPHOR_WEIGHTS if name.endswith(f'-{weight}')), 'regular')
    return f'assets/{weight}/{name}.svg'


def _material_symbols_path(name: str) -> str:
    # Iconify's plain name is Google's filled Outlined icon, `-outline` the unfilled one, and the same two in the Rounded style end `-rounded`
    # and `-outline-rounded`. Google's files join the words of a name with underscores.
    def file(base: str) -> str:
        return base.replace('-', '_')

    if name.endswith('-outline-rounded'):
        return f'rounded/{file(name[:-len("-outline-rounded")])}.svg'
    if name.endswith('-rounded'):
        return f'rounded/{file(name[:-len("-rounded")])}-fill.svg'
    if name.endswith('-outline'):
        return f'outlined/{file(name[:-len("-outline")])}.svg'
    return f'outlined/{file(name)}-fill.svg'


# Each library, by its prefix in Iconify's naming.
ICON_LIBRARIES: dict[str, IconLibrary] = {
    'tabler': IconLibrary('@tabler/icons', 3, _tabler_path),
    'lucide': IconLibrary('lucide-static', 1, lambda name: f'icons/{name}.svg'),
    'heroicons': IconLibrary('heroicons', 2, _heroicons_path),
    'ph': IconLibrary('@phosphor-icons/core', 2, _phosphor_path),
    'bi': IconLibrary('bootstrap-icons', 1, lambda name: f'icons/{name}.svg'),
    'material-symbols': IconLibrary('@material-symbols/svg-400', 0, _material_symbols_path),
    'maki': IconLibrary('@mapbox/maki', 8, lambda name: f'icons/{name}.svg'),
    'temaki': IconLibrary('@rapideditor/temaki', 5, lambda name: f'icons/{name}.svg'),
}


def resolve_field_icon_address(value: str) -> Optional[str]:
    """The address a field's icon value names, or None for a value that names none."""
    trimmed = js_trim(value)
    if re.match(r'^https://', trimmed, re.IGNORECASE):
        return read_https_address(trimmed)
    separator = trimmed.find(':')
    prefix = 'tabler' if separator == -1 else trimmed[:separator].lower()
    name = (trimmed if separator == -1 else trimmed[separator + 1:]).lower()
    library = ICON_LIBRARIES.get(prefix)
    if library is None or not _ICON_NAME_PATTERN.match(name):
        return None
    return f'{JSDELIVR_NPM}{library.package_name}@{library.major}/{library.path(name)}'


def is_icon_library_address(url: str) -> bool:
    """Whether `url` is a file of one of the libraries on jsDelivr, at any version."""
    if not url.startswith(JSDELIVR_NPM):
        return False
    rest = url[len(JSDELIVR_NPM):]
    return any(rest.startswith(f'{library.package_name}@') or rest.startswith(f'{library.package_name}/') for library in ICON_LIBRARIES.values())


# The characters the `URL` class percent-encodes in a user name or password, beyond control characters and those outside ASCII.
_USERINFO_ENCODED = ' "#<>?`{}/:;=@[\\]^|'


def read_https_address(value: Any) -> Optional[str]:
    """
    The address as the `URL` class writes its `href`, or None where it is not
    an `https://` address. It is read as `js_compat.split_url` reads an
    address, with the departures recorded for `parseDataSource.ts`. A user name
    and password are written as the class writes them.
    """
    if not isinstance(value, str):
        return None
    parts = split_url(js_trim(value))
    if parts is None or parts['scheme'] != 'https':
        return None
    href = url_to_string(parts)
    userinfo = parts['userinfo']
    if not userinfo:
        return href
    user, colon, password = userinfo.partition(':')
    credentials = _percent_encode(user, _USERINFO_ENCODED) + (f':{_percent_encode(password, _USERINFO_ENCODED)}' if colon and password else '')
    return href.replace('https://', f'https://{credentials}@', 1) if credentials else href
