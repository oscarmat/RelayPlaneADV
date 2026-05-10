# Routing & Model Resolution

← [Volver al índice](./README.md)

## Proveedores built-in

Definidos en `DEFAULT_ENDPOINTS` dentro de `standalone-proxy.ts`:

| Provider | Base URL | API Key Env |
|----------|----------|-------------|
| anthropic | `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` |
| openai | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| google | `https://generativelanguage.googleapis.com/v1beta` | `GEMINI_API_KEY` |
| xai | `https://api.x.ai/v1` | `XAI_API_KEY` |
| openrouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| deepseek | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| mistral | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| together | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| fireworks | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| perplexity | `https://api.perplexity.ai` | `PERPLEXITY_API_KEY` |
| ollama | `http://localhost:11434` | `OLLAMA_API_KEY` |

## MODEL_MAPPING

Tabla estática que mapea nombres de modelo a `{ provider, model }`. Ejemplos:

```typescript
'claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4-6' }
'gpt-4o':          { provider: 'openai',    model: 'gpt-4o' }
'gemini-2.5-pro':  { provider: 'google',    model: 'gemini-2.5-pro' }
'grok-4':          { provider: 'xai',       model: 'grok-4' }
```

## Smart Aliases

Aliases semánticos que se resuelven dinámicamente al iniciar según las API keys disponibles:

| Alias | Significado |
|-------|-------------|
| `rp:best` | Mejor modelo disponible (calidad máxima) |
| `rp:fast` | Modelo más rápido |
| `rp:cheap` | Modelo más económico |
| `rp:balanced` | Balance calidad/coste |

La prioridad de resolución es: OpenRouter > Anthropic > OpenAI > passthrough.

## Cross-Provider Cascade

Fichero: `cross-provider-cascade.ts`

Cuando un proveedor falla (5xx, timeout, circuit breaker abierto), el cascade manager intenta el siguiente proveedor en la lista configurada.

```typescript
interface CrossProviderCascadeConfig {
  enabled: boolean;
  providers: string[];           // Lista ordenada de proveedores fallback
  statusCodes: number[];         // Códigos que disparan cascade (ej: [429, 500, 502, 503])
  maxHops: number;               // Máximo de saltos (default: 3)
  modelMapping: Record<string, Record<string, string>>; // Mapeo de modelos entre proveedores
}
```

**Flujo del cascade:**
1. Petición falla en proveedor A con status en `statusCodes`
2. `getFallbackProviders(A)` devuelve [B, C, ...]
3. `mapModel(model, A, B)` traduce el modelo al equivalente en B
4. Se reintenta en B (con su propio circuit breaker)
5. Si B también falla, se intenta C (hasta `maxHops`)

## Complexity Routing

El proxy puede elegir modelo según la complejidad del prompt:

```typescript
interface ComplexityTiers {
  simple: string;    // Prompts cortos/simples → modelo económico
  moderate: string;  // Complejidad media → modelo balanceado
  complex: string;   // Prompts largos/complejos → modelo potente
}
```

`classifyComplexity(messages)` analiza longitud y contenido para clasificar.

## Cooldown Manager

Clase: `CooldownManager` en `standalone-proxy.ts`

Gestiona la salud de proveedores con un sistema de cooldown exponencial:

```typescript
interface ProviderHealth {
  failures: number;
  lastFailure: number;
  cooldownUntil: number;
}
```

- Tras N fallos consecutivos, el proveedor entra en cooldown
- El cooldown crece exponencialmente con cada fallo adicional
- Un éxito resetea el contador de fallos
- `isAvailable(provider)` → false si está en cooldown

## Detección automática de proveedores

`detectAvailableProviders()` al inicio escanea las variables de entorno para determinar qué proveedores están configurados. Esto alimenta los smart aliases y el DEFAULT_ROUTING.

→ Ver [Resiliencia](./resilience.md) para circuit breaker y recovery.
