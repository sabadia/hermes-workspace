/**
 * Knowledge Browser — Provider-Agnostic Facade
 *
 * Delegates to the adapter factory so the workspace respects
 * `memory.provider` from Hermes Agent config.yaml.
 */
export type { WikiPageMeta, WikiLink, KnowledgeGraph } from './knowledge-browser-types'

// Re-export config helpers for backward compat
export { readKnowledgeBaseConfig, writeKnowledgeBaseConfig, getKnowledgeBaseEffectiveRoot } from './knowledge-config'
export type { KnowledgeBaseSource, KnowledgeBaseConfig } from './knowledge-config'

import { getActiveKnowledgeAdapter } from './knowledge-adapters'
import { readKnowledgeBaseConfig, type KnowledgeBaseSource } from './knowledge-config'
import * as fs from 'node:fs'
import * as path from 'node:path'

function getLegacyKnowledgeRoot(): string {
  if (process.env.KNOWLEDGE_DIR) return path.resolve(process.env.KNOWLEDGE_DIR)
  const claudeHome = path.join(process.env.HOME || '/', '.claude')
  const claudeKnowledge = path.join(claudeHome, 'knowledge')
  if (fs.existsSync(claudeKnowledge)) return claudeKnowledge
  const homeKnowledge = path.join(process.env.HOME || '/', 'knowledge', 'wiki')
  if (fs.existsSync(homeKnowledge)) return homeKnowledge
  return claudeKnowledge
}

function getKnowledgeRoot(): string {
  const config = readKnowledgeBaseConfig()
  const source = config.source
  if (source.type === 'local') {
    const p = source.path.trim()
    if (p) return path.resolve(p.replace(/^~\//, `${process.env.HOME || '/'}/`))
  }
  return getLegacyKnowledgeRoot()
}

export function knowledgeRootExists(): boolean {
  try {
    const root = getKnowledgeRoot()
    if (!root) return false
    return fs.existsSync(root)
  } catch {
    return false
  }
}

export async function syncKnowledgeSource(): Promise<{
  source: KnowledgeBaseSource
  success: boolean
  error?: string
}> {
  const source = readKnowledgeBaseConfig().source
  // GitHub sync is not supported in the adapter facade; return local success
  if (source.type !== 'github') {
    return { source, success: true }
  }
  return {
    source,
    success: false,
    error: 'GitHub knowledge sync must be performed via the filesystem adapter directly.',
  }
}

export async function listKnowledgePages(): Promise<import('./knowledge-browser-types').WikiPageMeta[]> {
  return getActiveKnowledgeAdapter().list()
}

export async function readKnowledgePage(relativePath: string): Promise<{
  meta: import('./knowledge-browser-types').WikiPageMeta
  content: string
  backlinks: Array<string>
}> {
  return getActiveKnowledgeAdapter().read(relativePath)
}

export async function searchKnowledgePages(query: string): Promise<Array<{
  path: string
  title: string
  line: number
  text: string
}>> {
  return getActiveKnowledgeAdapter().search(query)
}

export async function buildKnowledgeGraph(): Promise<import('./knowledge-browser-types').KnowledgeGraph> {
  return getActiveKnowledgeAdapter().buildGraph()
}
