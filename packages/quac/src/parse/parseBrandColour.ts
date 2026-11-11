import { propertyList, readPropertyBlock } from './projectProperties.ts'

/** The project colour label this package reads as the map's brand colour, compared ignoring case. */
export const BRAND_COLOUR_LABEL = 'Brand'

/**
 * The project colour labelled {@link BRAND_COLOUR_LABEL} (Project Properties >
 * Colors), as QGIS saved it, or null where the project has none. QGIS saves
 * the palette as two parallel lists, `<Palette><Colors>` and
 * `<Palette><Labels>` (`QgsProject::setProjectColors`,
 * `src/core/project/qgsproject.cpp`), each colour in
 * `QgsColorUtils::colorToString` form, which starts `r,g,b,a,`
 * (`src/core/qgscolorutils.cpp`, `qgis/QGIS@master`, read 2026-10-25). The
 * first matching label wins. The app decodes the text: this package reads no
 * colours of its own.
 */
export function parseBrandColour(qgisRoot: Element): string | null {
  const palette = readPropertyBlock(qgisRoot, 'Palette')
  if (!palette) return null
  const colours = propertyList(palette, 'Colors')
  const labels = propertyList(palette, 'Labels')
  const index = labels.findIndex((label) => label.trim().toLowerCase() === BRAND_COLOUR_LABEL.toLowerCase())
  if (index < 0) return null
  return colours[index]?.trim() || null
}
