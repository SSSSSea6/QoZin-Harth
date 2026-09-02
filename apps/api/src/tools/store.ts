import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { env } from '../env'

function versionDir(toolId: string, versionId: string): string {
  return resolve(env.TOOLS_DIR, toolId, versionId)
}

export async function savePackage(
  toolId: string,
  versionId: string,
  files: Record<string, Uint8Array>,
): Promise<void> {
  const dir = versionDir(toolId, versionId)
  for (const [name, data] of Object.entries(files)) {
    const target = resolve(dir, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }
}

export async function readPackageFile(
  toolId: string,
  versionId: string,
  name: string,
): Promise<Buffer | null> {
  const dir = versionDir(toolId, versionId)
  const target = resolve(dir, name)
  if (target !== dir && !target.startsWith(dir + sep)) return null
  try {
    return await readFile(target)
  } catch {
    return null
  }
}

export async function loadPackageFiles(
  toolId: string,
  versionId: string,
): Promise<Record<string, Uint8Array>> {
  const dir = versionDir(toolId, versionId)
  const files: Record<string, Uint8Array> = {}
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath, entry.name)
    files[relative(dir, full).split(sep).join('/')] = new Uint8Array(await readFile(full))
  }
  return files
}
