"""
Reads the answers the JavaScript saved for the expression modules, in
`packages/quac/src/tests/answers/<module>.json` (written by
`packages/quac/src/tests/expressionAnswers.test.ts`), and writes a Python
answer as JSON would hold it, so the two compare.
"""

from __future__ import annotations

import dataclasses
import json
import math
from typing import Any

from .declared import QUAC_PACKAGE

ANSWERS = QUAC_PACKAGE / 'src' / 'tests' / 'answers'


def _number(text: str) -> Any:
    """A whole number as JavaScript reads it: past 2 ** 53 it is the nearest double, which the JSON writes with trailing zeros."""
    value = int(text)
    return value if abs(value) < 2 ** 53 else float(value)


def load(module: str) -> Any:
    return json.loads((ANSWERS / f'{module}.json').read_text(encoding='utf-8'), parse_int=_number)


def as_json(value: Any) -> Any:
    """A value as `JSON.stringify` writes it and JSON reads it back: NaN and the infinities as null, a tuple as a list."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return as_json(dataclasses.asdict(value))
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: as_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_json(item) for item in value]
    return value
