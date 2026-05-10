# Resiliencia

← [Volver al índice](./README.md)

## Circuit Breaker

Fichero: `circuit-breaker.ts`

Implementación clásica del patrón circuit breaker con tres estados:

```
CLOSED ──(N fallos consecutivos)──→ OPEN ──(timeout)──→ HALF-OPEN
   ▲                                                        │
   └────────────────────(éxito en probe)────────────────────┘
                                                            │
                              OPEN ◄────(fallo en probe)────┘
```

### Configuración

```typescript
interface CircuitBreakerOptions {
  failureThreshold?: number;   // Fallos antes de abrir (default: 3)
  resetTimeoutMs?: number;     // Tiempo en OPEN antes de HALF-OPEN (default: 30s)
  requestTimeoutMs?: number;   // Timeout por request (default: 3s)
}
```

### Uso en el proxy

Se crea una instancia por proveedor. Antes de cada request:
1. `breaker.isHealthy()` → si false, skip al cascade
2. En éxito: `breaker.recordSuccess()`
3. En fallo: `breaker.recordFailure()`

## Cooldown Manager

Clase en `standalone-proxy.ts` que complementa al circuit breaker con cooldown exponencial:

- Más granular que el circuit breaker (por proveedor, no por instancia)
- Cooldown crece exponencialmente: `base * 2^(failures-1)`
- Se integra con el cascade: proveedores en cooldown se saltan

```typescript
class CooldownManager {
  recordFailure(provider: string, error: string): void;
  recordSuccess(provider: string): void;
  isAvailable(provider: string): boolean;
}
```

## Cross-Provider Cascade

Fichero: `cross-provider-cascade.ts`

Fallback automático entre proveedores cuando uno falla. Ver [Routing](./routing.md) para configuración.

Características:
- Mapeo de modelos entre proveedores (ej: `claude-sonnet-4` → `gpt-4o`)
- Respeta circuit breakers y cooldowns de cada proveedor
- Máximo de hops configurable
- Registra el historial de cascade en headers de respuesta

## Adaptive Recovery

Fichero: `recovery.ts`

Sistema de recuperación que aprende de fallos pasados y aplica correcciones proactivas.

### Componentes

| Componente | Responsabilidad |
|-----------|-----------------|
| `RecoveryPatternStore` | Almacena patrones de fallo/recuperación (max 100, expiran en 30 días) |
| `FailureObserver` | Detecta fallos recuperables y construye contexto |
| `PatternApplicator` | Aplica patrones conocidos de forma preemptiva |
| `RecoveryEngine` | Orquesta el flujo completo de recuperación |

### Flujo

```
Fallo detectado
    │
    ▼
FailureObserver.buildContext()    ← Construye FailureContext
    │
    ▼
RecoveryPatternStore.findMatching()  ← ¿Hay patrón conocido?
    │
    ├─ SÍ → Aplica overrides del patrón (retry con ajustes)
    │
    └─ NO → Intenta estrategias genéricas:
            • Reducir max_tokens
            • Simplificar tools
            • Cambiar modelo
    │
    ▼
Si éxito → Almacena nuevo patrón con confianza inicial
Si fallo → Reduce confianza del patrón (o descarta)
```

### Aplicación preemptiva

`PatternApplicator.getPreemptiveOverrides()` se llama ANTES de enviar la petición. Si hay un patrón de alta confianza para ese proveedor/modelo, aplica los overrides sin esperar al fallo.

```typescript
interface RequestOverrides {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  removeTools?: boolean;
}
```

→ Ver [Observabilidad](./observability.md) para cómo se registran los eventos de resiliencia.
