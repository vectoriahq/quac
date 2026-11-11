import type { StacAsset, StacCollection } from './Stac.ts'

/**
 * Selecting a Collection's data asset.
 *
 * Portolan addresses assets by role rather than by key
 * (the Portolan convention): `data` is the primary file, `visual`
 * a rendering derivative, `style` a visualisation style. This package's own
 * generators write the primary file under the `data` key *and* the `data` role,
 * so the key stands as the fallback for a document that declares no roles at
 * all — which an external catalogue is free to do.
 */

/** The role marking a Collection's primary data file. */
export const DATA_ROLE = 'data'

/**
 * The asset with a role, or null when the Collection declares none.
 *
 * An asset stored under the role's own name is preferred over any other
 * with it, so a Collection that both keys and roles its data asset resolves
 * to the same one either way. Otherwise the first match `Object.entries` yields
 * wins — position in that list is not the document's order (see
 * `DEFAULT_STYLE_ROLE`), so a Collection with two assets in one role has no
 * stable answer here. Portolan gives none either: `specs/portolan/core.md`
 * § Assets lists the roles it uses and calls `data` "for the primary
 * GeoParquet, COG, or Parquet", without a rule for choosing among several
 * with it (read at
 * https://raw.githubusercontent.com/portolan-sdi/portolan-spec/main/specs/portolan/core.md
 * on 2026-08-12). The one role that does have a tie-break is `style`, where a
 * second `default` role marks the winner — which is the shape a `data`
 * tie-break would take if Portolan ever adds one.
 */
export function findAssetByRole(collection: StacCollection, role: string): StacAsset | null {
  const assets = collection.assets ?? {}
  const keyed = assets[role]
  if (keyed?.roles?.includes(role)) return keyed

  for (const asset of Object.values(assets)) {
    if (asset.roles?.includes(role)) return asset
  }
  return keyed ?? null
}

/** A Collection's primary data file — the `data`-role asset. */
export function readDataAsset(collection: StacCollection): StacAsset | null {
  return findAssetByRole(collection, DATA_ROLE)
}
