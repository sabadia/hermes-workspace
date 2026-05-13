/**
 * Hermes Config API — read/write config via dashboard API
 * Falls back to hermes-config-reader for read-only when dashboard unavailable
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getCapabilities,
} from '../../server/gateway-capabilities'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'
import {
  getConfig,
  getEnvVars,
  saveConfig,
  setEnvVar,
  deleteEnvVar,
  getOAuthProviders,
} from '../../server/claude-dashboard-api'
import type { EnvVarInfo } from '../../server/claude-dashboard-api'
import {
  readHermesConfig,
  invalidateHermesConfigCache,
} from '../../server/hermes-config-reader'

type AuthResult = Response | true

const CLAUDE_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')

// Fallback provider list — used only when dashboard doesn't expose live providers
const PROVIDERS = [
  { id: 'nous', name: 'Nous Portal', authType: 'oauth', envKeys: [] as string[] },
  { id: 'openai-codex', name: 'OpenAI Codex', authType: 'oauth', envKeys: [] as string[] },
  {
    id: 'anthropic',
    name: 'Anthropic',
    authType: 'api_key',
    envKeys: ['ANTHROPIC_API_KEY'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    authType: 'api_key',
    envKeys: ['OPENROUTER_API_KEY'],
  },
  {
    id: 'zai',
    name: 'Z.AI / GLM',
    authType: 'api_key',
    envKeys: ['GLM_API_KEY'],
  },
  {
    id: 'kimi-coding',
    name: 'Kimi / Moonshot',
    authType: 'api_key',
    envKeys: ['KIMI_API_KEY'],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    authType: 'api_key',
    envKeys: ['MINIMAX_API_KEY'],
  },
  {
    id: 'minimax-cn',
    name: 'MiniMax (China)',
    authType: 'api_key',
    envKeys: ['MINIMAX_CN_API_KEY'],
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    authType: 'api_key',
    envKeys: ['XIAOMI_API_KEY'],
  },
  { id: 'ollama', name: 'Ollama (Local)', authType: 'none', envKeys: [] as string[] },
  {
    id: 'atomic-chat',
    name: 'Atomic Chat (Local)',
    authType: 'none',
    envKeys: [] as string[],
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    authType: 'api_key',
    envKeys: ['CUSTOM_API_KEY'],
  },
]

function maskKey(key: string): string {
  if (!key || key.length < 8) return '***'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function checkAuthStore(providerId: string): {
  hasToken: boolean
  source: string
  maskedKey?: string
} {
  // Check Claude auth store
  const storePath = path.join(CLAUDE_HOME, 'auth-profiles.json')
  try {
    if (fs.existsSync(storePath)) {
      const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
      const profiles = store?.profiles || {}
      for (const [key, value] of Object.entries(profiles)) {
        if (!key.startsWith(`${providerId}:`)) continue
        if (typeof value !== 'object' || value === null) continue
        const p = value as Record<string, unknown>
        const token = String(p.token || p.key || p.access || '').trim()
        if (token) {
          return { hasToken: true, source: 'claude-auth-store', maskedKey: maskKey(token) }
        }
      }
    }
  } catch {}
  return { hasToken: false, source: '' }
}

/**
 * Try to get live provider list from dashboard API.
 * Returns null if unavailable or empty.
 */
async function fetchLiveProviders(): Promise<typeof PROVIDERS | null> {
  try {
    const data = await getOAuthProviders()
    if (data && Array.isArray(data) && data.length > 0) {
      return data as typeof PROVIDERS
    }
    // Some dashboards return { providers: [...] }
    const wrapped = data as Record<string, unknown>
    if (wrapped?.providers && Array.isArray(wrapped.providers) && wrapped.providers.length > 0) {
      return wrapped.providers as typeof PROVIDERS
    }
  } catch {
    // Dashboard doesn't expose provider list — use fallback
  }
  return null
}

export const Route = createFileRoute('/api/claude-config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        await ensureGatewayProbed()
        const caps = getCapabilities()

        if (!caps.config) {
          // Dashboard unavailable — fall back to read-only hermes-config-reader
          const localConfig = readHermesConfig() as Record<string, unknown>

          const providerStatus = PROVIDERS.map((p) => ({
            ...p,
            configured: false,
            authSource: 'none',
            maskedKeys: {} as Record<string, string>,
          }))

          const modelField = localConfig.model
          let activeModel = ''
          let activeProvider = ''
          if (typeof modelField === 'string') {
            activeModel = modelField
            activeProvider = (localConfig.provider as string) || ''
          } else if (modelField && typeof modelField === 'object') {
            const modelObj = modelField as Record<string, unknown>
            activeModel = (modelObj.default as string) || ''
            activeProvider =
              (modelObj.provider as string) || (localConfig.provider as string) || ''
          }

          return Response.json({
            ...createCapabilityUnavailablePayload('config'),
            config: localConfig,
            providers: providerStatus,
            activeProvider,
            activeModel,
            claudeHome: CLAUDE_HOME,
          })
        }

        // Dashboard available — use API
        const config = await getConfig()
        const envVars = await getEnvVars()

        // Try live providers from dashboard, fall back to hardcoded PROVIDERS
        const liveProviders = await fetchLiveProviders()
        const providerList = liveProviders ?? PROVIDERS

        // Build provider status
        const providerStatus = providerList.map((p) => {
          const envKeys = (p as { envKeys?: string[] }).envKeys ?? []
          const hasEnvKey =
            envKeys.length === 0 ||
            envKeys.some((k) => {
              const info = envVars[k] as EnvVarInfo | undefined
              return info?.has_value || info?.is_set || false
            })
          const authStoreCheck = checkAuthStore(p.id)
          const authType = (p as { authType?: string }).authType ?? 'api_key'
          const hasKey =
            hasEnvKey || authStoreCheck.hasToken || authType === 'none'
          const maskedKeys: Record<string, string> = {}
          for (const k of envKeys) {
            const info = envVars[k] as EnvVarInfo | undefined
            if (info?.masked_value) maskedKeys[k] = info.masked_value
            else if (info?.redacted_value) maskedKeys[k] = info.redacted_value
          }
          if (authStoreCheck.hasToken && authStoreCheck.maskedKey) {
            maskedKeys['auth-store'] = authStoreCheck.maskedKey
          }
          return {
            ...p,
            configured: hasKey,
            authSource: authStoreCheck.hasToken
              ? authStoreCheck.source
              : hasEnvKey
                ? 'env'
                : 'none',
            maskedKeys,
          }
        })

        // Get active provider/model from config
        // Support both flat keys (model: "gpt-5.4", provider: "openai-codex")
        // and legacy nested format (model: { default: "...", provider: "..." })
        const modelField = config.model
        let activeModel = ''
        let activeProvider = ''
        if (typeof modelField === 'string') {
          activeModel = modelField
          activeProvider = (config.provider as string) || ''
        } else if (modelField && typeof modelField === 'object') {
          const modelObj = modelField as Record<string, unknown>
          activeModel = (modelObj.default as string) || ''
          activeProvider =
            (modelObj.provider as string) || (config.provider as string) || ''
        }

        return Response.json({
          config,
          providers: providerStatus,
          activeProvider,
          activeModel,
          claudeHome: CLAUDE_HOME,
        })
      },

      PATCH: async ({ request }) => {
        const authResult = isAuthenticated(request) as AuthResult
        if (authResult !== true) return authResult
        await ensureGatewayProbed()
        if (!getCapabilities().config) {
          return new Response(
            JSON.stringify(
              createCapabilityUnavailablePayload('config', {
                error: 'Configuration updates are unavailable on this backend.',
              }),
            ),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const body = (await request.json()) as Record<string, unknown>

        // Handle config updates via dashboard API
        if (body.config && typeof body.config === 'object') {
          await saveConfig(body.config as Record<string, unknown>)
        }

        // Handle env var updates via dashboard API
        if (body.env && typeof body.env === 'object') {
          const envUpdates = body.env as Record<string, string | null>
          for (const [key, value] of Object.entries(envUpdates)) {
            if (value === '' || value === null) {
              await deleteEnvVar(key)
            } else {
              await setEnvVar(key, value)
            }
          }
        }

        // Invalidate local config cache so subsequent reads pick up changes
        invalidateHermesConfigCache()

        return Response.json({
          ok: true,
          message: 'Config updated. Restart Claude to apply changes.',
        })
      },
    },
  },
})
