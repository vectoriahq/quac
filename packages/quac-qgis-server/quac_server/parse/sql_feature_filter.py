"""
Mirrors `packages/quac/src/parse/sqlFeatureFilter.ts`: a layer's GDAL SQL
feature filter as a test of a feature's properties.

A test is a dictionary, as the JavaScript's `FeatureTest` is:
`{'kind': 'readable', 'filter': ..., 'keeps': function}`, where `keeps` says
whether the layer holds a feature, or `{'kind': 'unreadable', 'expression':
...}` where the filter holds something this does not read, so a caller
leaves the layer out rather than show it whole.
"""

from __future__ import annotations

import math
import re
import sys
from typing import Any, Mapping, Optional

from ..js_compat import JS_SPACE, code_unit_key, js_number, js_string, js_truthy
from .qgis_expression import ExpressionNode, read_qgis_expression

FeatureTest = dict[str, Any]
Truth = Optional[bool]


def read_sql_feature_test(filter_: dict[str, str]) -> FeatureTest:
    """
    A GDAL SQL filter (`ogr_sql`, the Provider Feature Filter of a layer QGIS
    reads through OGR, such as a GeoJSON file) as a feature test.

    It reads the part of GDAL's SQL that a QGIS expression writes and means
    alike: fields, text, numbers, `NULL`, the comparisons, `IS [NOT] NULL`,
    `LIKE`, `ILIKE`, `IN`, `BETWEEN`, `AND`, `OR` and `NOT`. A function,
    arithmetic, a boolean literal, `~` or a whole `SELECT` makes it
    unreadable, as does any other dialect. `=`, `<>`, `!=` and `IN` against
    text with case ignore case, as GDAL's string equality does
    (`ogr_sql_dialect.html` § "WHERE", gdal.org, read 2026-10-26).

    Values compare as a QGIS expression compares them: a comparison with a
    NULL is unknown, numbers compare as numbers unless both sides are text, and
    `AND`, `OR` and `NOT` follow three-valued logic. A feature is kept where
    the filter comes out true. A field is found by its name, then by its name
    ignoring case.
    """
    unreadable: FeatureTest = {'kind': 'unreadable', 'expression': filter_['expression']}
    if filter_.get('dialect') != 'ogr_sql':
        return unreadable
    node = read_qgis_expression(filter_['expression'])
    if not node or not _is_shared_sql(node):
        return unreadable

    def keeps(properties: Optional[Mapping[str, Any]]) -> bool:
        value = _evaluate(node, properties or {})
        return value is not None and _to_boolean(value)

    return {'kind': 'readable', 'filter': filter_, 'keeps': keeps}


_SHARED_PREDICATES = frozenset(['is', 'like', 'ilike', 'in', 'between'])


def _is_shared_sql(node: ExpressionNode) -> bool:
    """Whether a node holds only what GDAL's SQL and a QGIS expression write and mean alike."""
    kind = node['kind']
    if kind in ('field', 'text', 'number', 'null'):
        return True
    if kind == 'compare':
        return _is_shared_sql(node['left']) and _is_shared_sql(node['right'])
    if kind == 'logic':
        return all(_is_shared_sql(arg) for arg in node['args'])
    if kind == 'not':
        return _is_shared_sql(node['arg'])
    if kind == 'predicate':
        # GDAL's SQL has no `~`, so only these predicates mean the same in both.
        if node['op'] not in _SHARED_PREDICATES:
            return False
        if node['op'] == 'is' and (len(node['args']) < 2 or node['args'][1]['kind'] != 'null'):
            return False
        return all(_is_shared_sql(arg) for arg in node['args'])
    return False


def _field_value(properties: Mapping[str, Any], name: str) -> Any:
    """A field's value: by its name, then by its name ignoring case; None where the feature has neither."""
    if name in properties:
        return properties[name]
    lower = name.lower()
    match = next((key for key in properties if key.lower() == lower), None)
    return None if match is None else properties[match]


def _is_cased_text(node: ExpressionNode) -> bool:
    """Text whose upper and lower case differ, which is all that ignoring case changes."""
    return node['kind'] == 'text' and node['value'].lower() != node['value'].upper()


def _lowered(value: Any) -> Any:
    """A value in lower case, as text; None stays None."""
    return None if value is None else _to_text(value).lower()


def _evaluate(node: ExpressionNode, properties: Mapping[str, Any]) -> Any:
    """A node's value: a condition gives 1, 0 or None, as QGIS gives one."""
    kind = node['kind']
    if kind == 'field':
        return _field_value(properties, node['name'])
    if kind in ('text', 'number'):
        return node['value']
    if kind == 'null':
        return None
    if kind == 'compare':
        caseless = node['op'] in ('=', '<>', '!=') and (_is_cased_text(node['left']) or _is_cased_text(node['right']))

        def read(side: ExpressionNode) -> Any:
            return _lowered(_evaluate(side, properties)) if caseless else _evaluate(side, properties)

        return _from_truth(_compare_values(node['op'], read(node['left']), read(node['right'])))
    if kind == 'logic':
        return _from_truth(_combine_truths([_to_truth(_evaluate(arg, properties)) for arg in node['args']], node['op'] == 'or'))
    if kind == 'not':
        truth = _to_truth(_evaluate(node['arg'], properties))
        return _from_truth(None if truth is None else not truth)
    if kind == 'predicate':
        truth = _predicate_truth(node, properties)
        return _from_truth(not truth if node['negate'] and truth is not None else truth)
    return None


def _predicate_truth(node: ExpressionNode, properties: Mapping[str, Any]) -> Truth:
    if node['op'] == 'in':
        caseless = any(_is_cased_text(arg) for arg in node['args'][1:])
        values = [_lowered(_evaluate(arg, properties)) if caseless else _evaluate(arg, properties) for arg in node['args']]
        return _is_in(values[0], values[1:])
    values = [_evaluate(arg, properties) for arg in node['args']] + [None, None]
    value, second, third = values[0], values[1], values[2]
    op = node['op']
    if op == 'is':
        # Only `IS NULL` is read, so the other side is always None.
        return value is None
    if op in ('like', 'ilike'):
        if value is None or second is None:
            return None
        return _like_pattern(_to_text(second), op == 'ilike').match(_to_text(value)) is not None
    if op == 'between':
        if value is None:
            return None
        return _combine_truths([_compare_values('>=', value, second), _compare_values('<=', value, third)], False)
    return None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _to_text(value: Any) -> str:
    return value if isinstance(value, str) else js_string(value)


# Text that Qt's `QString::toDouble` reads as a number: decimal digits, an optional exponent, and spaces at either end.
_NUMBER_TEXT = re.compile(f'[{JS_SPACE}]*[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?[{JS_SPACE}]*\\Z')

# QGIS's `qgsDoubleNear` tolerance: four times the gap between 1 and the next double.
_DOUBLE_NEAR = 4 * sys.float_info.epsilon


def _to_number(value: Any) -> Optional[float]:
    """A number as QGIS reads one: a number, or text that is one. None for anything else."""
    if _is_number(value):
        return value if math.isfinite(value) else None
    if not isinstance(value, str) or not _NUMBER_TEXT.match(value):
        return None
    number = js_number(value)
    return number if math.isfinite(number) else None


def _to_boolean(value: Any) -> bool:
    """A value as QGIS's `toBool` reads it: false for None, 0, and for blank text, `0` and `false` in any case."""
    if isinstance(value, str):
        return value.lower() not in ('', '0', 'false')
    return js_truthy(value)


def _to_truth(value: Any) -> Truth:
    """A value as QGIS's `getTVLValue` reads it for a condition: unknown for None, and for text that is not a number."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    number = _to_number(value)
    return None if number is None else abs(number) > _DOUBLE_NEAR


def _from_truth(truth: Truth) -> Optional[int]:
    return None if truth is None else 1 if truth else 0


def _combine_truths(truths: list[Truth], deciding: bool) -> Truth:
    """`AND` (deciding false) or `OR` (deciding true) over three-valued truths."""
    if any(truth is deciding for truth in truths):
        return deciding
    return None if any(truth is None for truth in truths) else not deciding


def _compare_non_null(left: Any, right: Any) -> tuple[float, bool]:
    """
    QGIS's `compareNonNullValues` for two values that are not None, as a
    difference: as numbers when both read as numbers and they are not both
    text, as true and false when either is a boolean, and otherwise as text.
    """
    left_number = _to_number(left)
    right_number = _to_number(right)
    if not (isinstance(left, str) and isinstance(right, str)) and left_number is not None and right_number is not None:
        return left_number - right_number, True
    if isinstance(left, bool) or isinstance(right, bool):
        return int(_to_boolean(left)) - int(_to_boolean(right)), False
    left_text = code_unit_key(_to_text(left))
    right_text = code_unit_key(_to_text(right))
    return (-1 if left_text < right_text else 1 if left_text > right_text else 0), False


_COMPARISONS = {
    '=': lambda diff, numeric: abs(diff) <= _DOUBLE_NEAR if numeric else diff == 0,
    '<>': lambda diff, numeric: abs(diff) > _DOUBLE_NEAR if numeric else diff != 0,
    '!=': lambda diff, numeric: abs(diff) > _DOUBLE_NEAR if numeric else diff != 0,
    '<': lambda diff, numeric: diff < 0,
    '<=': lambda diff, numeric: diff <= 0,
    '>': lambda diff, numeric: diff > 0,
    '>=': lambda diff, numeric: diff >= 0,
}


def _compare_values(op: str, left: Any, right: Any) -> Truth:
    """A comparison of two values: unknown when either is None."""
    if left is None or right is None:
        return None
    diff, numeric = _compare_non_null(left, right)
    return _COMPARISONS[op](diff, numeric)


def _is_in(value: Any, items: list[Any]) -> Truth:
    """
    QGIS's `IN`: unknown for a None value, true when a list item equals it, as
    numbers when both read as numbers and are not both text and as text
    otherwise, and unknown rather than false when the list holds a None.
    """
    if value is None:
        return None
    list_has_null = False
    for item in items:
        if item is None:
            list_has_null = True
            continue
        value_number = _to_number(value)
        item_number = _to_number(item)
        if not (isinstance(value, str) and isinstance(item, str)) and value_number is not None and item_number is not None:
            equal = abs(value_number - item_number) <= _DOUBLE_NEAR
        else:
            equal = _to_text(value) == _to_text(item)
        if equal:
            return True
    return None if list_has_null else False


def _like_pattern(pattern: str, case_insensitive: bool) -> re.Pattern[str]:
    """A `LIKE` pattern as a regular expression: `%` any run, `_` one character, and `\\%` or `\\_` the character itself."""
    source = ''
    index = 0
    while index < len(pattern):
        char = pattern[index]
        following = pattern[index + 1] if index + 1 < len(pattern) else None
        if char == '\\' and following in ('%', '_'):
            source += re.escape(following)
            index += 1
        elif char == '%':
            source += '[\\s\\S]*'
        elif char == '_':
            source += '[\\s\\S]'
        else:
            source += re.escape(char)
        index += 1
    return re.compile(f'(?:{source})\\Z', re.IGNORECASE if case_insensitive else 0)
