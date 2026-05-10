# Gobernanza

← [Volver al índice](./README.md)

## Budget Manager

Fichero: `budget.ts`

Control de gasto con múltiples niveles de granularidad.

### Límites

```typescript
interface BudgetConfig {
  dailyLimitUsd: number;       // Límite diario global
  hourlyLimitUsd: number;      // Límite por hora
  perRequestLimitUsd: number;  // Máximo por request individual
  sessionCapUsd: number;       // Cap por sesión de agente
  warningThresholds: number[]; // Umbrales de alerta (ej: [0.5, 0.8, 0.95])
}
```

### Presupuesto por sesión

Cada sesión de agente tiene un cap independiente. Cuando se acerca al límite:
1. Warning en logs
2. Downgrade automático a modelo más barato (`_nextLadderModel()`)
3. Bloqueo si se supera el cap

### Almacenamiento

Usa SQLite (`~/.relayplane/budget.db`) para persistencia de registros de gasto con ventanas temporales (diaria/horaria).

## Rate Limiter

Fichero: `rate-limiter.ts`

Rate limiting por requests-per-minute (RPM) con cola de espera.

### Configuración

```typescript
interface RateLimitConfig {
  rpm: number;           // Requests por minuto permitidos
  burstMultiplier?: number;  // Factor de burst (default: 1.5)
}
```

### Niveles de configuración

1. **Global**: RPM por defecto para todos los modelos
2. **Por modelo**: Override específico por nombre de modelo
3. **Por proveedor**: Límites a nivel de proveedor completo

### Cola de espera

Cuando se excede el RPM, las peticiones entran en cola (hasta `maxQueueDepth`). Se drenan conforme se liberan slots. Timeout configurable para evitar esperas infinitas.

```typescript
class RateLimiter {
  checkLimit(workspaceId, model, provider?): RateLimitCheck;
  acquireSlot(workspaceId, model, provider?): Promise<void>;  // Espera en cola
  getUsage(workspaceId, model): { used, limit, resetAt };
}
```

## Agent Policy

Fichero: `agent-policy.ts`

Políticas de routing por agente. Permite definir reglas como:
- "Agent X solo puede usar modelos baratos"
- "Agent Y siempre usa claude-sonnet"
- "Agentes desconocidos → modelo por defecto"

Se carga desde `~/.relayplane/agent-policy.json`.

```typescript
type ResolvedBy = 'policy' | 'config' | 'complexity' | 'default' | 'explicit';
```

## Kill Switch

Fichero: `kill-switch.ts`

Mecanismo de parada de emergencia que bloquea todas las peticiones. Se activa:
- Manualmente via endpoint admin
- Automáticamente si el gasto supera un umbral crítico
- Via señal externa (fichero sentinel)

## Tenant Isolation

Fichero: `tenant-isolation.ts`

Aislamiento entre workspaces/tenants:
- Cada workspace tiene su propio rate limit
- Presupuestos independientes por tenant
- Un tenant no puede agotar los recursos de otro

## Downgrade

Fichero: `downgrade.ts`

Degradación automática de modelo cuando:
- El presupuesto está cerca del límite
- El proveedor preferido está en cooldown
- La latencia supera umbrales

```typescript
interface DowngradeConfig {
  enabled: boolean;
  latencyThresholdMs: number;
  budgetThresholdPct: number;
  targetModel: string;
}
```

→ Ver [Configuración](./configuration.md) para cómo se definen estos parámetros.
