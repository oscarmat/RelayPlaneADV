# Configuración

← [Volver al índice](./README.md)

## Ficheros de configuración

| Fichero | Ubicación | Propósito |
|---------|-----------|-----------|
| `config.json` | `~/.relayplane/config.json` | Configuración principal del usuario |
| `proxy-config.json` | `~/.relayplane/proxy-config.json` | Config avanzada del proxy (routing, cascade, etc.) |
| `agent-policy.json` | `~/.relayplane/agent-policy.json` | Políticas de routing por agente |
| `credentials.json` | `~/.relayplane/credentials.json` | Credenciales almacenadas |

## config.json (usuario)

Fichero: `config.ts` → `loadConfig()`

```typescript
interface ProxyConfig {
  port?: number;
  telemetry_enabled?: boolean;
  lifecycle_enabled?: boolean;
  device_id?: string;
  api_key?: string;
  
  // Mesh (conocimiento distribuido)
  mesh?: MeshConfigSection;
  
  // Rate limiting
  rateLimit?: RateLimitConfigSection;
  
  // Proveedores con config personalizada
  providers?: Record<string, ProviderConfig>;
  
  // Cascade cross-provider
  crossProviderCascade?: CrossProviderCascadeConfigSection;
}
```

### Sección de proveedores

```typescript
interface ProviderConfig {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  rateLimit?: ProviderRateLimitConfig;
  accounts?: ProviderAccountConfig[];  // Multi-key rotation
}
```

## proxy-config.json (avanzada)

Fichero: `standalone-proxy.ts` → `loadProxyConfig()`

Configuración más detallada del comportamiento del proxy:

```typescript
interface RelayPlaneProxyConfigFile {
  routing?: RoutingConfig;
  reliability?: ReliabilityConfig;
  cascade?: CascadeConfig;
  cooldown?: CooldownConfig;
  complexity?: ComplexityConfig;
  budget?: BudgetConfig;
  anomaly?: AnomalyConfig;
  alerts?: AlertsConfig;
  downgrade?: DowngradeConfig;
  ollama?: OllamaProviderConfig;
  cache?: CacheConfig;
  traces?: TracesConfig;
  hybridAuth?: HybridAuthConfig;
  crossProviderCascade?: CrossProviderCascadeConfig;
}
```

## Carga de configuración

### Startup flow

```
startProxy()
    │
    ├─ loadUserConfig()           ← ~/.relayplane/config.json
    │     └─ Si no existe → createDefaultConfig()
    │
    ├─ loadProxyConfig()          ← ~/.relayplane/proxy-config.json
    │     └─ normalizeProxyConfig() → defaults para campos faltantes
    │
    ├─ mergeProxyConfig()         ← Merge de ambas configs
    │
    ├─ detectAvailableProviders() ← Escanea env vars
    │
    ├─ buildSmartAliases()        ← Genera aliases según proveedores disponibles
    │
    ├─ configureRateLimiter()     ← Inicializa rate limiter con config
    │
    └─ loadAgentRegistry()        ← Carga registro de agentes
```

### Deep merge

`mergeProxyConfig()` hace deep merge de la config del usuario sobre los defaults. Arrays se reemplazan (no se concatenan). Objetos se fusionan recursivamente.

## Variables de entorno

El proxy lee API keys de variables de entorno. Las principales:

| Variable | Proveedor |
|----------|-----------|
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google |
| `XAI_API_KEY` | xAI |
| `OPENROUTER_API_KEY` | OpenRouter |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral |
| `TOGETHER_API_KEY` | Together |
| `FIREWORKS_API_KEY` | Fireworks |
| `PERPLEXITY_API_KEY` | Perplexity |

Variables de control:
| Variable | Efecto |
|----------|--------|
| `RELAYPLANE_HOME_OVERRIDE` | Directorio base alternativo (en vez de `~/.relayplane`) |
| `RELAYPLANE_PORT` | Puerto del proxy |
| `RELAYPLANE_VERBOSE` | Logging detallado |

## Credential Pool

Fichero: `credential-pool.ts`

Permite configurar múltiples API keys por proveedor con rotación automática:

```typescript
interface PoolAccountConfig {
  key: string;
  weight?: number;      // Peso para distribución
  rateLimit?: number;   // RPM individual de esta key
}
```

Útil para distribuir carga entre varias keys y evitar rate limits del proveedor.

→ Ver [Referencia completa de config](./config-reference.md) para la especificación de todos los campos.
→ Ver [Streaming](./streaming.md) para detalles de SSE.
