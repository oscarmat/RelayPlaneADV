# Request Pipeline

← [Volver al índice](./README.md)

## Punto de entrada

El servidor HTTP se inicia en `standalone-proxy.ts` → `startProxy()`. Escucha en el puerto configurado (por defecto 4801) y despacha según la ruta:

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/v1/chat/completions` | POST | API compatible OpenAI |
| `/v1/messages` | POST | API nativa Anthropic |
| `/v1/estimate` | POST | Estimación de coste sin ejecutar |
| `/v1/admin/*` | GET/POST | Endpoints de administración |
| `/health` | GET | Health check |
| `/dashboard` | GET | Dashboard HTML |

## Ciclo de vida de una petición

```
Request HTTP
    │
    ▼
extractRequestContext(req)     ← Headers, IP, workspace ID
    │
    ▼
readJsonBody(req)              ← Parse del body JSON
    │
    ▼
resolveModelAlias(model)       ← rp:auto → rp:balanced, etc.
    │
    ▼
parseModelSuffix(model)        ← "claude-sonnet:cost" → {base, suffix}
    │
    ▼
resolveExplicitModel(model)    ← MODEL_MAPPING lookup + SMART_ALIASES
    │
    ▼
resolvePolicy(agent, model)    ← agent-policy.ts: ¿permitido?
    │
    ▼
acquireSlot(workspace, model)  ← rate-limiter.ts: ¿dentro de RPM?
    │
    ▼
checkBudget(estimatedCost)     ← budget.ts: ¿dentro de presupuesto?
    │
    ▼
┌─ stream: true? ─────────────────────────────────────────┐
│  YES → handleStreamingRequest()                          │
│  NO  → handleNonStreamingRequest()                       │
└──────────────────────────────────────────────────────────┘
    │
    ▼
Forward al proveedor (con circuit breaker + cooldown)
    │
    ▼
Conversión de respuesta (si cross-format)
    │
    ▼
Telemetría + Cost tracking + Routing log
```

## Resolución de modelo

La resolución sigue esta prioridad (de mayor a menor):

1. **Modelo explícito con prefijo de proveedor**: `anthropic/claude-sonnet-4-6` → usa directamente
2. **Config del usuario** (`providers[name].models`): mapeo personalizado
3. **SMART_ALIASES**: `rp:best`, `rp:fast`, `rp:cheap`, `rp:balanced`
4. **MODEL_MAPPING**: tabla estática de ~40 modelos conocidos
5. **Complexity routing**: si está habilitado, elige modelo según complejidad del prompt
6. **DEFAULT_ROUTING**: fallback por tipo de tarea

## Forwarding por proveedor

Cada proveedor tiene funciones dedicadas de forwarding:

| Proveedor | Non-streaming | Streaming |
|-----------|--------------|-----------|
| Anthropic | `forwardToAnthropic()` | `forwardToAnthropicStream()` |
| OpenAI | `forwardToOpenAI()` | `forwardToOpenAIStream()` |
| Google | `forwardToGemini()` | `forwardToGeminiStream()` |
| xAI | `forwardToXAI()` | `forwardToXAIStream()` |
| OpenAI-compat | `forwardToOpenAICompatible()` | `forwardToOpenAICompatibleStream()` |
| Ollama | `forwardToOllama()` | `forwardToOllamaStream()` |

## Conversión de formato

El proxy acepta peticiones en formato OpenAI o Anthropic y las convierte según el proveedor destino:

- **OpenAI → Anthropic**: `convertMessagesToAnthropic()` + `buildAnthropicBody()`
- **Anthropic → OpenAI**: `convertNativeAnthropicBodyToChatRequest()`
- **OpenAI → Gemini**: `convertMessagesToGemini()`
- **Anthropic response → OpenAI**: `convertAnthropicResponse()`
- **Gemini response → OpenAI**: `convertGeminiResponse()`

Para streaming, cada formato tiene su propio conversor de chunks:
- `convertAnthropicStreamEvent()` / `convertAnthropicStream()`
- `convertGeminiStreamEvent()` / `convertGeminiStream()`
- `pipeOpenAIStream()`

## Interfaces clave

```typescript
interface RequestContext {
  ip: string;
  workspaceId: string;
  agentId?: string;
  headers: Record<string, string>;
}

interface ParsedModel {
  baseModel: string;
  suffix?: RoutingSuffix;  // 'cost' | 'fast' | 'quality'
}

interface ProviderEndpoint {
  baseUrl: string;
  apiKeyEnv: string;
}
```

→ Ver [Routing](./routing.md) para detalles de resolución de modelos y cascade.
