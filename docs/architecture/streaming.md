# Streaming (SSE)

← [Volver al índice](./README.md)

## Visión general

El proxy soporta streaming via Server-Sent Events (SSE) para todos los proveedores. Cuando `stream: true` en la petición, la respuesta se envía chunk a chunk al cliente.

## Formatos SSE por proveedor

### OpenAI format

```
data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n
data: {"id":"chatcmpl-...","choices":[{"delta":{"content":" world"},"index":0}]}\n\n
data: [DONE]\n\n
```

### Anthropic format

```
event: message_start\ndata: {"type":"message_start","message":{...}}\n\n
event: content_block_start\ndata: {"type":"content_block_start",...}\n\n
event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n
event: message_stop\ndata: {"type":"message_stop"}\n\n
```

### Gemini format

Gemini usa un formato propio que se convierte a OpenAI format en el proxy.

## SSEWriter

Fichero: `streaming.ts`

Clase helper para escribir SSE responses:

```typescript
class SSEWriter {
  constructor(response: ServerResponse);
  write(message: SSEMessage): boolean;   // Escribe un evento SSE
  writeData(data: unknown): boolean;     // Shortcut para data-only
  comment(text: string): boolean;        // Keep-alive comment
  close(): void;                         // Envía [DONE] y cierra
  isOpen(): boolean;                     // ¿Cliente aún conectado?
}
```

## Conversión de streaming cross-format

Cuando el cliente envía en formato OpenAI pero el proveedor destino es Anthropic (o viceversa), el proxy convierte cada chunk individualmente:

### Anthropic → OpenAI (streaming)

`convertAnthropicStreamEvent()` transforma cada evento Anthropic en un chunk OpenAI:

- `message_start` → chunk inicial con `role: "assistant"`
- `content_block_delta` → chunk con `delta.content`
- `message_stop` → chunk con `finish_reason: "stop"`

Mantiene estado (`StreamingToolState`) para tool calls que llegan en múltiples chunks.

### Gemini → OpenAI (streaming)

`convertGeminiStreamEvent()` transforma respuestas Gemini en chunks OpenAI.

### OpenAI passthrough

`pipeOpenAIStream()` simplemente reenvía los chunks sin transformación (para proveedores OpenAI-compatible).

## streamProviderResponse()

Función de alto nivel que:
1. Hace fetch al proveedor con `Accept: text/event-stream`
2. Lee el body como stream
3. Parsea eventos SSE del buffer
4. Invoca callbacks (`onChunk`, `onComplete`, `onError`)
5. Escribe al SSEWriter del cliente
6. Retorna métricas (TTFT, chunks, success)

## Keep-alive

`startKeepAlive(writer, intervalMs)` envía comments SSE periódicos (`: ping\n\n`) para mantener la conexión viva en proxies intermedios.

## Agregación

`aggregateStreamingResponse(chunks)` reconstruye la respuesta completa a partir de los chunks para:
- Calcular tokens totales
- Extraer el texto completo
- Obtener finish_reason
- Registrar en telemetría

→ Ver [Mesh & Knowledge](./mesh.md) para la capa de conocimiento distribuido.
