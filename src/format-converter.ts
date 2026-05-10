/**
 * Format Converter
 *
 * Bidirectional conversion between OpenAI and Anthropic request/response formats.
 * Extracted from standalone-proxy.ts into a reusable module for use with
 * custom providers that may have different API compatibility types.
 *
 * @packageDocumentation
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApiFormat = 'openai' | 'anthropic';

export interface ConversionContext {
  sourceFormat: ApiFormat;
  targetFormat: ApiFormat;
  targetModel: string;
  stream: boolean;
}

export interface StreamConversionState {
  /** Tracks current tool block index for streaming tool calls */
  currentToolIndex: number;
  /** Map of tool blocks being streamed (index → tool info) */
  tools: Map<number, { id: string; name: string; arguments: string }>;
  /** Message ID for the stream session */
  messageId: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect the format of an incoming request based on the endpoint path.
 *
 * - `/v1/chat/completions` → openai
 * - `/v1/messages` → anthropic
 * - Default → openai (most common format)
 */
export function detectRequestFormat(path: string): ApiFormat {
  const normalized = path.toLowerCase().replace(/\/+$/, '');
  if (normalized.endsWith('/v1/messages') || normalized === '/v1/messages') {
    return 'anthropic';
  }
  // Default to openai for /v1/chat/completions and any other path
  return 'openai';
}

/**
 * Convert request body between formats.
 * Returns body unchanged when sourceFormat === targetFormat (passthrough).
 */
export function convertRequestBody(
  body: Record<string, unknown>,
  context: ConversionContext
): Record<string, unknown> {
  // Passthrough: no conversion needed
  if (context.sourceFormat === context.targetFormat) {
    return body;
  }

  if (context.sourceFormat === 'openai' && context.targetFormat === 'anthropic') {
    return convertOpenAIRequestToAnthropic(body, context);
  }

  if (context.sourceFormat === 'anthropic' && context.targetFormat === 'openai') {
    return convertAnthropicRequestToOpenAI(body, context);
  }

  // Fallback passthrough (should not happen with valid formats)
  return body;
}

/**
 * Convert non-streaming response body between formats.
 * Returns body unchanged when sourceFormat === targetFormat (passthrough).
 *
 * Note: For responses, the conversion direction is reversed from requests.
 * If we sent a request to an Anthropic provider, the response comes back in
 * Anthropic format and needs to be converted to the source (client) format.
 */
export function convertResponseBody(
  body: Record<string, unknown>,
  context: ConversionContext
): Record<string, unknown> {
  // Passthrough: no conversion needed
  if (context.sourceFormat === context.targetFormat) {
    return body;
  }

  // Response comes back in targetFormat, needs to be converted to sourceFormat
  if (context.targetFormat === 'anthropic' && context.sourceFormat === 'openai') {
    // Response is in Anthropic format, client expects OpenAI format
    return convertAnthropicResponseToOpenAI(body);
  }

  if (context.targetFormat === 'openai' && context.sourceFormat === 'anthropic') {
    // Response is in OpenAI format, client expects Anthropic format
    return convertOpenAIResponseToAnthropic(body);
  }

  return body;
}

/**
 * Convert a single SSE chunk between formats.
 * Returns null if the chunk should be skipped (no meaningful conversion).
 * Returns the converted chunk string if conversion produced output.
 *
 * For streaming, the response chunks come in targetFormat and need to be
 * converted to sourceFormat for the client.
 */
export function convertStreamChunk(
  chunk: string,
  context: ConversionContext,
  state: StreamConversionState
): string | null {
  // Passthrough: no conversion needed
  if (context.sourceFormat === context.targetFormat) {
    return chunk;
  }

  if (context.targetFormat === 'anthropic' && context.sourceFormat === 'openai') {
    // Anthropic SSE chunk → OpenAI SSE chunk
    return convertAnthropicChunkToOpenAI(chunk, state, context.targetModel);
  }

  if (context.targetFormat === 'openai' && context.sourceFormat === 'anthropic') {
    // OpenAI SSE chunk → Anthropic SSE chunk
    return convertOpenAIChunkToAnthropic(chunk, state, context.targetModel);
  }

  return chunk;
}

/**
 * Create a fresh StreamConversionState for a new streaming session.
 */
export function createStreamConversionState(): StreamConversionState {
  return {
    currentToolIndex: 0,
    tools: new Map(),
    messageId: `chatcmpl-${Date.now()}`,
  };
}

// ─── OpenAI → Anthropic Request Conversion ───────────────────────────────────

/**
 * Convert an OpenAI chat completion request body to Anthropic messages format.
 *
 * Key transformations:
 * - Extract system messages to top-level `system` field
 * - Convert tool messages to user messages with tool_result content
 * - Convert assistant messages with tool_calls to tool_use content blocks
 * - Map max_tokens (default 4096 if not specified)
 * - Convert tools format (OpenAI function → Anthropic input_schema)
 * - Convert tool_choice format
 */
function convertOpenAIRequestToAnthropic(
  body: Record<string, unknown>,
  context: ConversionContext
): Record<string, unknown> {
  const messages = Array.isArray(body['messages'])
    ? (body['messages'] as Array<Record<string, unknown>>)
    : [];

  // Extract system message
  const systemMessages = messages.filter((m) => m['role'] === 'system');
  const systemContent = systemMessages
    .map((m) => (typeof m['content'] === 'string' ? m['content'] : ''))
    .filter(Boolean)
    .join('\n');

  // Convert non-system messages to Anthropic format
  const anthropicMessages = convertMessagesToAnthropicFormat(messages);

  const result: Record<string, unknown> = {
    model: context.targetModel,
    messages: anthropicMessages,
    max_tokens: (body['max_tokens'] as number) ?? 4096,
    stream: context.stream,
  };

  if (systemContent) {
    result['system'] = systemContent;
  }

  if (body['temperature'] !== undefined) {
    result['temperature'] = body['temperature'];
  }

  if (body['top_p'] !== undefined) {
    result['top_p'] = body['top_p'];
  }

  // Convert tools
  if (body['tools'] && Array.isArray(body['tools'])) {
    result['tools'] = convertToolsOpenAIToAnthropic(body['tools'] as unknown[]);
  }

  // Convert tool_choice
  if (body['tool_choice'] !== undefined) {
    result['tool_choice'] = convertToolChoiceOpenAIToAnthropic(body['tool_choice']);
  }

  return result;
}

/**
 * Convert OpenAI messages array to Anthropic messages format.
 * Skips system messages (handled separately as top-level field).
 */
function convertMessagesToAnthropicFormat(
  messages: Array<Record<string, unknown>>
): unknown[] {
  const result: unknown[] = [];

  for (const msg of messages) {
    const role = msg['role'] as string;
    const content = msg['content'];

    // Skip system messages (handled separately)
    if (role === 'system') continue;

    // Tool result message → Anthropic user message with tool_result content
    if (role === 'tool') {
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg['tool_call_id'],
            content: typeof content === 'string' ? content : JSON.stringify(content),
          },
        ],
      });
      continue;
    }

    // Assistant message with tool_calls → Anthropic assistant with tool_use content
    const toolCalls = msg['tool_calls'] as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }> | undefined;

    if (role === 'assistant' && toolCalls && toolCalls.length > 0) {
      const contentBlocks: unknown[] = [];

      // Add text content if present
      if (content && typeof content === 'string') {
        contentBlocks.push({ type: 'text', text: content });
      }

      // Add tool_use blocks
      for (const tc of toolCalls) {
        let parsedInput: unknown = {};
        try {
          parsedInput = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedInput = {};
        }
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parsedInput,
        });
      }

      result.push({ role: 'assistant', content: contentBlocks });
      continue;
    }

    // Regular user/assistant message
    result.push({
      role: role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }

  return result;
}

/**
 * Convert OpenAI tools format to Anthropic format.
 * OpenAI: { type: "function", function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema }
 */
function convertToolsOpenAIToAnthropic(tools: unknown[]): unknown[] {
  return tools.map((tool: unknown) => {
    const t = tool as {
      type?: string;
      function?: { name?: string; description?: string; parameters?: unknown };
    };
    if (t.type === 'function' && t.function) {
      return {
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      };
    }
    return tool;
  });
}

/**
 * Convert OpenAI tool_choice to Anthropic format.
 */
function convertToolChoiceOpenAIToAnthropic(toolChoice: unknown): unknown {
  if (toolChoice === 'auto') return { type: 'auto' };
  if (toolChoice === 'none') return { type: 'none' };
  if (toolChoice === 'required') return { type: 'any' };

  const tc = toolChoice as { type?: string; function?: { name?: string } };
  if (tc.type === 'function' && tc.function?.name) {
    return { type: 'tool', name: tc.function.name };
  }

  return toolChoice;
}

// ─── Anthropic → OpenAI Request Conversion ───────────────────────────────────

/**
 * Convert an Anthropic messages request body to OpenAI chat completion format.
 *
 * Key transformations:
 * - Convert top-level `system` field to a system-role message in messages array
 * - Handle structured system content (array of {type, text} blocks)
 * - Map messages to OpenAI format
 * - Preserve max_tokens, temperature
 */
function convertAnthropicRequestToOpenAI(
  body: Record<string, unknown>,
  context: ConversionContext
): Record<string, unknown> {
  const rawMessages = Array.isArray(body['messages'])
    ? (body['messages'] as Array<Record<string, unknown>>)
    : [];

  const messages: Array<Record<string, unknown>> = [];

  // Convert top-level system to a system-role message
  if (body['system'] && typeof body['system'] === 'string') {
    messages.push({ role: 'system', content: body['system'] });
  } else if (Array.isArray(body['system'])) {
    // Anthropic structured system (array of {type, text}) — flatten to text
    const systemText = (body['system'] as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  // Convert Anthropic messages to OpenAI format
  for (const msg of rawMessages) {
    const role = msg['role'] as string;
    const content = msg['content'];

    if (typeof content === 'string') {
      messages.push({ role, content });
    } else if (Array.isArray(content)) {
      // Anthropic content blocks — extract text parts
      const textParts = (content as Array<{ type?: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '');
      messages.push({ role, content: textParts.join('') });
    } else {
      messages.push({ role, content: String(content ?? '') });
    }
  }

  const result: Record<string, unknown> = {
    model: context.targetModel,
    messages,
    stream: context.stream,
  };

  if (body['max_tokens'] !== undefined) {
    result['max_tokens'] = body['max_tokens'];
  }

  if (body['temperature'] !== undefined) {
    result['temperature'] = body['temperature'];
  }

  if (body['top_p'] !== undefined) {
    result['top_p'] = body['top_p'];
  }

  return result;
}

// ─── Anthropic → OpenAI Response Conversion ──────────────────────────────────

/**
 * Convert an Anthropic response body to OpenAI chat completion format.
 * Handles both text and tool_use content blocks.
 */
function convertAnthropicResponseToOpenAI(
  body: Record<string, unknown>
): Record<string, unknown> {
  const content = body['content'] as Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }> | undefined;

  const textBlocks = content?.filter((c) => c.type === 'text') ?? [];
  const toolBlocks = content?.filter((c) => c.type === 'tool_use') ?? [];

  const textContent = textBlocks.map((c) => c.text ?? '').join('');

  // Build message object
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: textContent || null,
  };

  // Convert tool_use blocks to OpenAI tool_calls format
  if (toolBlocks.length > 0) {
    message['tool_calls'] = toolBlocks.map((block) => ({
      id: block.id || `call_${Date.now()}`,
      type: 'function',
      function: {
        name: block.name,
        arguments: typeof block.input === 'string'
          ? block.input
          : JSON.stringify(block.input ?? {}),
      },
    }));
  }

  // Determine finish_reason from stop_reason
  let finishReason = 'stop';
  const stopReason = body['stop_reason'] as string | undefined;
  if (stopReason === 'tool_use') {
    finishReason = 'tool_calls';
  } else if (stopReason === 'end_turn') {
    finishReason = 'stop';
  } else if (stopReason) {
    finishReason = stopReason;
  }

  const usage = body['usage'] as { input_tokens?: number; output_tokens?: number } | undefined;

  return {
    id: (body['id'] as string) || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body['model'] as string,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: usage?.input_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? 0,
      total_tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    },
  };
}

// ─── OpenAI → Anthropic Response Conversion ──────────────────────────────────

/**
 * Convert an OpenAI chat completion response to Anthropic messages format.
 */
function convertOpenAIResponseToAnthropic(
  body: Record<string, unknown>
): Record<string, unknown> {
  const choices = body['choices'] as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];
  const message = firstChoice?.['message'] as Record<string, unknown> | undefined;

  const contentBlocks: Array<Record<string, unknown>> = [];

  // Convert text content
  const textContent = message?.['content'] as string | null | undefined;
  if (textContent) {
    contentBlocks.push({ type: 'text', text: textContent });
  }

  // Convert tool_calls to tool_use blocks
  const toolCalls = message?.['tool_calls'] as Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }> | undefined;

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      let parsedInput: unknown = {};
      try {
        parsedInput = JSON.parse(tc.function.arguments || '{}');
      } catch {
        parsedInput = {};
      }
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      });
    }
  }

  // Map finish_reason to stop_reason
  let stopReason = 'end_turn';
  const finishReason = firstChoice?.['finish_reason'] as string | undefined;
  if (finishReason === 'tool_calls') {
    stopReason = 'tool_use';
  } else if (finishReason === 'stop') {
    stopReason = 'end_turn';
  } else if (finishReason === 'length') {
    stopReason = 'max_tokens';
  } else if (finishReason) {
    stopReason = finishReason;
  }

  const usage = body['usage'] as {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | undefined;

  return {
    id: (body['id'] as string) || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: body['model'] as string,
    content: contentBlocks,
    stop_reason: stopReason,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    },
  };
}

// ─── Streaming Chunk Conversion ──────────────────────────────────────────────

/**
 * Convert an Anthropic SSE chunk to OpenAI SSE format.
 * Parses the event type and data from the raw SSE line(s).
 */
function convertAnthropicChunkToOpenAI(
  chunk: string,
  state: StreamConversionState,
  model: string
): string | null {
  // Parse SSE event from chunk
  const lines = chunk.split('\n');
  let eventType = '';
  let eventData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      eventData = line.slice(6);
    }
  }

  if (!eventType || !eventData) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(eventData) as Record<string, unknown>;
  } catch {
    return null;
  }

  return convertAnthropicStreamEventToOpenAI(eventType, parsed, state, model);
}

/**
 * Convert a single Anthropic stream event to OpenAI chunk format.
 */
function convertAnthropicStreamEventToOpenAI(
  eventType: string,
  eventData: Record<string, unknown>,
  state: StreamConversionState,
  model: string
): string | null {
  const choice = {
    index: 0,
    delta: {} as Record<string, unknown>,
    finish_reason: null as string | null,
  };
  const baseChunk: Record<string, unknown> = {
    id: state.messageId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
  };

  switch (eventType) {
    case 'message_start': {
      const msg = eventData['message'] as Record<string, unknown> | undefined;
      if (msg?.['id']) {
        state.messageId = msg['id'] as string;
        baseChunk['id'] = state.messageId;
      }
      choice.delta = { role: 'assistant', content: '' };
      const msgUsage = msg?.['usage'] as Record<string, unknown> | undefined;
      if (msgUsage) {
        baseChunk['usage'] = {
          prompt_tokens: msgUsage['input_tokens'] ?? 0,
        };
      }
      return `data: ${JSON.stringify(baseChunk)}\n\n`;
    }

    case 'content_block_start': {
      const contentBlock = eventData['content_block'] as Record<string, unknown> | undefined;
      const blockIndex = eventData['index'] as number | undefined;

      if (contentBlock?.['type'] === 'tool_use') {
        const toolId = contentBlock['id'] as string;
        const toolName = contentBlock['name'] as string;
        const idx = blockIndex ?? state.currentToolIndex;

        state.tools.set(idx, { id: toolId, name: toolName, arguments: '' });
        state.currentToolIndex = idx;

        choice.delta = {
          tool_calls: [{
            index: idx,
            id: toolId,
            type: 'function',
            function: { name: toolName, arguments: '' },
          }],
        };
        return `data: ${JSON.stringify(baseChunk)}\n\n`;
      }
      return null;
    }

    case 'content_block_delta': {
      const delta = eventData['delta'] as Record<string, unknown> | undefined;
      const blockIndex = eventData['index'] as number | undefined;

      if (delta?.['type'] === 'text_delta') {
        choice.delta = { content: delta['text'] as string };
        return `data: ${JSON.stringify(baseChunk)}\n\n`;
      }

      if (delta?.['type'] === 'input_json_delta') {
        const partialJson = (delta['partial_json'] as string) || '';
        const idx = blockIndex ?? state.currentToolIndex;
        const tool = state.tools.get(idx);
        if (tool) {
          tool.arguments += partialJson;
        }

        choice.delta = {
          tool_calls: [{
            index: idx,
            function: { arguments: partialJson },
          }],
        };
        return `data: ${JSON.stringify(baseChunk)}\n\n`;
      }
      return null;
    }

    case 'message_delta': {
      const delta = eventData['delta'] as Record<string, unknown> | undefined;
      const stopReason = delta?.['stop_reason'] as string | undefined;
      const usage = eventData['usage'] as Record<string, unknown> | undefined;

      if (stopReason === 'tool_use') {
        choice.finish_reason = 'tool_calls';
      } else if (stopReason === 'end_turn') {
        choice.finish_reason = 'stop';
      } else {
        choice.finish_reason = stopReason || 'stop';
      }
      choice.delta = {};

      if (usage) {
        baseChunk['usage'] = {
          completion_tokens: usage['output_tokens'] ?? 0,
        };
      }
      return `data: ${JSON.stringify(baseChunk)}\n\n`;
    }

    case 'message_stop': {
      return 'data: [DONE]\n\n';
    }

    default:
      return null;
  }
}

/**
 * Convert an OpenAI SSE chunk to Anthropic SSE format.
 */
function convertOpenAIChunkToAnthropic(
  chunk: string,
  state: StreamConversionState,
  model: string
): string | null {
  // Parse OpenAI SSE format: "data: {...}\n\n" or "data: [DONE]\n\n"
  const trimmed = chunk.trim();

  if (!trimmed.startsWith('data: ')) {
    return null;
  }

  const dataStr = trimmed.slice(6);

  if (dataStr === '[DONE]') {
    return 'event: message_stop\ndata: {}\n\n';
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(dataStr) as Record<string, unknown>;
  } catch {
    return null;
  }

  const choices = parsed['choices'] as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];
  if (!firstChoice) return null;

  const delta = firstChoice['delta'] as Record<string, unknown> | undefined;
  const finishReason = firstChoice['finish_reason'] as string | null | undefined;

  // First chunk with role
  if (delta?.['role'] === 'assistant') {
    const msgEvent = {
      type: 'message_start',
      message: {
        id: (parsed['id'] as string) || state.messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
    state.messageId = (parsed['id'] as string) || state.messageId;
    return `event: message_start\ndata: ${JSON.stringify(msgEvent)}\n\n`;
  }

  // Text content delta
  if (delta?.['content'] && typeof delta['content'] === 'string') {
    const contentDelta = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: delta['content'] },
    };
    return `event: content_block_delta\ndata: ${JSON.stringify(contentDelta)}\n\n`;
  }

  // Finish reason
  if (finishReason) {
    let stopReason = 'end_turn';
    if (finishReason === 'tool_calls') {
      stopReason = 'tool_use';
    } else if (finishReason === 'length') {
      stopReason = 'max_tokens';
    } else if (finishReason === 'stop') {
      stopReason = 'end_turn';
    }

    const messageDelta = {
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { output_tokens: 0 },
    };
    return `event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`;
  }

  return null;
}
