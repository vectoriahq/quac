/**
 * QGIS hands a regular expression to Qt's `QRegularExpression`, which is PCRE2;
 * Groundwork runs it as a JavaScript `RegExp`. The two engines differ in many
 * corners (`pcre2pattern`, PCRE2 10.4x, read 2026-10-27), so this file reads
 * only the forms listed here, written so that both give the same answer, and
 * gives null for any other pattern, so the expression is not read rather than
 * worked out differently.
 *
 * - A character, a backslash before one that is not a letter or digit, `\n`,
 *   `\r`, `\t`, `\f`, `\xhh` and `\x{…}`.
 * - `.`, which matches anything but a line feed, `^`, and `$`, which also
 *   matches before a final line feed, as PCRE2 does by default.
 * - `\d`, `\w`, `\s`, `\b` and their capitals. With `unicode` (QGIS's
 *   `regexp_` functions pass `UseUnicodePropertiesOption`,
 *   `src/core/expression/qgsexpressionfunction.cpp`; its `~` operator does
 *   not, `qgsexpressionnodeimpl.cpp`, `qgis/QGIS@16eddb2`, read 2026-10-26),
 *   they take in every script's digits, letters and spaces, as PCRE2's `UCP`
 *   does: `\w` is `\p{L}`, `\p{N}` and `_`, and `\s` is `\p{Z}` with the tab,
 *   line and vertical spaces. Without it they are the ASCII ones. That `\w`
 *   is PCRE2's before 10.43, which widens it to `\p{Mn}` and `\p{Pc}`; the
 *   two differ only on a combining mark or a joining mark such as ‿, where
 *   QGIS builds differ too, and Vectoria chose to keep the earlier one
 *   (2026-10-27, no reason given).
 * - A class such as `[A-Z_]` or `[^\d,]`.
 * - A group, `(…)` or `(?:…)`, and `|`.
 * - `*`, `+`, `?`, `{n}`, `{n,}` and `{n,m}`, each also lazy with a `?` after it.
 * - A lookahead, `(?=…)` or `(?!…)`, or a lookbehind, `(?<=…)` or `(?<!…)`,
 *   that holds no group.
 * - A leading `(?i)`.
 *
 * Within those, these are not read either, because the engines give
 * different answers:
 * - a quantifier after an assertion, such as `\b?`, which PCRE2 refuses;
 * - a quantifier that can repeat a group that captures, or holds a group that
 *   does, or a group that can match the empty text: JavaScript clears the
 *   inner groups at each repeat and refuses an empty pass of any group whose
 *   minimum is 0, and PCRE2 does neither;
 * - a quantifier that can repeat a group holding a `|` or a quantifier whose
 *   count can vary, such as `(?:[A-Za-z]+ ?)*`: on text it fails to match,
 *   JavaScript can try every way to split it, where PCRE2 stops at its match
 *   limit and reports no match. In Node, `^(?:[A-Za-z]+ ?)*$` took 3 s on 26
 *   letters and a `!`, and twice as long for each letter more (2026-10-27);
 * - in a lookbehind, a quantifier other than `{n}`, as PCRE2 before 10.43
 *   needs a lookbehind of a set length;
 * - inside a class, `\b`, `\S`, and with `unicode` `\D` and `\W`, which have
 *   no JavaScript form there, and a `-` beside a class escape, which PCRE2
 *   refuses and JavaScript reads as a range;
 * - for `~` with `(?i)`, `\w`, `\W`, `\b` and `\B`, which JavaScript widens
 *   to ſ and the Kelvin sign.
 */

const UNICODE_WORD = '\\p{L}\\p{N}_'
const UNICODE_SPACE = '\\t\\n\\v\\f\\r\\x85\\u180E\\p{Z}'
const ASCII_SPACE = '\\t\\n\\v\\f\\r '

/** The escapes that stand for a set of characters, which PCRE2 will not take as the end of a range. */
const CLASS_TYPES = new Set(['d', 'D', 'w', 'W', 's', 'S'])

const SYNTAX = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '/'])

// A lookahead rather than a group, so that a quantifier after it fails to compile, as PCRE2 refuses `\b?`.
const wordBoundary = (word: string, negate: boolean) => (negate
  ? `(?=(?<=[${word}])(?=[${word}])|(?<![${word}])(?![${word}]))`
  : `(?=(?<=[${word}])(?![${word}])|(?<![${word}])(?=[${word}]))`)

/** A character that stands for itself, escaped where JavaScript's Unicode mode needs it to be. */
function literal(char: string, inClass: boolean): string {
  if (char === '-') return inClass ? '\\-' : '-'
  return SYNTAX.has(char) ? `\\${char}` : char
}

/** One item of a pattern as JavaScript: whether it captures or holds a group that does, whether it is an assertion, whether it can match the empty text, and whether it holds a `|` or a quantifier whose count can vary. */
interface Atom { source: string, captures: boolean, assertion: boolean, empty: boolean, chooses: boolean }

/** Where an item sits: inside a lookahead or lookbehind, and inside a lookbehind. */
interface Context { lookaround: boolean, lookbehind: boolean }

const atomOf = (source: string): Atom => ({ source, captures: false, assertion: false, empty: false, chooses: false })
const assertionOf = (source: string): Atom => ({ source, captures: false, assertion: true, empty: true, chooses: false })

/** The JavaScript source for one PCRE2 pattern, and whether it ignores case, or null where it is not on the list above. */
function translate(pattern: string, unicode: boolean): { source: string, ignoreCase: boolean } | null {
  let index = 0
  let ignoreCase = false
  if (pattern.startsWith('(?i)')) {
    ignoreCase = true
    index = 4
  }

  /** One `\` escape at `index`, which points at the backslash; the JavaScript for it, or null. */
  const escape = (inClass: boolean): string | null => {
    const char = pattern[index + 1]
    if (char === undefined) return null
    index += 2
    switch (char) {
      case 'd': return unicode ? '\\p{Nd}' : '\\d'
      case 'D': return unicode ? (inClass ? null : '\\P{Nd}') : '\\D'
      case 'w': return unicode ? (inClass ? UNICODE_WORD : `[${UNICODE_WORD}]`) : (ignoreCase ? null : '\\w')
      case 'W': return unicode ? (inClass ? null : `[^${UNICODE_WORD}]`) : (ignoreCase ? null : '\\W')
      case 's': {
        const space = unicode ? UNICODE_SPACE : ASCII_SPACE
        return inClass ? space : `[${space}]`
      }
      case 'S': return inClass ? null : `[^${unicode ? UNICODE_SPACE : ASCII_SPACE}]`
      case 'b': return inClass ? null : (unicode ? wordBoundary(UNICODE_WORD, false) : (ignoreCase ? null : '\\b'))
      case 'B': return inClass ? null : (unicode ? wordBoundary(UNICODE_WORD, true) : (ignoreCase ? null : '\\B'))
      case 'n': case 'r': case 't': case 'f': return `\\${char}`
      case 'x': {
        const braced = /^\{([0-9A-Fa-f]{1,6})\}/.exec(pattern.slice(index))
        if (braced) {
          // PCRE2 in UTF mode refuses a surrogate, and JavaScript takes one.
          const code = parseInt(braced[1]!, 16)
          if (code >= 0xD800 && code <= 0xDFFF) return null
          index += braced[0].length
          return `\\u{${braced[1]}}`
        }
        const hex = /^[0-9A-Fa-f]{2}/.exec(pattern.slice(index))
        if (!hex) return null
        index += 2
        return `\\x${hex[0]}`
      }
      default:
        if (/[A-Za-z0-9]/.test(char)) return null
        return literal(char, inClass)
    }
  }

  /** A class at `index`, which points at its `[`. */
  const readClass = (): string | null => {
    let out = '['
    index += 1
    if (pattern[index] === '^') {
      out += '^'
      index += 1
    }
    const classStart = index
    // A `]` straight after the opening bracket is a member of the class in PCRE2.
    if (pattern[index] === ']') {
      out += '\\]'
      index += 1
    }
    while (index < pattern.length) {
      const char = pattern[index]!
      if (char === ']') {
        index += 1
        return `${out}]`
      }
      if (char === '\\') {
        const start = index
        const part = escape(true)
        if (part === null) return null
        if (CLASS_TYPES.has(pattern[start + 1]!)) {
          const hyphenBefore = pattern[start - 1] === '-' && start - 1 > classStart && pattern[start - 2] !== '\\'
          const hyphenAfter = pattern[index] === '-' && pattern[index + 1] !== ']'
          if (hyphenBefore || hyphenAfter) return null
        }
        out += part
        continue
      }
      // `[:`, `[=` and `[.` start a POSIX class in PCRE2.
      if (char === '[' && /[:=.]/.test(pattern[index + 1] ?? '')) return null
      out += char === '-' ? '-' : literal(char, true)
      index += 1
    }
    return null
  }

  /** A quantifier at `index`, with the least and most times it repeats, or null where there is none. */
  const readQuantifier = (): { text: string, min: number, max: number, lazy: boolean } | null => {
    const found = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})(\??)/.exec(pattern.slice(index))
    if (!found) return null
    const lazy = found[5] === '?'
    if (found[1]) {
      index += found[0].length
      return { text: found[0], min: found[1] === '+' ? 1 : 0, max: found[1] === '?' ? 1 : Infinity, lazy }
    }
    const min = Number(found[2])
    const max = found[3] ? (found[4] ? Number(found[4]) : Infinity) : min
    // PCRE2 refuses a count above 65535, and JavaScript takes it; left in place, the `{` is not read as text either.
    if (min > 65535 || (max > 65535 && max !== Infinity)) return null
    index += found[0].length
    return { text: found[0], min, max, lazy }
  }

  /** A group at `index`, which points at its `(`. */
  const readGroup = (context: Context): Atom | null => {
    if (context.lookaround) return null
    const rest = pattern.slice(index + 1)
    const kind = rest.startsWith('?') ? ['?:', '?=', '?!', '?<=', '?<!'].find((start) => rest.startsWith(start)) : ''
    if (kind === undefined) return null
    const open = `(${kind}`
    index += open.length
    const lookbehind = kind === '?<=' || kind === '?<!'
    const lookaround = lookbehind || kind === '?=' || kind === '?!'
    const inner = readAlternatives({ lookaround, lookbehind })
    if (!inner || pattern[index] !== ')') return null
    index += 1
    return { source: `${open}${inner.source})`, captures: kind === '' || inner.captures, assertion: lookaround, empty: lookaround || inner.empty, chooses: inner.chooses }
  }

  const readAtom = (context: Context): Atom | null => {
    const char = pattern[index]!
    switch (char) {
      case '(': return readGroup(context)
      case '[': {
        const source = readClass()
        return source === null ? null : atomOf(source)
      }
      case '\\': {
        const escaped = pattern[index + 1]
        const source = escape(false)
        if (source === null) return null
        return escaped === 'b' || escaped === 'B' ? assertionOf(source) : atomOf(source)
      }
      case '.':
        index += 1
        return atomOf('[^\\n]')
      case '^':
        index += 1
        return assertionOf('^')
      case '$':
        index += 1
        return assertionOf('(?=\\n?$)')
      // A quantifier with nothing to repeat, or one after another, which makes it possessive.
      case '*': case '+': case '?':
        return null
      case '{':
        // PCRE2 10.43 reads `{,n}`, and a count with spaces or tabs inside the braces, as a quantifier, and earlier versions as text.
        if (/^\{[ \t]*(?:\d+[ \t]*(?:,[ \t]*\d*[ \t]*)?\}|,)/.test(pattern.slice(index))) return null
        index += 1
        return atomOf('\\{')
      default:
        index += 1
        return atomOf(literal(char, false))
    }
  }

  /** The branches up to a `)` or the end, whether a group in them captures, whether one of them can match the empty text, and whether they hold a `|` or a quantifier whose count can vary. */
  function readAlternatives(context: Context): { source: string, captures: boolean, empty: boolean, chooses: boolean } | null {
    let out = ''
    let captures = false
    let empty = false
    let branchEmpty = true
    let chooses = false
    while (index < pattern.length && pattern[index] !== ')') {
      if (pattern[index] === '|') {
        chooses = true
        empty ||= branchEmpty
        branchEmpty = true
        out += '|'
        index += 1
        continue
      }
      const atom = readAtom(context)
      if (!atom) return null
      captures ||= atom.captures
      chooses ||= atom.chooses
      const quantifier = readQuantifier()
      branchEmpty &&= atom.empty || (quantifier !== null && quantifier.min === 0)
      if (!quantifier) {
        out += atom.source
        continue
      }
      if (atom.assertion) return null
      if (context.lookbehind && quantifier.min !== quantifier.max) return null
      chooses ||= quantifier.min !== quantifier.max
      // JavaScript has no match limit, so a repeat of a group that can split the same text more than one way can run for hours where PCRE2 gives up.
      if (atom.chooses && quantifier.max > 1) return null
      // A quantifier with a minimum of 0 or a maximum above 1 runs differently on a group that captures or can match the empty text:
      // JavaScript clears the inner groups at each pass and refuses a pass that matches the empty text, and PCRE2 does neither.
      // So such a group may repeat at most once, and an optional one is written as a choice with the empty text, which JavaScript
      // tries in the same order as PCRE2: `(X)?` as `(?:(X)|)`, and `(X)??` as `(?:|(X))`.
      const differs = atom.captures || atom.empty
      if (differs && quantifier.max > 1) return null
      if (differs && quantifier.min === 0 && quantifier.max === 1) {
        out += quantifier.lazy ? `(?:|${atom.source})` : `(?:${atom.source}|)`
      } else {
        out += atom.source + quantifier.text
      }
    }
    return { source: out, captures, empty: empty || branchEmpty, chooses }
  }

  const translated = readAlternatives({ lookaround: false, lookbehind: false })
  // A `)` that no group opened stops the reading early.
  if (!translated || index < pattern.length) return null
  return { source: translated.source, ignoreCase }
}

const COMPILED = new Map<string, RegExp | null>()

/**
 * A PCRE2 pattern as a JavaScript `RegExp` that matches what QGIS matches, or
 * null where Groundwork cannot translate it, or where the result does not
 * compile. `unicode` is QGIS's `UseUnicodePropertiesOption`: on for the
 * `regexp_` functions, off for `~`. The `RegExp` is shared, so a caller that
 * matches globally makes its own from its `source` and `flags`.
 */
export function compileQtRegex(pattern: string, unicode: boolean): RegExp | null {
  const key = `${unicode ? 'u' : 'a'}|${pattern}`
  if (!COMPILED.has(key)) {
    const translated = translate(pattern, unicode)
    let regex: RegExp | null = null
    if (translated) {
      try {
        regex = new RegExp(translated.source, translated.ignoreCase ? 'ui' : 'u')
      } catch {
        regex = null
      }
    }
    COMPILED.set(key, regex)
  }
  return COMPILED.get(key)!
}

/**
 * Every match in the text, as `QRegularExpression::globalMatch` finds them
 * (`src/corelib/text/qregularexpression.cpp`, `qt/qtbase@3a00b02`, read
 * 2026-10-27): after an empty match it tries again at the same place for one
 * that is not empty (`PCRE2_NOTEMPTY_ATSTART | PCRE2_ANCHORED`), and only then
 * moves on one character. So `.*?` over `ab` matches the empty text, `a`, the
 * empty text, `b` and the empty text, where JavaScript's `matchAll` skips `a`
 * and `b`. The retry asks that the match not end where it began, with a
 * lookbehind that counts the characters before that place.
 */
function* qtGlobalMatches(text: string, regex: RegExp): Generator<RegExpExecArray> {
  const global = new RegExp(regex.source, `${regex.flags}g`)
  let position = 0
  let retryAt = -1
  while (position <= text.length) {
    let match: RegExpExecArray | null
    if (retryAt === position) {
      const before = [...text.slice(0, position)].length
      const notEmpty = new RegExp(`(?:${regex.source})(?<!^[\\s\\S]{${before}})`, `${regex.flags}y`)
      notEmpty.lastIndex = position
      match = notEmpty.exec(text)
      if (!match) {
        position += text.codePointAt(position)! > 0xFFFF ? 2 : 1
        retryAt = -1
        continue
      }
    } else {
      global.lastIndex = position
      match = global.exec(text)
      if (!match) return
    }
    yield match
    position = match.index + match[0].length
    retryAt = match[0] === '' ? position : -1
  }
}

/**
 * `QString::replace` with a pattern (`src/corelib/text/qstring.cpp`,
 * `qt/qtbase@3a00b02`, read 2026-10-26), which `regexp_replace` calls: every
 * match is replaced, and in the replacement `\1` to `\99` stand for that group
 * where the pattern has it, taking a second digit only where the pattern has
 * that many groups. Any other backslash stays as written, and a group that
 * took no part gives nothing.
 */
export function replaceQtRegex(text: string, regex: RegExp, after: string): string {
  const groups = new RegExp(`${regex.source}|`, regex.flags).exec('')!.length - 1
  const references: Array<{ at: number, length: number, group: number }> = []
  for (let at = 0; at < after.length - 1; at++) {
    if (after[at] !== '\\') continue
    let group = Number(after[at + 1])
    if (!(/\d/.test(after[at + 1]!) && group > 0 && group <= groups)) continue
    let length = 2
    const second = after[at + 2]
    if (second !== undefined && /\d/.test(second) && group * 10 + Number(second) <= groups) {
      group = group * 10 + Number(second)
      length = 3
    }
    references.push({ at, length, group })
  }

  let result = ''
  let lastEnd = 0
  for (const match of qtGlobalMatches(text, regex)) {
    result += text.slice(lastEnd, match.index)
    let afterEnd = 0
    for (const { at, length, group } of references) {
      result += after.slice(afterEnd, at) + (match[group] ?? '')
      afterEnd = at + length
    }
    result += after.slice(afterEnd)
    lastEnd = match.index + match[0].length
  }
  return result + text.slice(lastEnd)
}
