import { describe, expect, it } from 'vitest'

import { ICON_LIBRARIES, isIconLibraryAddress, readHttpsAddress, resolveFieldIconAddress } from './fieldIconAddress.ts'
import referenceDoc from '../../spec/README.md?raw'


const NPM = 'https://cdn.jsdelivr.net/npm/'

describe('resolveFieldIconAddress', () => {
  it.each([
    ['tree', '@tabler/icons@3/icons/outline/tree.svg'],
    ['tabler:tree', '@tabler/icons@3/icons/outline/tree.svg'],
    ['tabler:heart-filled', '@tabler/icons@3/icons/filled/heart.svg'],
    ['lucide:tree-pine', 'lucide-static@1/icons/tree-pine.svg'],
    ['heroicons:academic-cap', 'heroicons@2/24/outline/academic-cap.svg'],
    ['heroicons:academic-cap-solid', 'heroicons@2/24/solid/academic-cap.svg'],
    ['heroicons:academic-cap-20-solid', 'heroicons@2/20/solid/academic-cap.svg'],
    ['heroicons:academic-cap-16-solid', 'heroicons@2/16/solid/academic-cap.svg'],
    ['ph:tree-structure', '@phosphor-icons/core@2/assets/regular/tree-structure.svg'],
    ['ph:tree-structure-bold', '@phosphor-icons/core@2/assets/bold/tree-structure-bold.svg'],
    ['ph:tree-structure-duotone', '@phosphor-icons/core@2/assets/duotone/tree-structure-duotone.svg'],
    ['bi:tree', 'bootstrap-icons@1/icons/tree.svg'],
    ['material-symbols:home', '@material-symbols/svg-400@0/outlined/home-fill.svg'],
    ['material-symbols:home-outline', '@material-symbols/svg-400@0/outlined/home.svg'],
    ['material-symbols:home-rounded', '@material-symbols/svg-400@0/rounded/home-fill.svg'],
    ['material-symbols:home-outline-rounded', '@material-symbols/svg-400@0/rounded/home.svg'],
    ['material-symbols:outdoor-grill', '@material-symbols/svg-400@0/outlined/outdoor_grill-fill.svg'],
    ['material-symbols:water-drop-outline-rounded', '@material-symbols/svg-400@0/rounded/water_drop.svg'],
    ['maki:park', '@mapbox/maki@8/icons/park.svg'],
    ['temaki:bench', '@rapideditor/temaki@5/icons/bench.svg']
  ])('reads %s as a jsDelivr file', (value, path) => {
    expect(resolveFieldIconAddress(value)).toBe(`${NPM}${path}`)
  })

  it('reads a name in any case, with spaces around it', () => {
    expect(resolveFieldIconAddress('  Tabler:Tree ')).toBe(`${NPM}@tabler/icons@3/icons/outline/tree.svg`)
  })

  it('keeps an https address as written', () => {
    expect(resolveFieldIconAddress('https://example.com/icons/tree.svg')).toBe('https://example.com/icons/tree.svg')
  })

  it.each([
    ['an empty value', ''],
    ['an http address', 'http://example.com/tree.svg'],
    ['a library outside the table', 'fa7-solid:tree'],
    ['a name with a path in it', 'tabler:../tree'],
    ['a name with a space in it', 'tabler:pine tree'],
    ['a library and no name', 'tabler:']
  ])('names no icon for %s', (_, value) => {
    expect(resolveFieldIconAddress(value)).toBeNull()
  })
})

describe('isIconLibraryAddress', () => {
  it('knows a library file at any version, and nothing else', () => {
    expect(isIconLibraryAddress(`${NPM}@tabler/icons@3/icons/outline/tree.svg`)).toBe(true)
    expect(isIconLibraryAddress(`${NPM}@tabler/icons@latest/icons/outline/tree.svg`)).toBe(true)
    expect(isIconLibraryAddress(`${NPM}@mapbox/maki/icons/park.svg`)).toBe(true)
    expect(isIconLibraryAddress(`${NPM}@tabler/icons-react@3/dist/index.js`)).toBe(false)
    expect(isIconLibraryAddress('https://cdn.jsdelivr.net/gh/qgis/QGIS@final-3_44_13/images/svg/gpsicons/tree.svg')).toBe(false)
    expect(isIconLibraryAddress('https://example.com/@mapbox/maki@8/icons/park.svg')).toBe(false)
  })
})

describe('readHttpsAddress', () => {
  it('reads only an https address', () => {
    expect(readHttpsAddress('https://cdn.jsdelivr.net/npm/x.svg')).toBe('https://cdn.jsdelivr.net/npm/x.svg')
    expect(readHttpsAddress('http://cdn.jsdelivr.net/npm/x.svg')).toBeNull()
    expect(readHttpsAddress('javascript:alert(1)')).toBeNull()
    expect(readHttpsAddress(42)).toBeNull()
  })
})

describe('the icon libraries in the field reference', () => {
  it('lists each library the code reads, with its package and major version, and no other', () => {
    const rows = [...referenceDoc.matchAll(/^\| `([a-z-]+)`(?:, or none)? \| [^|]+ \| `([^`]+)` \| (\d+) \|$/gm)]
      .map((match) => [match[1]!, match[2]!, Number(match[3])] as const)
    const libraries = Object.entries(ICON_LIBRARIES).map(([prefix, library]) => [prefix, library.packageName, library.major] as const)
    expect(rows).toEqual(libraries)
  })
})
