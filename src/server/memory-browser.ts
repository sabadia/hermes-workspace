/**
 * Memory Browser — Provider-Agnostic Facade
 *
 * Delegates to the adapter factory so the workspace respects
 * `memory.provider` from Hermes Agent config.yaml.
 */
export type { MemoryFileMeta, MemorySearchMatch } from './memory-browser-types'

// Re-export filesystem helpers for routes that need direct disk access
export {
  getMemoryWorkspaceRoot,
  resolveMemoryFilePath,
} from './memory-adapters/filesystem'

import { getActiveMemoryAdapter } from './memory-adapters'

export async function listMemoryFiles(): Promise<import('./memory-browser-types').MemoryFileMeta[]> {
  return getActiveMemoryAdapter().list()
}

export async function readMemoryFile(relativePath: string): Promise<string> {
  return getActiveMemoryAdapter().read(relativePath)
}

export async function searchMemoryFiles(query: string): Promise<import('./memory-browser-types').MemorySearchMatch[]> {
  return getActiveMemoryAdapter().search(query)
}

export async function writeMemoryFile(relativePath: string, content: string): Promise<void> {
  return getActiveMemoryAdapter().write(relativePath, content)
}
