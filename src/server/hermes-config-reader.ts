/**
 * Hermes Config Reader — Single Source of Truth
 *
 * Reads `~/.hermes/config.yaml` (and profile-specific configs) so the workspace
 * always uses the same settings as the Hermes Agent CLI / gateway.
 *
 * Principle: The workspace is a viewer. It never invents its own config.
 * If a setting is not in config.yaml, it does not exist.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as YAML from 'yaml'

export type HermesMemoryProvider = 'hindsight' | 'honcho' | 'mem0' | 'filesystem' | string

export type HermesMcpConfig = {
  enabled?: boolean
  url?: string
  command?: string
  args?: string[]
  transport?: 'stdio' | 'http' | 'sse'
}

export type HermesConfig = {
  model?: {
    default?: string
    provider?: string
    base_url?: string
    api_key?: string
    context_length?: number
  }
  memory?: {
    memory_enabled?: boolean
    user_profile_enabled?: boolean
    provider?: HermesMemoryProvider
    flush_min_turns?: number
    nudge_interval?: number
    char_limit?: number
  }
  mcp?: Record<string, HermesMcpConfig>
  agent?: {
    max_turns?: number
    tool_use_enforcement?: boolean
  }
  display?: {
    skin?: string
    tool_progress?: boolean
    show_reasoning?: boolean
    show_cost?: boolean
  }
  stt?: {
    enabled?: boolean
    provider?: string
  }
  tts?: {
    provider?: string
  }
  security?: {
    tirith_enabled?: boolean
    redact_secrets?: boolean
  }
  [key: string]: unknown
}

function hermesHome(): string {
  return (
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  )
}

function activeProfile(): string | null {
  const activeFile = path.join(hermesHome(), 'active_profile')
  try {
    if (fs.existsSync(activeFile)) {
      return fs.readFileSync(activeFile, 'utf-8').trim() || null
    }
  } catch {
    // ignore
  }
  return null
}

function configPath(): string {
  const profile = activeProfile()
  if (profile) {
    const profileConfig = path.join(hermesHome(), 'profiles', profile, 'config.yaml')
    if (fs.existsSync(profileConfig)) return profileConfig
  }
  return path.join(hermesHome(), 'config.yaml')
}

let _cachedConfig: HermesConfig | null = null
let _cachedAt = 0
const CACHE_TTL_MS = 5000

export function readHermesConfig(): HermesConfig {
  const now = Date.now()
  if (_cachedConfig && now - _cachedAt < CACHE_TTL_MS) {
    return _cachedConfig
  }

  try {
    const cp = configPath()
    if (!fs.existsSync(cp)) {
      _cachedConfig = {}
      _cachedAt = now
      return _cachedConfig
    }
    const raw = fs.readFileSync(cp, 'utf-8')
    const parsed = YAML.parse(raw)
    _cachedConfig =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as HermesConfig)
        : {}
    _cachedAt = now
    return _cachedConfig
  } catch {
    _cachedConfig = {}
    _cachedAt = now
    return _cachedConfig
  }
}

export function invalidateHermesConfigCache(): void {
  _cachedConfig = null
  _cachedAt = 0
}

export function getMemoryProvider(): HermesMemoryProvider {
  const cfg = readHermesConfig()
  const provider = cfg.memory?.provider
  if (provider && typeof provider === 'string') return provider.toLowerCase()
  return 'filesystem'
}

export function isMemoryEnabled(): boolean {
  const cfg = readHermesConfig()
  return cfg.memory?.memory_enabled !== false
}

export function getMcpServer(name: string): HermesMcpConfig | null {
  const cfg = readHermesConfig()
  // Hermes uses `mcp_servers:` as the canonical key; `mcp:` is legacy/auxiliary
  const servers = (cfg as Record<string, unknown>).mcp_servers ?? cfg.mcp
  if (!servers || typeof servers !== 'object') return null
  const server = (servers as Record<string, unknown>)[name]
  if (!server || typeof server !== 'object') return null
  return server as HermesMcpConfig
}

export function getHindsightBaseUrl(): string | null {
  // 1. Explicit env override
  const envUrl = process.env.HINDSIGHT_BASE_URL?.trim()
  if (envUrl) return envUrl

  // 2. Derive from MCP config: strip /mcp suffix if present
  const mcp = getMcpServer('hindsight')
  if (mcp?.url) {
    const url = mcp.url.trim()
    if (url.endsWith('/mcp')) return url.slice(0, -4)
    return url
  }

  // 3. Legacy env keys
  const legacy =
    process.env.HINDSIGHT_URL?.trim() ||
    process.env.HONCHO_BASE_URL?.trim()
  if (legacy) return legacy

  return null
}

export function getHindsightApiKey(): string | null {
  return process.env.HINDSIGHT_API_KEY?.trim() || null
}

export function getHindsightBankId(): string {
  return process.env.HINDSIGHT_BANK_ID?.trim() || 'lena-paul'
}
