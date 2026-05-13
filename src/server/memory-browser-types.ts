/**
 * Memory Browser Types
 *
 * Extracted to avoid circular imports between the facade and adapters.
 */

export type MemoryFileMeta = {
  path: string
  name: string
  size: number
  modified: string
}

export type MemorySearchMatch = {
  path: string
  line: number
  text: string
}
