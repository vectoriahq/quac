import { strFromU8, unzipSync } from 'fflate'

import { getLowerCaseExtension } from '../util/fileName.ts'

/**
 * Returns a QGIS project file's XML, ready for `parseQgsXml`.
 *
 * A `.qgz` is a zip holding the `.qgs`. Its other entries — the `.qgd` auxiliary
 * data and any files attached to the project — are not read.
 */
export async function readProjectXml(fileName: string, body: Blob | Response): Promise<string> {
  if (getLowerCaseExtension(fileName) !== 'qgz') return body.text()

  const bytes = new Uint8Array(await body.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (entry) => entry.name.toLowerCase().endsWith('.qgs')
    })
  } catch (error) {
    throw new Error('The .qgz file is not a valid zip file.', { cause: error })
  }

  const projectEntry = Object.values(entries)[0]
  if (!projectEntry) {
    throw new Error('The .qgz file holds no .qgs project.')
  }
  return strFromU8(projectEntry)
}
