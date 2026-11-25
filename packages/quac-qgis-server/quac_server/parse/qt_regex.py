"""
Mirrors `packages/quac/src/parse/qtRegex.ts`.

QGIS hands a regular expression to Qt's `QRegularExpression`, which is PCRE2.
The JavaScript translates the forms it reads into a JavaScript `RegExp` and
gives null for any other pattern; this module reads the same forms, refuses
the same patterns, and writes each one as a Python `re` pattern that matches
what the JavaScript's does. The module comment in `qtRegex.ts` lists the
forms and the reasons for each refusal.

Where the two engines write a form differently, the Python is written out:
`\\d`, `\\w`, `\\s` and `\\b` are classes or lookarounds over the characters the
JavaScript names (Python's own are Unicode where the JavaScript's are ASCII),
`$` is `(?=\\n?\\Z)`, and a lookbehind holding a `|` is one lookbehind per
branch, as Python asks each lookbehind to have one length.
"""

from __future__ import annotations

import re
import sys
import unicodedata
import warnings
from typing import Any, Iterator, Optional

_ASCII_WORD = 'A-Za-z0-9_'
_ASCII_SPACE = '\\t\\n\\v\\f\\r '

# The escapes that stand for a set of characters, which PCRE2 will not take as the end of a range.
_CLASS_TYPES = frozenset('dDwWsS')

_SYNTAX = frozenset('^$\\.*+?()[]{}|/')

_unicode_classes: dict[str, str] = {}


def _unicode_class(name: str) -> str:
    """
    The inside of a class holding `\\p{Nd}` (`digit`), `\\p{L}`, `\\p{N}` and `_`
    (`word`), or the spaces of `\\s` with `\\p{Z}` (`space`), as ranges built from
    Python's `unicodedata`.
    """
    if not _unicode_classes:
        found: dict[str, list[list[int]]] = {'digit': [], 'word': [], 'space': []}
        for code in range(sys.maxunicode + 1):
            category = unicodedata.category(chr(code))
            for kind, matches in (('digit', category == 'Nd'), ('word', category[0] in 'LN' or code == 0x5F), ('space', category[0] == 'Z' or code in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x85, 0x180E))):
                if not matches:
                    continue
                ranges = found[kind]
                if ranges and ranges[-1][1] == code - 1:
                    ranges[-1][1] = code
                else:
                    ranges.append([code, code])
        for kind, ranges in found.items():
            _unicode_classes[kind] = ''.join(f'\\U{low:08X}' if low == high else f'\\U{low:08X}-\\U{high:08X}' for low, high in ranges)
    return _unicode_classes[name]


def _word_boundary(word: str, negate: bool) -> str:
    if negate:
        return f'(?=(?<=[{word}])(?=[{word}])|(?<![{word}])(?![{word}]))'
    return f'(?=(?<=[{word}])(?![{word}])|(?<![{word}])(?=[{word}]))'


def _literal(char: str, in_class: bool) -> str:
    """A character that stands for itself, escaped where the pattern needs it to be."""
    if char == '-':
        return '\\-' if in_class else '-'
    return f'\\{char}' if char in _SYNTAX else char


def _atom_of(source: str) -> dict[str, Any]:
    return {'source': source, 'captures': False, 'assertion': False, 'empty': False, 'chooses': False}


def _assertion_of(source: str) -> dict[str, Any]:
    return {'source': source, 'captures': False, 'assertion': True, 'empty': True, 'chooses': False}


_QUANTIFIER = re.compile(r'(?:([*+?])|\{([0-9]+)(?:(,)([0-9]*))?\})(\??)')
_SPACED_QUANTIFIER = re.compile(r'\{[ \t]*(?:[0-9]+[ \t]*(?:,[ \t]*[0-9]*[ \t]*)?\}|,)')
_INFINITY = float('inf')


class _Translation:
    """One PCRE2 pattern read into Python's form, following the JavaScript's `translate`."""

    def __init__(self, pattern: str, unicode: bool) -> None:
        self.pattern = pattern
        self.unicode = unicode
        self.index = 0
        self.ignore_case = False

    def at(self, offset: int = 0) -> Optional[str]:
        position = self.index + offset
        return self.pattern[position] if 0 <= position < len(self.pattern) else None

    def escape(self, in_class: bool) -> Optional[dict[str, Any]]:
        """
        One `\\` escape at `index`, which points at the backslash: what it adds
        to a class (`members`, or a set it is not in, `excluded`) or, outside
        one, its `source`; None where it is not read.
        """
        char = self.at(1)
        if char is None:
            return None
        self.index += 2
        unicode, ignore_case = self.unicode, self.ignore_case
        if char == 'd':
            digits = _unicode_class('digit') if unicode else '0-9'
            return {'members': digits} if in_class else {'source': f'[{digits}]'}
        if char == 'D':
            if unicode:
                return None if in_class else {'source': f"[^{_unicode_class('digit')}]"}
            return {'excluded': '0-9'} if in_class else {'source': '[^0-9]'}
        if char == 'w':
            if unicode:
                word = _unicode_class('word')
                return {'members': word} if in_class else {'source': f'[{word}]'}
            if ignore_case:
                return None
            return {'members': _ASCII_WORD} if in_class else {'source': f'[{_ASCII_WORD}]'}
        if char == 'W':
            if unicode:
                return None if in_class else {'source': f"[^{_unicode_class('word')}]"}
            if ignore_case:
                return None
            return {'excluded': _ASCII_WORD} if in_class else {'source': f'[^{_ASCII_WORD}]'}
        if char == 's':
            space = _unicode_class('space') if unicode else _ASCII_SPACE
            return {'members': space} if in_class else {'source': f'[{space}]'}
        if char == 'S':
            return None if in_class else {'source': f"[^{_unicode_class('space') if unicode else _ASCII_SPACE}]"}
        if char in ('b', 'B'):
            if in_class or (not unicode and ignore_case):
                return None
            return {'source': _word_boundary(_unicode_class('word') if unicode else _ASCII_WORD, char == 'B')}
        if char in 'nrtf':
            return {'members': f'\\{char}'} if in_class else {'source': f'\\{char}'}
        if char == 'x':
            rest = self.pattern[self.index:]
            braced = re.match(r'\{([0-9A-Fa-f]{1,6})\}', rest)
            if braced:
                # PCRE2 in UTF mode refuses a surrogate, and JavaScript takes one.
                code = int(braced.group(1), 16)
                if 0xD800 <= code <= 0xDFFF:
                    return None
                # JavaScript refuses a code above U+10FFFF.
                if code > 0x10FFFF:
                    return None
                self.index += len(braced.group(0))
                escaped = f'\\U{code:08X}'
                return {'members': escaped} if in_class else {'source': escaped}
            hexadecimal = re.match(r'[0-9A-Fa-f]{2}', rest)
            if not hexadecimal:
                return None
            self.index += 2
            escaped = f'\\x{hexadecimal.group(0)}'
            return {'members': escaped} if in_class else {'source': escaped}
        if re.match(r'[A-Za-z0-9]', char):
            return None
        written = _literal(char, in_class)
        return {'members': written} if in_class else {'source': written}

    def read_class(self) -> Optional[str]:
        """A class at `index`, which points at its `[`."""
        members = ''
        excluded: list[str] = []
        self.index += 1
        negated = False
        if self.at() == '^':
            negated = True
            self.index += 1
        class_start = self.index
        # A `]` straight after the opening bracket is a member of the class in PCRE2.
        if self.at() == ']':
            members += '\\]'
            self.index += 1
        while self.index < len(self.pattern):
            char = self.pattern[self.index]
            if char == ']':
                self.index += 1
                return _class_source(members, excluded, negated)
            if char == '\\':
                start = self.index
                part = self.escape(True)
                if part is None:
                    return None
                if self.pattern[start + 1] in _CLASS_TYPES:
                    hyphen_before = start - 1 > class_start and self.pattern[start - 1] == '-' and self.pattern[start - 2] != '\\'
                    hyphen_after = self.at() == '-' and self.at(1) != ']'
                    if hyphen_before or hyphen_after:
                        return None
                if 'excluded' in part:
                    excluded.append(part['excluded'])
                else:
                    members += part['members']
                continue
            # `[:`, `[=` and `[.` start a POSIX class in PCRE2.
            if char == '[' and (self.at(1) or '') in (':', '=', '.'):
                return None
            members += '-' if char == '-' else _literal(char, True)
            self.index += 1
        return None

    def read_quantifier(self) -> Optional[dict[str, Any]]:
        """A quantifier at `index`, with the least and most times it repeats, or None where there is none."""
        found = _QUANTIFIER.match(self.pattern, self.index)
        if not found:
            return None
        lazy = found.group(5) == '?'
        if found.group(1):
            self.index = found.end()
            symbol = found.group(1)
            return {'text': found.group(0), 'min': 1 if symbol == '+' else 0, 'max': 1 if symbol == '?' else _INFINITY, 'lazy': lazy}
        minimum = int(found.group(2))
        maximum: float = (int(found.group(4)) if found.group(4) else _INFINITY) if found.group(3) else minimum
        # PCRE2 refuses a count above 65535, and JavaScript takes it; left in place, the `{` is not read as text either.
        if minimum > 65535 or (maximum > 65535 and maximum != _INFINITY):
            return None
        self.index = found.end()
        return {'text': found.group(0), 'min': minimum, 'max': maximum, 'lazy': lazy}

    def read_group(self, lookaround: bool) -> Optional[dict[str, Any]]:
        """A group at `index`, which points at its `(`."""
        if lookaround:
            return None
        rest = self.pattern[self.index + 1:]
        kind: Optional[str] = ''
        if rest.startswith('?'):
            kind = next((start for start in ('?:', '?=', '?!', '?<=', '?<!') if rest.startswith(start)), None)
        if kind is None:
            return None
        opening = f'({kind}'
        self.index += len(opening)
        lookbehind = kind in ('?<=', '?<!')
        is_lookaround = lookbehind or kind in ('?=', '?!')
        inner = self.read_alternatives(is_lookaround, lookbehind)
        if not inner or self.at() != ')':
            return None
        self.index += 1
        if lookbehind and len(inner['branches']) > 1:
            # Python asks each lookbehind to have one length, where the JavaScript takes a branch of each length.
            if kind == '?<=':
                source = '(?:' + '|'.join(f'(?<={branch})' for branch in inner['branches']) + ')'
            else:
                source = '(?:' + ''.join(f'(?<!{branch})' for branch in inner['branches']) + ')'
        else:
            source = f"{opening}{inner['source']})"
        return {'source': source, 'captures': kind == '' or inner['captures'], 'assertion': is_lookaround, 'empty': is_lookaround or inner['empty'], 'chooses': inner['chooses']}

    def read_atom(self, lookaround: bool) -> Optional[dict[str, Any]]:
        char = self.pattern[self.index]
        if char == '(':
            return self.read_group(lookaround)
        if char == '[':
            source = self.read_class()
            return None if source is None else _atom_of(source)
        if char == '\\':
            escaped = self.at(1)
            part = self.escape(False)
            if part is None:
                return None
            return _assertion_of(part['source']) if escaped in ('b', 'B') else _atom_of(part['source'])
        if char == '.':
            self.index += 1
            return _atom_of('[^\\n]')
        if char == '^':
            self.index += 1
            return _assertion_of('^')
        if char == '$':
            self.index += 1
            return _assertion_of('(?=\\n?\\Z)')
        # A quantifier with nothing to repeat, or one after another, which makes it possessive.
        if char in '*+?':
            return None
        if char == '{':
            # PCRE2 10.43 reads `{,n}`, and a count with spaces or tabs inside the braces, as a quantifier, and earlier versions as text.
            if _SPACED_QUANTIFIER.match(self.pattern, self.index):
                return None
            self.index += 1
            return _atom_of('\\{')
        self.index += 1
        return _atom_of(_literal(char, False))

    def read_alternatives(self, lookaround: bool, lookbehind: bool) -> Optional[dict[str, Any]]:
        """
        The branches up to a `)` or the end, whether a group in them captures,
        whether one of them can match the empty text, and whether they hold a
        `|` or a quantifier whose count can vary.
        """
        branches = ['']
        captures = False
        empty = False
        branch_empty = True
        chooses = False
        while self.index < len(self.pattern) and self.pattern[self.index] != ')':
            if self.pattern[self.index] == '|':
                chooses = True
                empty = empty or branch_empty
                branch_empty = True
                branches.append('')
                self.index += 1
                continue
            atom = self.read_atom(lookaround)
            if not atom:
                return None
            captures = captures or atom['captures']
            chooses = chooses or atom['chooses']
            quantifier = self.read_quantifier()
            branch_empty = branch_empty and (atom['empty'] or (quantifier is not None and quantifier['min'] == 0))
            if not quantifier:
                branches[-1] += atom['source']
                continue
            if atom['assertion']:
                return None
            if lookbehind and quantifier['min'] != quantifier['max']:
                return None
            chooses = chooses or quantifier['min'] != quantifier['max']
            # A repeat of a group that can split the same text more than one way can run for hours where PCRE2 gives up.
            if atom['chooses'] and quantifier['max'] > 1:
                return None
            # A group that captures or can match the empty text may repeat at most once, and an optional one is written as a
            # choice with the empty text, as the JavaScript writes it: `(X)?` as `(?:(X)|)`, and `(X)??` as `(?:|(X))`.
            differs = atom['captures'] or atom['empty']
            if differs and quantifier['max'] > 1:
                return None
            if differs and quantifier['min'] == 0 and quantifier['max'] == 1:
                branches[-1] += f"(?:|{atom['source']})" if quantifier['lazy'] else f"(?:{atom['source']}|)"
            else:
                branches[-1] += atom['source'] + quantifier['text']
        return {'source': '|'.join(branches), 'branches': branches, 'captures': captures, 'empty': empty or branch_empty, 'chooses': chooses}

    def translate(self) -> Optional[dict[str, Any]]:
        if self.pattern.startswith('(?i)'):
            self.ignore_case = True
            self.index = 4
        translated = self.read_alternatives(False, False)
        # A `)` that no group opened stops the reading early.
        if not translated or self.index < len(self.pattern):
            return None
        return {'source': translated['source'], 'ignoreCase': self.ignore_case}


def _class_source(members: str, excluded: list[str], negated: bool) -> str:
    """
    A class with its members and the sets it holds everything outside of
    (`\\D` and `\\W` of `~`, which a Python class cannot hold): a choice
    between them, or, negated, one character in none of the members and
    outside none of the sets.
    """
    if not excluded:
        return f"[{'^' if negated else ''}{members}]"
    if not negated:
        return '(?:' + '|'.join(([f'[{members}]'] if members else []) + [f'[^{inside}]' for inside in excluded]) + ')'
    ahead = (f'(?![{members}])' if members else '') + ''.join(f'(?=[{inside}])' for inside in excluded[:-1])
    return f'(?:{ahead}[{excluded[-1]}])'


def _translate(pattern: str, unicode: bool) -> Optional[dict[str, Any]]:
    """The Python source for one PCRE2 pattern, and whether it ignores case, or None where it is not on the list."""
    return _Translation(pattern, unicode).translate()


_COMPILED: dict[str, Optional[re.Pattern[str]]] = {}


def compile_qt_regex(pattern: str, unicode: bool) -> Optional[re.Pattern[str]]:
    """
    A PCRE2 pattern as a compiled Python pattern that matches what QGIS
    matches, or None where this package cannot translate it, or where the
    result does not compile. `unicode` is QGIS's `UseUnicodePropertiesOption`:
    on for the `regexp_` functions, off for `~`.
    """
    key = f"{'u' if unicode else 'a'}|{pattern}"
    if key not in _COMPILED:
        translated = _translate(pattern, unicode)
        regex: Optional[re.Pattern[str]] = None
        if translated:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore')
                    regex = re.compile(translated['source'], re.IGNORECASE if translated['ignoreCase'] else 0)
            except (re.error, OverflowError, RecursionError):
                regex = None
        _COMPILED[key] = regex
    return _COMPILED[key]


def _qt_global_matches(text: str, regex: re.Pattern[str]) -> Iterator[re.Match[str]]:
    """
    Every match in the text, as `QRegularExpression::globalMatch` finds them
    (`src/corelib/text/qregularexpression.cpp`, `qt/qtbase@3a00b02`, read
    2026-10-27): after an empty match it tries again at the same place for one
    that is not empty, and only then moves on one character. The retry asks
    that the match not end where it began, with a lookbehind that counts the
    characters before that place.
    """
    position = 0
    retry_at = -1
    while position <= len(text):
        if retry_at == position:
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                not_empty = re.compile(f'(?:{regex.pattern})(?<!\\A[\\s\\S]{{{position}}})', regex.flags)
            match = not_empty.match(text, position)
            if not match:
                position += 1
                retry_at = -1
                continue
        else:
            match = regex.search(text, position)
            if not match:
                return
        yield match
        position = match.end()
        retry_at = position if match.group(0) == '' else -1


def replace_qt_regex(text: str, regex: re.Pattern[str], after: str) -> str:
    """
    `QString::replace` with a pattern (`src/corelib/text/qstring.cpp`,
    `qt/qtbase@3a00b02`, read 2026-10-26), which `regexp_replace` calls: every
    match is replaced, and in the replacement `\\1` to `\\99` stand for that
    group where the pattern has it, taking a second digit only where the
    pattern has that many groups. Any other backslash stays as written, and a
    group that took no part gives nothing.
    """
    groups = regex.groups
    references: list[tuple[int, int, int]] = []
    for at in range(len(after) - 1):
        if after[at] != '\\':
            continue
        digit = after[at + 1]
        if not ('0' <= digit <= '9' and 0 < int(digit) <= groups):
            continue
        group = int(digit)
        length = 2
        second = after[at + 2] if at + 2 < len(after) else None
        if second is not None and '0' <= second <= '9' and group * 10 + int(second) <= groups:
            group = group * 10 + int(second)
            length = 3
        references.append((at, length, group))

    result = ''
    last_end = 0
    for match in _qt_global_matches(text, regex):
        result += text[last_end:match.start()]
        after_end = 0
        for at, length, group in references:
            result += after[after_end:at] + (match.group(group) or '')
            after_end = at + length
        result += after[after_end:]
        last_end = match.end()
    return result + text[last_end:]
