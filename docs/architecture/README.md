# Arquitectura de RelayPlaneADV

RelayPlaneADV es un proxy LLM inteligente que enruta peticiones a múltiples proveedores de IA (Anthropic, OpenAI, Google, xAI, DeepSeek, etc.) con observabilidad integrada, resiliencia y optimización de costes.

## Visión general

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clientes (IDE, CLI, agentes)             │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTP
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                     standalone-proxy.ts                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐    │
│  │ Routing  │  │ Format   │  │ Auth     │  │ Streaming     │    │
│  │ Engine   │  │ Convert  │  │ Resolver │  │ (SSE)         │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘    │
│       │              │              │                │          │
│  ┌────┴──────────────┴──────────────┴────────────────┴───────┐  │
│  │                  Request Pipeline                         │  │
│  └────────────────────────────┬──────────────────────────────┘  │
└───────────────────────────────┼─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│  Resiliencia │  │  Observabilidad  │  │  Gobernanza          │
│              │  │                  │  │                      │
│ • Circuit    │  │ • Telemetry      │  │ • Budget Manager     │
│   Breaker    │  │ • Cost Ledger    │  │ • Rate Limiter       │
│ • Cooldown   │  │ • Routing Log    │  │ • Agent Policy       │
│ • Cascade    │  │ • Agent Tracker  │  │ • Kill Switch        │
│ • Recovery   │  │ • Trace Writer   │  │ • Tenant Isolation   │
└──────────────┘  └──────────────────┘  └──────────────────────┘
```

## Módulos principales

| Módulo | Fichero(s) | Descripción |
|--------|-----------|-------------|
| [Request Pipeline](./request-pipeline.md) | `standalone-proxy.ts` | Núcleo del proxy: recepción, routing, forwarding y respuesta |
| [Routing & Model Resolution](./routing.md) | `standalone-proxy.ts`, `cross-provider-cascade.ts` | Resolución de modelos, aliases, cascade cross-provider |
| [Resiliencia](./resilience.md) | `circuit-breaker.ts`, `cross-provider-cascade.ts`, `recovery.ts` | Circuit breaker, cooldown, cascade y recuperación adaptativa |
| [Observabilidad](./observability.md) | `telemetry.ts`, `cost-ledger.ts`, `routing-log.ts`, `agent-tracker.ts` | Telemetría, costes, logs de routing, tracking de agentes |
| [Gobernanza](./governance.md) | `budget.ts`, `rate-limiter.ts`, `agent-policy.ts`, `kill-switch.ts` | Presupuestos, rate limiting, políticas de agente |
| [Configuración](./configuration.md) | `config.ts`, `standalone-proxy.ts` | Carga de config, proveedores, credenciales |
| [Referencia de config](./config-reference.md) | `config.ts`, `standalone-proxy.ts` | Especificación completa de todos los campos de configuración |
| [Streaming](./streaming.md) | `streaming.ts`, `standalone-proxy.ts` | SSE, conversión de chunks entre formatos |
| [Mesh & Knowledge](./mesh.md) | `mesh/`, `osmosis-store.ts` | Capa de conocimiento distribuido (Osmosis) |

## Estructura de ficheros

```
src/
├── standalone-proxy.ts    ← Punto de entrada del servidor HTTP y lógica principal
├── index.ts               ← Exports públicos del paquete
├── config.ts              ← Gestión de ~/.relayplane/config.json
├── circuit-breaker.ts     ← Patrón circuit breaker (CLOSED→OPEN→HALF-OPEN)
├── cross-provider-cascade.ts ← Fallback entre proveedores
├── recovery.ts            ← Recuperación adaptativa con patrones aprendidos
├── rate-limiter.ts        ← Rate limiting por modelo/proveedor/workspace
├── budget.ts              ← Gestión de presupuesto diario/horario/por-sesión
├── cost-ledger.ts         ← Registro persistente de costes
├── telemetry.ts           ← Eventos de telemetría (local + cloud)
├── routing-log.ts         ← Ring buffer de decisiones de routing
├── agent-tracker.ts       ← Fingerprinting y tracking de agentes
├── agent-policy.ts        ← Políticas de routing por agente
├── streaming.ts           ← SSEWriter y streaming helpers
├── credential-pool.ts     ← Pool de credenciales multi-key
├── token-pool.ts          ← Pool de tokens con rotación
├── middleware.ts          ← Middleware para integración embebida
├── ollama.ts              ← Integración con Ollama (modelos locales)
├── kill-switch.ts         ← Parada de emergencia
├── tenant-isolation.ts    ← Aislamiento multi-tenant
├── mesh/                  ← Capa de conocimiento distribuido
│   ├── index.ts           ← Inicialización del mesh
│   ├── store.ts           ← Almacenamiento SQLite de átomos
│   ├── capture.ts         ← Captura de eventos
│   ├── fitness.ts         ← Cálculo de fitness de modelos
│   ├── sync.ts            ← Sincronización con mesh remoto
│   └── types.ts           ← Tipos compartidos
├── helpers/
│   └── config-loader.ts   ← Utilidades de carga de config
└── utils/
    ├── model-suggestions.ts ← Sugerencias de modelos en errores
    └── version-status.ts    ← Comprobación de versión
```

## Flujo de una petición típica

1. **Recepción** → `standalone-proxy.ts` recibe HTTP request en `/v1/chat/completions` o `/v1/messages`
2. **Autenticación** → Se resuelve la API key (passthrough, env var, o credential pool)
3. **Resolución de modelo** → `MODEL_MAPPING` + `SMART_ALIASES` + config del usuario
4. **Policy check** → `agent-policy.ts` verifica si el agente puede usar ese modelo
5. **Budget check** → `budget.ts` verifica límites de gasto
6. **Rate limit** → `rate-limiter.ts` verifica RPM
7. **Format conversion** → Si el proveedor destino usa formato diferente al de la petición
8. **Forwarding** → Se envía al proveedor (con circuit breaker + cooldown check)
9. **Cascade** → Si falla, `cross-provider-cascade.ts` intenta el siguiente proveedor
10. **Response** → Se convierte la respuesta al formato esperado por el cliente
11. **Telemetría** → Se registra coste, latencia, modelo, agente

→ Ver [Request Pipeline](./request-pipeline.md) para detalles completos.
