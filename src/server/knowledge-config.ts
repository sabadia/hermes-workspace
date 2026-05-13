import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as YAML from 'yaml'
import {
  readHermesConfig,
  invalidateHermesConfigCache,
} from './hermes-config-reader'

export type KnowledgeBaseSource =
  | { type: 'local'; path: string }
  | { type: 'github'; repo: string; branch: string; path: string }

export type KnowledgeBaseConfig = {
  source: KnowledgeBaseSource
}

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  source: { type: 'local', path: '' },
}

function hermesHome(): string {
  return (
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  )
}

function configYamlPath(): string {
  return path.join(hermesHome(), 'config.yaml')
}

/** Legacy JSON config path — read-only fallback for migration */
function legacyJsonPath(): string {
  return path.join(hermesHome(), 'knowledge-config.json')
}

/**
 * Read knowledge config. Priority:
 * 1. config.yaml  knowledge.source
 * 2. legacy knowledge-config.json (migration fallback)
 * 3. default
 */
export function readKnowledgeBaseConfig(): KnowledgeBaseConfig {
  // 1. Try config.yaml
  const cfg = readHermesConfig()
  const k = cfg.knowledge as
    | { source?: Partial<KnowledgeBaseSource> }
    | undefined
  if (k?.source && typeof k.source === 'object' && k.source.type) {
    return { source: k.source as KnowledgeBaseSource }
  }

  // 2. Legacy JSON fallback
  try {
    const jp = legacyJsonPath()
    if (fs.existsSync(jp)) {
      const raw = fs.readFileSync(jp, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<KnowledgeBaseConfig>
      if (parsed.source) {
        return { source: parsed.source as KnowledgeBaseSource }
      }
    }
  } catch {
    // ignore parse errors
  }

  return DEFAULT_CONFIG
}

/**
 * Write knowledge config into config.yaml (knowledge: section).
 * Keeps all other sections intact. Also invalidates the reader cache.
 */
export function writeKnowledgeBaseConfig(config: KnowledgeBaseConfig): void {
  const cp = configYamlPath()
  let doc: Record<string, unknown> = {}

  try {
    if (fs.existsSync(cp)) {
      const raw = fs.readFileSync(cp, 'utf-8')
      const parsed = YAML.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        doc = parsed as Record<string, unknown>
      }
    }
  } catch {
    // start fresh if unreadable
  }

  doc.knowledge = { source: config.source }

  const dir = path.dirname(cp)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(cp, YAML.stringify(doc), 'utf-8')
  invalidateHermesConfigCache()
}

export function getKnowledgeBaseEffectiveRoot(): string {
  const config = readKnowledgeBaseConfig()
  if (config.source.type === 'local') {
    const p = config.source.path.trim()
    if (p) return path.resolve(p.replace(/^~\//, os.homedir() + '/'))
  }
  // fallback: legacy env var or default
  if (process.env.KNOWLEDGE_DIR) return path.resolve(process.env.KNOWLEDGE_DIR)
  const claudeKnowledge = path.join(os.homedir(), '.claude', 'knowledge')
  if (fs.existsSync(claudeKnowledge)) return claudeKnowledge
  return claudeKnowledge
}
