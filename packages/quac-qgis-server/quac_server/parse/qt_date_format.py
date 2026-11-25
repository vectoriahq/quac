"""
Mirrors `packages/quac/src/parse/qtDateFormat.ts`.

QGIS's date patterns are Qt's (`QLocale::toString`, which hands them to
`QCalendarBackend::dateTimeToString`, `src/corelib/text/qlocale.cpp`,
`qt/qtbase@3a00b02`, read 2026-10-26). This module splits a pattern the way Qt
does and formats a date under it for `format_date`.

The letters are `y`, `M`, `d`, `h`, `H`, `m`, `s`, `z`, `a`/`A` (with an
optional `p`/`P` after) and `t`. Any other character, and text in single
quotes, is written as it stands. `t` (a time zone's name or offset) is not
formatted, so a pattern holding it is not read.

The JavaScript works a moment out with its `Date` class, in the device's own
time zone; the helpers below do the same from the operating system's time
zone, as `Date` does: a local time that a change of clock skips is read with
the offset before the change, and one it repeats as the earlier moment.
"""

from __future__ import annotations

import datetime
import math
import re
import time
from typing import Any, Optional, Union

# One piece of a split pattern: `{'letter', 'count'}` for a run of one letter, `{'quoted'}` for text in quotes, `{'literal'}` for other characters.
QtPatternPiece = dict[str, Any]

# A moment and the zone it is shown in: `{'epoch': milliseconds, 'offsetMinutes': minutes or 'local'}`.
QtDateTime = dict[str, Any]

_DAY = 86_400_000


def split_qt_date_pattern(pattern: str) -> list[QtPatternPiece]:
    """
    A pattern split into runs of the same letter, quoted text and the characters
    between (`qt_repeatCount` and `qt_readEscapedFormatString`): `''` is a quote,
    inside quotes or out, and quoted text with no closing quote runs to the end.
    """
    pieces: list[QtPatternPiece] = []

    def push_literal(text: str) -> None:
        if pieces and 'literal' in pieces[-1]:
            pieces[-1]['literal'] += text
        else:
            pieces.append({'literal': text})

    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "'":
            if pattern[index + 1:index + 2] == "'":
                push_literal("'")
                index += 2
                continue
            text = ''
            index += 1
            while index < len(pattern):
                if pattern[index] == "'":
                    if pattern[index + 1:index + 2] != "'":
                        break
                    text += "'"
                    index += 2
                else:
                    text += pattern[index]
                    index += 1
            index += 1
            pieces.append({'quoted': text})
        elif re.match(r'[A-Za-z]', char):
            end = index
            while end < len(pattern) and pattern[end] == char:
                end += 1
            pieces.append({'letter': char, 'count': end - index})
            index = end
        else:
            push_literal(char)
            index += 1
    return pieces


def is_formattable_qt_date_pattern(pattern: str) -> bool:
    """Whether `format_date` formats a pattern: true unless it names a time zone with `t`."""
    return all('letter' not in piece or piece['letter'] != 't' for piece in split_qt_date_pattern(pattern))


def _days_from_civil(year: int, month: int, day: int) -> int:
    """The days from 1970-01-01 to a date of the proleptic Gregorian calendar."""
    year -= month <= 2
    era = (year if year >= 0 else year - 399) // 400
    year_of_era = year - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    return era * 146097 + day_of_era - 719468


def _civil_from_days(days: int) -> tuple[int, int, int]:
    """The date of the proleptic Gregorian calendar that is a number of days from 1970-01-01."""
    days += 719468
    era = (days if days >= 0 else days - 146096) // 146097
    day_of_era = days - era * 146097
    year_of_era = (day_of_era - day_of_era // 1460 + day_of_era // 36524 - day_of_era // 146096) // 365
    day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4 - year_of_era // 100)
    shifted_month = (5 * day_of_year + 2) // 153
    day = day_of_year - (153 * shifted_month + 2) // 5 + 1
    month = shifted_month + (3 if shifted_month < 10 else -9)
    return year_of_era + era * 400 + (month <= 2), month, day


def _local_offset(epoch: int) -> int:
    """The device's offset from UTC at a moment, in milliseconds."""
    try:
        return time.localtime(epoch // 1000).tm_gmtoff * 1000
    except (OverflowError, OSError, ValueError):
        # Where the system refuses a moment, such as one before 1970, the offset at 1970 stands in.
        return time.localtime(0).tm_gmtoff * 1000


def _utc_of_local(local: int) -> int:
    """
    The moment a local time stands for, as `Date` reads one: the earlier of two
    where the clock repeats it, and with the offset before the change where the
    clock skips it.
    """
    before = _local_offset(local - _DAY)
    after = _local_offset(local + _DAY)
    instants = [local - offset for offset in sorted({before, after}) if _local_offset(local - offset) == offset]
    return min(instants) if instants else local - before


def _local_epoch(year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0, msec: int = 0) -> int:
    """A local date and time, from parts, as `new Date(0)` and its `setFullYear` and `setHours` give it, for years below 100 too."""
    start_local = _local_offset(0) % _DAY
    moment = _utc_of_local(_days_from_civil(year, month, day) * _DAY + start_local)
    local_day = (moment + _local_offset(moment)) // _DAY
    return _utc_of_local(local_day * _DAY + ((hour * 60 + minute) * 60 + second) * 1000 + msec)


def _utc_epoch(year: int, month: int, day: int, hour: int, minute: int, second: int, msec: int) -> int:
    return _days_from_civil(year, month, day) * _DAY + ((hour * 60 + minute) * 60 + second) * 1000 + msec


_DAYS_IN_MONTH_2000 = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def _is_real_date(year: int, month: int, day: int) -> bool:
    if month < 1 or month > 12 or day < 1:
        return False
    return day <= _DAYS_IN_MONTH_2000[month - 1] and not (month == 2 and day == 29 and not (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)))


_ISO_TIME = re.compile(r'([0-9]{2})(?::([0-9]{2})(?::([0-9]{2})(?:[.,]([0-9]+))?)?)?\Z')
_ISO_OFFSET = re.compile(r'([+-])([0-9]{2})(?::?([0-9]{2}))?\Z')


def _read_iso_time(text: str) -> Optional[dict[str, int]]:
    """`HH`, `HH:mm`, `HH:mm:ss` or `HH:mm:ss.zzz` (`fromIsoTimeString`, `qdatetime.cpp`), with 24:00 allowed."""
    match = _ISO_TIME.match(text)
    if not match:
        return None
    hour, minute, second = int(match.group(1)), int(match.group(2) or 0), int(match.group(3) or 0)
    # `Math.round`, which rounds a half up.
    msec = math.floor(float(f'0.{match.group(4)}') * 1000 + 0.5) if match.group(4) else 0
    if hour > 24 or minute > 59 or second > 59:
        return None
    if hour == 24 and (minute or second or msec):
        return None
    # A fraction that rounds up to a whole second is kept as 999, as QTime cannot hold 1000.
    return {'hour': hour, 'minute': minute, 'second': second, 'msec': min(msec, 999)}


def _epoch_of_datetime(value: datetime.datetime) -> int:
    """A Python date-time as `Date` holds one: an aware one's moment, and a naive one read as local time."""
    if value.tzinfo is not None and value.utcoffset() is not None:
        return (value - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)) // datetime.timedelta(milliseconds=1)
    return _utc_of_local(_days_from_civil(value.year, value.month, value.day) * _DAY
                         + ((value.hour * 60 + value.minute) * 60 + value.second) * 1000 + value.microsecond // 1000)


def read_qt_date_time(value: Any) -> Optional[QtDateTime]:
    """
    A value as QGIS's `getDateTimeValue` reads one for `format_date`
    (`src/core/expression/qgsexpressionutils.h`, `qgis/QGIS@16eddb2`, read
    2026-10-26): a Python date-time (where the JavaScript takes a `Date`, as
    `now()` gives) in the device's zone, or text Qt reads as an ISO date-time
    (`QDateTime::fromString` with `Qt::ISODate`, `qdatetime.cpp`,
    `qt/qtbase@3a00b02`). That is `yyyy-MM-dd`, at midnight on its own, or
    followed by `T` or a space and a time, with `Z` for UTC or an offset such
    as `+10:00`; with neither it is the device's time. Text that is only a
    time is that time on 1 January of year 1. None for anything else, where
    QGIS reports an error.
    """
    if isinstance(value, datetime.datetime):
        return {'epoch': _epoch_of_datetime(value), 'offsetMinutes': 'local'}
    if not isinstance(value, str):
        return None

    date = re.match(r'([0-9]{4})-([0-9]{2})-([0-9]{2})', value)
    if not date:
        time_only = _read_iso_time(value)
        if time_only and time_only['hour'] < 24:
            return {'epoch': _local_epoch(1, 1, 1, time_only['hour'], time_only['minute'], time_only['second'], time_only['msec']), 'offsetMinutes': 'local'}
        return None
    year, month, day = int(date.group(1)), int(date.group(2)), int(date.group(3))
    if not _is_real_date(year, month, day):
        return None
    if len(value) == 10:
        return {'epoch': _local_epoch(year, month, day), 'offsetMinutes': 'local'}
    if value[10] not in 'Tt ':
        return None

    rest = value[11:]
    offset_minutes: Union[int, str] = 'local'
    if rest.endswith(('Z', 'z')):
        offset_minutes = 0
        rest = rest[:-1]
    else:
        sign = max(rest.rfind('+'), rest.rfind('-'))
        if sign >= 0:
            offset = _ISO_OFFSET.match(rest[sign:])
            if not offset:
                return None
            offset_minutes = (-1 if offset.group(1) == '-' else 1) * (int(offset.group(2)) * 60 + int(offset.group(3) or 0))
            rest = rest[:sign]
    moment = _read_iso_time(rest)
    if not moment:
        return None
    if offset_minutes == 'local':
        epoch = _local_epoch(year, month, day, moment['hour'], moment['minute'], moment['second'], moment['msec'])
    else:
        epoch = _utc_epoch(year, month, day, moment['hour'], moment['minute'], moment['second'], moment['msec']) - offset_minutes * 60_000
    return {'epoch': epoch, 'offsetMinutes': offset_minutes}


def _parts_of(value: QtDateTime) -> dict[str, int]:
    """The calendar parts of a moment as shown in its zone."""
    epoch = value['epoch']
    shown = epoch + (_local_offset(epoch) if value['offsetMinutes'] == 'local' else value['offsetMinutes'] * 60_000)
    days, within = divmod(shown, _DAY)
    year, month, day = _civil_from_days(days)
    return {
        'year': year,
        'month': month,
        'day': day,
        'weekday': (days + 4) % 7,
        'hour': within // 3_600_000,
        'minute': within // 60_000 % 60,
        'second': within // 1000 % 60,
        'msec': within % 1000,
    }


def _iso_week(year: int, month: int, day: int) -> int:
    """The ISO 8601 week of a date, 1 to 53, as `QDate::weekNumber` gives it: the week holding the year's first Thursday is week 1."""
    days = _days_from_civil(year, month, day)
    thursday = days + 3 - ((days + 4 + 6) % 7)
    first = _days_from_civil(_civil_from_days(thursday)[0], 1, 1)
    return (thursday - first) // 7 + 1


_DATE_ONLY = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}\Z')


def qt_date_part(part: str, value: Any) -> Optional[int]:
    """
    A part of a date, as QGIS's `year`, `month`, `day`, `week`, `day_of_week`,
    `hour`, `minute` and `second` give it (`fcnYear` to `fcnSeconds`,
    `fcnDayOfWeek` and `fcnWeek`, `src/core/expression/qgsexpressionfunction.cpp`,
    `qgis/QGIS@16eddb2`, read 2026-10-26). The value is read as `format_date`
    reads one (`read_qt_date_time`) and the part is taken in its zone. A time
    alone is read on 0001-01-01, and QGIS takes no time from a date alone and
    no weekday from a time alone, which give None. `day_of_week` counts from 0
    for Sunday.
    """
    moment = read_qt_date_time(value)
    if not moment:
        return None
    time_only = isinstance(value, str) and not re.match(r'[0-9]{4}-', value)
    date_only = isinstance(value, str) and bool(_DATE_ONLY.match(value))
    parts = _parts_of(moment)
    if part in ('year', 'month', 'day'):
        return parts[part]
    if part == 'week':
        return _iso_week(parts['year'], parts['month'], parts['day'])
    if part == 'day_of_week':
        return None if time_only else parts['weekday']
    if part in ('hour', 'minute', 'second'):
        return None if date_only else parts[part]
    return None


# The names `Intl.DateTimeFormat` gives in `en-AU`, the language `format_date` uses where none is given: each in the form used inside a date, as Qt's names are.
_EN_AU_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
_EN_AU_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
_EN_AU_WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
_EN_AU_WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']


def format_qt_date_time(value: QtDateTime, pattern: str, language: Optional[str] = None) -> Optional[str]:
    """
    A date under a QGIS date pattern, as `format_date(datetime, format,
    language)` gives it (`fcnFormatDate`, `src/core/expression/qgsexpressionfunction.cpp`,
    `qgis/QGIS@16eddb2`, read 2026-10-26). A `Z` anywhere after the pattern's
    first character shows the moment in UTC. Month and day names and am and
    pm are in `language`; QGIS uses the computer's own language when none is
    given, and this function uses `en-AU`, as `format_number` does. None for a
    pattern holding `t`, and for any language but `en-AU`, which the
    JavaScript names in the browser's languages.
    """
    if not is_formattable_qt_date_pattern(pattern):
        return None
    shown = {**value, 'offsetMinutes': 0} if pattern.find('Z') > 0 else value
    parts = _parts_of(shown)
    year, month, day, weekday = parts['year'], parts['month'], parts['day'], parts['weekday']
    hour, minute, second, msec = parts['hour'], parts['minute'], parts['second'], parts['msec']

    if language and language.replace('_', '-').lower() != 'en-au':
        return None

    def number(count: int, width: int) -> str:
        return f'{count:0{width}d}'

    zero = number(0, 1)
    day_period = 'am' if hour < 12 else 'pm'
    # `timeFormatContainsAP`: an `a` or `A` anywhere outside quotes makes `h` a 12-hour clock.
    pieces = split_qt_date_pattern(pattern)
    twelve_hour = any('letter' in piece and piece['letter'].lower() == 'a' for piece in pieces)

    result = ''
    for position, piece in enumerate(pieces):
        if 'quoted' in piece:
            result += piece['quoted']
            continue
        if 'literal' in piece:
            result += piece['literal']
            continue
        letter = piece['letter']
        left = piece['count']
        while left > 0:
            used = min(left, 3 if letter == 'z' else 4 if letter in ('M', 'd') else 2)
            if letter == 'y':
                used = 4 if left >= 4 else 2 if left >= 2 else 1
                result += number(year, 4) if used == 4 else number(year % 100, 2) if used == 2 else 'y'
            elif letter == 'M':
                result += number(month, used) if used <= 2 else (_EN_AU_MONTHS_SHORT if used == 3 else _EN_AU_MONTHS_LONG)[month - 1]
            elif letter == 'd':
                result += number(day, used) if used <= 2 else (_EN_AU_WEEKDAYS_SHORT if used == 3 else _EN_AU_WEEKDAYS_LONG)[weekday]
            elif letter == 'h':
                clock = (hour - 12 if hour > 12 else 12 if hour == 0 else hour) if twelve_hour else hour
                result += number(clock, used)
            elif letter == 'H':
                result += number(hour, used)
            elif letter == 'm':
                result += number(minute, used)
            elif letter == 's':
                result += number(second, used)
            elif letter == 'z':
                # Milliseconds as the fraction of a second: `zzz` keeps three digits, `z` and `zz` drop up to two trailing zeros.
                text = number(msec, 3)
                if used != 3:
                    chop = 0
                    while chop < 2 and text.endswith(zero):
                        text = text[:-len(zero)]
                        chop += 1
                result += text
            elif letter in ('a', 'A'):
                # A `p` or `P` straight after joins the marker: `AP` is upper case, `ap` lower case, and `Ap` and `aP` as the language writes it. A lone `A` or `a` takes its own case.
                following = pieces[position + 1] if left == 1 and position + 1 < len(pieces) else None
                p = following if following is not None and 'letter' in following and following['letter'].lower() == 'p' else None
                used = 1
                if letter == 'A' and (p is None or p['letter'] == 'P'):
                    result += day_period.upper()
                elif letter == 'a' and (p is None or p['letter'] == 'p'):
                    result += day_period.lower()
                else:
                    result += day_period
                if p is not None:
                    p['count'] -= 1
            else:
                used = left
                result += letter * left
            left -= used
    return result
