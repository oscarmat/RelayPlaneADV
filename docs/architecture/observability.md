# Observabilidad

← [Volver al índice](./README.md)

## Telemetría

Fichero: `telemetry.ts`

Registra eventos de uso del proxy tanto localmente (JSONL) como en la nube (si habilitado).

```typescript
interface TelemetryEvent {
  device_id: string;
  timestamp: string;
  task_type: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  success: boolean;
  cost_usd: number;
}
```

### Modos

- **Normal**: Registra en `~/.relayplane/telemetry.jsonl` + envía a cloud
- **Audit**: Acumula en buffer en memoria (para inspección sin persistencia)
- **Offline**: Solo registro local, sin envío a cloud

### Estimación de costes

`estimateCost(model, inputTokens, outputTokens)` calcula el coste basándose en tablas de precios por modelo. Soporta cache tokens (Anthropic prompt caching).

## Cost Ledger

Fichero: `cost-ledger.ts`

Registro persistente de costes por tenant/modelo en `~/.relayplane/cost-ledger.json`.

```typescript
interface CostRecord {
  tenantId: string;
  model: string;
  costUsd: number;
  requestCount: number;
  timestamp: Date;
}
```

Permite consultas por rango temporal (7d, 30d, all) con desglose por modelo y por día.

## Routing Log

Fichero: `routing-log.ts`

Ring buffer de 1000 entradas con persistencia en `~/.relayplane/routing-log.jsonl`.

```typescript
interface RoutingLogEntry {
  ts: string;
  requestId: string;
  agentFingerprint: string | null;
  agentName: string | null;
  taskType: string;
  complexity: string;
  resolvedModel: string;       // "provider/model"
  resolvedBy: ResolvedBy;      // 'policy' | 'config' | 'complexity' | 'default'
  candidateModel: string | null;
  reason: string;
  inputTokens?: number;
  outputTokens?: number;
}
```

Soporta filtros por agente y tipo de tarea. Rotación automática a 10 MB.

## Agent Tracker

Fichero: `agent-tracker.ts`

Identifica agentes por fingerprint (SHA-256 de los primeros 500 chars del system prompt) y mantiene un registro en `~/.relayplane/agents.json`.

```typescript
interface AgentRegistryEntry {
  name: string;                // "Agent 1", o nombre explícito
  fingerprint: string;         // 12 chars hex
  firstSeen: string;
  lastSeen: string;
  systemPromptPreview: string; // Primeros 80 chars
  totalRequests: number;
  totalCost: number;
}
```

Funcionalidades:
- Auto-naming (`Agent 1`, `Agent 2`, ...)
- Rename manual via API
- Acumulación de costes por agente
- Flush debounced a disco (cada 5s)

## Trace Writer

Fichero: `trace-writer.ts`

Escribe trazas detalladas de requests/responses para debugging. Configurable por nivel de detalle.

## Session Tracker

Fichero: `session-tracker.ts`

Agrupa requests en sesiones lógicas para tracking de conversaciones y presupuestos por sesión.

## Dashboard

El proxy expone un dashboard HTML en `/dashboard` con:
- Estadísticas de uso en tiempo real
- Costes acumulados
- Estado de proveedores (healthy/cooldown/open)
- Historial de routing
- Agentes detectados

→ Ver [Gobernanza](./governance.md) para presupuestos y rate limiting.
