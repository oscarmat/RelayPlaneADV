# Mesh & Knowledge (Osmosis)

← [Volver al índice](./README.md)

## Visión general

La capa Osmosis es un sistema de conocimiento distribuido que aprende de los patrones de uso del proxy para optimizar routing y detectar anomalías.

## Componentes

```
src/mesh/
├── index.ts      ← initMeshLayer(): inicialización y MeshHandle
├── store.ts      ← MeshStore: almacenamiento SQLite de átomos
├── capture.ts    ← captureRequest(): captura eventos en átomos
├── fitness.ts    ← computeFitness(): calcula fitness de modelos
├── sync.ts       ← MeshSyncManager: sincronización con mesh remoto
└── types.ts      ← KnowledgeAtom, CaptureEvent, SyncResult
```

## Knowledge Atoms

Unidad básica de conocimiento. Cada request exitoso o fallido genera un átomo:

```typescript
// Átomo de éxito
{
  type: 'success',
  model: string,
  taskType: string,
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
  timestamp: number
}

// Átomo de fallo
{
  type: 'failure',
  errorType: string,
  model: string,
  fallbackTaken: boolean,
  timestamp: number
}
```

## Osmosis Store

Fichero: `osmosis-store.ts`

Almacenamiento local de átomos en SQLite (`~/.relayplane/osmosis.db`). Funciones principales:

- `captureAtom(atom)` — Persiste un átomo
- `countAtomsForSession(sessionId)` — Cuenta átomos por sesión
- `getOsmosisDb()` — Acceso directo a la DB

## Fitness

`computeFitness(store)` analiza los átomos acumulados para calcular un score de fitness por modelo:

- Tasa de éxito
- Latencia media
- Coste medio
- Tendencia reciente (últimas 24h vs histórico)

Esto alimenta las decisiones de routing inteligente.

## Sincronización

`MeshSyncManager` sincroniza átomos con un mesh remoto (si `contribute: true`):

- **Push**: Envía átomos locales al endpoint del mesh
- **Pull**: Descarga átomos de otros nodos para enriquecer el conocimiento local
- **Dedup**: Evita duplicados por hash de contenido

Intervalo configurable (default: 60s). El sync es no-bloqueante y tolerante a fallos.

## Configuración

```typescript
interface MeshConfig {
  enabled: boolean;           // Activar/desactivar mesh
  endpoint: string;           // URL del mesh remoto
  sync_interval_ms: number;   // Intervalo de sync (default: 60000)
  contribute: boolean;        // ¿Contribuir átomos al mesh?
  db_path?: string;           // Path alternativo para la DB
}
```

## Episode Writer

Fichero: `episode-writer.ts`

Escribe "episodios" completos (secuencias de requests relacionados) para análisis posterior. Un episodio agrupa requests de una misma sesión/conversación.
