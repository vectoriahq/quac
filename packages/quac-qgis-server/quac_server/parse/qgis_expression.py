"""
Mirrors `packages/quac/src/parse/qgisExpression.ts`: reads a QGIS expression
into a tree, and writes the tree as a GeoStyler function.

A node is a dictionary with the JavaScript's members (`{'kind': 'field',
'name': 'status'}`), and a `LayerLookup` too, so a tree writes to JSON as the
JavaScript's does, and a lookup's `key` is the same text. Where the JavaScript
tells one node from another by identity, so does this module, with `is`.
"""

from __future__ import annotations

import math
import re
from typing import Any, Callable, Optional, Union

from ..js_compat import JS_SPACE, js_json_stringify, js_number, js_number_string, js_trim
from .parse_measurement import MeasureFactors
from .qt_date_format import is_formattable_qt_date_pattern
from .qt_regex import compile_qt_regex

ExpressionNode = dict[str, Any]
ExpressionToken = dict[str, Any]
# A node read from a token and the index after it, or None.
Read = Optional[tuple[ExpressionNode, int]]

_INFINITY = math.inf

# Words QGIS's lexer reads as keywords rather than field names, ignoring case.
QGIS_KEYWORDS = frozenset([
    'and', 'between', 'case', 'else', 'end', 'false', 'ilike', 'in', 'is', 'like', 'not', 'null', 'or', 'then', 'true', 'when',
])

# The one-argument QGIS functions a label expression may call, and the GeoStyler function each becomes.
ONE_ARGUMENT_FUNCTIONS = {
    'upper': 'strToUpperCase',
    'lower': 'strToLowerCase',
    'title': 'strCapitalize',
    'trim': 'strTrim',
}

# The QGIS functions with no GeoStyler function of the same meaning, and the
# fewest and most arguments each takes by position. Each becomes a GeoStyler
# `custom` function with the QGIS name as its `fnName`.
QGIS_ONLY_FUNCTIONS: dict[str, tuple[float, float]] = {
    'coalesce': (1, _INFINITY),
    'if': (3, 3),
    'length': (1, 1),
    'round': (1, 2),
    'format_number': (1, 5),
    'left': (2, 2),
    'right': (2, 2),
    'substr': (2, 3),
    'replace': (3, 3),
    'current_value': (1, 1),
    'to_int': (1, 1),
    'to_string': (1, 1),
    'lpad': (2, 3),
    'maximum': (1, 1),
    'minimum': (1, 1),
    'format_date': (2, 3),
    'now': (0, 0),
    'make_interval': (0, 7),
    'max': (0, _INFINITY),
    'min': (0, _INFINITY),
    'abs': (1, 1),
    'floor': (1, 1),
    'ceil': (1, 1),
    'to_real': (1, 1),
    'rpad': (2, 3),
    'strpos': (2, 2),
    'nullif': (2, 2),
    'wordwrap': (2, 3),
    'year': (1, 1),
    'month': (1, 1),
    'day': (1, 1),
    'week': (1, 1),
    'day_of_week': (1, 1),
    'hour': (1, 1),
    'minute': (1, 1),
    'second': (1, 1),
    'regexp_match': (2, 2),
    'regexp_replace': (3, 3),
    'regexp_substr': (2, 2),
    'array_first': (1, 1),
    'array_get': (2, 2),
    'overlay_within': (1, 5),
    'overlay_intersects': (1, 9),
    'overlay_nearest': (1, 6),
    'aggregate': (3, 6),
    'geometry': (1, 1),
    'intersects': (2, 2),
    'x': (1, 1),
    'y': (1, 1),
    'z': (1, 1),
    'transform': (3, 3),
    'layer_property': (2, 2),
}

# The functions that take a coordinate of a point: of the point a variable
# holds (`EXPRESSION_VARIABLE`), or of the record's shape (`SHAPE_COORDINATE`).
POINT_PARTS = ['x', 'y', 'z']

# The coordinates of the record's own point, written with no brackets.
FEATURE_COORDINATES = ['$x', '$y']

# The `fnName` of the GeoStyler `custom` function that stands for a coordinate
# of the record's shape: its arguments are the coordinate, how it is taken
# (`feature` or `shape`), and the coordinate systems a `transform()` takes the
# shape from and to, or both None.
SHAPE_COORDINATE = 'shape_coordinate'

# Stands for the layer's own coordinate system in a `SHAPE_COORDINATE`, written `@layer_crs` or `layer_property(@layer, 'crs')`.
LAYER_CRS = '@layer_crs'

# The `fnName` of the GeoStyler `custom` function that stands for a variable,
# such as `@cloud_useremail`: its name with no `@`, and a coordinate of the
# point it holds where `x()`, `y()` or `z()` reads one.
EXPRESSION_VARIABLE = 'expression_variable'


def _variable_name(node: Optional[ExpressionNode]) -> Optional[str]:
    """The name of the variable a node is, with no `@`, or None for any other node and for `@parent`."""
    if node is not None and node['kind'] == 'call' and node['name'].startswith('@') and node['name'] != '@parent':
        return node['name'][1:]
    return None


def _is_variable(node: Optional[ExpressionNode]) -> bool:
    return _variable_name(node) is not None


def _find_variables(node: ExpressionNode) -> list[ExpressionNode]:
    """The variables at or under a node, other than `@parent`."""
    found = [node] if _is_variable(node) else []
    for child in _child_nodes(node):
        found += _find_variables(child)
    return found


def _arg(node: Optional[ExpressionNode], position: int) -> Optional[ExpressionNode]:
    """A call's argument at a position, or None where it has none, as `node.args[position]` gives undefined."""
    if node is None or 'args' not in node:
        return None
    args = node['args']
    return args[position] if position < len(args) else None


def _is_coordinate_call(node: ExpressionNode) -> bool:
    """Whether a node is a coordinate of the record's shape: `$x`, `$y`, or `x()`, `y()` or `z()` of anything but a variable."""
    if node['kind'] != 'call':
        return False
    return node['name'] in FEATURE_COORDINATES or (node['name'] in POINT_PARTS and not _is_variable(_arg(node, 0)))


def _find_coordinate_calls(node: ExpressionNode) -> list[ExpressionNode]:
    """The coordinates of the record's shape at or under a node, not looking inside one."""
    if _is_coordinate_call(node):
        return [node]
    found: list[ExpressionNode] = []
    for child in _child_nodes(node):
        found += _find_coordinate_calls(child)
    return found


def _is_record_shape(node: Optional[ExpressionNode]) -> bool:
    return node is not None and node['kind'] == 'call' and node['name'] == '$geometry'


def _is_readable_crs(node: Optional[ExpressionNode]) -> bool:
    """A coordinate system written as text, as `@layer_crs`, or as `layer_property(@layer, 'crs')`."""
    if node is not None and node['kind'] == 'text':
        return js_trim(node['value']) != ''
    if _variable_name(node) == 'layer_crs':
        return True
    if node is None or node['kind'] != 'call' or node['name'] != 'layer_property':
        return False
    layer, prop = _arg(node, 0), _arg(node, 1)
    return _variable_name(layer) == 'layer' and prop is not None and prop['kind'] == 'text' and prop['value'].lower() == 'crs'


def _crs_of(node: ExpressionNode) -> str:
    """The code a readable coordinate system names, or `LAYER_CRS` for the layer's own."""
    return js_trim(node['value']) if node['kind'] == 'text' else LAYER_CRS


def _is_readable_coordinate(call: ExpressionNode) -> bool:
    """`$x`, `$y`, or `x()`, `y()` or `z()` of `$geometry` or of `transform($geometry, from, to)`."""
    if call['name'] in FEATURE_COORDINATES:
        return True
    shape = _arg(call, 0)
    if _is_record_shape(shape):
        return True
    return (shape is not None and shape['kind'] == 'call' and shape['name'] == 'transform' and _is_record_shape(_arg(shape, 0))
            and _is_readable_crs(_arg(shape, 1)) and _is_readable_crs(_arg(shape, 2)))


def _coordinate_function(call: ExpressionNode) -> Any:
    """The `SHAPE_COORDINATE` a readable coordinate becomes."""
    if call['name'] in FEATURE_COORDINATES:
        return {'name': 'custom', 'fnName': SHAPE_COORDINATE, 'args': [call['name'][1:], 'feature', None, None]}
    shape = call['args'][0]
    transformed = shape['kind'] == 'call' and shape['name'] == 'transform'
    return {
        'name': 'custom',
        'fnName': SHAPE_COORDINATE,
        'args': [call['name'], 'shape', _crs_of(shape['args'][1]) if transformed else None, _crs_of(shape['args'][2]) if transformed else None],
    }


def _without_coordinates(node: ExpressionNode) -> ExpressionNode:
    """
    A node with each coordinate of the record's shape replaced by NULL, for the
    checks that do not look inside one. Nodes holding none are kept as they
    are, so a `$area` found in the result is the one in the expression.
    """
    if _is_coordinate_call(node):
        return {'kind': 'null'}
    children = _child_nodes(node)
    replaced = [_without_coordinates(child) for child in children]
    if all(child is children[index] for index, child in enumerate(replaced)):
        return node
    remaining = iter(replaced)
    kind = node['kind']
    if kind in ('call', 'predicate', 'logic'):
        return {**node, 'args': [next(remaining) for _ in node['args']]}
    if kind in ('arithmetic', 'compare'):
        return {**node, 'left': next(remaining), 'right': next(remaining)}
    if kind in ('negate', 'not'):
        return {**node, 'arg': next(remaining)}
    if kind == 'case':
        whens = [{'when': next(remaining), 'then': next(remaining)} for _ in node['whens']]
        return {**node, 'whens': whens, 'otherwise': next(remaining) if node['otherwise'] else None}
    return node


# The functions whose second argument is a regular expression, which QGIS compiles with Unicode properties.
REGEXP_FUNCTIONS = ['regexp_match', 'regexp_replace', 'regexp_substr']

# The names of the functions that take a named value, such as
# `make_interval(days:=14)`, in the order QGIS gives them by position, and the
# value each takes when it is left out (`QgsExpressionFunction::Parameter`,
# `src/core/expression/qgsexpressionfunction.cpp`, `qgis/QGIS@master`, read
# 2026-10-27). QGIS's own lists go on past the ones that are read; a value for
# any of those leaves the expression unread.
NAMED_PARAMETERS: dict[str, dict[str, Any]] = {
    'make_interval': {'names': ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'], 'omitted': {'kind': 'number', 'value': 0}},
    'overlay_within': {'names': ['layer', 'expression', 'filter', 'limit', 'cache'], 'omitted': {'kind': 'null'}},
    'overlay_intersects': {
        'names': ['layer', 'expression', 'filter', 'limit', 'cache', 'min_overlap', 'min_inscribed_circle_radius', 'return_details', 'sort_by_intersection_size'],
        'omitted': {'kind': 'null'},
    },
    'overlay_nearest': {'names': ['layer', 'expression', 'filter', 'limit', 'max_distance', 'cache'], 'omitted': {'kind': 'null'}},
    'aggregate': {'names': ['layer', 'aggregate', 'expression', 'filter', 'concatenator', 'order_by'], 'omitted': {'kind': 'null'}},
}

# The calls that read another layer of the project: `LayerLookup`.
LOOKUPS = ['overlay_within', 'overlay_intersects', 'overlay_nearest', 'aggregate']

# What `aggregate` reads the filter `intersects($geometry, geometry(@parent))` through, which stand nowhere else.
PARENT_GEOMETRY_CALLS = ['intersects', 'geometry', '$geometry', '@parent']

# The `aggregate` kinds this reader takes, which the caller works out (`QgsAggregateCalculator::aggregates`).
LOOKUP_AGGREGATES = ('count', 'min', 'max', 'concatenate')

# One read of another layer of the project, as the JavaScript's `LayerLookup`
# describes it: `key`, `layer`, `predicate`, `expression`, `filter`, `limit`,
# and `sortByOverlap` and `maxDistance` where the expression gives them.
LayerLookup = dict[str, Any]

# The `fnName` of the GeoStyler `custom` function that stands for a `LayerLookup`, with its `key` as its one argument.
LAYER_LOOKUP = 'layer_lookup'

# The functions that take a date as their first argument, where `now()` may stand.
DATE_TAKERS = ['format_date', 'year', 'month', 'day', 'week', 'day_of_week', 'hour', 'minute', 'second']

# The aggregates this reader reads, which scan the records of a layer.
AGGREGATES = ['maximum', 'minimum']

# The values QGIS gives a feature from its geometry that this reader takes, and the unit each is in. They are written with no brackets (`$area`).
GEOMETRY_VALUES = {
    '$area': 'area',
    '$length': 'distance',
    '$perimeter': 'distance',
}

# The GeoStyler function each comparison becomes.
COMPARISON_FUNCTIONS = {
    '=': 'equalTo',
    '!=': 'notEqualTo',
    '<>': 'notEqualTo',
    '<': 'lessThan',
    '<=': 'lessThanOrEqualTo',
    '>': 'greaterThan',
    '>=': 'greaterThanOrEqualTo',
}

# The GeoStyler function each arithmetic operator becomes.
ARITHMETIC_FUNCTIONS = {
    '+': 'add',
    '-': 'sub',
    '*': 'mul',
    '/': 'div',
    '//': 'intdiv',
    '%': 'mod',
    '^': 'pow',
}

# The `fnName` of the GeoStyler `custom` function that wraps a condition read from a QGIS rule.
QGIS_CONDITION = 'qgis_condition'


def is_qgis_condition_filter(filter_: Any) -> bool:
    """Whether a filter is a condition `qgis_condition_to_filter` wrapped."""
    return isinstance(filter_, dict) and filter_.get('name') == 'custom' and filter_.get('fnName') == QGIS_CONDITION and isinstance(filter_.get('args'), list)


def read_qgis_expression(
    expression: str,
    *,
    current_value: bool = False,
    geometry: Union[bool, MeasureFactors, None] = None,
    aggregates: bool = False,
    lookups: bool = False,
    variables: bool = False,
    coordinates: bool = False,
    dates: bool = False,
) -> Optional[ExpressionNode]:
    """
    Reads a QGIS expression into a tree: fields, text, numbers, `TRUE`,
    `FALSE`, `NULL`, `||`, `+`, `-`, `*`, `/`, `//`, `%`, `^`, conditions, `~`,
    `CASE` and calls to the functions above. None for any other expression.
    The keyword arguments are the JavaScript's options, and say what the
    caller can answer: `current_value`, `geometry` (True, or the project's
    `MeasureFactors`), `aggregates`, `lookups`, `variables`, `coordinates` and `dates`.
    The JavaScript's comment on `readQgisExpression` says what each one reads.
    """
    tokens = _tokenize_expression(expression)
    if not tokens:
        return None

    read = _read_or(tokens, 0)
    if not read or read[1] != len(tokens):
        return None
    root = read[0]
    found_coordinates = _find_coordinate_calls(root)
    if found_coordinates and (not coordinates or not all(_is_readable_coordinate(call) for call in found_coordinates)):
        return None
    if any(_find_coordinate_calls(call) for call in _find_calls(root, *LOOKUPS)):
        return None
    # The rest is checked with each coordinate set aside: its shape, its coordinate systems and `@layer` are read above.
    parsed = _without_coordinates(root)
    if _find_calls(parsed, *FEATURE_COORDINATES, 'transform', 'layer_property'):
        return None
    if not current_value and _find_calls(parsed, 'current_value'):
        return None
    if not variables and _find_variables(parsed):
        return None
    if not all(_is_variable(_arg(call, 0)) for call in _find_calls(parsed, *POINT_PARTS)):
        return None
    aggregate_calls = _find_calls(parsed, *AGGREGATES)
    if aggregate_calls and not aggregates:
        return None
    if any(_find_calls(call['args'][0], *AGGREGATES, *GEOMETRY_VALUES) for call in aggregate_calls):
        return None

    if not all(_is_readable_regex(_arg(call, 1), True) for call in _find_calls(parsed, *REGEXP_FUNCTIONS)):
        return None
    if not all(_is_readable_regex(_arg(predicate, 1), False) for predicate in _find_regexp_predicates(parsed)):
        return None

    if not all(_is_readable_format_date(call) for call in _find_calls(parsed, 'format_date')):
        return None
    dated_nows = {id(call) for call in _find_dated_nows(parsed, dates, dates)}
    if any(id(call) not in dated_nows for call in _find_calls(parsed, 'now')):
        return None

    if not _are_lookups_readable(parsed, lookups is True):
        return None

    added_intervals = {id(call) for call in _find_added_intervals(parsed)}
    if any(id(call) not in added_intervals for call in _find_calls(parsed, 'make_interval')):
        return None

    geometry_calls = _find_calls(parsed, *GEOMETRY_VALUES)
    if not geometry_calls:
        return root
    if not geometry:
        return None
    if geometry is True:
        return root
    for call in geometry_calls:
        factor = getattr(geometry, GEOMETRY_VALUES[call['name']])
        if factor is None:
            return None
        call['factor'] = factor
    return root


def _is_readable_regex(pattern: Optional[ExpressionNode], unicode: bool) -> bool:
    """A regular expression written into the expression as text, which `compile_qt_regex` translates."""
    return pattern is not None and pattern['kind'] == 'text' and compile_qt_regex(pattern['value'], unicode) is not None


def _find_regexp_predicates(node: ExpressionNode) -> list[ExpressionNode]:
    """The `~` predicates at or under a node."""
    found = [node] if node['kind'] == 'predicate' and node['op'] == 'regexp' else []
    for child in _child_nodes(node):
        found += _find_regexp_predicates(child)
    return found


def _is_readable_format_date(call: ExpressionNode) -> bool:
    """A `format_date` call whose pattern and language are written-in text, and whose pattern this package formats."""
    pattern, language = _arg(call, 1), _arg(call, 2)
    return (pattern is not None and pattern['kind'] == 'text' and is_formattable_qt_date_pattern(pattern['value'])
            and (language is None or language['kind'] == 'text'))


def qgis_condition_to_filter(expression: str, measure: Optional[MeasureFactors] = None) -> Optional[dict[str, Any]]:
    """
    A QGIS rule's condition as a GeoStyler filter: the condition's GeoStyler
    function inside a `custom` function named `QGIS_CONDITION`. None for a
    condition `read_qgis_expression` cannot read. `measure` is the project's
    units, which `$area` and `$length` need.
    """
    node = read_qgis_expression(expression, current_value=True, geometry=measure)
    return node and {'name': 'custom', 'fnName': QGIS_CONDITION, 'args': [expression_to_geo_styler_function(node)]}


_ESCAPES = {'n': '\n', 't': '\t', '\\': '\\', "'": "'"}


def unescape_string_literal(text: str) -> str:
    """
    A string literal's text, as QGIS's `stripText` makes it: `''` becomes a
    quote first, then a backslash and the character after it become that
    character, `\\n` and `\\t` as a newline and a tab, and any character but
    those, `\\` and `'` as `?`.
    """
    return re.sub(r'\\(.)', _unescaped, text.replace("''", "'"), flags=re.DOTALL)


def _unescaped(match: re.Match[str]) -> str:
    char = match.group(1)
    if ord(char) > 0xFFFF:
        # JavaScript's `.` takes one UTF-16 code unit, so a character past U+FFFF loses its first half to the `?` and keeps its second.
        return '?' + chr(0xDC00 + ((ord(char) - 0x10000) & 0x3FF))
    return _ESCAPES.get(char, '?')


# JavaScript's `.` outside Unicode mode: anything but a line terminator.
_NOT_LINE_TERMINATOR = '[^\\n\\r\\u2028\\u2029]'
_NAME_CHAR = 'A-Za-z_\\x80-\\U0010FFFF'

_TOKEN = re.compile(
    f'[{JS_SPACE}]+'
    f"|'((?:''|\\\\{_NOT_LINE_TERMINATOR}|[^'\\\\])*)'"
    '|"((?:""|[^"])*)"'
    f'|[Cc][Hh][Aa][Rr][{JS_SPACE}]*\\([{JS_SPACE}]*([0-9]+)[{JS_SPACE}]*\\)'
    '|([0-9]*\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[0-9]+(?:[eE][-+]?[0-9]+)?)'
    f'|([$@]?[{_NAME_CHAR}][A-Za-z0-9_\\x80-\\U0010FFFF]*)'
    '|(\\|\\||<>|!=|<=|>=|:=|//|[()\\[\\],=<>+*/%^~-])'
)


def _tokenize_expression(expression: str) -> Optional[list[ExpressionToken]]:
    """
    Splits an expression into field references, string literals, numbers,
    names and punctuation, following QGIS's lexer (`src/core/qgsexpressionlexer.ll`,
    `qgis/QGIS@master`, read 2026-10-23). A `char(n)` call is read as the text
    of the character with that code. None where the expression holds anything
    else.
    """
    tokens: list[ExpressionToken] = []
    position = 0
    while position < len(expression):
        match = _TOKEN.match(expression, position)
        if not match:
            return None
        position = match.end()
        text, quoted_field, char_code, number, name, punct = match.groups()
        if text is not None or char_code is not None:
            if char_code is not None:
                code = int(char_code)
                if code < 1 or code > 0x10FFFF:
                    return None
                tokens.append({'type': 'text', 'value': chr(code)})
            else:
                tokens.append({'type': 'text', 'value': unescape_string_literal(text)})
        elif quoted_field is not None:
            value = quoted_field.replace('""', '"')
            if not value:
                return None
            tokens.append({'type': 'field', 'value': value})
        elif number is not None:
            tokens.append({'type': 'number', 'value': js_number(number)})
        elif name is not None:
            tokens.append({'type': 'name', 'value': name})
        elif punct is not None:
            tokens.append({'type': 'punct', 'value': punct})
    return tokens


def _token(tokens: list[ExpressionToken], index: int) -> Optional[ExpressionToken]:
    return tokens[index] if 0 <= index < len(tokens) else None


def _is_punct(token: Optional[ExpressionToken], value: str) -> bool:
    return token is not None and token['type'] == 'punct' and token['value'] == value


def _is_word(token: Optional[ExpressionToken], word: str) -> bool:
    return token is not None and token['type'] == 'name' and token['value'].lower() == word


# The readers below follow QGIS's operator precedence, loosest first: `OR`,
# `AND`, `NOT`, `BETWEEN`, the comparisons, `~`, `IS`, `LIKE` and `IN`, then
# `+` and `-`, `*`, `/`, `//` and `%`, then `^` (right to left), `||`, and a
# unary minus tightest of all (`src/core/qgsexpressionparser.yy`).

def _read_or(tokens: list[ExpressionToken], index: int) -> Read:
    return _read_logic(tokens, index, 'or', _read_and)


def _read_and(tokens: list[ExpressionToken], index: int) -> Read:
    return _read_logic(tokens, index, 'and', _read_not)


def _read_logic(tokens: list[ExpressionToken], index: int, op: str, read_operand: Callable[[list[ExpressionToken], int], Read]) -> Read:
    first = read_operand(tokens, index)
    if not first:
        return None
    args = [first[0]]
    position = first[1]
    while _is_word(_token(tokens, position), op):
        operand = read_operand(tokens, position + 1)
        if not operand:
            return None
        args.append(operand[0])
        position = operand[1]
    return (args[0] if len(args) == 1 else {'kind': 'logic', 'op': op, 'args': args}), position


def _read_not(tokens: list[ExpressionToken], index: int) -> Read:
    if not _is_word(_token(tokens, index), 'not'):
        return _read_predicate(tokens, index)
    operand = _read_not(tokens, index + 1)
    return operand and ({'kind': 'not', 'arg': operand[0]}, operand[1])


def _read_predicate(tokens: list[ExpressionToken], index: int) -> Read:
    """A value, and any comparison, `IS`, `LIKE`, `ILIKE`, `IN` or `BETWEEN` after it, left to right."""
    read = _read_sum(tokens, index)
    while read:
        left, position = read
        token = _token(tokens, position)

        if token is not None and token['type'] == 'punct' and token['value'] in COMPARISON_FUNCTIONS:
            right = _read_sum(tokens, position + 1)
            read = right and ({'kind': 'compare', 'op': token['value'], 'left': left, 'right': right[0]}, right[1])
            continue
        if _is_punct(token, '~'):
            right = _read_sum(tokens, position + 1)
            read = right and ({'kind': 'predicate', 'op': 'regexp', 'negate': False, 'args': [left, right[0]]}, right[1])
            continue
        if _is_word(token, 'is'):
            negate = _is_word(_token(tokens, position + 1), 'not')
            right = _read_sum(tokens, position + (2 if negate else 1))
            read = right and ({'kind': 'predicate', 'op': 'is', 'negate': negate, 'args': [left, right[0]]}, right[1])
            continue

        negate = _is_word(token, 'not')
        if negate:
            position += 1
        op = next((word for word in ('like', 'ilike', 'in', 'between') if _is_word(_token(tokens, position), word)), None)
        if not op:
            return None if negate else read

        if op in ('like', 'ilike'):
            pattern = _read_sum(tokens, position + 1)
            read = pattern and ({'kind': 'predicate', 'op': op, 'negate': negate, 'args': [left, pattern[0]]}, pattern[1])
        elif op == 'in':
            items = _read_list(tokens, position + 1)
            read = items and ({'kind': 'predicate', 'op': op, 'negate': negate, 'args': [left, *items[0]]}, items[1])
        else:
            low = _read_sum(tokens, position + 1)
            high = _read_sum(tokens, low[1] + 1) if low and _is_word(_token(tokens, low[1]), 'and') else None
            read = high and ({'kind': 'predicate', 'op': op, 'negate': negate, 'args': [left, low[0], high[0]]}, high[1])
    return None


def _read_list(tokens: list[ExpressionToken], index: int) -> Optional[tuple[list[ExpressionNode], int]]:
    """`(a, b, …)` from `index`: the expressions, and the index after the closing bracket."""
    if not _is_punct(_token(tokens, index), '('):
        return None
    nodes: list[ExpressionNode] = []
    position = index + 1
    while not _is_punct(_token(tokens, position), ')'):
        if position >= len(tokens):
            return None
        if nodes:
            if not _is_punct(_token(tokens, position), ','):
                return None
            position += 1
        item = _read_or(tokens, position)
        if not item:
            return None
        nodes.append(item[0])
        position = item[1]
    return nodes, position + 1


def _read_sum(tokens: list[ExpressionToken], index: int) -> Read:
    """`a + b - c …` from `index`, left to right, or a lone product, and the index after it."""
    return _read_arithmetic(tokens, index, ('+', '-'), _read_product)


def _read_product(tokens: list[ExpressionToken], index: int) -> Read:
    """`a * b / c // d % e …` from `index`, left to right, or a lone power, and the index after it."""
    return _read_arithmetic(tokens, index, ('*', '/', '//', '%'), _read_power)


def _read_power(tokens: list[ExpressionToken], index: int) -> Read:
    """`a ^ b ^ …` from `index`, right to left, so `2 ^ 3 ^ 2` is `2 ^ 9`, or a lone concatenation, and the index after it."""
    base = _read_concat(tokens, index)
    if not base or not _is_punct(_token(tokens, base[1]), '^'):
        return base
    exponent = _read_power(tokens, base[1] + 1)
    return exponent and ({'kind': 'arithmetic', 'op': '^', 'left': base[0], 'right': exponent[0]}, exponent[1])


def _read_arithmetic(tokens: list[ExpressionToken], index: int, ops: tuple[str, ...], read_operand: Callable[[list[ExpressionToken], int], Read]) -> Read:
    read = read_operand(tokens, index)
    while read:
        token = _token(tokens, read[1])
        if token is None or token['type'] != 'punct' or token['value'] not in ops:
            return read
        right = read_operand(tokens, read[1] + 1)
        read = right and ({'kind': 'arithmetic', 'op': token['value'], 'left': read[0], 'right': right[0]}, right[1])
    return None


def _read_concat(tokens: list[ExpressionToken], index: int) -> Read:
    """
    `a || b || …` from `index`, or a lone unary term, and the index after it.
    It is a call named `||`, kept apart from `concat`: QGIS gives NULL when any
    part of `||` is NULL, where `concat` skips it.
    """
    first = _read_unary(tokens, index)
    if not first:
        return None
    terms = [first[0]]
    position = first[1]
    while _is_punct(_token(tokens, position), '||'):
        term = _read_unary(tokens, position + 1)
        if not term:
            return None
        terms.append(term[0])
        position = term[1]
    return (terms[0] if len(terms) == 1 else {'kind': 'call', 'name': '||', 'args': terms}), position


def _read_unary(tokens: list[ExpressionToken], index: int) -> Read:
    """A term, or a minus or plus before one: a minus before a number is the negative number."""
    token = _token(tokens, index)
    if not _is_punct(token, '-') and not _is_punct(token, '+'):
        return _read_indexed(tokens, index)
    operand = _read_unary(tokens, index + 1)
    if not operand or _is_punct(token, '+'):
        return operand
    node = operand[0]
    return ({'kind': 'number', 'value': -node['value']} if node['kind'] == 'number' else {'kind': 'negate', 'arg': node}), operand[1]


def _read_indexed(tokens: list[ExpressionToken], index: int) -> Read:
    """A term and any `[index]` after it, read as `array_get`, as QGIS's index operator works on an array."""
    read = _read_term(tokens, index)
    while read and _is_punct(_token(tokens, read[1]), '['):
        position = _read_or(tokens, read[1] + 1)
        if not position or not _is_punct(_token(tokens, position[1]), ']'):
            return None
        read = {'kind': 'call', 'name': 'array_get', 'args': [read[0], position[0]]}, position[1] + 1
    return read


def _read_term(tokens: list[ExpressionToken], index: int) -> Read:
    """
    A field reference, quoted or bare, a string literal, a number, `TRUE`,
    `FALSE`, `NULL`, a bracketed expression, a `CASE`, or a call to one of the
    label functions, from `index`.
    """
    token = _token(tokens, index)
    after = _token(tokens, index + 1)
    if token is not None and token['type'] == 'field':
        return {'kind': 'field', 'name': token['value']}, index + 1
    if token is not None and token['type'] == 'text':
        return {'kind': 'text', 'value': token['value']}, index + 1
    if token is not None and token['type'] == 'number':
        return {'kind': 'number', 'value': token['value']}, index + 1
    if _is_punct(token, '('):
        inner = _read_or(tokens, index + 1)
        return (inner[0], inner[1] + 1) if inner and _is_punct(_token(tokens, inner[1]), ')') else None
    if token is None or token['type'] != 'name':
        return None

    if not _is_punct(after, '('):
        word = token['value'].lower()
        if word.startswith('$'):
            if word == '$now':
                return {'kind': 'call', 'name': 'now', 'args': []}, index + 1
            if word in GEOMETRY_VALUES or word == '$geometry' or word in FEATURE_COORDINATES:
                return {'kind': 'call', 'name': word, 'args': []}, index + 1
            return None
        # `@parent` is read inside an `aggregate` filter, and any other variable
        # where the caller says `variables`. A variable keeps its spelling, since
        # QGIS looks one up by its exact name.
        if word == '@parent':
            return {'kind': 'call', 'name': word, 'args': []}, index + 1
        if word.startswith('@'):
            return {'kind': 'call', 'name': token['value'], 'args': []}, index + 1
        if word in ('true', 'false'):
            return {'kind': 'boolean', 'value': word == 'true'}, index + 1
        if word == 'null':
            return {'kind': 'null'}, index + 1
        if word == 'case':
            return _read_case(tokens, index + 1)
        if word in QGIS_KEYWORDS:
            return None
        return {'kind': 'field', 'name': token['value']}, index + 1

    name = token['value'].lower()
    argument_range = _argument_range_of(name)
    if not argument_range:
        return None
    items = _read_arguments(tokens, index + 1, NAMED_PARAMETERS.get(name))
    if not items or len(items[0]) < argument_range[0] or len(items[0]) > argument_range[1]:
        return None
    return {'kind': 'call', 'name': name, 'args': items[0]}, items[1]


def _read_arguments(tokens: list[ExpressionToken], index: int, parameters: Optional[dict[str, Any]]) -> Optional[tuple[list[ExpressionNode], int]]:
    """
    A call's arguments from its opening bracket, each by position or as
    `name:=value`, in the order of the function's `parameters`, with a
    left-out one given its `omitted` value. As in QGIS, a value by position
    cannot follow a named one, and a name must be the function's and given
    once. None for a named value where the function has no `parameters`.
    """
    if not _is_punct(_token(tokens, index), '('):
        return None
    positional: list[ExpressionNode] = []
    named: dict[str, ExpressionNode] = {}
    position = index + 1
    while not _is_punct(_token(tokens, position), ')'):
        if position >= len(tokens):
            return None
        if positional or named:
            if not _is_punct(_token(tokens, position), ','):
                return None
            position += 1
        name_token = _token(tokens, position)
        is_named = name_token is not None and name_token['type'] == 'name' and _is_punct(_token(tokens, position + 1), ':=')
        item = _read_or(tokens, position + 2 if is_named else position)
        if not item:
            return None
        if is_named:
            names = parameters['names'] if parameters else []
            lowered = name_token['value'].lower()
            at = names.index(lowered) if lowered in names else -1
            if at < 0 or at < len(positional) or names[at] in named:
                return None
            named[names[at]] = item[0]
        else:
            if named:
                return None
            positional.append(item[0])
        position = item[1]
    if not named or parameters is None:
        return positional, position + 1
    nodes = [positional[at] if at < len(positional) else named.get(parameter, parameters['omitted']) for at, parameter in enumerate(parameters['names'])]
    return nodes, position + 1


def _read_case(tokens: list[ExpressionToken], index: int) -> Read:
    """`WHEN … THEN …`, one or more, an optional `ELSE …`, and `END`, from just after `CASE`."""
    whens: list[dict[str, ExpressionNode]] = []
    position = index
    while _is_word(_token(tokens, position), 'when'):
        when = _read_or(tokens, position + 1)
        if not when or not _is_word(_token(tokens, when[1]), 'then'):
            return None
        then = _read_or(tokens, when[1] + 1)
        if not then:
            return None
        whens.append({'when': when[0], 'then': then[0]})
        position = then[1]
    if not whens:
        return None

    otherwise: Optional[ExpressionNode] = None
    if _is_word(_token(tokens, position), 'else'):
        read = _read_or(tokens, position + 1)
        if not read:
            return None
        otherwise = read[0]
        position = read[1]
    return ({'kind': 'case', 'whens': whens, 'otherwise': otherwise}, position + 1) if _is_word(_token(tokens, position), 'end') else None


def _argument_range_of(name: str) -> Optional[tuple[float, float]]:
    """The fewest and most arguments a label function takes, or None for a function this reader does not read."""
    if name == 'concat':
        return (1, _INFINITY)
    if name in ONE_ARGUMENT_FUNCTIONS:
        return (1, 1)
    return QGIS_ONLY_FUNCTIONS.get(name)


def _child_nodes(node: ExpressionNode) -> list[ExpressionNode]:
    """The nodes directly under a node."""
    kind = node['kind']
    if kind in ('call', 'predicate', 'logic'):
        return node['args']
    if kind in ('arithmetic', 'compare'):
        return [node['left'], node['right']]
    if kind in ('negate', 'not'):
        return [node['arg']]
    if kind == 'case':
        children = [part for pair in node['whens'] for part in (pair['when'], pair['then'])]
        return children + ([node['otherwise']] if node['otherwise'] else [])
    return []


def _is_added_interval(node: ExpressionNode) -> bool:
    """Whether a node is a `+` or `-` with a `make_interval` call as its right side."""
    return node['kind'] == 'arithmetic' and node['op'] in ('+', '-') and node['right']['kind'] == 'call' and node['right']['name'] == 'make_interval'


def _find_dated_nows(node: ExpressionNode, dated: bool, dates: bool) -> list[ExpressionNode]:
    """
    The `now()` calls at or under a node that stand where the evaluator takes
    a date. `dated` says whether the node itself stands in one; `dates` is the
    caller's option, without which only the first argument of a `DATE_TAKERS`
    call does. The JavaScript's `findDatedNows`.
    """
    if node['kind'] == 'call' and node['name'] == 'now':
        return [node] if dated else []
    found = []
    for child, child_dated in _dated_children(node, dated, dates):
        found += _find_dated_nows(child, child_dated, dates)
    return found


def _dated_children(node: ExpressionNode, dated: bool, dates: bool) -> list[tuple[ExpressionNode, bool]]:
    """The nodes directly under a node, each with whether it stands where a date is taken."""
    kind = node['kind']
    if kind == 'call' and node['name'] in DATE_TAKERS:
        return [(arg, index == 0) for index, arg in enumerate(node['args'])]
    if dates:
        if kind == 'compare':
            return [(node['left'], True), (node['right'], True)]
        if _is_added_interval(node):
            return [(node['left'], dated), (node['right'], False)]
        if kind == 'call' and node['name'] == 'if':
            return [(arg, dated and index > 0) for index, arg in enumerate(node['args'])]
        if kind == 'call' and node['name'] == 'coalesce':
            return [(arg, dated) for arg in node['args']]
        if kind == 'case':
            children = [part for pair in node['whens'] for part in ((pair['when'], False), (pair['then'], dated))]
            return children + ([(node['otherwise'], dated)] if node['otherwise'] else [])
    return [(child, False) for child in _child_nodes(node)]


def _find_added_intervals(node: ExpressionNode) -> list[ExpressionNode]:
    """The `make_interval` calls that are the right side of a `+` or `-` at or under a node."""
    found = []
    if _is_added_interval(node):
        found.append(node['right'])
    for child in _child_nodes(node):
        found += _find_added_intervals(child)
    return found


def _are_lookups_readable(root: ExpressionNode, allowed: bool) -> bool:
    """
    Whether an expression's reads of other layers are ones the caller can
    answer: with `allowed` false, it holds none. The JavaScript's comment on
    `areLookupsReadable` lists the forms read.
    """
    found = _find_calls(root, *LOOKUPS)
    if not found:
        return not _find_calls(root, 'array_first', 'array_get', *PARENT_GEOMETRY_CALLS)
    if not allowed or not all(_is_readable_lookup(call) for call in found):
        return False
    overlays = [call for call in found if call['name'] != 'aggregate']
    readers = _find_calls(root, 'array_first', 'array_get')
    if len(readers) != len(overlays):
        return False
    if not all(any(reader['args'][0] is overlay for overlay in overlays) for reader in readers):
        return False
    if any(reader['name'] == 'array_get' and not _is_whole_number(_arg(reader, 1)) for reader in readers):
        return False
    filter_calls = len([call for call in found if call['name'] == 'aggregate']) * len(PARENT_GEOMETRY_CALLS)
    return len(_find_calls(root, *PARENT_GEOMETRY_CALLS)) == filter_calls


def _is_whole_number(node: Optional[ExpressionNode]) -> bool:
    """`Number.isInteger` of a number node's value."""
    if node is None or node['kind'] != 'number':
        return False
    value = node['value']
    return isinstance(value, int) or (math.isfinite(value) and value == math.floor(value))


def _lookup_arguments(call: ExpressionNode) -> dict[str, ExpressionNode]:
    """The arguments a lookup was given, by name, a left-out one read as NULL."""
    names = NAMED_PARAMETERS[call['name']]['names']
    return {name: call['args'][at] if at < len(call['args']) else {'kind': 'null'} for at, name in enumerate(names)}


def _reads_target_fields_only(node: ExpressionNode) -> bool:
    """An expression over the target's own fields: no read of another layer, form, shape or variable."""
    return (not _find_calls(node, *LOOKUPS, *PARENT_GEOMETRY_CALLS, 'array_first', 'array_get', 'current_value', *AGGREGATES, *GEOMETRY_VALUES)
            and not _find_variables(node))


def _is_parent_intersects_filter(node: ExpressionNode) -> bool:
    if node['kind'] != 'call' or node['name'] != 'intersects':
        return False

    def is_parent_shape(arg: Optional[ExpressionNode]) -> bool:
        inner = _arg(arg, 0)
        return (arg is not None and arg['kind'] == 'call' and arg['name'] == 'geometry'
                and inner is not None and inner['kind'] == 'call' and inner['name'] == '@parent')

    first, second = _arg(node, 0), _arg(node, 1)
    return (_is_record_shape(first) and is_parent_shape(second)) or (is_parent_shape(first) and _is_record_shape(second))


# The values of `sort_by_intersection_size` that QGIS takes: `des` for the largest overlap first, `asc` for the smallest.
OVERLAP_SORTS = {'des': 'descending', 'asc': 'ascending'}


def _is_readable_lookup(call: ExpressionNode) -> bool:
    args = _lookup_arguments(call)
    layer = args['layer']
    expression = args['expression']
    if layer['kind'] != 'text' or not js_trim(layer['value']):
        return False
    if expression['kind'] == 'null' or not _reads_target_fields_only(expression):
        return False
    if call['name'] == 'aggregate':
        aggregate = args['aggregate']
        return (aggregate['kind'] == 'text'
                and aggregate['value'].lower() in LOOKUP_AGGREGATES
                and _is_parent_intersects_filter(args['filter'])
                and args['concatenator']['kind'] in ('null', 'text')
                and args['order_by']['kind'] == 'null')
    is_readable_overlay = ((args['filter']['kind'] == 'null' or _reads_target_fields_only(args['filter']))
                           and (args['limit']['kind'] == 'null' or _is_whole_number(args['limit']))
                           and args['cache']['kind'] in ('null', 'boolean'))
    if call['name'] == 'overlay_nearest':
        max_distance = args['max_distance']
        return is_readable_overlay and (max_distance['kind'] == 'null' or (max_distance['kind'] == 'number' and max_distance['value'] >= 0))
    if call['name'] == 'overlay_intersects':
        sort = args['sort_by_intersection_size']
        return (is_readable_overlay
                and args['min_overlap']['kind'] == 'null'
                and args['min_inscribed_circle_radius']['kind'] == 'null'
                and args['return_details']['kind'] == 'null'
                and (sort['kind'] == 'null' or (sort['kind'] == 'text' and js_trim(sort['value']).lower() in OVERLAP_SORTS)))
    return is_readable_overlay


def _to_layer_lookup(call: ExpressionNode) -> LayerLookup:
    """The `LayerLookup` a readable lookup call makes."""
    args = _lookup_arguments(call)
    is_aggregate = call['name'] == 'aggregate'
    layer = args['layer']
    limit = args.get('limit')
    is_nearest = call['name'] == 'overlay_nearest'
    sort = args.get('sort_by_intersection_size')
    max_distance = args.get('max_distance')
    # `overlay_nearest` gives the one nearest feature unless it is given a limit, and every one for a limit of -1.
    if is_aggregate:
        kept: Optional[float] = None
    elif limit is not None and limit['kind'] == 'number':
        kept = limit['value'] if limit['value'] >= 0 else None
    else:
        kept = 1 if is_nearest else None
    lookup: dict[str, Any] = {
        'layer': js_trim(layer['value']) if layer['kind'] == 'text' else '',
        'predicate': 'within' if call['name'] == 'overlay_within' else 'nearest' if is_nearest else 'intersects',
        'expression': args['expression'],
        'filter': None if is_aggregate or args['filter']['kind'] == 'null' else args['filter'],
        'limit': kept,
    }
    if sort is not None and sort['kind'] == 'text':
        lookup['sortByOverlap'] = OVERLAP_SORTS.get(js_trim(sort['value']).lower())
    if max_distance is not None and max_distance['kind'] == 'number':
        lookup['maxDistance'] = max_distance['value']
    return {'key': js_json_stringify(lookup), **lookup}


def read_layer_lookups(node: ExpressionNode) -> list[LayerLookup]:
    """The reads of other layers in an expression `read_qgis_expression` read with `lookups`, one per distinct read."""
    found: dict[str, LayerLookup] = {}
    for call in _find_calls(node, *LOOKUPS):
        lookup = _to_layer_lookup(call)
        found[lookup['key']] = lookup
    return list(found.values())


def _find_calls(node: ExpressionNode, *names: str) -> list[ExpressionNode]:
    """The calls to any of the named functions at or under a node."""
    found = [node] if node['kind'] == 'call' and node['name'] in names else []
    for child in _child_nodes(node):
        found += _find_calls(child, *names)
    return found


def read_current_value_fields(node: ExpressionNode) -> Optional[list[str]]:
    """
    The form fields an expression reads through `current_value`, or None where
    QGIS could not tell: this reader takes a text literal as the one constant
    argument. An empty list is an expression that reads no form value.
    """
    fields: list[str] = []
    for call in _find_calls(node, 'current_value'):
        arg = _arg(call, 0)
        if arg is None or arg['kind'] != 'text' or not arg['value']:
            return None
        fields.append(arg['value'])
    return fields


def read_expression_fields(node: ExpressionNode) -> list[str]:
    """The fields an expression names, each once, in the order it first names them."""
    own = [node['name']] if node['kind'] == 'field' else []
    names = own + [name for child in _child_nodes(node) for name in read_expression_fields(child)]
    return list(dict.fromkeys(names))


def expression_to_template(node: ExpressionNode) -> Optional[str]:
    """
    The `{{field}}` template of a label made only of fields, text and joins,
    or None where it holds anything else. A `||` join is a template only when
    none of its parts can be NULL.
    """
    kind = node['kind']
    if kind == 'field':
        return f"{{{{{node['name']}}}}}"
    if kind == 'text':
        return node['value']
    if kind == 'number':
        return js_number_string(node['value'])
    if kind == 'boolean':
        return 'true' if node['value'] else 'false'
    if kind == 'null':
        return ''
    if kind == 'call':
        if node['name'] == '||' and not all(arg['kind'] in ('text', 'number', 'boolean') for arg in node['args']):
            return None
        if node['name'] not in ('concat', '||'):
            return None
        parts = [expression_to_template(arg) for arg in node['args']]
        return ''.join(part for part in parts if part is not None) if all(part is not None for part in parts) else None
    return None


def expression_to_geo_styler_function(node: ExpressionNode) -> Any:
    """
    The GeoStyler function for a label. A comparison, `AND`, `OR`, `NOT`,
    `IN`, `BETWEEN`, `CASE` and the four arithmetic operators take GeoStyler's
    own names (`add`, `sub`, `mul`, `div`); `IS`, `LIKE`, `ILIKE` and
    `QGIS_ONLY_FUNCTIONS` are `custom` functions with the QGIS name.
    """
    def negated(fn: Any, negate: bool) -> Any:
        return {'name': 'not', 'args': [fn]} if negate else fn

    kind = node['kind']
    if kind == 'field':
        return {'name': 'property', 'args': [node['name']]}
    if kind == 'null':
        return None
    if kind in ('text', 'number', 'boolean'):
        return node['value']
    if kind == 'compare':
        return {'name': COMPARISON_FUNCTIONS[node['op']], 'args': [expression_to_geo_styler_function(node['left']), expression_to_geo_styler_function(node['right'])]}
    if kind == 'logic':
        return {'name': 'all' if node['op'] == 'and' else 'any', 'args': [expression_to_geo_styler_function(arg) for arg in node['args']]}
    if kind == 'not':
        return {'name': 'not', 'args': [expression_to_geo_styler_function(node['arg'])]}
    if kind == 'arithmetic':
        return {'name': ARITHMETIC_FUNCTIONS[node['op']], 'args': [expression_to_geo_styler_function(node['left']), expression_to_geo_styler_function(node['right'])]}
    if kind == 'negate':
        return {'name': 'custom', 'fnName': 'negate', 'args': [expression_to_geo_styler_function(node['arg'])]}
    if kind == 'predicate':
        args = [expression_to_geo_styler_function(arg) for arg in node['args']]
        fn = {'name': node['op'], 'args': args} if node['op'] in ('in', 'between') else {'name': 'custom', 'fnName': node['op'], 'args': args}
        return negated(fn, node['negate'])
    if kind == 'case':
        return {
            'name': 'case',
            'args': [
                expression_to_geo_styler_function(node['otherwise']) if node['otherwise'] else None,
                *({'case': expression_to_geo_styler_function(pair['when']), 'value': expression_to_geo_styler_function(pair['then'])} for pair in node['whens']),
            ],
        }
    # A call.
    if _is_coordinate_call(node):
        return _coordinate_function(node)
    variable = _variable_name(node)
    if variable is not None:
        return {'name': 'custom', 'fnName': EXPRESSION_VARIABLE, 'args': [variable]}
    point = _variable_name(_arg(node, 0))
    name = node['name']
    if name in POINT_PARTS and point is not None:
        return {'name': 'custom', 'fnName': EXPRESSION_VARIABLE, 'args': [point, name]}
    args = [expression_to_geo_styler_function(arg) for arg in node['args']]
    if name == 'concat':
        return {'name': 'strConcat', 'args': args}
    if name == '||':
        return {'name': 'custom', 'fnName': '||', 'args': args}
    if name in GEOMETRY_VALUES:
        return {'name': 'custom', 'fnName': name, 'args': [node.get('factor')]}
    if name in ('overlay_within', 'overlay_intersects', 'overlay_nearest'):
        return {'name': 'custom', 'fnName': LAYER_LOOKUP, 'args': [_to_layer_lookup(node)['key']]}
    if name == 'aggregate':
        lookup_args = _lookup_arguments(node)
        aggregate, concatenator = lookup_args['aggregate'], lookup_args['concatenator']
        return {
            'name': 'custom',
            'fnName': 'aggregate',
            'args': [
                aggregate['value'].lower() if aggregate['kind'] == 'text' else None,
                concatenator['value'] if concatenator['kind'] == 'text' else '',
                {'name': 'custom', 'fnName': LAYER_LOOKUP, 'args': [_to_layer_lookup(node)['key']]},
            ],
        }
    if name in QGIS_ONLY_FUNCTIONS:
        return {'name': 'custom', 'fnName': name, 'args': args}
    # A name with no GeoStyler function, which the JavaScript writes as `name: undefined` and JSON leaves out.
    function_name = ONE_ARGUMENT_FUNCTIONS.get(name)
    return {'name': function_name, 'args': args} if function_name is not None else {'args': args}
