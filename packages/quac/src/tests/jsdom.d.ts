/**
 * The one part of jsdom the package's tests reach for: a window whose
 * `DOMParser` and `XMLSerializer` `xmlParser.ts` lends to the tests. Declared
 * here rather than adding jsdom's types, which would bring Node's types with
 * them.
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    readonly window: Window & typeof globalThis
  }
}
