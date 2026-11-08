"""JavaScript's answers for numbers and text, in Python.

The JavaScript reader relies on `Number()`, `String.prototype.trim`,
`encodeURIComponent` and `URLSearchParams`'s writing of a query. These helpers
give the same answers for what a QGIS project holds, so a Python module can
follow its JavaScript counterpart line by line. This module has no JavaScript
counterpart.
"""

from __future__ import annotations

import math
import re
from typing import Optional, Union
from urllib.parse import quote

Number = Union[int, float]

# The characters JavaScript's `String.prototype.trim` removes, as far as a project's text holds them.
_JS_WHITESPACE = ' \t\n\r\v\f                 　﻿'

_DECIMAL = re.compile(r'^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$')
_RADIX = re.compile(r'^0([xXoObB])([0-9a-fA-F]+)$')


def js_trim(text: str) -> str:
    """`String.prototype.trim`."""
    return text.strip(_JS_WHITESPACE)


def js_number(text: Optional[str]) -> float:
    """
    `Number(text)`: NaN where JavaScript gives NaN, and an `int` where the
    value is a whole number, so a number writes to JSON as JavaScript writes it.
    """
    if text is None:
        return 0
    trimmed = js_trim(text)
    if trimmed == '':
        return 0
    if trimmed in ('Infinity', '+Infinity'):
        return math.inf
    if trimmed == '-Infinity':
        return -math.inf
    if _DECIMAL.match(trimmed):
        return whole(float(trimmed))
    radix = _RADIX.match(trimmed)
    if radix:
        base = {'x': 16, 'o': 8, 'b': 2}[radix.group(1).lower()]
        try:
            return int(radix.group(2), base)
        except ValueError:
            return math.nan
    return math.nan


def whole(value: float) -> Number:
    """A finite whole number as an `int`, as JavaScript's JSON writes `5.0` as `5`."""
    if math.isfinite(value) and value == int(value) and abs(value) < 2 ** 53:
        return int(value)
    return value


def is_finite(value: float) -> bool:
    """`Number.isFinite`."""
    return not math.isnan(value) and math.isfinite(value)


def encode_uri_component(text: str) -> str:
    """`encodeURIComponent`."""
    return quote(text, safe="-_.!~*'()")


def _form_encode(text: str) -> str:
    """The `application/x-www-form-urlencoded` serializer `URLSearchParams` uses: a space is `+`."""
    return quote(text, safe='*-._').replace('%20', '+').replace('~', '%7E')


def search_params_to_string(pairs: list[tuple[str, str]]) -> str:
    """`new URLSearchParams(pairs).toString()`."""
    return '&'.join(f'{_form_encode(key)}={_form_encode(value)}' for key, value in pairs)
