# @vectoriahq/quac

Writes and reads [QUAC](https://github.com/vectoriahq/quac), which adds map layer settings to STAC 1.1.0 catalogues: how each layer is shown, how its fields are filled in and checked, and how its layers relate.

The package writes QUAC catalogues from QGIS projects and other sources, and reads them back. It makes no network request: it builds a catalogue from what an application has already fetched, such as a QGIS project's text or a QGIS Server GetProjectSettings response.

## Install

```bash
npm install @vectoriahq/quac
```

## Read a Collection

Each `readCollection…` function takes one Collection and returns one kind of setting, keyed by field name where it is a field's. It needs nothing else from the catalogue, so an application can read a Collection as it opens it. This reads the trees layer of [the demo catalogue](https://vectoriahq.github.io/quac/demo/catalog.json):

```js
import {
  readCollectionFieldAliases,
  readCollectionFieldEditRules,
  readCollectionFieldValues,
  readCollectionFormLayout
} from '@vectoriahq/quac'

const response = await fetch('https://vectoriahq.github.io/quac/demo/collections/trees.json')
const trees = await response.json()

readCollectionFieldAliases(trees).height
// 'Height'
readCollectionFieldEditRules(trees).height
// { range: { min: 0, max: 40, step: 0.5, precision: 1, suffix: ' m' },
//   constraintExpression: { expression: '"height" < 40', description: 'Taller than any tree on this street', strength: 'warn' },
//   readOnly: false, notNull: null, … }
readCollectionFieldValues(trees).condition
// [{ value: 'G', label: 'Good' }, { value: 'F', label: 'Fair' }, …]
readCollectionFormLayout(trees).fields.at(-1)
// { name: 'removal_reason', visibleWhen: ['"condition" = \'D\''] }
```

A Value Relation names the Collection its choices come from (`readCollectionFieldValueRelations`), and a child layer names its parent (`readCollectionRelatedTo`). Reading those choices or records means reading that Collection's data too.

## Build a catalogue

Build a catalogue from a QGIS project file. The parsers use the standard `DOMParser` and `XMLSerializer`, which a browser provides. In Node, supply both, such as [jsdom](https://www.npmjs.com/package/jsdom)'s:

```js
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { parseQgsXml, generateStacCatalogue } from '@vectoriahq/quac'

const { window } = new JSDOM()
globalThis.DOMParser = window.DOMParser
globalThis.XMLSerializer = window.XMLSerializer

const project = parseQgsXml(await readFile('project.qgs', 'utf8'))
const catalogue = generateStacCatalogue(project)
```

The JSON Schema that checks a catalogue's `quac:` fields is exported as `@vectoriahq/quac/schema`.

## Documentation

The [repository's README](https://github.com/vectoriahq/quac#readme) says where QUAC fits, and the [field reference](https://github.com/vectoriahq/quac/tree/main/packages/quac/spec) describes every field.

## Licence

Copyright 2026 Vectoria Pty Ltd. Apache License 2.0.
