import './linkedomDomParser.ts'

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { generateServerStacCatalogue, generateStacCatalogue, parseQgsXml, readProjectXml } from '../index.ts'
import publishingQgs from './fixtures/qgis/server-publishing/publishing.qgs?raw'

/** Every fixture project, by path. */
const PROJECTS = import.meta.glob(['./fixtures/qgis/**/*.qgs'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const SERVER = 'https://qgis.example.com/ows?MAP=/projects/fixture.qgs'

describe('the fixtures for the cases the QUAC plugin meets', () => {
  it('reads the .qgz as the .qgs it holds', async () => {
    const qgz = readFileSync(new URL('./fixtures/qgis/server-publishing/publishing.qgz', import.meta.url))
    const xml = await readProjectXml('publishing.qgz', new Response(qgz))
    expect(xml).toBe(publishingQgs)
    expect(generateServerStacCatalogue(parseQgsXml(xml), { serverAddress: SERVER }))
      .toEqual(generateServerStacCatalogue(parseQgsXml(publishingQgs), { serverAddress: SERVER }))
  })

  it.each(Object.keys(PROJECTS))('writes no connection string from %s on either route', (path) => {
    const project = parseQgsXml(PROJECTS[path]!)
    const catalogues = JSON.stringify([generateStacCatalogue(project), generateServerStacCatalogue(project, { serverAddress: SERVER })])
    expect(catalogues).not.toMatch(/password=|user='|dbname=/)
  })
})
