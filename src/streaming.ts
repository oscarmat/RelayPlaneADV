/**
 * Streaming Support for RelayPlane Proxy
 *
 * Provides SSE (Server-Sent Events) streaming for LLM responses
 * and real-time updates. Includes custom provider streaming with
 * format-aware passthrough and cross-format conversion.
 *
 * @packageDocumentation
 */

import type { ServerResponse } from 'node:http';
import {
  convertStreamChunk,
  createStreamConversionState,
  type ApiFormat,
  type ConversionContext,
  type StreamConversionState,
} from './format-converter.js';

/**
 * SSE message structure
 */
export interface SSEMessage {
  event?: string;
  data: unknown;
  id?: string;
  retry?: number;
}

/**
 * Stream writer for SSE responses
 */
export class SSEWriter {
  private response: ServerResponse;
  private closed = false;

  constructor(response: ServerResponse) {
    this.response = response;

    // Set SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Handle client disconnect
    response.on('close', () => {
      this.closed = true;
    });
  }

  /**
   * Write an SSE message
   */
  write(message: SSEMessage): boolean {
    if (this.closed) return false;

    const lines: string[] = [];

    if (message.event) {
      lines.push(`event: ${message.event}`);
    }

    if (message.id) {
      lines.push(`id: ${message.id}`);
    }

    if (message.retry !== undefined) {
      lines.push(`retry: ${message.retry}`);
    }

    // Data can be multi-line, each line needs data: prefix
    const dataStr = typeof message.data === 'string'
      ? message.data
      : JSON.stringify(message.data);

    for (const line of dataStr.split('\n')) {
      lines.push(`data: ${line}`);
    }

    lines.push(''); // Empty line to end message
    lines.push('');

    try {
      this.response.write(lines.join('\n'));
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  /**
   * Write a data-only message (convenience method)
   */
  writeData(data: unknown): boolean {
    return this.write({ data });
  }

  /**
   * Send a comment (keep-alive)
   */
  comment(text: string): boolean {
    if (this.closed) return false;
    try {
      this.response.write(`: ${text}\n\n`);
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  /**
   * Close the stream
   */
  close(): void {
    if (!this.closed) {
      this.write({ data: '[DONE]' });
      this.response.end();
      this.closed = true;
    }
  }

  /**
   * Check if stream is still open
   */
  isOpen(): boolean {
    return !this.closed;
  }
}

/**
 * Create an SSE writer
 */
export function createSSEWriter(response: ServerResponse): SSEWriter {
  return new SSEWriter(response);
}

/**
 * Stream a provider response to SSE
 */
export async function streamProviderResponse(
  providerUrl: string,
  request: unknown,
  headers: Record<string, string>,
  writer: SSEWriter,
  callbacks?: {
    onChunk?: (chunk: unknown) => void;
    onComplete?: (fullResponse: unknown) => void;
    onError?: (error: Error) => void;
  }
): Promise<{ success: boolean; chunks: unknown[]; ttftMs?: number }> {
  const chunks: unknown[] = [];
  let ttftMs: number | undefined;
  const startTime = Date.now();

  try {
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = new Error(`Provider returned ${response.status}`);
      callbacks?.onError?.(error);
      writer.write({
        event: 'error',
        data: { error: { message: error.message, status: response.status } },
      });
      writer.close();
      return { success: false, chunks };
    }

    if (!response.body) {
      const error = new Error('No response body');
      callbacks?.onError?.(error);
      writer.close();
      return { success: false, chunks };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (ttftMs === undefined) {
        ttftMs = Date.now() - startTime;
      }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            chunks.push(parsed);
            callbacks?.onChunk?.(parsed);

            // Forward to client
            if (!writer.write({ data: parsed })) {
              // Client disconnected
              return { success: false, chunks, ttftMs };
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      if (data && data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          chunks.push(parsed);
          callbacks?.onChunk?.(parsed);
          writer.write({ data: parsed });
        } catch {
          // Invalid JSON
        }
      }
    }

    callbacks?.onComplete?.(chunks);
    writer.close();

    return { success: true, chunks, ttftMs };
  } catch (error) {
    callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)));
    writer.write({
      event: 'error',
      data: { error: { message: error instanceof Error ? error.message : 'Stream error' } },
    });
    writer.close();
    return { success: false, chunks, ttftMs };
  }
}

/**
 * Aggregate streaming chunks into a complete response
 */
export function aggregateStreamingResponse(chunks: unknown[]): {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
  finish_reason?: string;
} {
  let content = '';
  let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
  let model: string | undefined;
  let finish_reason: string | undefined;

  for (const chunk of chunks) {
    if (typeof chunk !== 'object' || chunk === null) continue;

    const c = chunk as Record<string, unknown>;

    // Extract model
    if (c.model && typeof c.model === 'string') {
      model = c.model;
    }

    // Extract content from choices
    if (Array.isArray(c.choices) && c.choices.length > 0) {
      const choice = c.choices[0] as Record<string, unknown>;

      // Delta content (streaming)
      if (choice.delta && typeof choice.delta === 'object') {
        const delta = choice.delta as Record<string, unknown>;
        if (typeof delta.content === 'string') {
          content += delta.content;
        }
      }

      // Finish reason
      if (choice.finish_reason && typeof choice.finish_reason === 'string') {
        finish_reason = choice.finish_reason;
      }
    }

    // Extract usage (usually in last chunk)
    if (c.usage && typeof c.usage === 'object') {
      const u = c.usage as Record<string, unknown>;
      if (
        typeof u.prompt_tokens === 'number' &&
        typeof u.completion_tokens === 'number'
      ) {
        usage = {
          prompt_tokens: u.prompt_tokens,
          completion_tokens: u.completion_tokens,
          total_tokens: (u.total_tokens as number) ?? u.prompt_tokens + u.completion_tokens,
        };
      }
    }
  }

  return { content, usage, model, finish_reason };
}

/**
 * Keep-alive ping for long-running streams
 */
export function startKeepAlive(
  writer: SSEWriter,
  intervalMs = 15000
): () => void {
  const timer = setInterval(() => {
    if (!writer.isOpen()) {
      clearInterval(timer);
      return;
    }
    writer.comment('ping');
  }, intervalMs);

  return () => clearInterval(timer);
}


// ─── Custom Provider Streaming ───────────────────────────────────────────────

/**
 * Options for streaming a custom provider response.
 */
export interface CustomProviderStreamOptions {
  /** The raw Response from the custom provider (must have a readable body) */
  response: Response;
  /** The format the provider returns (based on its apiCompatibility) */
  providerFormat: ApiFormat;
  /** The format the client expects (based on the incoming request path) */
  clientFormat: ApiFormat;
  /** The target model name (used in conversion context) */
  targetModel: string;
  /** Optional callback invoked for each raw SSE chunk string written to the client */
  onChunk?: (chunk: string) => void;
}

/**
 * Stream a custom provider response to the client, handling format differences.
 *
 * Behavior:
 * - If providerFormat === clientFormat: passthrough (pipe raw bytes directly)
 * - If formats differ: parse each SSE chunk and convert via convertStreamChunk()
 *
 * This function reads the response body as a stream and writes converted SSE
 * chunks to the ServerResponse without buffering the entire response.
 *
 * @returns An async generator yielding SSE chunk strings for the client.
 */
export async function* streamCustomProviderResponse(
  options: CustomProviderStreamOptions
): AsyncGenerator<string, void, unknown> {
  const { response, providerFormat, clientFormat, targetModel, onChunk } = options;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Custom provider response has no readable body');
  }

  const decoder = new TextDecoder();
  const needsConversion = providerFormat !== clientFormat;

  if (!needsConversion) {
    // ─── Passthrough: pipe raw bytes directly ─────────────────────────────
    // Both OpenAI (`data: {...}\n\n`) and Anthropic (`event: ...\ndata: {...}\n\n`)
    // are forwarded as-is since client and provider share the same format.
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        onChunk?.(text);
        yield text;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }

  // ─── Cross-format conversion: parse SSE events and convert each chunk ──
  const conversionContext: ConversionContext = {
    sourceFormat: clientFormat,
    targetFormat: providerFormat,
    targetModel,
    stream: true,
  };
  const state: StreamConversionState = createStreamConversionState();

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events from the buffer.
      // SSE events are delimited by double newlines (\n\n).
      // We split on \n\n to extract complete events.
      const events = buffer.split('\n\n');
      // The last element may be an incomplete event; keep it in the buffer
      buffer = events.pop() ?? '';

      for (const rawEvent of events) {
        const trimmed = rawEvent.trim();
        if (!trimmed) continue;

        // Reconstruct the full SSE chunk with the trailing \n\n delimiter
        const fullChunk = trimmed + '\n\n';

        // Convert the chunk using the format converter
        const converted = convertStreamChunk(fullChunk, conversionContext, state);

        if (converted !== null) {
          onChunk?.(converted);
          yield converted;
        }
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      const fullChunk = buffer.trim() + '\n\n';
      const converted = convertStreamChunk(fullChunk, conversionContext, state);
      if (converted !== null) {
        onChunk?.(converted);
        yield converted;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Pipe a custom provider streaming response directly to a ServerResponse.
 *
 * This is a convenience function that wraps `streamCustomProviderResponse`
 * and writes each chunk to the HTTP response. It sets appropriate SSE headers
 * and handles the full lifecycle.
 *
 * @param res - The Node.js ServerResponse to write to
 * @param options - Streaming options (response, formats, model)
 * @param extraHeaders - Additional headers to include in the response (e.g., relay metadata)
 * @returns Object with streaming metadata (chunks written, success status, tokens, response text)
 */
export interface CustomProviderStreamResult {
  success: boolean;
  chunksWritten: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  responseText: string;
}

export async function pipeCustomProviderStream(
  res: ServerResponse,
  options: CustomProviderStreamOptions,
  extraHeaders?: Record<string, string>
): Promise<CustomProviderStreamResult> {
  // Write SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    ...extraHeaders,
  });

  let chunksWritten = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let responseText = '';
  let sseBuffer = '';

  // Wrap onChunk to also extract tokens and text from SSE events
  const originalOnChunk = options.onChunk;
  options.onChunk = (chunk: string) => {
    originalOnChunk?.(chunk);

    // Buffer chunks and parse complete SSE events (delimited by \n\n)
    sseBuffer += chunk;
    const events = sseBuffer.split('\n\n');
    // Keep the last incomplete fragment in the buffer
    sseBuffer = events.pop() ?? '';

    for (const event of events) {
      const lines = event.split('\n');
      for (const line of lines) {
        // Handle both "data: {...}" and "data:{...}" formats
        let jsonStr: string | null = null;
        if (line.startsWith('data: ')) {
          jsonStr = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          jsonStr = line.slice(5).trim();
        }
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);

          // Anthropic format: content_block_delta with text or thinking
          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'text_delta' && parsed.delta?.text) {
              responseText += parsed.delta.text;
            } else if (parsed.delta?.text) {
              responseText += parsed.delta.text;
            }
            // Also capture thinking content for response preview
            if (parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
              responseText += parsed.delta.thinking;
            }
          }

          // Anthropic format: message_delta with usage at end of stream
          if (parsed.type === 'message_delta' && parsed.usage) {
            outputTokens = parsed.usage.output_tokens ?? outputTokens;
          }

          // Anthropic format: message_start with usage (input tokens)
          if (parsed.type === 'message_start' && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens ?? 0;
            cacheCreationTokens = parsed.message.usage.cache_creation_input_tokens;
            cacheReadTokens = parsed.message.usage.cache_read_input_tokens;
            console.log(`[RelayPlane][DEBUG-TOKENS] message_start found: input_tokens=${inputTokens}`);
          }

          // OpenAI format: choices[0].delta.content
          if (parsed.choices?.[0]?.delta?.content) {
            responseText += parsed.choices[0].delta.content;
          }

          // OpenAI format: usage in final chunk
          if (parsed.usage && parsed.usage.prompt_tokens) {
            inputTokens = parsed.usage.prompt_tokens ?? 0;
            outputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }
  };

  try {
    for await (const chunk of streamCustomProviderResponse(options)) {
      const writeOk = res.write(chunk);
      chunksWritten++;

      // If write returns false, the buffer is full; wait for drain
      if (!writeOk) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }

    // Process any remaining data in the SSE buffer (e.g., final usage event)
    if (sseBuffer.trim()) {
      const finalLines = sseBuffer.split('\n');
      for (const line of finalLines) {
        let jsonStr: string | null = null;
        if (line.startsWith('data: ')) {
          jsonStr = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          jsonStr = line.slice(5).trim();
        }
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.type === 'text_delta' && parsed.delta?.text) {
              responseText += parsed.delta.text;
            } else if (parsed.delta?.text) {
              responseText += parsed.delta.text;
            }
            if (parsed.delta?.type === 'thinking_delta' && parsed.delta?.thinking) {
              responseText += parsed.delta.thinking;
            }
          }
          if (parsed.type === 'message_delta' && parsed.usage) {
            outputTokens = parsed.usage.output_tokens ?? outputTokens;
          }
          if (parsed.type === 'message_start' && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens ?? 0;
            cacheCreationTokens = parsed.message.usage.cache_creation_input_tokens;
            cacheReadTokens = parsed.message.usage.cache_read_input_tokens;
          }
          if (parsed.choices?.[0]?.delta?.content) {
            responseText += parsed.choices[0].delta.content;
          }
          if (parsed.usage && parsed.usage.prompt_tokens) {
            inputTokens = parsed.usage.prompt_tokens ?? 0;
            outputTokens = parsed.usage.completion_tokens ?? 0;
          }
        } catch { /* skip */ }
      }
    }

    res.end();
    return { success: true, chunksWritten, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, responseText };
  } catch (error) {
    // If the response hasn't been ended yet, try to end it gracefully
    if (!res.writableEnded) {
      res.end();
    }
    return { success: false, chunksWritten, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, responseText };
  }
}
