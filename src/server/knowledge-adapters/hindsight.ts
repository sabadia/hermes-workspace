/**
 * Hindsight Knowledge Adapter
 *
 * Uses Hindsight's native /graph and /entities/graph endpoints
 * instead of manually building edges from markdown wikilinks.
 * Endpoints verified against Hindsight 0.6.1 OpenAPI spec.
 */
import type { KnowledgeGraph, WikiPageMeta } from '../knowledge-browser-types'
import {
  getHindsightBaseUrl,
  getHindsightApiKey,
  getHindsightBankId,
} from '../hermes-config-reader'

const TIMEOUT_MS = 15000

async function fetchJson<T>(method: string, endpoint: string, body?: unknown): Promise<T | null> {
  const base = getHindsightBaseUrl()
  if (!base) return null
  const url = `${base.replace(/\/$/, '')}${endpoint}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const key = getHindsightApiKey()
  if (key) headers.Authorization = `Bearer ${key}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.warn(`[hindsight-knowledge] ${method} ${endpoint} -> ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[hindsight-knowledge] ${method} ${endpoint} error:`, err)
    return null
  }
}

type MemoryUnit = {
  id: string
  text: string
  context?: string
  tags?: Array<string>
  created_at?: string
  updated_at?: string
  mentioned_at?: string
  type?: string
}

type ListMemoryResponse = {
  items?: Array<MemoryUnit>
}

type RecallResult = {
  id: string
  text: string
  score?: number
  context?: string
  tags?: Array<string>
}

type RecallResponse = {
  results?: Array<RecallResult>
}

type GraphNode = {
  id: string
  label?: string
  type?: string
  tags?: Array<string>
  count?: number
}

type GraphEdge = {
  source: string
  target: string
  weight?: number
  type?: string
}

type GraphResponse = {
  nodes?: Array<GraphNode>
  edges?: Array<GraphEdge>
}

function memoryToWikiPage(m: MemoryUnit): WikiPageMeta {
  const updated = m.updated_at || m.created_at || m.mentioned_at || new Date().toISOString()
  return {
    path: `hindsight://${m.id}`,
    name: m.id,
    title: m.context || m.id,
    type: m.type || 'memory',
    domain: undefined,
    status: undefined,
    tags: m.tags || [],
    summary: m.text?.slice(0, 200),
    created: m.created_at,
    updated,
    size: m.text?.length ?? 0,
    modified: updated,
    wikilinks: [],
  }
}

export async function list(): Promise<Array<WikiPageMeta>> {
  const bankId = getHindsightBankId()
  const res = await fetchJson<ListMemoryResponse>(
    'GET',
    `/v1/default/banks/${encodeURIComponent(bankId)}/memories/list?limit=200`,
  )
  if (!res?.items) return []
  return res.items.map(memoryToWikiPage)
}

export async function read(relativePath: string) {
  const bankId = getHindsightBankId()
  const id = relativePath.replace(/^hindsight:\/\//, '')
  const res = await fetchJson<MemoryUnit>(
    'GET',
    `/v1/default/banks/${encodeURIComponent(bankId)}/memories/${encodeURIComponent(id)}`,
  )
  if (!res) throw new Error(`Knowledge node not found: ${id}`)
  const meta = memoryToWikiPage(res)
  return { meta, content: res.text, backlinks: [] }
}

export async function search(query: string) {
  const needle = query.trim()
  if (!needle) return []

  const bankId = getHindsightBankId()
  const res = await fetchJson<RecallResponse>(
    'POST',
    `/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`,
    { query: needle, top_k: 50, budget: 'mid' },
  )
  if (!res?.results) return []

  return res.results.map((m) => ({
    path: `hindsight://${m.id}`,
    title: m.context || m.id,
    line: 1,
    text: m.text.split(/\r?\n/)[0] || m.text.slice(0, 120),
  }))
}

export async function buildGraph(): Promise<KnowledgeGraph> {
  const bankId = getHindsightBankId()

  // Prefer the native graph endpoint; fall back to entity graph if it fails
  const graphRes = await fetchJson<GraphResponse>(
    'GET',
    `/v1/default/banks/${encodeURIComponent(bankId)}/graph?limit=1000`,
  )

  if (graphRes?.nodes && graphRes?.edges) {
    return {
      nodes: graphRes.nodes.map((n) => {
        const data = (n as unknown as { data: GraphNode }).data || (n as GraphNode)
        return {
          id: data.id,
          title: data.label || data.id,
          type: data.type,
          tags: data.tags || [],
        }
      }),
      edges: graphRes.edges.map((e) => {
        const data = (e as unknown as { data: GraphEdge }).data || (e as GraphEdge)
        return {
          source: data.source,
          target: data.target,
        }
      }),
    }
  }

  // Fallback: build from entity co-occurrence graph
  const entityRes = await fetchJson<{ nodes?: Array<{ data?: GraphNode }>; edges?: Array<{ data?: GraphEdge }> }>(
    'GET',
    `/v1/default/banks/${encodeURIComponent(bankId)}/entities/graph?limit=1000`,
  )

  if (entityRes?.nodes && entityRes?.edges) {
    return {
      nodes: entityRes.nodes.map((n) => {
        const data = n.data || (n as unknown as GraphNode)
        return {
          id: data.id,
          title: data.label || data.id,
          type: data.type || 'entity',
          tags: data.tags || [],
        }
      }),
      edges: entityRes.edges.map((e) => {
        const data = e.data || (e as unknown as GraphEdge)
        return {
          source: data.source,
          target: data.target,
        }
      }),
    }
  }

  // Ultimate fallback: empty graph
  return { nodes: [], edges: [] }
}

export function available(): boolean {
  return !!getHindsightBaseUrl()
}
