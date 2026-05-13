/**
 * Memory Adapter Factory
 */
import { getMemoryProvider } from '../hermes-config-reader'
import type { MemoryFileMeta, MemorySearchMatch } from '../memory-browser-types'
import * as filesystem from './filesystem'
import * as hindsight from './hindsight'

export type MemoryAdapter = {
  list(): Promise<Array<MemoryFileMeta>>
  read(relativePath: string): Promise<string>
  search(query: string): Promise<Array<MemorySearchMatch>>
  write(relativePath: string, content: string): Promise<void>
  available(): boolean
}

const ADAPTERS: Record<string, MemoryAdapter> = {
  filesystem: filesystem as MemoryAdapter,
  hindsight: hindsight as MemoryAdapter,
}

export function getActiveMemoryAdapter(): MemoryAdapter {
  const provider = getMemoryProvider()
  const adapter = ADAPTERS[provider]
  if (adapter && adapter.available()) return adapter

  if (provider !== 'filesystem' && ADAPTERS.filesystem.available()) {
    return ADAPTERS.filesystem
  }
  return filesystem as MemoryAdapter
}

export function listMemoryProviders(): Array<{ id: string; label: string; available: boolean }> {
  return [
    { id: 'filesystem', label: 'Filesystem (MEMORY.md)', available: ADAPTERS.filesystem.available() },
    { id: 'hindsight', label: 'Hindsight', available: ADAPTERS.hindsight.available() },
  ]
}
