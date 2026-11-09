/**
 * The one Node API the package's tests reach for: reading a binary fixture,
 * such as a `.qgz`, which a `?raw` import would garble. Declared here rather
 * than adding Node's types to the package, which would put Node's globals into
 * the code the package ships.
 */
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array<ArrayBuffer>
}
