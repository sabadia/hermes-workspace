/**
 * Knowledge Browser Types
 *
 * Extracted to avoid circular imports between the facade and adapters.
 */

export type WikiPageMeta = {
  path: string
  name: string
  title: string
  type?: string
  domain?: string
  status?: string
  tags: Array<string>
  summary?: string
  created?: string
  updated?: string
  size: number
  modified: string
  wikilinks: Array<string>
}

export type WikiLink = {
  source: string
  target: string
}

export type KnowledgeGraph = {
  nodes: Array<{ id: string; title: string; type?: string; tags: Array<string> }>
  edges: Array<{ source: string; target: string }>
}
