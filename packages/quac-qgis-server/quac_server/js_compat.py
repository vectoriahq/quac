"""JavaScript's answers for numbers and text, in Python.

The JavaScript reader relies on `Number()`, `String()`, `JSON.stringify`,
`Number.parseInt`, `String.prototype.trim`, the whitespace of a regular expression's `\\s`, the
order `<` puts text in, `encodeURIComponent`, and the `URL` class and
`URLSearchParams` for `http` and `https` addresses and a layer source's query. These helpers
give the same answers for what a QGIS project holds, so a Python module can
follow its JavaScript counterpart line by line. This module has no JavaScript
counterpart.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Callable, Optional, Union
from urllib.parse import parse_qsl, quote

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


_LEADING_INTEGER = re.compile(r'^([+-]?[0-9]+)')


def js_parse_int(text: Optional[str]) -> float:
    """`Number.parseInt(text, 10)`: the whole number the text opens with, after any space, or NaN where it opens with none."""
    match = _LEADING_INTEGER.match(js_trim(text or ''))
    return int(match.group(1)) if match else math.nan


# The characters JavaScript's `\\s` matches, as the inside of a Python class.
JS_SPACE = '\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'


def js_number_string(value: Number) -> str:
    """`String(number)`: the fewest digits that read back as the number, written out up to 21 digits and with an exponent past them, as JavaScript writes it."""
    number = float(value)
    if math.isnan(number):
        return 'NaN'
    if math.isinf(number):
        return 'Infinity' if number > 0 else '-Infinity'
    if number == 0:
        return '0'
    sign = '-' if number < 0 else ''
    mantissa, _, exponent = repr(abs(number)).partition('e')
    integer, _, fraction = mantissa.partition('.')
    digits = integer + fraction
    point = len(integer) + int(exponent or 0)
    stripped = digits.lstrip('0')
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip('0')
    count = len(digits)
    if count <= point <= 21:
        return sign + digits + '0' * (point - count)
    if 0 < point <= 21:
        return f'{sign}{digits[:point]}.{digits[point:]}'
    if -6 < point <= 0:
        return f"{sign}0.{'0' * -point}{digits}"
    power = point - 1
    written = digits if count == 1 else f'{digits[0]}.{digits[1:]}'
    return f"{sign}{written}e{'+' if power >= 0 else '-'}{abs(power)}"


def js_string(value: Any) -> str:
    """`String(value)` for what a feature's properties hold: text, a number, true or false, null, a list or an object."""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return js_number_string(value)
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return ','.join('' if item is None else js_string(item) for item in value)
    return '[object Object]'


def js_truthy(value: Any) -> bool:
    """`Boolean(value)`: false for null, false, 0, NaN and empty text, and true for anything else, an empty list or object included."""
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0 and not math.isnan(value)
    if isinstance(value, str):
        return value != ''
    return True


def code_unit_key(text: str) -> bytes:
    """A key that puts text in the order JavaScript's `<` does, by UTF-16 code unit, where Python's own order is by code point."""
    return text.encode('utf-16-be', 'surrogatepass')


def js_json_stringify(value: Any) -> str:
    """`JSON.stringify(value)` with no spacing, for text, numbers, true, false, null, lists and dictionaries, which keep their order."""
    if value is None or value is True or value is False:
        return json.dumps(value)
    if isinstance(value, (int, float)):
        return 'null' if isinstance(value, float) and not math.isfinite(value) else js_number_string(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return '[' + ','.join(js_json_stringify(item) for item in value) + ']'
    return '{' + ','.join(f'{json.dumps(key, ensure_ascii=False)}:{js_json_stringify(item)}' for key, item in value.items()) + '}'


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


def url_search_params(query: str) -> list[tuple[str, str]]:
    """`new URLSearchParams(query)`'s pairs, in order: split at `&`, a `+` read as a space and each escape decoded as UTF-8."""
    return parse_qsl(query[1:] if query.startswith('?') else query, keep_blank_values=True, errors='replace')


# An `http` or `https` address: its scheme, then any slashes, then its authority, path, query and fragment.
_HTTP_URL = re.compile(r'^([a-zA-Z][a-zA-Z0-9+.-]*):[/\\]*([^/\\?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?\Z', re.DOTALL)


def split_url(address: str) -> Optional[dict[str, Any]]:
    """
    An `http` or `https` address taken apart as `new URL(address)` takes it,
    its scheme and host in lower case, its port without a default one, and its
    `userinfo` the user name and password, empty where it has none. None where
    the class would refuse it, or it is no `http` or `https` address. A host
    outside ASCII is converted with Python's IDNA 2003 codec, where the class
    uses UTS 46, so such a host can be written differently.
    """
    address = re.sub(r'[\t\n\r]', '', js_trim(address))
    match = _HTTP_URL.match(address)
    if match is None or match.group(1).lower() not in ('http', 'https'):
        return None
    scheme = match.group(1).lower()
    authority = match.group(2)
    userinfo, _, host_port = authority.rpartition('@')
    host, colon, port = host_port.partition(':') if not host_port.startswith('[') else (host_port, '', '')
    if not host or (colon and port and not port.isdigit()):
        return None
    try:
        host = host.encode('ascii').decode('ascii').lower() if host.isascii() else host.encode('idna').decode('ascii').lower()
    except UnicodeError:
        return None
    port_number = int(port) if colon and port else None
    if port_number is not None and port_number > 65535:
        return None
    if port_number == {'http': 80, 'https': 443}[scheme]:
        port_number = None
    return {
        'scheme': scheme,
        'userinfo': userinfo,
        'host': host,
        'port': port_number,
        'path': match.group(3).replace('\\', '/'),
        'query': match.group(4),
        'fragment': match.group(5),
    }


def url_to_string(parts: dict[str, Any]) -> str:
    """
    The `href` the `URL` class writes for an address `split_url` took apart,
    less its user name and password: a default port left off, `.` and `..`
    taken out of the path, and each character the class escapes in the path,
    query and fragment percent-encoded. A query or fragment of None is left
    off.
    """
    href = f"{parts['scheme']}://{parts['host']}{'' if parts['port'] is None else ':' + str(parts['port'])}{url_path(parts['path'])}"
    if parts['query'] is not None:
        href += '?' + _percent_encode(parts['query'], ' "#<>\'')
    if parts['fragment'] is not None:
        href += '#' + _percent_encode(parts['fragment'], ' "<>`')
    return href


def without_search_params(parts: dict[str, Any], drop: Callable[[str], bool]) -> dict[str, Any]:
    """
    The address with each query parameter whose name `drop` picks taken out,
    as `url.searchParams.delete(name)` takes it out: where one is, the query
    is written again by `URLSearchParams`, and left off where nothing is left.
    Where none is, the query is kept as written.
    """
    if parts['query'] is None:
        return parts
    pairs = url_search_params(_percent_encode(parts['query'], ' "#<>\''))
    if not any(drop(key) for key, _value in pairs):
        return parts
    query = search_params_to_string([(key, value) for key, value in pairs if not drop(key)])
    return {**parts, 'query': query or None}


def url_path(path: str) -> str:
    """A special URL's path as the `URL` class writes it: `/` where empty, its dot segments taken out, and escaped."""
    segments: list[str] = []
    parts = path.split('/')[1:] if path else ['']
    for index, part in enumerate(parts):
        last = index == len(parts) - 1
        lowered = part.lower()
        if lowered in ('..', '.%2e', '%2e.', '%2e%2e'):
            if segments:
                segments.pop()
            if last:
                segments.append('')
        elif lowered in ('.', '%2e'):
            if last:
                segments.append('')
        else:
            segments.append(_percent_encode(part, ' "#<>?^`{}'))
    return '/' + '/'.join(segments)


def _percent_encode(text: str, also: str) -> str:
    """Each control character, each character outside ASCII and each of `also` percent-encoded as UTF-8; a `%` is kept as written."""
    return ''.join(
        ''.join(f'%{byte:02X}' for byte in char.encode('utf-8')) if ord(char) < 0x20 or ord(char) > 0x7E or char in also else char
        for char in text
    )
