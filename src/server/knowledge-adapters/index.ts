/**
 * Knowledge Adapter Factory
 */
import { getMemoryProvider } from '../hermes-config-reader'
import type { KnowledgeGraph, WikiPageMeta } from '../knowledge-browser-types'
import * as filesystem from './filesystem'
import * as hindsight from './hindsight'

export type KnowledgeAdapter = {
  list(): Promise<Array<WikiPageMeta>>
  read(relativePath: string): Promise<{ meta: WikiPageMeta; content: string; backlinks: Array<string> }>
  search(query: string): Promise<Array<{ path: string; title: string; line: number; text: string }>>
  buildGraph(): Promise<KnowledgeGraph>
  sync?(): Promise<{ success: boolean; error?: string }>
  available(): boolean
}

const ADAPTERS: Record<string, KnowledgeAdapter> = {
  filesystem: filesystem as KnowledgeAdapter,
  hindsight: hindsight as KnowledgeAdapter,
}

export function getActiveKnowledgeAdapter(): KnowledgeAdapter {
  const provider = getMemoryProvider()
  const adapter = ADAPTERS[provider]
  if (adapter && adapter.available()) return adapter

  if (provider !== 'filesystem' && ADAPTERS.filesystem.available()) {
    return ADAPTERS.filesystem
  }
  return filesystem as KnowledgeAdapter
}
