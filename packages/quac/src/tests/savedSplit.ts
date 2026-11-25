import { splitCatalogue } from '../generate/splitCatalogue.ts'

import type { SplitCatalogueOptions } from '../generate/splitCatalogue.ts'
import type { StacCatalog } from '../model/Stac.ts'

/**
 * A catalogue's separate documents as a fixture saves them, as
 * `<name>.split.json` beside its `<name>.catalogue.json`: once with the
 * default names, and once with the root named after the fixture and every
 * other document in a folder of the same name, each with the options it was
 * split with. The Python's `tests/test_split_catalogue.py` splits the same
 * catalogue with the same options and compares.
 */
export function savedSplit(catalogue: StacCatalog, name: string): string {
  const forms: SplitCatalogueOptions[] = [{}, { rootFileName: `${name}.json`, childrenFolder: name }]
  const saved = forms.map((options) => ({ options, documents: splitCatalogue(catalogue, options) }))
  return `${JSON.stringify(saved, null, 2)}\n`
}
