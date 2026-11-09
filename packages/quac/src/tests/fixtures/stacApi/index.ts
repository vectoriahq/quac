/**
 * Fixture responses for a STAC API.
 *
 * **Hand-authored, not captured from a live service.** No STAC API was reachable
 * from the environment these were written in — the GeoLens demo, Earth Search and
 * Planetary Computer are all blocked by the container's network policy — so no
 * response here was recorded off the wire, and none of these documents was
 * checked against a specification document either: the specifications were not
 * reachable from that environment. What they encode is the structure a STAC API serves: a Catalog whose Collections have no downloadable asset, each
 * with a `rel: "items"` link to the Items holding the data, with the item
 * list answering as a GeoJSON FeatureCollection with `rel: "next"`.
 *
 * So the tests over them establish that Groundwork behaves as intended against
 * documents of this shape, and not that real services produce this shape.
 * Replacing them with captured responses is what would turn them into evidence
 * about real servers; until then, treat a passing suite as covering the design
 * rather than the wire format.
 */

/** The API's landing page — a Catalog linking its Collections as children. */
export const apiLandingPage = {
  type: 'Catalog',
  stac_version: '1.1.0',
  id: 'demo-api',
  title: 'Demo STAC API',
  description: 'A STAC API whose collections file their data on items.',
  links: [
    { rel: 'self', href: 'https://api.example.com/stac/' },
    { rel: 'root', href: 'https://api.example.com/stac/' },
    { rel: 'child', href: 'https://api.example.com/stac/collections/imagery' },
    { rel: 'child', href: 'https://api.example.com/stac/collections/empty-shelf' },
    { rel: 'child', href: 'https://api.example.com/stac/collections/empty-list' }
  ]
}

/**
 * A Collection with no assets at all and an `items` link — the shape every
 * Collection a STAC API serves takes, and what greyed out as
 * `No data asset` before the drill-down existed.
 */
export const imageryCollection = {
  type: 'Collection',
  stac_version: '1.1.0',
  id: 'imagery',
  title: 'Coastal imagery',
  description: 'Aerial imagery of the coast.',
  license: 'CC-BY-4.0',
  extent: {
    spatial: { bbox: [[115, -32, 116, -31]] },
    temporal: { interval: [['2026-01-01T00:00:00Z', null]] }
  },
  links: [
    { rel: 'self', href: 'https://api.example.com/stac/collections/imagery' },
    { rel: 'items', href: 'https://api.example.com/stac/collections/imagery/items' }
  ]
}

/** A Collection with neither an asset nor an item list — nothing to load. */
export const emptyShelfCollection = {
  type: 'Collection',
  stac_version: '1.1.0',
  id: 'empty-shelf',
  title: 'Nothing here',
  description: 'A collection with no data asset and no item list.',
  license: 'other',
  extent: {
    spatial: { bbox: [[115, -32, 116, -31]] },
    temporal: { interval: [[null, null]] }
  },
  links: [{ rel: 'self', href: 'https://api.example.com/stac/collections/empty-shelf' }]
}

/** A Collection that lists items and holds none — an empty second level. */
export const emptyListCollection = {
  type: 'Collection',
  stac_version: '1.1.0',
  id: 'empty-list',
  title: 'Nothing filed yet',
  description: 'A collection that lists items but holds none.',
  license: 'other',
  extent: {
    spatial: { bbox: [[115, -32, 116, -31]] },
    temporal: { interval: [[null, null]] }
  },
  links: [
    { rel: 'self', href: 'https://api.example.com/stac/collections/empty-list' },
    { rel: 'items', href: 'https://api.example.com/stac/collections/empty-list/items' }
  ]
}

/** One Item: a GeoJSON Feature with the assets the Collection lacks. */
function buildItem(id: string, datetime: string | null, extra?: Record<string, unknown>) {
  return {
    type: 'Feature',
    stac_version: '1.1.0',
    id,
    collection: 'imagery',
    bbox: [115.1, -31.9, 115.4, -31.6],
    geometry: { type: 'Polygon', coordinates: [[[115.1, -31.9], [115.4, -31.9], [115.4, -31.6], [115.1, -31.6], [115.1, -31.9]]] },
    properties: { datetime, ...(extra ?? {}) },
    assets: {
      data: {
        href: `https://api.example.com/data/${id}.tif`,
        type: 'image/tiff; application=geotiff; profile=cloud-optimized',
        roles: ['data']
      }
    },
    // This fixture Item states its own address, which is what `itemBaseUrl`
    // resolves relative hrefs against however the Item was reached.
    links: [{ rel: 'self', href: `https://api.example.com/stac/collections/imagery/items/${id}` }]
  }
}

/**
 * The first page of the item list, deliberately **not** in newest-first order —
 * the case `sortItemsNewestFirst` exists for, whatever a given service does with
 * an unimplemented `sortby`.
 */
export const itemsPageOne = {
  type: 'FeatureCollection',
  features: [
    buildItem('scene-mar', '2026-03-04T01:00:00Z', { title: 'Coastal scene, March' }),
    buildItem('scene-aug', '2026-08-19T01:00:00Z', { title: 'Coastal scene, August' }),
    buildItem('scene-undated', null),
    buildItem('scene-may', '2026-05-21T01:00:00Z', { title: 'Coastal scene, May' })
  ],
  links: [
    { rel: 'self', href: 'https://api.example.com/stac/collections/imagery/items?limit=20&sortby=-datetime' },
    // Relative, so following it exercises the resolution against the page it
    // came from.
    { rel: 'next', href: 'items?limit=20&sortby=-datetime&token=page-2' }
  ]
}

/** The last page — no `next` link, so the list ends here. */
export const itemsPageTwo = {
  type: 'FeatureCollection',
  features: [buildItem('scene-jan', '2026-01-09T01:00:00Z', { title: 'Coastal scene, January' })],
  links: [
    { rel: 'self', href: 'https://api.example.com/stac/collections/imagery/items?limit=20&sortby=-datetime&token=page-2' }
  ]
}

/** One Item fetched on its own, as the rebuild fetches an item-backed layer. */
export const singleItem = buildItem('scene-aug', '2026-08-19T01:00:00Z', { title: 'Coastal scene, August' })

/**
 * Routes a fetch to the fixture that URL addresses, for `vi.stubGlobal`.
 * Returns null for an address no fixture covers, so a test can decide whether
 * that is a failure or a case of its own.
 */
export function fixtureFor(url: string): unknown | null {
  const [path, query = ''] = url.split('?')
  if (path === 'https://api.example.com/stac/' || path === 'https://api.example.com/stac') return apiLandingPage
  if (path === 'https://api.example.com/stac/collections/imagery') return imageryCollection
  if (path === 'https://api.example.com/stac/collections/empty-shelf') return emptyShelfCollection
  if (path === 'https://api.example.com/stac/collections/empty-list') return emptyListCollection
  if (path === 'https://api.example.com/stac/collections/empty-list/items') {
    return { type: 'FeatureCollection', features: [], links: [] }
  }
  if (path === 'https://api.example.com/stac/collections/imagery/items') {
    return query.includes('token=page-2') ? itemsPageTwo : itemsPageOne
  }
  if (path === 'https://api.example.com/stac/collections/imagery/items/scene-aug') return singleItem
  return null
}
