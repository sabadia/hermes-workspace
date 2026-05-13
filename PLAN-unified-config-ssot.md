# Unified Config — Single Source of Truth Plan

> Status: Phase 1 (Memory + Knowledge) **IMPLEMENTED**. Phases 2–4 **PLANNED**.
> Owner: Lena Paul (Secretary)  
> Date: 2026-05-13

---

## Executive Summary

The Hermes Workspace dashboard currently maintains **parallel configuration surfaces** that diverge from Hermes Agent's canonical `~/.hermes/config.yaml`. This creates:

- **Fragmented memory**: Agent uses Hindsight; workspace shows filesystem-only
- **Dummy knowledge graphs**: Workspace builds wikilink graphs while Hindsight has a real semantic graph
- **Silent drift**: 15+ divergence points where workspace invents its own config

**Principle**: The workspace is a *viewer*. It never invents config. It reads `config.yaml` and follows the agent.

---

## Phase 1 ✅ IMPLEMENTED — Memory + Knowledge Graph

### 1.1 Config Reader (`src/server/hermes-config-reader.ts`)
- Reads `~/.hermes/config.yaml` (honors active profile)
- 5-second in-memory cache to avoid disk thrashing
- Exposes: `getMemoryProvider()`, `isMemoryEnabled()`, `getMcpServer()`, `getHindsightBaseUrl()`, `getHindsightApiKey()`, `getHindsightBankId()`

### 1.2 Memory Adapter Factory (`src/server/memory-adapters/`)
| File | Role |
|------|------|
| `index.ts` | Factory: routes to active provider based on `memory.provider` |
| `filesystem.ts` | Legacy adapter: walks `MEMORY.md`, `memory/`, `memories/` |
| `hindsight.ts` | Hindsight adapter: calls REST API (`list`, `read`, `search`, `write`) |

**Behavior**:
- `memory.provider: hindsight` → Hindsight adapter
- `memory.provider: filesystem` (or missing) → Filesystem adapter
- Fallback chain: requested → filesystem → error

### 1.3 Knowledge Adapter Factory (`src/server/knowledge-adapters/`)
| File | Role |
|------|------|
| `index.ts` | Factory: routes to active provider |
| `filesystem.ts` | Legacy adapter: parses markdown wikilinks `[[...]]` |
| `hindsight.ts` | Hindsight adapter: builds semantic graph from entity tags + shared metadata |

**Semantic graph edges** (Hindsight):
- **Tag-based**: memories share tags → edge
- **Document-based**: memory content mentions document ID → edge
- Future: Hindsight entity-link API when exposed

### 1.4 Facade Updates
- `memory-browser.ts` → delegates to adapter factory (preserves all exports)
- `knowledge-browser.ts` → delegates to adapter factory (preserves all exports)
- Type extraction: `memory-browser-types.ts`, `knowledge-browser-types.ts` to prevent circular imports

### 1.5 Route Updates
All memory/knowledge routes now `await` the async facade:
- `/api/memory/list`, `/api/memory/read`, `/api/memory/search`
- `/api/knowledge/list`, `/api/knowledge/read`, `/api/knowledge/search`, `/api/knowledge/graph`

### 1.6 Integration Detection
- Added `detectHindsightIntegration()` to `integration-detection.ts`
- Detects via: env vars (`HINDSIGHT_API_KEY`), `.env`, `config.yaml` (`memory.provider: hindsight` or `mcp.hindsight`)

### 1.7 Gateway Capabilities
- `memory: true` hardcode removed from `gateway-capabilities.ts`
- Now dynamically checks `memory.memory_enabled` in config + adapter availability

---

## Phase 2 📋 PLANNED — Full Divergence Audit + Fixes

### 2.1 Critical Divergence Points (High Priority)

| # | Divergence | File(s) | Problem | Fix |
|---|-----------|---------|---------|-----|
| 1 | **Memory provider** | `memory-browser.ts` | Hardcodes filesystem walk | ✅ Fixed via adapter factory |
| 2 | **Knowledge graph** | `knowledge-browser.ts` | Builds wikilinks, ignores Hindsight graph | ✅ Fixed via adapter factory |
| 3 | **Knowledge config** | `knowledge-config.ts` | Own `knowledge-config.json` under `~/.hermes/` | **Migrate** into `config.yaml` under `workspace.knowledge` |
| 4 | **Workspace overrides** | `gateway-capabilities.ts` | `workspace-overrides.json` for URLs | **Keep** — this is legitimate UI state, but document it |
| 5 | **Swarm memory root** | `swarm-memory.ts` | Uses `~/.openclaw/workspace/memory/swarm/` | **Migrate** to `~/.hermes/swarm-memory/` |
| 6 | **Swarm kanban** | `swarm-kanban-store.ts` | `~/.hermes/swarm2-kanban.json` | **Migrate** to `~/.hermes/config.yaml` `swarm.kanban` or keep as workspace state file |
| 7 | **Tasks store** | `tasks-store.ts` | `~/.hermes/tasks.json` flat file | **Retire** — use Hermes Agent's native task system or Kanban |
| 8 | **Connection settings** | `connection-settings.ts` | `workspace-overrides.json` | **Keep** — legitimate runtime UI state |
| 9 | **Hardcoded provider list** | `claude-config.ts` | Static `PROVIDERS` array | **Sync** with `hermes-agent` skill or read from agent's provider registry |
| 10 | **MCP presets** | `mcp-presets-store.ts` | `~/.hermes/mcp-presets.json` | **Acceptable** — workspace-specific marketplace cache |
| 11 | **MCP hub sources** | `mcp-hub-sources-store.ts` | `~/.hermes/mcp-hub-sources.json` | **Acceptable** — workspace-specific marketplace config |
| 12 | **MCP tools cache** | `mcp-tools-cache.ts` | `~/.hermes/cache/mcp-tools.json` | **Acceptable** — ephemeral cache |
| 13 | **Auth sessions** | `auth-middleware.ts` | `~/.hermes/workspace-sessions.json` | **Acceptable** — workspace-specific session tokens |
| 14 | **Local provider discovery** | `local-provider-discovery.ts` | Writes `custom_providers` to config.yaml | **Audit** — verify it uses same schema as `hermes config set` |
| 15 | **Feature gates** | `feature-gates.ts` | `memory` always gated as available | ✅ Fixed via dynamic capability probe |
| 16 | **Terminal TTL** | `terminal-sessions.ts` | `HERMES_TERMINAL_DETACH_TTL_MS` env var | **Migrate** to `config.yaml` `workspace.terminal.detachTtlMs` |
| 17 | **Playground admin** | `playground-admin.ts` | `PLAYGROUND_ADMIN_TOKEN` env | **Acceptable** — feature-specific secret |
| 18 | **Swarm environment** | `swarm-environment.ts` | Parallel env var hierarchy | **Audit** — ensure it reads from `config.yaml` `swarm.*` |
| 19 | **Integration detection** | `integration-detection.ts` | Only Honcho + Byterover | ✅ Added Hindsight; **Add Mem0** |
| 20 | **Profile management** | `profiles-browser.ts` | Own profile logic | **Audit** — should use `hermes profile` CLI where possible |

### 2.2 Recommended Priority Order

1. **Phase 2a** (Immediate): Migrate `knowledge-config.json` into `config.yaml`
2. **Phase 2b** (This week): Unify swarm memory root (`~/.openclaw` → `~/.hermes`)
3. **Phase 2c** (This week): Retire `tasks.json` in favor of Hermes native tasks
4. **Phase 2d** (Next): Sync provider list with agent's canonical registry
5. **Phase 2e** (Next): Add Mem0 detection to integration-detection
6. **Phase 2f** (Future): Migrate terminal TTL + playground env vars into config.yaml

---

## Phase 3 🏗️ PLANNED — Future-Proof Architecture

### 3.1 Config Inheritance Model

```
~/.hermes/config.yaml          (agent source of truth)
├── model.*                    (shared)
├── memory.*                   (shared)
├── mcp.*                      (shared)
├── workspace.*                (NEW — workspace-specific UI state)
│   ├── knowledge.source         (migrated from knowledge-config.json)
│   ├── terminal.detachTtlMs     (migrated from env var)
│   └── overrides.*              (migrated from workspace-overrides.json)
└── swarm.*                    (shared with agent)
    ├── kanban                   (migrated from swarm2-kanban.json)
    └── memoryRoot               (migrated from hardcoded paths)
```

### 3.2 Adapter Interface (Future Providers)

To add a new memory provider (e.g., Mem0, custom):

1. Create `src/server/memory-adapters/{provider}.ts`
2. Implement `MemoryAdapter` interface
3. Register in `src/server/memory-adapters/index.ts`
4. Add detection to `integration-detection.ts`

No other files change. This is the **Open/Closed** principle in action.

### 3.3 Unified Config API

The workspace should expose a single `/api/config` endpoint that:
- Reads from `config.yaml` (read-only for most keys)
- Exposes `workspace.*` keys as read-write
- Forbids writing to `model.*`, `memory.*`, `mcp.*` directly (use `hermes config set` or CLI)

This prevents the workspace from accidentally corrupting agent config.

---

## Phase 4 🧪 PLANNED — Testing + Validation

### 4.1 Unit Tests Needed
- `hermes-config-reader.test.ts`: profile resolution, cache invalidation, YAML parsing
- `memory-adapters/index.test.ts`: factory routing, fallback chain
- `memory-adapters/hindsight.test.ts`: mock HTTP server, timeout handling
- `knowledge-adapters/hindsight.test.ts`: graph edge generation

### 4.2 Integration Tests Needed
- Start workspace with `memory.provider: hindsight` → verify memory tab shows Hindsight entries
- Start workspace with `memory.provider: filesystem` → verify memory tab shows markdown files
- Switch provider in config.yaml → verify workspace picks it up within 5 seconds

### 4.3 Manual Validation Checklist
- [ ] Memory tab lists Hindsight memories when `provider: hindsight`
- [ ] Memory tab lists filesystem files when `provider: filesystem`
- [ ] Search works for both providers
- [ ] Knowledge graph shows Hindsight semantic graph when `provider: hindsight`
- [ ] Knowledge graph shows wikilink graph when `provider: filesystem`
- [ ] Inspector panel shows correct provider label
- [ ] Gateway capabilities report `memory: false` when `memory_enabled: false`

---

## Appendix A: Files Changed in Phase 1

### New Files
- `src/server/hermes-config-reader.ts`
- `src/server/memory-browser-types.ts`
- `src/server/knowledge-browser-types.ts`
- `src/server/memory-adapters/index.ts`
- `src/server/memory-adapters/filesystem.ts`
- `src/server/memory-adapters/hindsight.ts`
- `src/server/knowledge-adapters/index.ts`
- `src/server/knowledge-adapters/filesystem.ts`
- `src/server/knowledge-adapters/hindsight.ts`

### Modified Files
- `src/server/memory-browser.ts` (facade delegation)
- `src/server/knowledge-browser.ts` (facade delegation)
- `src/server/integration-detection.ts` (+ Hindsight detection)
- `src/server/gateway-capabilities.ts` (dynamic memory probe)
- `src/routes/api/memory/list.ts` (await)
- `src/routes/api/memory/read.ts` (await)
- `src/routes/api/memory/search.ts` (await)
- `src/routes/api/knowledge/list.ts` (await)
- `src/routes/api/knowledge/read.ts` (await)
- `src/routes/api/knowledge/search.ts` (await)
- `src/routes/api/knowledge/graph.ts` (await)

---

## Appendix B: Rollback Procedure

If Phase 1 causes regressions:

1. Revert `memory-browser.ts` and `knowledge-browser.ts` to original content
2. Remove `src/server/memory-adapters/` and `src/server/knowledge-adapters/`
3. Revert route files to remove `await`
4. Restart workspace server

The original filesystem behavior will be fully restored.
