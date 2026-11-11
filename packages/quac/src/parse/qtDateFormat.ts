/**
 * QGIS's date patterns are Qt's (`QLocale::toString`, which hands them to
 * `QCalendarBackend::dateTimeToString`, `src/corelib/text/qlocale.cpp`,
 * `qt/qtbase@3a00b02`, read 2026-10-26). This file splits a pattern the way Qt
 * does and formats a date under it for `format_date`; `fieldDateFormat.ts`
 * splits stored date patterns with the same `splitQtDatePattern`.
 *
 * The letters are `y`, `M`, `d`, `h`, `H`, `m`, `s`, `z`, `a`/`A` (with an
 * optional `p`/`P` after) and `t`. Any other character, and text in single
 * quotes, is written as it stands. `t` (a time zone's name or offset) is not
 * formatted, so a pattern holding it is not read.
 */

/** One piece of a split pattern: a run of one letter, text in quotes, or other characters. */
export type QtPatternPiece = { letter: string, count: number } | { quoted: string } | { literal: string }

/**
 * A pattern split into runs of the same letter, quoted text and the characters
 * between (`qt_repeatCount` and `qt_readEscapedFormatString`): `''` is a quote,
 * inside quotes or out, and quoted text with no closing quote runs to the end.
 */
export function splitQtDatePattern(pattern: string): QtPatternPiece[] {
  const pieces: QtPatternPiece[] = []
  const pushLiteral = (text: string) => {
    const last = pieces[pieces.length - 1]
    if (last && 'literal' in last) last.literal += text
    else pieces.push({ literal: text })
  }
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]!
    if (char === "'") {
      if (pattern[index + 1] === "'") {
        pushLiteral("'")
        index += 2
        continue
      }
      let text = ''
      index += 1
      while (index < pattern.length) {
        if (pattern[index] === "'") {
          if (pattern[index + 1] !== "'") break
          text += "'"
          index += 2
        } else {
          text += pattern[index]
          index += 1
        }
      }
      index += 1
      pieces.push({ quoted: text })
    } else if (/[A-Za-z]/.test(char)) {
      let end = index
      while (pattern[end] === char) end++
      pieces.push({ letter: char, count: end - index })
      index = end
    } else {
      pushLiteral(char)
      index += 1
    }
  }
  return pieces
}

/** Whether `format_date` formats a pattern: true unless it names a time zone with `t`. */
export function isFormattableQtDatePattern(pattern: string): boolean {
  return splitQtDatePattern(pattern).every((piece) => !('letter' in piece) || piece.letter !== 't')
}

/**
 * A moment and the zone it is shown in: the device's own, or a fixed offset
 * from UTC in minutes. Qt shows a date-time in the zone it was read with, so
 * `2026-10-26T04:30:00Z` is shown as 04:30 on any device.
 */
export interface QtDateTime {
  epoch: number
  offsetMinutes: number | 'local'
}

/** A local date and time, from parts, for years below 100 too (which `new Date` reads as 19xx). */
function localEpoch(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, msec = 0): number {
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(hour, minute, second, msec)
  return date.getTime()
}

function utcEpoch(year: number, month: number, day: number, hour: number, minute: number, second: number, msec: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, msec)
  return date.getTime()
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(2000, month, 0)).getUTCDate() && !(month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)))
}

const ISO_TIME = /^(\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?$/
const ISO_OFFSET = /^([+-])(\d{2})(?::?(\d{2}))?$/

/** `HH`, `HH:mm`, `HH:mm:ss` or `HH:mm:ss.zzz` (`fromIsoTimeString`, `qdatetime.cpp`), with 24:00 allowed. */
function readIsoTime(text: string): { hour: number, minute: number, second: number, msec: number } | null {
  const match = ISO_TIME.exec(text)
  if (!match) return null
  const [hour, minute, second] = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
  const msec = match[4] ? Math.round(Number(`0.${match[4]}`) * 1000) : 0
  if (hour > 24 || minute > 59 || second > 59) return null
  if (hour === 24 && (minute || second || msec)) return null
  // A fraction that rounds up to a whole second is kept as 999, as QTime cannot hold 1000.
  return { hour, minute, second, msec: Math.min(msec, 999) }
}

/**
 * A value as QGIS's `getDateTimeValue` reads one for `format_date`
 * (`src/core/expression/qgsexpressionutils.h`, `qgis/QGIS@16eddb2`, read
 * 2026-10-26): a JavaScript date (`now()`) in the device's zone, or text Qt
 * reads as an ISO date-time (`QDateTime::fromString` with `Qt::ISODate`,
 * `qdatetime.cpp`, `qt/qtbase@3a00b02`). That is `yyyy-MM-dd`, at midnight on
 * its own, or followed by `T` or a space and a time, with `Z` for UTC or an
 * offset such as `+10:00`; with neither it is the device's time. Text that is
 * only a time is that time on 1 January of year 1. Null for anything else,
 * where QGIS reports an error.
 */
export function readQtDateTime(value: unknown): QtDateTime | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { epoch: value.getTime(), offsetMinutes: 'local' }
  if (typeof value !== 'string') return null

  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!date) {
    const time = readIsoTime(value)
    return time && time.hour < 24 ? { epoch: localEpoch(1, 1, 1, time.hour, time.minute, time.second, time.msec), offsetMinutes: 'local' } : null
  }
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])]
  if (!isRealDate(year, month, day)) return null
  if (value.length === 10) return { epoch: localEpoch(year, month, day), offsetMinutes: 'local' }
  if (!/^[Tt ]/.test(value.slice(10))) return null

  let rest = value.slice(11)
  let offsetMinutes: number | 'local' = 'local'
  if (/[Zz]$/.test(rest)) {
    offsetMinutes = 0
    rest = rest.slice(0, -1)
  } else {
    const sign = Math.max(rest.lastIndexOf('+'), rest.lastIndexOf('-'))
    if (sign >= 0) {
      const offset = ISO_OFFSET.exec(rest.slice(sign))
      if (!offset) return null
      offsetMinutes = (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] ?? 0))
      rest = rest.slice(0, sign)
    }
  }
  const time = readIsoTime(rest)
  if (!time) return null
  const epoch = offsetMinutes === 'local'
    ? localEpoch(year, month, day, time.hour, time.minute, time.second, time.msec)
    : utcEpoch(year, month, day, time.hour, time.minute, time.second, time.msec) - offsetMinutes * 60_000
  return { epoch, offsetMinutes }
}

/** The calendar parts of a moment as shown in its zone. */
function partsOf({ epoch, offsetMinutes }: QtDateTime) {
  const date = new Date(offsetMinutes === 'local' ? epoch : epoch + offsetMinutes * 60_000)
  const utc = offsetMinutes !== 'local'
  return {
    year: utc ? date.getUTCFullYear() : date.getFullYear(),
    month: (utc ? date.getUTCMonth() : date.getMonth()) + 1,
    day: utc ? date.getUTCDate() : date.getDate(),
    weekday: utc ? date.getUTCDay() : date.getDay(),
    hour: utc ? date.getUTCHours() : date.getHours(),
    minute: utc ? date.getUTCMinutes() : date.getMinutes(),
    second: utc ? date.getUTCSeconds() : date.getSeconds(),
    msec: utc ? date.getUTCMilliseconds() : date.getMilliseconds()
  }
}

/** The ISO 8601 week of a date, 1 to 53, as `QDate::weekNumber` gives it: the week holding the year's first Thursday is week 1. */
function isoWeek(year: number, month: number, day: number): number {
  const date = new Date(utcEpoch(year, month, day, 12, 0, 0, 0))
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7))
  const thursday = date.getTime()
  date.setUTCMonth(0, 1)
  return Math.floor((thursday - date.getTime()) / (7 * 86_400_000)) + 1
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A part of a date, as QGIS's `year`, `month`, `day`, `week`, `day_of_week`,
 * `hour`, `minute` and `second` give it (`fcnYear` to `fcnSeconds`,
 * `fcnDayOfWeek` and `fcnWeek`, `src/core/expression/qgsexpressionfunction.cpp`,
 * `qgis/QGIS@16eddb2`, read 2026-10-26). The value is read as `format_date`
 * reads one (`readQtDateTime`) and the part is taken in its zone. A field QGIS
 * holds as a date-time reaches this function as ISO text, so such text counts as a
 * date-time. QGIS takes no time from a date alone and no weekday from a time
 * alone, so `hour`, `minute` and `second` of `2026-10-06`, and `day_of_week` of
 * `14:05`, are null, where QGIS reports an error. A time alone is read on
 * 0001-01-01, so its `year`, `month`, `day` and `week` are 1. `day_of_week`
 * counts from 0 for Sunday. QGIS also takes a span of time, which this function does not read.
 */
export function qtDatePart(part: string, value: unknown): number | null {
  const moment = readQtDateTime(value)
  if (!moment) return null
  const timeOnly = typeof value === 'string' && !/^\d{4}-/.test(value)
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value)
  const parts = partsOf(moment)
  switch (part) {
    case 'year': return parts.year
    case 'month': return parts.month
    case 'day': return parts.day
    case 'week': return isoWeek(parts.year, parts.month, parts.day)
    case 'day_of_week': return timeOnly ? null : parts.weekday
    case 'hour': return dateOnly ? null : parts.hour
    case 'minute': return dateOnly ? null : parts.minute
    case 'second': return dateOnly ? null : parts.second
    default: return null
  }
}

/** One named part of a date in a language: the form used inside a date (`октября`), as Qt's names are, not the standalone one. */
function namePart(locale: string, options: Intl.DateTimeFormatOptions, epoch: number, type: Intl.DateTimeFormatPartTypes): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).formatToParts(epoch).find((part) => part.type === type)?.value ?? ''
}

/**
 * A date under a QGIS date pattern, as `format_date(datetime, format,
 * language)` gives it (`fcnFormatDate`, `src/core/expression/qgsexpressionfunction.cpp`,
 * `qgis/QGIS@16eddb2`, read 2026-10-26). A `Z` anywhere after the pattern's
 * first character shows the moment in UTC. Month and day names, am and pm and
 * the digits are in `language`; QGIS uses the computer's own language when
 * none is given, and this function uses `en-AU`, as `format_number` does. Null
 * for a pattern holding `t` and for a language the browser cannot read.
 */
export function formatQtDateTime(value: QtDateTime, pattern: string, language?: string | null): string | null {
  if (!isFormattableQtDatePattern(pattern)) return null
  const shown = pattern.indexOf('Z') > 0 ? { ...value, offsetMinutes: 0 } : value
  const { year, month, day, weekday, hour, minute, second, msec } = partsOf(shown)

  let locale: string
  try {
    locale = Intl.getCanonicalLocales(language ? language.replace(/_/g, '-') : 'en-AU')[0] ?? 'en-AU'
  } catch {
    return null
  }
  const number = (count: number, width: number) => new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: width }).format(count)
  const zero = number(0, 1)
  // A day in the same month and weekday, read in UTC so no zone moves it.
  const named = utcEpoch(2023, month, 1, 12, 0, 0, 0)
  const sameWeekday = utcEpoch(2023, 1, 1 + weekday, 12, 0, 0, 0)
  const dayPeriod = namePart(locale, { hour: 'numeric', hour12: true }, utcEpoch(2023, 1, 1, hour < 12 ? 9 : 15, 0, 0, 0), 'dayPeriod')
  // `timeFormatContainsAP`: an `a` or `A` anywhere outside quotes makes `h` a 12-hour clock.
  const pieces = splitQtDatePattern(pattern)
  const twelveHour = pieces.some((piece) => 'letter' in piece && piece.letter.toLowerCase() === 'a')

  let result = ''
  for (const [position, piece] of pieces.entries()) {
    if ('quoted' in piece) {
      result += piece.quoted
      continue
    }
    if ('literal' in piece) {
      result += piece.literal
      continue
    }
    const { letter } = piece
    let left = piece.count
    while (left > 0) {
      let used = Math.min(left, letter === 'z' ? 3 : letter === 'M' || letter === 'd' ? 4 : 2)
      switch (letter) {
        case 'y':
          used = left >= 4 ? 4 : left >= 2 ? 2 : 1
          result += used === 4 ? number(year, 4) : used === 2 ? number(year % 100, 2) : 'y'
          break
        case 'M':
          result += used <= 2
            ? number(month, used)
            : namePart(locale, { day: 'numeric', month: used === 3 ? 'short' : 'long' }, named, 'month')
          break
        case 'd':
          result += used <= 2
            ? number(day, used)
            : namePart(locale, { weekday: used === 3 ? 'short' : 'long', day: 'numeric', month: 'long' }, sameWeekday, 'weekday')
          break
        case 'h': {
          const clock = twelveHour ? (hour > 12 ? hour - 12 : hour === 0 ? 12 : hour) : hour
          result += number(clock, used)
          break
        }
        case 'H':
          result += number(hour, used)
          break
        case 'm':
          result += number(minute, used)
          break
        case 's':
          result += number(second, used)
          break
        case 'z': {
          // Milliseconds as the fraction of a second: `zzz` keeps three digits, `z` and `zz` drop up to two trailing zeros.
          let text = number(msec, 3)
          if (used !== 3) {
            for (let chop = 0; chop < 2 && text.endsWith(zero); chop++) text = text.slice(0, -zero.length)
          }
          result += text
          break
        }
        case 'a':
        case 'A': {
          // A `p` or `P` straight after joins the marker: `AP` is upper case, `ap` lower case, and `Ap` and `aP` as the language writes it. A lone `A` or `a` takes its own case.
          const following = left === 1 ? pieces[position + 1] : undefined
          const p = following && 'letter' in following && following.letter.toLowerCase() === 'p' ? following : null
          used = 1
          if (letter === 'A' && (!p || p.letter === 'P')) result += dayPeriod.toUpperCase()
          else if (letter === 'a' && (!p || p.letter === 'p')) result += dayPeriod.toLowerCase()
          else result += dayPeriod
          if (p) p.count -= 1
          break
        }
        default:
          used = left
          result += letter.repeat(left)
      }
      left -= used
    }
  }
  return result
}
