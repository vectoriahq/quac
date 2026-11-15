// Gives a test running under Vitest's 'node' environment the `DOMParser` and
// `XMLSerializer` this package's parsers call, from a jsdom window, as the
// README tells a Node user to. jsdom reads XML as a browser does, decoding
// every entity in an attribute value, so an expression such as `"height" < 40`
// reaches a parser as QGIS wrote it. Importing this for its side effect is
// lighter than a whole `@vitest-environment jsdom` test file.
import { JSDOM } from 'jsdom'

const { window } = new JSDOM('')

globalThis.DOMParser = window.DOMParser
globalThis.XMLSerializer = window.XMLSerializer
