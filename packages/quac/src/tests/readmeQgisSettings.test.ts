import { describe, expect, it } from 'vitest'

import README from '../../../../README.md?raw'

/**
 * The repository README's "From a QGIS setting to a QUAC field" tables link
 * each QGIS setting to its example under `packages/quac/spec/examples/`. This
 * keeps the tables and the examples in agreement: every example whose source
 * is a QGIS project has a row, and each row names exactly the fields its
 * example's `example.json` lists.
 */

interface Manifest { fields: string[], source: string }

const MANIFEST_FILES = import.meta.glob(['../../spec/examples/*/example.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const MANIFESTS = new Map(Object.entries(MANIFEST_FILES).map(([path, text]) => [path.split('/').at(-2)!, JSON.parse(text) as Manifest]))
const EXAMPLE_LINK = /\]\(packages\/quac\/spec\/examples\/([^/)]+)\/\)/g

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`)
  if (start < 0) throw new Error(`The README has no "${heading}" section.`)
  const end = markdown.indexOf('\n## ', start + 1)
  return markdown.slice(start, end < 0 ? undefined : end)
}

function manifestOf(name: string): Manifest {
  const manifest = MANIFESTS.get(name)
  if (!manifest) throw new Error(`No example named ${name}.`)
  return manifest
}

const rows = section(README, 'From a QGIS setting to a QUAC field')
  .split('\n')
  .filter((line) => line.startsWith('| ') && !line.startsWith('|---'))
  .map((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    return {
      line,
      fields: [...(cells[1] ?? '').matchAll(/`(quac:[a-z_]+)`/g)].map((match) => match[1]!),
      examples: [...(cells[2] ?? '').matchAll(EXAMPLE_LINK)].map((match) => match[1]!)
    }
  })

describe('the README\'s QGIS settings tables', () => {
  it('have a row for every example whose source is a QGIS project', () => {
    const fromQgis = [...MANIFESTS]
      .filter(([, manifest]) => ['qgis-project', 'qgis-server'].includes(manifest.source))
      .map(([name]) => name)
      .sort()
    const linked = rows.flatMap((row) => row.examples).sort()
    expect(linked).toEqual(fromQgis)
  })

  it.each(rows.filter((row) => row.examples.length > 0).map((row) => [row.line, row]))('%s names its examples\' fields', (_line, row) => {
    for (const example of row.examples) {
      expect([...row.fields].sort(), example).toEqual([...manifestOf(example).fields].sort())
    }
  })
})
