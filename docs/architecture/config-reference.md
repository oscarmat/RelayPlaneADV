# Referencia completa de configuración

← [Volver al índice](./README.md) | Ver también: [Configuración (overview)](./configuration.md)

RelayPlaneADV usa dos ficheros de configuración principales. Ambos residen en `~/.relayplane/` (o el directorio definido por `RELAYPLANE_HOME_OVERRIDE`).

---

## 1. config.json — Configuración del usuario

Ruta: `~/.relayplane/config.json`

Fichero fuente: `src/config.ts` → `interface ProxyConfig`

```jsonc
{
  // ─── Identidad y metadatos ─────────────────────────────────────
  "device_id": "string",              // UUID generado en primer arranque
  "config_version": 4,                // Versión del schema (para migraciones)
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601",
  "first_run_complete": true,

  // ─── Telemetría ────────────────────────────────────────────────
  "telemetry_enabled": false,         // Telemetría completa (modelo, tokens, coste)
  "lifecycle_enabled": true,          // Pings anónimos de ciclo de vida
  "lifecycle_explicitly_set": false,  // true si el usuario ejecutó `relayplane lifecycle on/off`
  "telemetry_explicitly_set": false,
  "telemetry_exclude": false,         // Excluir este dispositivo (devbox)
  "telemetry_migration_applied": false,
  "last_ping_date": "ISO 8601",       // Último ping diario
  "last_dashboard_ping": "ISO 8601",  // Último ping horario del dashboard

  // ─── API Key ───────────────────────────────────────────────────
  "api_key": "string",               // RelayPlane API key (features Pro)

  // ─── Mesh (Osmosis) ────────────────────────────────────────────
  "mesh": {
    "enabled": false,                 // Activar capa de conocimiento
    "endpoint": "https://osmosis-mesh-dev.fly.dev",
    "sync_interval_ms": 60000,        // Intervalo de sincronización (ms)
    "contribute": false               // Contribuir átomos al mesh remoto
  },

  // ─── Rate Limiting ─────────────────────────────────────────────
  "rateLimit": {
    "models": {                       // Override por modelo
      "claude-sonnet-4-6": { "rpm": 120 },
      "gpt-4o": { "rpm": 60 }
    },
    "maxQueueDepth": 50,              // Máx requests en cola (default: 50)
    "queueTimeoutMs": 30000           // Timeout de cola en ms (default: 30000)
  },

  // ─── Proveedores ───────────────────────────────────────────────
  "providers": {
    "anthropic": {
      "rateLimit": { "rpm": 100 },    // RPM a nivel de proveedor
      "accounts": [                   // Pool multi-key
        {
          "label": "primary",         // Etiqueta para dashboard
          "apiKey": "sk-ant-...",     // API key o OAT token
          "priority": 0              // Menor = preferido (default: 0)
        },
        {
          "label": "backup",
          "apiKey": "sk-ant-...",
          "priority": 1
        }
      ]
    },
    "openai": {
      "rateLimit": { "rpm": 60 }
    }
  },

  // ─── Cross-Provider Cascade ────────────────────────────────────
  "crossProviderCascade": {
    "enabled": true,                  // Activar fallback entre proveedores
    "providers": ["anthropic", "openrouter", "google"],  // Orden de prioridad
    "triggerStatuses": [429, 529, 503],  // Códigos que disparan cascade
    "modelMapping": {                 // Mapeo personalizado de modelos
      "anthropic": {
        "google": {
          "claude-sonnet-4-6": "gemini-2.5-pro"
        }
      }
    }
  },

  // ─── Traces ────────────────────────────────────────────────────
  "traces": {
    "enabled": true,                  // Escribir ficheros de traza
    "storeFullRequests": false,       // Guardar bodies completos (solo hashes por defecto)
    "retentionDays": 30,              // Días de retención
    "directory": "~/.relayplane/traces/",
    "maxDiskMb": 500                  // Límite de disco para trazas
  }
}
```

### Tipos detallados

#### MeshConfigSection

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar la capa de conocimiento distribuido |
| `endpoint` | string | `"https://osmosis-mesh-dev.fly.dev"` | URL del mesh remoto |
| `sync_interval_ms` | number | `60000` | Intervalo de sincronización en ms |
| `contribute` | boolean | `false` | Contribuir átomos al mesh |

#### RateLimitConfigSection

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `models` | `Record<string, {rpm: number}>` | `{}` | Override de RPM por modelo |
| `maxQueueDepth` | number | `50` | Máx requests en cola cuando se alcanza el límite |
| `queueTimeoutMs` | number | `30000` | Timeout en ms para requests en cola |

#### ProviderConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `rateLimit` | `{rpm: number}` | — | RPM a nivel de proveedor |
| `accounts` | `ProviderAccountConfig[]` | — | Pool de tokens multi-key |

#### ProviderAccountConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `label` | string | (requerido) | Etiqueta legible para el dashboard |
| `apiKey` | string | (requerido) | API key o OAT token |
| `priority` | number | `0` | Prioridad de selección (menor = preferido) |

#### CrossProviderCascadeConfigSection

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar cascade cross-provider |
| `providers` | string[] | `[]` | Lista ordenada de proveedores |
| `triggerStatuses` | number[] | `[429, 529, 503]` | Códigos HTTP que disparan cascade |
| `modelMapping` | `Record<from, Record<to, Record<model, mapped>>>` | — | Mapeo personalizado |

#### TracesConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Activar escritura de trazas |
| `storeFullRequests` | boolean | `false` | Guardar bodies completos (privacidad) |
| `retentionDays` | number | `30` | Días antes de borrar trazas antiguas |
| `directory` | string | `~/.relayplane/traces/` | Directorio de trazas |
| `maxDiskMb` | number | `500` | Límite de disco en MB |

---

## 2. proxy-config.json — Configuración avanzada del proxy

Ruta: `~/.relayplane/proxy-config.json`

Fichero fuente: `src/standalone-proxy.ts` → `interface RelayPlaneProxyConfigFile`

```jsonc
{
  // ─── General ───────────────────────────────────────────────────
  "enabled": true,
  "defaultProvider": "openrouter",    // Forzar TODOS los requests a este proveedor
  "modelOverrides": {                 // Reescritura de modelos
    "claude-sonnet": "claude-sonnet-4-6"
  },

  // ─── Routing ───────────────────────────────────────────────────
  "routing": {
    "mode": "complexity",             // "standard" | "cascade" | "auto" | "passthrough" | "complexity"
    "cascade": {
      "enabled": true,
      "models": ["claude-sonnet-4-6", "gpt-4o", "gemini-2.5-pro"],
      "escalateOn": "uncertainty",    // "uncertainty" | "refusal" | "error"
      "maxEscalations": 2
    },
    "complexity": {
      "enabled": true,
      "simple": "claude-haiku-4-5",                    // string o {provider, model}
      "moderate": "google/gemini-2.5-flash",           // notación provider/model
      "complex": { "provider": "anthropic", "model": "claude-opus-4-6" }
    }
  },

  // ─── Reliability ───────────────────────────────────────────────
  "reliability": {
    "cooldowns": {
      "enabled": true,
      "allowedFails": 3,              // Fallos antes de cooldown
      "windowSeconds": 60,            // Ventana de tiempo para contar fallos
      "cooldownSeconds": 30           // Duración del cooldown
    }
  },

  // ─── Auth ──────────────────────────────────────────────────────
  "auth": {
    "anthropicMaxToken": "sk-ant-max-...",  // Token MAX para modelos Opus
    "useMaxForModels": ["opus", "claude-opus"]  // Modelos que usan MAX token
  },

  // ─── Cache ─────────────────────────────────────────────────────
  "cache": {
    "enabled": true,
    "maxSizeMb": 100,                 // Tamaño máximo en memoria
    "defaultTtlSeconds": 3600,        // TTL por defecto (1 hora)
    "ttlByTaskType": {                // TTL por tipo de tarea
      "code_generation": 7200,
      "translation": 86400
    },
    "onlyWhenDeterministic": true,    // Solo cachear temperature=0
    "cacheDir": "~/.relayplane/cache",
    "mode": "exact",                  // "exact" | "aggressive"
    "aggressiveMaxAge": 1800          // TTL en modo aggressive (30 min)
  },

  // ─── Budget ────────────────────────────────────────────────────
  "budget": {
    "enabled": true,
    "dailyUsd": 50,                   // Límite diario en USD
    "hourlyUsd": 10,                  // Límite por hora
    "perRequestUsd": 2,               // Máximo por request
    "onBreach": "downgrade",          // "block" | "warn" | "downgrade" | "alert"
    "downgradeTo": "claude-haiku-4-5",
    "alertWebhook": "https://hooks.slack.com/...",
    "alertThresholds": [50, 80, 95],  // Porcentajes de alerta
    "sessionCapUsd": 1.00,            // Cap por sesión de agente
    "modelLadder": [                  // Escalera de downgrade por sesión
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5"
    ],
    "dailyCapUSD": 100,               // Cap diario absoluto (BudgetTracker)
    "warningThreshold": 0.8           // Fracción del cap para warning (0-1)
  },

  // ─── Anomaly Detection ─────────────────────────────────────────
  "anomaly": {
    "enabled": false,
    "velocityThreshold": 50,          // Requests en 5 min antes de alerta
    "tokenExplosionUsd": 5.0,         // Coste por request para alerta
    "repetitionThreshold": 20,        // Repeticiones en 5 min
    "windowMs": 300000                // Ventana de análisis (5 min)
  },

  // ─── Alerts ────────────────────────────────────────────────────
  "alerts": {
    "enabled": false,
    "webhookUrl": "https://hooks.slack.com/...",
    "cooldownMs": 300000,             // Cooldown entre alertas (5 min)
    "maxHistory": 500                 // Máx alertas en historial
  },

  // ─── Downgrade ─────────────────────────────────────────────────
  "downgrade": {
    "enabled": false,
    "thresholdPercent": 80,           // % del presupuesto para activar
    "mapping": {                      // Mapeo de downgrade
      "claude-opus-4-6": "claude-sonnet-4-6",
      "claude-sonnet-4-6": "claude-haiku-4-5",
      "gpt-4o": "gpt-4o-mini",
      "gemini-2.5-pro": "gemini-2.0-flash"
    }
  },

  // ─── Cross-Provider Cascade ────────────────────────────────────
  "crossProviderCascade": {
    "enabled": true,
    "providers": ["anthropic", "openrouter", "google"],
    "triggerStatuses": [429, 529, 503],
    "modelMapping": {}
  },

  // ─── Ollama (modelos locales) ──────────────────────────────────
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "models": ["llama3.2", "codestral", "qwen2.5-coder"],
    "routeWhen": {
      "complexity": ["simple"],       // Complejidades que van a Ollama
      "taskTypes": ["question_answering"]  // Tipos de tarea
    },
    "timeoutMs": 120000,              // Timeout (2 min)
    "defaultModel": "llama3.2",
    "enabled": true
  },

  // ─── Dashboard ─────────────────────────────────────────────────
  "dashboard": {
    "showRequestContent": false       // Mostrar contenido de requests en dashboard
  },

  // ─── Memory ────────────────────────────────────────────────────
  "memory": {
    "proceduralInjectionEnabled": false  // Inyectar hints en system prompts
  }
}
```

### Tipos detallados

#### RoutingConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `mode` | string | `"standard"` | Modo de routing: `standard`, `cascade`, `auto`, `passthrough`, `complexity` |
| `cascade` | CascadeConfig | — | Config de cascade intra-modelo |
| `complexity` | ComplexityConfig | — | Config de routing por complejidad |

#### CascadeConfig (intra-modelo)

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar cascade entre modelos |
| `models` | string[] | `[]` | Lista ordenada de modelos a intentar |
| `escalateOn` | string | `"error"` | Condición de escalación: `uncertainty`, `refusal`, `error` |
| `maxEscalations` | number | `2` | Máximo de escalaciones por request |

#### ComplexityConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar routing por complejidad |
| `simple` | string \| {provider, model} | (auto) | Modelo para prompts simples |
| `moderate` | string \| {provider, model} | (auto) | Modelo para complejidad media |
| `complex` | string \| {provider, model} | (auto) | Modelo para prompts complejos |

Los valores de modelo aceptan tres formatos:
- String simple: `"claude-haiku-4-5"` (se busca en MODEL_MAPPING)
- Notación slash: `"google/gemini-2.5-flash"` (provider/model)
- Objeto: `{ "provider": "anthropic", "model": "claude-opus-4-6" }`

#### CooldownConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Activar cooldown de proveedores |
| `allowedFails` | number | `3` | Fallos consecutivos antes de cooldown |
| `windowSeconds` | number | `60` | Ventana para contar fallos |
| `cooldownSeconds` | number | `30` | Duración del cooldown |

#### CacheConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Activar cache de respuestas |
| `maxSizeMb` | number | `100` | Tamaño máximo en memoria (MB) |
| `defaultTtlSeconds` | number | `3600` | TTL por defecto |
| `ttlByTaskType` | Record<string, number> | `{}` | TTL por tipo de tarea |
| `onlyWhenDeterministic` | boolean | `true` | Solo cachear temperature=0 |
| `cacheDir` | string | `~/.relayplane/cache` | Directorio de cache |
| `mode` | string | `"exact"` | `"exact"` o `"aggressive"` |
| `aggressiveMaxAge` | number | `1800` | TTL en modo aggressive (s) |

#### BudgetConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar control de presupuesto |
| `dailyUsd` | number | `50` | Límite diario (USD) |
| `hourlyUsd` | number | `10` | Límite por hora (USD) |
| `perRequestUsd` | number | `2` | Máximo por request (USD) |
| `onBreach` | string | `"warn"` | Acción: `block`, `warn`, `downgrade`, `alert` |
| `downgradeTo` | string | — | Modelo destino en downgrade |
| `alertWebhook` | string | — | URL webhook para alertas |
| `alertThresholds` | number[] | `[50, 80, 95]` | Umbrales de alerta (%) |
| `sessionCapUsd` | number | `1.00` | Cap por sesión |
| `modelLadder` | string[] | — | Escalera de modelos para downgrade |
| `dailyCapUSD` | number | — | Cap diario absoluto (null = ilimitado) |
| `warningThreshold` | number | `0.8` | Fracción del cap para warning |

#### AnomalyConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar detección de anomalías |
| `velocityThreshold` | number | `50` | Requests en ventana antes de alerta |
| `tokenExplosionUsd` | number | `5.0` | Coste por request para alerta |
| `repetitionThreshold` | number | `20` | Repeticiones antes de alerta |
| `windowMs` | number | `300000` | Ventana de análisis (ms) |

#### AlertsConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar sistema de alertas |
| `webhookUrl` | string | — | URL para envío de alertas |
| `cooldownMs` | number | `300000` | Cooldown entre alertas (ms) |
| `maxHistory` | number | `500` | Máx alertas en historial |

#### DowngradeConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar auto-downgrade |
| `thresholdPercent` | number | `80` | % del presupuesto para activar |
| `mapping` | Record<string, string> | (built-in) | Mapeo modelo caro → barato |

#### OllamaProviderConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `baseUrl` | string | `"http://localhost:11434"` | URL de Ollama |
| `models` | string[] | `[]` | Modelos disponibles |
| `routeWhen.complexity` | string[] | — | Complejidades que van a Ollama |
| `routeWhen.taskTypes` | string[] | — | Tipos de tarea para Ollama |
| `timeoutMs` | number | `120000` | Timeout (ms) |
| `defaultModel` | string | (primero de models) | Modelo por defecto |
| `enabled` | boolean | `true` | Activar proveedor Ollama |

#### HybridAuthConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `anthropicMaxToken` | string | — | Token MAX para modelos Opus |
| `useMaxForModels` | string[] | — | Modelos que usan el token MAX |

#### CrossProviderCascadeConfig

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Activar cascade cross-provider |
| `providers` | string[] | `[]` | Lista ordenada de proveedores fallback |
| `triggerStatuses` | number[] | `[429, 529, 503]` | Códigos que disparan cascade |
| `modelMapping` | Record<from, Record<to, Record<model, mapped>>> | (built-in) | Mapeo personalizado |

---

## 3. Otros ficheros de datos

Estos ficheros son gestionados automáticamente por el proxy (no se editan manualmente):

| Fichero | Formato | Descripción |
|---------|---------|-------------|
| `~/.relayplane/agents.json` | JSON | Registro de agentes detectados |
| `~/.relayplane/routing-log.jsonl` | JSONL | Log de decisiones de routing |
| `~/.relayplane/telemetry.jsonl` | JSONL | Eventos de telemetría |
| `~/.relayplane/cost-ledger.json` | JSON | Registro de costes |
| `~/.relayplane/osmosis.db` | SQLite | Átomos de conocimiento |
| `~/.relayplane/budget.db` | SQLite | Registros de presupuesto |
| `~/.relayplane/traces/index.db` | SQLite | Índice de trazas |
| `~/.relayplane/cache/` | Directorio | Cache de respuestas (gzip) |
| `~/.relayplane/credentials.json` | JSON | Credenciales almacenadas |

---

## 4. Variables de entorno

### API Keys de proveedores

| Variable | Proveedor | Requerida |
|----------|-----------|-----------|
| `ANTHROPIC_API_KEY` | Anthropic | Para usar Claude |
| `OPENAI_API_KEY` | OpenAI | Para usar GPT |
| `GEMINI_API_KEY` | Google | Para usar Gemini |
| `XAI_API_KEY` | xAI | Para usar Grok |
| `OPENROUTER_API_KEY` | OpenRouter | Para usar OpenRouter |
| `DEEPSEEK_API_KEY` | DeepSeek | Para usar DeepSeek |
| `GROQ_API_KEY` | Groq | Para usar Groq |
| `MISTRAL_API_KEY` | Mistral | Para usar Mistral |
| `TOGETHER_API_KEY` | Together | Para usar Together |
| `FIREWORKS_API_KEY` | Fireworks | Para usar Fireworks |
| `PERPLEXITY_API_KEY` | Perplexity | Para usar Perplexity |
| `OLLAMA_API_KEY` | Ollama | No requerida (placeholder) |

### Variables de control

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `RELAYPLANE_HOME_OVERRIDE` | string | Directorio base alternativo |
| `RELAYPLANE_CONFIG_PATH` | string | Path completo al config.json |
| `RELAYPLANE_PORT` | number | Puerto del proxy |
| `RELAYPLANE_VERBOSE` | boolean | Logging detallado |
| `RELAYPLANE_PROCEDURAL_INJECTION` | boolean | Activar inyección procedural |

---

## 5. Precedencia de configuración

Cuando un mismo valor se puede definir en múltiples sitios, la precedencia es:

1. **Variables de entorno** (máxima prioridad)
2. **proxy-config.json** (config avanzada)
3. **config.json** (config del usuario)
4. **Defaults del código** (mínima prioridad)

Para API keys específicamente:
1. `apiKeyValue` en config de proveedor (si existe)
2. Variable de entorno (`PROVIDER_API_KEY`)
3. Header de la petición entrante (passthrough)
4. Pool de accounts (si configurado)
