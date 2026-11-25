"""Mirrors `packages/quac/src/model/stacHref.ts`, as far as a producer needs: how a relative asset href is spelled."""

from __future__ import annotations

import re

from ..js_compat import encode_uri_component


def encode_asset_path(path: str) -> str:
    """Percent-encodes a relative path for use in an href, keeping `/` as the separator between segments."""
    return '/'.join(encode_uri_component(segment) for segment in strip_leading_dot_slash(path).split('/'))


def strip_leading_dot_slash(path: str) -> str:
    return re.sub(r'^\./', '', path, count=1)
