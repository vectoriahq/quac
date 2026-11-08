// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { generateServerStacCatalogue, generateStacCatalogue, generateStacCatalogueFromWms, parseGetProjectSettings, parseQgsXml, serverLayerTree } from '../index'

/**
 * The second tier of QUAC's fixtures: for each whole-project fixture, the
 * catalogue this package generates, saved beside it as `<name>.catalogue.json`.
 * A change that moves a catalogue shows as a diff of that file, and the
 * reviewer reads the diff, not the file. `npm run test:quac:update` rewrites
 * them; a run in CI never does, so a saved catalogue that is missing or
 * different fails there.
 *
 * Each project is read from its text alone, with its file name as the
 * project's path, as a project in a cloud folder is. No companion data is
 * given, so no column is typed from loaded features, and no initial view,
 * which Groundwork works out by reprojecting outside the package.
 *
 * Each project also has the catalogue the QUAC plugin's route would serve for
 * it, saved as `<name>.server.catalogue.json`: the second expected catalogue,
 * where the server route differs.
 *
 * And each has the layer tree QGIS Server reads from it, saved as
 * `<name>.server.layers.json`: what the Python reader in
 * `packages/quac-qgis-server/` must return for the same project.
 */
const PROJECTS = import.meta.glob(['./fixtures/qgis/**/*.qgs'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const GET_PROJECT_SETTINGS = import.meta.glob(['./fixtures/qgis/**/*-get-project-settings.xml'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** A made-up QGIS Server address, so the WMS and WFS addresses the server route writes are fixed. */
const SERVER_ADDRESS = 'https://qgis.example.com/ows?MAP=/projects/fixture.qgs'

/** A catalogue as saved: JSON, which leaves out the members a generator sets to undefined. */
function saved(catalogue: unknown): string {
  return `${JSON.stringify(catalogue, null, 2)}\n`
}

function goldenPath(fixturePath: string): string {
  return fixturePath.replace(/\.(qgs|xml)$/, '.catalogue.json')
}

describe('saved catalogues of the whole-project fixtures', () => {
  it('has fixtures to check', () => {
    expect(Object.keys(PROJECTS).length).toBeGreaterThan(0)
    expect(Object.keys(GET_PROJECT_SETTINGS).length).toBeGreaterThan(0)
  })

  it.each(Object.keys(PROJECTS))('generates the saved catalogue for %s', async (path) => {
    const projectPath = path.slice(path.lastIndexOf('/') + 1)
    const catalogue = generateStacCatalogue(parseQgsXml(PROJECTS[path]!), [], { projectPath })
    await expect(saved(catalogue)).toMatchFileSnapshot(goldenPath(path))
  })

  it.each(Object.keys(PROJECTS))('generates the saved server catalogue for %s', async (path) => {
    const catalogue = generateServerStacCatalogue(parseQgsXml(PROJECTS[path]!), { serverAddress: SERVER_ADDRESS })
    await expect(saved(catalogue)).toMatchFileSnapshot(path.replace(/\.qgs$/, '.server.catalogue.json'))
  })

  it.each(Object.keys(PROJECTS))('reads the saved server layer tree for %s', async (path) => {
    const tree = serverLayerTree(parseQgsXml(PROJECTS[path]!))
    await expect(saved(tree)).toMatchFileSnapshot(path.replace(/\.qgs$/, '.server.layers.json'))
  })

  it.each(Object.keys(GET_PROJECT_SETTINGS))('generates the saved QGIS Server catalogue for %s', async (path) => {
    const catalogue = generateStacCatalogueFromWms(parseGetProjectSettings(GET_PROJECT_SETTINGS[path]!), {
      wfsEndpoint: SERVER_ADDRESS,
      wmsEndpoint: SERVER_ADDRESS
    })
    await expect(saved(catalogue)).toMatchFileSnapshot(goldenPath(path))
  })
})
