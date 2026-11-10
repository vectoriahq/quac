# @vectoriahq/quac

The JavaScript package for [QUAC](https://github.com/vectoriahq/quac), a profile of STAC 1.1.0 for describing the layers of a map: where each layer's data comes from, how its fields are filled in and checked, how it is drawn, and how its layers relate.

The package writes QUAC catalogues from QGIS projects and other sources, and reads them back. It makes no network request: it builds a catalogue from what an application has already fetched, such as a QGIS project's text or a QGIS Server GetProjectSettings response.

## Install

```bash
npm install @vectoriahq/quac
```

## Example

Build a catalogue from a QGIS project file. The parsers use the standard `DOMParser`, which a browser provides; in Node, supply one, such as [linkedom](https://www.npmjs.com/package/linkedom)'s.

```js
import { readFile } from 'node:fs/promises'
import { DOMParser } from 'linkedom'
import { parseQgsXml, generateStacCatalogue } from '@vectoriahq/quac'

globalThis.DOMParser = DOMParser

const project = parseQgsXml(await readFile('project.qgs', 'utf8'))
const catalogue = generateStacCatalogue(project)
```

The JSON Schema that checks a catalogue's `quac:` fields is exported as `@vectoriahq/quac/schema`.

## Documentation

The [repository's README](https://github.com/vectoriahq/quac#readme) says where QUAC fits, and the [field reference](https://github.com/vectoriahq/quac/tree/main/packages/quac/spec) describes every field.

## Licence

Copyright 2026 Vectoria Pty Ltd. Apache License 2.0.
