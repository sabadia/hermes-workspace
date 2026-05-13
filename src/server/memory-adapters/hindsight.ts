/**
 * Hindsight Memory Adapter
 *
 * Proxies memory operations to the self-hosted Hindsight REST API.
 * Endpoints verified against Hindsight 0.6.1 OpenAPI spec.
 */
import type { MemoryFileMeta, MemorySearchMatch } from '../memory-browser-types'
import {
  getHindsightBaseUrl,
  getHindsightApiKey,
  getHindsightBankId,
} from '../hermes-config-reader'

const TIMEOUT_MS = 15000

async function fetchJson<T>(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<T | null> {
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
      console.warn(`[hindsight-memory] ${method} ${endpoint} -> ${res.status}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[hindsight-memory] ${method} ${endpoint} error:`, err)
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
  metadata?: Record<string, unknown>
}

type ListMemoryResponse = {
  items?: Array<MemoryUnit>
  total?: number
  offset?: number
  limit?: number
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

function memoryToFileMeta(item: MemoryUnit): MemoryFileMeta {
  const updated = item.updated_at || item.created_at || item.mentioned_at || new Date().toISOString()
  return {
    path: `hindsight://${item.id}`,
    name: item.id,
    size: item.text?.length ?? 0,
    modified: updated,
  }
}

export async function list(): Promise<Array<MemoryFileMeta>> {
  const bankId = getHindsightBankId()
  const res = await fetchJson<ListMemoryResponse>(
    'GET',
    `/v1/default/banks/${encodeURIComponent(bankId)}/memories/list?limit=200`,
  )
  if (!res?.items) return []
  return res.items.map(memoryToFileMeta)
}

export async function read(relativePath: string): Promise<string> {
  const id = relativePath.replace(/^hindsight:\/\//, '')
  const bankId = getHindsightBankId()
  const res = await fetchJson<MemoryUnit>(
    'GET',
    `/v1/default/banks/${encodeURIComponent(bankId)}/memories/${encodeURIComponent(id)}`,
  )
  if (!res) throw new Error(`Memory not found: ${id}`)
  return res.text
}

export async function search(query: string): Promise<Array<MemorySearchMatch>> {
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
    line: 1,
    text: m.text.split(/\r?\n/)[0] || m.text.slice(0, 120),
  }))
}

export async function write(relativePath: string, content: string): Promise<void> {
  const bankId = getHindsightBankId()
  const context = relativePath.replace(/^hindsight:\/\//, '')
  await fetchJson<unknown>(
    'POST',
    `/v1/default/banks/${encodeURIComponent(bankId)}/retain`,
    {
      async: false,
      items: [{ content, context }],
    },
  )
}

export function available(): boolean {
  return !!getHindsightBaseUrl()
}
