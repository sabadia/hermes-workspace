/**
 * Filesystem Memory Adapter
 *
 * Original workspace memory implementation. Reads `~/.hermes/MEMORY.md`,
 * `memory/*.md`, and `memories/*.md` directly from disk.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { MemoryFileMeta, MemorySearchMatch } from '../memory-browser-types'

function isBrowserMemoryPath(relativePath: string): boolean {
  return (
    relativePath === 'MEMORY.md' ||
    relativePath.startsWith('memory/') ||
    relativePath.startsWith('memories/')
  )
}

function normalizeWorkspaceRoot(): string {
  const envHome = (process.env.HERMES_HOME || process.env.CLAUDE_HOME)?.trim()
  return envHome
    ? path.resolve(envHome)
    : path.resolve(path.join(os.homedir(), '.hermes'))
}

export function getMemoryWorkspaceRoot(): string {
  return path.resolve(normalizeWorkspaceRoot())
}

function normalizeRelativeMemoryPath(input: string): string {
  const normalized = input.replace(/\\/g, '/').trim()
  if (!normalized) throw new Error('Path is required')
  if (normalized.startsWith('/')) throw new Error('Absolute paths are not allowed')
  if (normalized.includes('..')) throw new Error('Path traversal is not allowed')
  if (!normalized.toLowerCase().endsWith('.md')) throw new Error('Only Markdown files are allowed')
  return normalized
}

export function resolveMemoryFilePath(relativePath: string): { fullPath: string; relativePath: string } {
  const safeRelativePath = normalizeRelativeMemoryPath(relativePath)
  const workspaceRoot = getMemoryWorkspaceRoot()
  const fullPath = path.resolve(workspaceRoot, safeRelativePath)
  if (!fullPath.startsWith(workspaceRoot)) {
    throw new Error('Resolved path is outside workspace')
  }
  return { fullPath, relativePath: safeRelativePath }
}

function pushIfMarkdownFile(entries: Array<MemoryFileMeta>, workspaceRoot: string, fullPath: string) {
  if (!fullPath.toLowerCase().endsWith('.md')) return
  let stats: fs.Stats
  try {
    stats = fs.statSync(fullPath)
  } catch {
    return
  }
  if (!stats.isFile()) return

  const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/')
  if (!isBrowserMemoryPath(relativePath)) return

  entries.push({
    path: relativePath,
    name: path.basename(fullPath),
    size: stats.size,
    modified: stats.mtime.toISOString(),
  })
}

function shouldSkipDirectory(name: string): boolean {
  return name === '.git' || name === 'node_modules'
}

function walkWorkspaceDir(entries: Array<MemoryFileMeta>, workspaceRoot: string, dirPath: string) {
  let dirEntries: Array<string>
  try {
    dirEntries = fs.readdirSync(dirPath)
  } catch {
    return
  }

  for (const name of dirEntries) {
    const fullPath = path.join(dirPath, name)
    let stats: fs.Stats
    try {
      stats = fs.statSync(fullPath)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      if (shouldSkipDirectory(name)) continue
      walkWorkspaceDir(entries, workspaceRoot, fullPath)
      continue
    }
    pushIfMarkdownFile(entries, workspaceRoot, fullPath)
  }
}

function compareMemoryFiles(a: MemoryFileMeta, b: MemoryFileMeta): number {
  if (a.path === 'MEMORY.md' && b.path !== 'MEMORY.md') return -1
  if (b.path === 'MEMORY.md' && a.path !== 'MEMORY.md') return 1

  const aIsDaily = /^memories?\/\d{4}-\d{2}-\d{2}\.md$/.test(a.path)
  const bIsDaily = /^memories?\/\d{4}-\d{2}-\d{2}\.md$/.test(b.path)
  if (aIsDaily && bIsDaily) return b.path.localeCompare(a.path)

  const modifiedDiff = Date.parse(b.modified) - Date.parse(a.modified)
  if (modifiedDiff !== 0) return modifiedDiff
  return a.path.localeCompare(b.path)
}

export async function list(): Promise<Array<MemoryFileMeta>> {
  const workspaceRoot = getMemoryWorkspaceRoot()
  const results: Array<MemoryFileMeta> = []

  pushIfMarkdownFile(results, workspaceRoot, path.join(workspaceRoot, 'MEMORY.md'))
  for (const subdir of ['memory', 'memories']) {
    walkWorkspaceDir(results, workspaceRoot, path.join(workspaceRoot, subdir))
  }

  results.sort(compareMemoryFiles)
  return results
}

export async function read(relativePath: string): Promise<string> {
  const { fullPath } = resolveMemoryFilePath(relativePath)
  return fs.readFileSync(fullPath, 'utf-8')
}

export async function search(query: string): Promise<Array<MemorySearchMatch>> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const matches: Array<MemorySearchMatch> = []
  const files = await list()

  for (const file of files) {
    let content = ''
    try {
      content = await read(file.path)
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index] || ''
      if (!text.toLowerCase().includes(needle)) continue
      matches.push({ path: file.path, line: index + 1, text })
      if (matches.length >= 200) return matches
    }
  }

  return matches
}

export async function write(relativePath: string, content: string): Promise<void> {
  const { fullPath } = resolveMemoryFilePath(relativePath)
  const dir = path.dirname(fullPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf-8')
}

export function available(): boolean {
  try {
    return fs.existsSync(getMemoryWorkspaceRoot())
  } catch {
    return false
  }
}
