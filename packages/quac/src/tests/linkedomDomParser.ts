// Spike: linkedom implements querySelector/querySelectorAll on parsed XML
// without the cost of a full jsdom environment (layout, CSSOM, canvas, etc).
// Importing this for its side effect lets XML-parsing tests run under the
// default 'node' Vitest environment instead of opting into '@vitest-environment jsdom'.
import { DOMParser } from 'linkedom'

globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser

// linkedom has no XMLSerializer; its nodes already stringify back to markup,
// so wrap that in the same interface this package's parsers call.
globalThis.XMLSerializer = class {
  serializeToString(node: { toString(): string }): string {
    return node.toString()
  }
} as unknown as typeof globalThis.XMLSerializer
