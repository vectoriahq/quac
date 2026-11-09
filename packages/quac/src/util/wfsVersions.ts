// The WFS versions Groundwork speaks. Kept free of imports so a catalogue
// generator can read them without loading the WFS client, which loads OpenLayers.

export const DEFAULT_WFS_VERSION = '1.1.0'

// WFS 2.0.0 is used as a fallback for Esri servers, which require it for GeoJSON output and
// for accurate hits counts. See fetchWfsFeatureCollection and fetchWfsFeatureCount.
export const WFS_FALLBACK_VERSION = '2.0.0'

/**
 * The versions requests are sent and parsed in, highest first. 1.0.0 is left
 * out: it has no `resultType=hits`, so a layer could not be counted in it.
 */
export const SPOKEN_WFS_VERSIONS = ['2.0.0', DEFAULT_WFS_VERSION] as const

/** The version a capabilities request asks for. */
export const WFS_CAPABILITIES_VERSION = SPOKEN_WFS_VERSIONS[0]
