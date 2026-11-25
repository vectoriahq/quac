import type { StacAsset, StacCatalog, StacCollection, StacLink } from '../model/Stac.ts'

/**
 * Writes a catalogue as separate documents: the root Catalog, each nested
 * Catalog and each Collection in a document of its own, linked by `child`,
 * `parent` and `root` links, with no `collections` or `catalogs` arrays
 * (`packages/quac/spec/README.md` § "The document").
 */

/** Where the documents go. */
export interface SplitCatalogueOptions {
  /**
   * The root Catalog's file name: one file name ending in `.json`, such as
   * `catalog.json` or `Parks.json`. `catalog.json` where it is left off.
   */
  rootFileName?: string
  /**
   * The folder every other document goes in, relative to the root document's
   * folder, such as `Parks`. Empty, the default, puts them beside the root
   * document.
   */
  childrenFolder?: string
}

/** One document of a catalogue written as separate documents. */
export interface CatalogueDocument {
  /**
   * Where the document is saved, relative to the root document's folder: file
   * and folder names joined by `/`, not escaped. Always inside that folder.
   */
  path: string
  document: StacCatalog | StacCollection
}

const DEFAULT_ROOT_FILE_NAME = 'catalog.json'

/**
 * The catalogue `catalogue` holds, one document holding the whole tree, as
 * separate documents, the root first and then each child after its parent, in
 * the order the parent's `child` links list them.
 *
 * A Catalog's Collections go in a `collections` folder beside it and its
 * nested Catalogs in a `catalogs` folder, each in a folder of its own holding
 * its `catalog.json`. The root's go in `childrenFolder`. A document's file or
 * folder name is its id, made safe as a file name on any system (`safeName`),
 * and where two in one folder would take the same name, in any case, the later
 * one is given `-2`, `-3` and so on.
 *
 * Every relative href, in each link and asset, is rewritten from the
 * document's own path. A `self`, `root` or `parent` link names that document's
 * new path, and a `child` link whose href is a child's own `self` href names
 * the child's. Every other relative href is resolved against the root
 * document's folder, as the one document's hrefs are, so a data file keeps its
 * place, even one outside that folder. An absolute href, one starting with `/`,
 * and one holding only a query or a fragment are left as they are. A child that
 * no `child` link names is given one.
 *
 * Throws where `rootFileName` or `childrenFolder` is not a safe relative path.
 */
export function splitCatalogue(catalogue: StacCatalog, options: SplitCatalogueOptions = {}): CatalogueDocument[] {
  const rootFileName = options.rootFileName ?? DEFAULT_ROOT_FILE_NAME
  if (!isSafeName(rootFileName) || !/\.json$/i.test(rootFileName)) {
    throw new Error(`The root document's file name must be one safe file name ending in .json: ${JSON.stringify(rootFileName)}`)
  }
  const childrenFolder = (options.childrenFolder ?? '').replace(/\/$/, '')
  const folderNames = childrenFolder ? childrenFolder.split('/') : []
  if (!folderNames.every(isSafeName) || folderNames[0]?.toLowerCase() === rootFileName.toLowerCase()) {
    throw new Error(`The children's folder must be a relative path of safe folder names, apart from the root document: ${JSON.stringify(options.childrenFolder)}`)
  }

  const root = placeCatalog(catalogue, rootFileName, folderNames)
  const documents: CatalogueDocument[] = []
  writeDocuments(root, null, root, documents)
  return documents
}

/** A document's place in the split catalogue. */
interface Placed {
  node: StacCatalog | StacCollection
  /** Its path, as `CatalogueDocument.path`. */
  path: string
  /** For a Catalog: its children in the order they are written, each with the index of the `child` link naming it, or -1. */
  children: Array<{ placed: Placed, linkIndex: number }>
}

/**
 * Places a Catalog at `path` and its children in `folder`, so every path is
 * known before any href is written.
 */
function placeCatalog(catalog: StacCatalog, path: string, folder: string[]): Placed {
  const candidates: Array<StacCatalog | StacCollection> = [...(catalog.collections ?? []), ...(catalog.catalogs ?? [])]
  const claimed = new Set<StacCatalog | StacCollection>()
  const ordered: Array<{ node: StacCatalog | StacCollection, linkIndex: number }> = []
  catalog.links.forEach((link, linkIndex) => {
    if (link.rel !== 'child') return
    const node = candidates.find((candidate) => !claimed.has(candidate) && selfHrefOf(candidate) === link.href)
    if (!node) return
    claimed.add(node)
    ordered.push({ node, linkIndex })
  })
  for (const node of candidates) {
    if (!claimed.has(node)) ordered.push({ node, linkIndex: -1 })
  }

  const fileNames = new Set<string>()
  const folderNames = new Set<string>()
  const children = ordered.map(({ node, linkIndex }) => {
    if (node.type === 'Collection') {
      const fileName = unclaimedName(safeName(node.id), '.json', fileNames)
      return { placed: { node, path: [...folder, 'collections', fileName].join('/'), children: [] }, linkIndex }
    }
    const childFolder = [...folder, 'catalogs', unclaimedName(safeName(node.id), '', folderNames)]
    return { placed: placeCatalog(node, [...childFolder, 'catalog.json'].join('/'), childFolder), linkIndex }
  })
  return { node: catalog, path, children }
}

function writeDocuments(placed: Placed, parent: Placed | null, root: Placed, into: CatalogueDocument[]): void {
  const folder = placed.path.split('/').slice(0, -1).map(encodeURIComponent)
  const hrefTo = (other: Placed) => relativeHref(folder, { ups: 0, segments: other.path.split('/').map(encodeURIComponent) })
  const childAt = new Map(placed.children.filter((child) => child.linkIndex >= 0).map((child) => [child.linkIndex, child.placed]))

  const links: StacLink[] = placed.node.links.map((link, index) => {
    if (!isPathHref(link.href)) return { ...link }
    const child = childAt.get(index)
    if (child) return { ...link, href: hrefTo(child) }
    if (link.rel === 'self') return { ...link, href: hrefTo(placed) }
    if (link.rel === 'root') return { ...link, href: hrefTo(root) }
    if (link.rel === 'parent' && parent) return { ...link, href: hrefTo(parent) }
    return { ...link, href: rewriteHref(link.href, folder) }
  })
  for (const child of placed.children) {
    if (child.linkIndex >= 0) continue
    const title = child.placed.node.title
    links.push({ rel: 'child', href: hrefTo(child.placed), type: 'application/json', ...(title === undefined ? {} : { title }) })
  }

  const document: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(placed.node)) {
    if (key === 'collections' || key === 'catalogs') continue
    if (key === 'links') document[key] = links
    else if (key === 'assets' && value && typeof value === 'object') document[key] = rewriteAssets(value as Record<string, StacAsset>, folder)
    else document[key] = value
  }
  into.push({ path: placed.path, document: document as unknown as StacCatalog | StacCollection })

  for (const child of placed.children) writeDocuments(child.placed, placed, root, into)
}

function rewriteAssets(assets: Record<string, StacAsset>, folder: string[]): Record<string, StacAsset> {
  return Object.fromEntries(Object.entries(assets).map(([key, asset]) => (
    [key, typeof asset?.href === 'string' ? { ...asset, href: rewriteHref(asset.href, folder) } : asset]
  )))
}

function selfHrefOf(node: StacCatalog | StacCollection): string | undefined {
  return node.links.find((link) => link.rel === 'self')?.href
}

/**
 * Whether an href is a relative path, which moves with the document holding
 * it: not an absolute address, not one starting with `/`, and not one holding
 * only a query or a fragment, which names the document it is in.
 */
function isPathHref(href: unknown): href is string {
  return typeof href === 'string' && href !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[/?#]/.test(href)
}

/** A path from the root document's folder: `ups` folders above it, then `segments`, escaped as hrefs hold them. */
interface Target {
  ups: number
  segments: string[]
}

/** A relative href, which resolves against the root document's folder, rewritten from `folder`, a folder inside it. */
function rewriteHref(href: string, folder: string[]): string {
  if (!isPathHref(href)) return href
  const cut = href.search(/[?#]/)
  const path = cut < 0 ? href : href.slice(0, cut)
  const rest = cut < 0 ? '' : href.slice(cut)
  return relativeHref(folder, resolvePath(path)) + rest
}

/** A relative path resolved against the root document's folder, its `.` and `..` segments taken out. */
function resolvePath(path: string): Target {
  const segments: string[] = []
  let ups = 0
  const parts = path.split('/')
  parts.forEach((part, index) => {
    const last = index === parts.length - 1
    if (part === '.' || part === '..') {
      if (part === '..') {
        if (segments.length > 0) segments.pop()
        else ups += 1
      }
      // A path ending in `.` or `..` names a folder.
      if (last) segments.push('')
      return
    }
    segments.push(part)
  })
  return { ups, segments }
}

/** The href naming `target` from `folder`, both from the root document's folder. */
function relativeHref(folder: string[], target: Target): string {
  if (target.ups > 0) return '../'.repeat(folder.length + target.ups) + target.segments.join('/')
  const targetFolder = target.segments.slice(0, -1)
  let shared = 0
  while (shared < folder.length && shared < targetFolder.length && folder[shared] === targetFolder[shared]) shared += 1
  const rest = target.segments.slice(shared).join('/')
  const ups = folder.length - shared
  return ups > 0 ? '../'.repeat(ups) + rest : `./${rest}`
}

/** Characters no file name may hold on Windows, macOS or Linux: controls, `/`, and those Windows refuses. */
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f"*/:<>?\\|]/g

/** The names Windows keeps for devices, with or without an extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i

/**
 * An id made a file or folder name that is safe on any system: each character
 * a name may not hold, `/` among them, becomes `_`, as does each `.` or space
 * at its end, which Windows drops; an empty name is `_`; and a name Windows
 * keeps for a device, such as `con`, is given a leading `_`. So no name is
 * empty, `.` or `..`.
 */
function safeName(id: string): string {
  let name = id.replace(UNSAFE_CHARACTERS, '_')
  // Counted from the end, not matched with /[. ]+$/, which takes time growing with the square of a run of spaces that does not end the id.
  let kept = name.length
  while (kept > 0 && (name[kept - 1] === '.' || name[kept - 1] === ' ')) kept -= 1
  name = name.slice(0, kept) + '_'.repeat(name.length - kept)
  if (name === '') name = '_'
  return RESERVED_NAME.test(name) ? `_${name}` : name
}

function isSafeName(name: string): boolean {
  return safeName(name) === name
}

/** `name` and `suffix`, or with `-2`, `-3` and so on before the suffix, whichever is first not in `taken`, compared in lower case. */
function unclaimedName(name: string, suffix: string, taken: Set<string>): string {
  let candidate = `${name}${suffix}`
  for (let count = 2; taken.has(candidate.toLowerCase()); count += 1) candidate = `${name}-${count}${suffix}`
  taken.add(candidate.toLowerCase())
  return candidate
}
