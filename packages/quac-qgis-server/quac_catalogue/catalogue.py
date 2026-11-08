"""
What the QUAC endpoint answers, with no QGIS module, so its tests run anywhere.

`answer` builds the catalogue for a request or serves the shared copy, and
fails closed: on any error it answers a short message and never a partial
catalogue. `CatalogueCache` holds one copy per project, server address and
project version, and is used only where QGIS's access controls allow a shared
copy (`QgsAccessControl.fillCacheKey`, which is true while no access-control
plugin gives a key of its own). `version_warning` is the sentence the plugin
logs when the project was saved by a newer QGIS than the server runs.
"""

from __future__ import annotations

import json
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Hashable, Optional

FAILURE_MESSAGE = "The catalogue could not be built for this project. The server's log has the details."

# How many projects' catalogues are kept, the least recently served dropped first.
CACHE_SIZE = 32


@dataclass
class Answer:
    status: int
    body: bytes
    content_type: str
    # `hit` or `miss` where a shared copy may be used, `off` where it may not, `failed` on an error.
    cache: str
    error: Optional[str] = None


class CatalogueCache:
    """One catalogue per key, the least recently served dropped once it holds `size`."""

    def __init__(self, size: int = CACHE_SIZE) -> None:
        self._size = size
        self._entries: OrderedDict[Hashable, bytes] = OrderedDict()

    def get(self, key: Hashable) -> Optional[bytes]:
        body = self._entries.get(key)
        if body is not None:
            self._entries.move_to_end(key)
        return body

    def put(self, key: Hashable, body: bytes) -> None:
        self._entries[key] = body
        self._entries.move_to_end(key)
        while len(self._entries) > self._size:
            self._entries.popitem(last=False)

    def __len__(self) -> int:
        return len(self._entries)


def encode(catalogue: dict[str, Any]) -> bytes:
    return json.dumps(catalogue, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def answer(key: Hashable, shared: bool, build: Callable[[], dict[str, Any]], cache: CatalogueCache) -> Answer:
    """
    The answer to one request. Where `shared` is true a copy built for `key` is
    served, or one is built and kept; otherwise one is built for this request
    alone and kept nowhere. Any error gives `FAILURE_MESSAGE` and status 500,
    with the error in `error` for the log.
    """
    if shared:
        body = cache.get(key)
        if body is not None:
            return Answer(200, body, 'application/json; charset=utf-8', 'hit')
    try:
        body = encode(build())
    except Exception as error:  # noqa: BLE001 - fail closed on anything
        return Answer(500, FAILURE_MESSAGE.encode('utf-8'), 'text/plain; charset=utf-8', 'failed', f'{type(error).__name__}: {error}')
    if shared:
        cache.put(key, body)
        return Answer(200, body, 'application/json; charset=utf-8', 'miss')
    return Answer(200, body, 'application/json; charset=utf-8', 'off')


_MAJOR = re.compile(r'^\s*(\d+)\.')


def major_version(version: Optional[str]) -> Optional[int]:
    """The major version of a QGIS version string such as `3.44.8-Solothurn`, or None."""
    match = _MAJOR.match(version or '')
    return int(match.group(1)) if match else None


def version_warning(project_version: Optional[str], server_version: str) -> Optional[str]:
    """
    The warning to log where the project was saved by a newer major version of
    QGIS than the server runs, or None. QGIS Server 3.44 does not read the
    server settings a QGIS 4 project saves (`docs/plans/quac-separation.md`,
    package 4), while the catalogue follows the project as saved.
    """
    project_major = major_version(project_version)
    server_major = major_version(server_version)
    if project_major is None or server_major is None or project_major <= server_major:
        return None
    return (
        f'The project was saved by QGIS {project_version} and this server runs QGIS {server_version}. '
        f'QGIS Server {server_major} may not apply the publishing settings a QGIS {project_major} project saves, '
        'so the catalogue, which follows the project as saved, can list layers and services differently from what the server publishes. '
        f'Save the project with QGIS {server_major}, or upgrade the server.'
    )
