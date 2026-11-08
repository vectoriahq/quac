/**
 * The icon libraries Groundwork reads from jsDelivr, each pinned to the major
 * version of its package, so a release adds icons but never renames one. A
 * field's icon is named from them (`docs/plans/archive/field-icons.md`), and a
 * map symbol from one of them is painted in its style's colour (#2255). This
 * table is the one place a library or a version changes.
 */

const JSDELIVR_NPM = 'https://cdn.jsdelivr.net/npm/'

/** An icon name as Iconify spells one: lower-case letters and digits joined by single hyphens. */
const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const PHOSPHOR_WEIGHTS = ['thin', 'light', 'bold', 'fill', 'duotone'] as const

export interface IconLibrary {
  /** The npm package, without its version. */
  packageName: string
  /** The major version read. */
  major: number
  /** The file in the package for the icon of that name. */
  path: (name: string) => string
}

/** Each library, by its prefix in Iconify's naming. The field reference lists them, and a test holds the two equal. */
export const ICON_LIBRARIES: Readonly<Record<string, IconLibrary>> = {
  tabler: {
    packageName: '@tabler/icons',
    major: 3,
    path: (name) => name.endsWith('-filled') ? `icons/filled/${name.slice(0, -'-filled'.length)}.svg` : `icons/outline/${name}.svg`
  },
  lucide: { packageName: 'lucide-static', major: 1, path: (name) => `icons/${name}.svg` },
  heroicons: {
    packageName: 'heroicons',
    major: 2,
    path: (name) => {
      for (const [suffix, folder] of [['-20-solid', '20/solid'], ['-16-solid', '16/solid'], ['-solid', '24/solid']] as const) {
        if (name.endsWith(suffix)) return `${folder}/${name.slice(0, -suffix.length)}.svg`
      }
      return `24/outline/${name}.svg`
    }
  },
  // Phosphor's files carry their weight in the name, as Iconify's do: `tree-structure-bold.svg`.
  ph: {
    packageName: '@phosphor-icons/core',
    major: 2,
    path: (name) => `assets/${PHOSPHOR_WEIGHTS.find((weight) => name.endsWith(`-${weight}`)) ?? 'regular'}/${name}.svg`
  },
  bi: { packageName: 'bootstrap-icons', major: 1, path: (name) => `icons/${name}.svg` },
  // Iconify's plain name is Google's filled Outlined icon, `-outline` the unfilled one, and the
  // same two in the Rounded style end `-rounded` and `-outline-rounded`. Google's files join
  // the words of a name with underscores, so `outdoor-grill` is `outlined/outdoor_grill-fill.svg`.
  'material-symbols': {
    packageName: '@material-symbols/svg-400',
    major: 0,
    path: (name) => {
      const file = (base: string) => base.replaceAll('-', '_')
      if (name.endsWith('-outline-rounded')) return `rounded/${file(name.slice(0, -'-outline-rounded'.length))}.svg`
      if (name.endsWith('-rounded')) return `rounded/${file(name.slice(0, -'-rounded'.length))}-fill.svg`
      if (name.endsWith('-outline')) return `outlined/${file(name.slice(0, -'-outline'.length))}.svg`
      return `outlined/${file(name)}-fill.svg`
    }
  },
  maki: { packageName: '@mapbox/maki', major: 8, path: (name) => `icons/${name}.svg` },
  temaki: { packageName: '@rapideditor/temaki', major: 5, path: (name) => `icons/${name}.svg` }
}

/** The address a field's icon value names, or null for a value that names none. */
export function resolveFieldIconAddress(value: string): string | null {
  const trimmed = value.trim()
  if (/^https:\/\//i.test(trimmed)) return readHttpsAddress(trimmed)

  const separator = trimmed.indexOf(':')
  const prefix = separator === -1 ? 'tabler' : trimmed.slice(0, separator).toLowerCase()
  const name = (separator === -1 ? trimmed : trimmed.slice(separator + 1)).toLowerCase()
  const library = Object.hasOwn(ICON_LIBRARIES, prefix) ? ICON_LIBRARIES[prefix] : undefined
  if (!library || !ICON_NAME_PATTERN.test(name)) return null
  return `${JSDELIVR_NPM}${library.packageName}@${library.major}/${library.path(name)}`
}

/**
 * Whether `url` is a file of one of the libraries on jsDelivr, at any version:
 * an administrator pastes the address the library's own site gives, which may
 * name `@latest` or an exact release.
 */
export function isIconLibraryAddress(url: string): boolean {
  if (!url.startsWith(JSDELIVR_NPM)) return false
  const rest = url.slice(JSDELIVR_NPM.length)
  return Object.values(ICON_LIBRARIES).some((library) => rest.startsWith(`${library.packageName}@`) || rest.startsWith(`${library.packageName}/`))
}

/** The address as the URL parser writes it, or null where it is not an `https://` address. */
export function readHttpsAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
