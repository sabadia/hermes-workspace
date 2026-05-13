/**
 * Filesystem Knowledge Adapter
 *
 * Original workspace knowledge implementation. Builds a graph from
 * markdown wikilinks ([[...]]) in a local or GitHub-synced directory.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as YAML from 'yaml'
import {
  readKnowledgeBaseConfig,
  type KnowledgeBaseSource,
} from '../knowledge-config'
import type { KnowledgeGraph, WikiPageMeta } from '../knowledge-browser-types'

type ParsedKnowledgePage = { meta: WikiPageMeta; content: string; raw: string }

function shouldSkipDirectory(name: string): boolean {
  return name === '.git' || name === 'node_modules'
}

function normalizeTitle(name: string): string {
  return name.replace(/\.md$/i, '')
}

function normalizeTagList(input: unknown): Array<string> {
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim()).filter(Boolean)
  }
  if (typeof input === 'string') {
    return input.split(',').map((v) => v.trim()).filter(Boolean)
  }
  return []
}

function normalizeFrontmatterValue(input: unknown): string | undefined {
  if (input == null) return undefined
  const value = String(input).trim()
  return value || undefined
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  if (!raw.startsWith('---')) return { data: {}, content: raw }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: raw }
  try {
    const parsed = YAML.parse(match[1])
    return { data: parsed && typeof parsed === 'object' ? parsed : {}, content: match[2] || '' }
  } catch {
    return { data: {}, content: match[2] || raw }
  }
}

function cleanWikilinkTarget(input: string): string {
  return input.split('|')[0]?.split('#')[0]?.trim() || ''
}

function extractWikilinks(content: string): Array<string> {
  const links = new Set<string>()
  const regex = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null = null
  while ((match = regex.exec(content)) !== null) {
    const target = cleanWikilinkTarget(match[1] || '')
    if (target) links.add(target)
  }
  return Array.from(links)
}

function getLegacyKnowledgeRoot(): string {
  if (process.env.KNOWLEDGE_DIR) return path.resolve(process.env.KNOWLEDGE_DIR)
  const claudeHome = path.join(os.homedir(), '.claude')
  const claudeKnowledge = path.join(claudeHome, 'knowledge')
  if (fs.existsSync(claudeKnowledge)) return claudeKnowledge
  const homeKnowledge = path.join(os.homedir(), 'knowledge', 'wiki')
  if (fs.existsSync(homeKnowledge)) return homeKnowledge
  return claudeKnowledge
}

function getKnowledgeRoot(): string {
  const config = readKnowledgeBaseConfig()
  const source = config.source
  if (source.type === 'local') {
    const p = source.path.trim()
    if (p) return path.resolve(p.replace(/^~\//, `${os.homedir()}/`))
  }
  return getLegacyKnowledgeRoot()
}

function walkKnowledgeDir(results: Array<ParsedKnowledgePage>, knowledgeRoot: string, dirPath: string) {
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
      walkKnowledgeDir(results, knowledgeRoot, fullPath)
      continue
    }
    if (!name.toLowerCase().endsWith('.md')) continue
    const relativePath = path.relative(knowledgeRoot, fullPath).replace(/\\/g, '/')
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8')
      const { data, content } = parseFrontmatter(raw)
      const modified = stats.mtime.toISOString()
      results.push({
        meta: {
          path: relativePath,
          name,
          title: normalizeFrontmatterValue(data.title) || normalizeTitle(name),
          type: normalizeFrontmatterValue(data.type),
          domain: normalizeFrontmatterValue(data.domain),
          status: normalizeFrontmatterValue(data.status),
          tags: normalizeTagList(data.tags),
          summary: normalizeFrontmatterValue(data.summary),
          created: normalizeFrontmatterValue(data.created),
          updated: normalizeFrontmatterValue(data.updated) || modified,
          size: stats.size,
          modified,
          wikilinks: extractWikilinks(content),
        },
        content,
        raw,
      })
    } catch {
      // skip unreadable
    }
  }
}

function getParsedKnowledgePages(): Array<ParsedKnowledgePage> {
  const knowledgeRoot = path.resolve(getKnowledgeRoot())
  if (!fs.existsSync(knowledgeRoot)) return []
  const results: Array<ParsedKnowledgePage> = []
  walkKnowledgeDir(results, knowledgeRoot, knowledgeRoot)
  results.sort((a, b) => {
    const updatedDiff =
      Date.parse(b.meta.updated || b.meta.modified) -
      Date.parse(a.meta.updated || a.meta.modified)
    if (updatedDiff !== 0) return updatedDiff
    return a.meta.path.localeCompare(b.meta.path)
  })
  return results
}

export async function list(): Promise<Array<WikiPageMeta>> {
  return getParsedKnowledgePages().map((p) => p.meta)
}

export async function read(relativePath: string) {
  const knowledgeRoot = path.resolve(getKnowledgeRoot())
  const fullPath = path.resolve(knowledgeRoot, relativePath)
  const rel = path.relative(knowledgeRoot, fullPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Resolved path is outside knowledge root')
  }
  const raw = fs.readFileSync(fullPath, 'utf-8')
  const { data, content } = parseFrontmatter(raw)
  const stats = fs.statSync(fullPath)
  const modified = stats.mtime.toISOString()
  const meta: WikiPageMeta = {
    path: relativePath,
    name: path.basename(relativePath),
    title: normalizeFrontmatterValue(data.title) || normalizeTitle(relativePath),
    type: normalizeFrontmatterValue(data.type),
    domain: normalizeFrontmatterValue(data.domain),
    status: normalizeFrontmatterValue(data.status),
    tags: normalizeTagList(data.tags),
    summary: normalizeFrontmatterValue(data.summary),
    created: normalizeFrontmatterValue(data.created),
    updated: normalizeFrontmatterValue(data.updated) || modified,
    size: stats.size,
    modified,
    wikilinks: extractWikilinks(content),
  }

  const pages = getParsedKnowledgePages()
  const byPath = new Map(pages.map((p) => [p.meta.path.replace(/\.md$/i, '').toLowerCase(), p.meta.path]))
  const byName = new Map(pages.map((p) => [path.basename(p.meta.path, '.md').toLowerCase(), p.meta.path]))

  const resolveLink = (linkText: string) => {
    const cleaned = cleanWikilinkTarget(linkText)
    if (!cleaned) return null
    const normalized = cleaned.replace(/\\/g, '/').trim().replace(/\.md$/i, '').toLowerCase()
    return byPath.get(normalized) || byName.get(normalized) || null
  }

  const backlinks = pages
    .filter((p) => p.meta.path !== relativePath)
    .filter((p) => p.meta.wikilinks.some((link) => resolveLink(link) === relativePath))
    .map((p) => p.meta.path)

  return { meta, content, backlinks }
}

export async function search(query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: Array<{ path: string; title: string; line: number; text: string }> = []
  const pages = getParsedKnowledgePages()
  for (const page of pages) {
    const lines = page.content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i]
      if (!text.toLowerCase().includes(needle)) continue
      matches.push({ path: page.meta.path, title: page.meta.title, line: i + 1, text })
      if (matches.length >= 200) return matches
    }
  }
  return matches
}

export async function buildGraph(): Promise<KnowledgeGraph> {
  const pages = getParsedKnowledgePages()
  const nodes = pages.map((p) => ({
    id: p.meta.path,
    title: p.meta.title,
    type: p.meta.type,
    tags: p.meta.tags,
  }))

  const byPath = new Map(pages.map((p) => [p.meta.path.replace(/\.md$/i, '').toLowerCase(), p.meta.path]))
  const byName = new Map(pages.map((p) => [path.basename(p.meta.path, '.md').toLowerCase(), p.meta.path]))

  const resolveLink = (linkText: string) => {
    const cleaned = cleanWikilinkTarget(linkText)
    if (!cleaned) return null
    const normalized = cleaned.replace(/\\/g, '/').trim().replace(/\.md$/i, '').toLowerCase()
    return byPath.get(normalized) || byName.get(normalized) || null
  }

  const edges: Array<{ source: string; target: string }> = []
  for (const page of pages) {
    for (const link of page.meta.wikilinks) {
      const target = resolveLink(link)
      if (target && target !== page.meta.path) {
        edges.push({ source: page.meta.path, target })
      }
    }
  }

  return { nodes, edges }
}

export function available(): boolean {
  try {
    return fs.existsSync(path.resolve(getKnowledgeRoot()))
  } catch {
    return false
  }
}
