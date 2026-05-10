import { describe, it, expect } from 'vitest';
import { streamCustomProviderResponse, type CustomProviderStreamOptions } from '../src/streaming.js';

/**
 * Unit tests for streaming with custom providers.
 * Validates Requirements 6.1, 6.2, 6.3
 */

/** Helper: create a mock Response with a ReadableStream body from string chunks */
function createMockResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

/** Helper: collect all yielded strings from the async generator */
async function collectChunks(gen: AsyncGenerator<string, void, unknown>): Promise<string[]> {
  const results: string[] = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
}

describe('streamCustomProviderResponse', () => {
  describe('OpenAI passthrough (Req 6.1)', () => {
    it('passes through OpenAI SSE chunks unchanged when providerFormat and clientFormat are both openai', async () => {
      const openaiChunks = [
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(openaiChunks);
      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'openai',
        clientFormat: 'openai',
        targetModel: 'gpt-4',
      };

      const result = await collectChunks(streamCustomProviderResponse(options));

      // In passthrough mode, the raw bytes are forwarded as-is.
      // Since all chunks are enqueued individually, they come through as decoded text.
      const joined = result.join('');
      const expectedJoined = openaiChunks.join('');
      expect(joined).toBe(expectedJoined);
    });

    it('invokes onChunk callback for each passthrough chunk', async () => {
      const openaiChunks = [
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const response = createMockResponse(openaiChunks);
      const receivedChunks: string[] = [];
      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'openai',
        clientFormat: 'openai',
        targetModel: 'gpt-4',
        onChunk: (chunk) => receivedChunks.push(chunk),
      };

      await collectChunks(streamCustomProviderResponse(options));

      // onChunk should have been called for each decoded text segment
      const joinedCallbacks = receivedChunks.join('');
      const expectedJoined = openaiChunks.join('');
      expect(joinedCallbacks).toBe(expectedJoined);
    });
  });

  describe('Anthropic passthrough (Req 6.2)', () => {
    it('passes through Anthropic SSE chunks unchanged when providerFormat and clientFormat are both anthropic', async () => {
      const anthropicChunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-3","content":[],"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ];

      const response = createMockResponse(anthropicChunks);
      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'anthropic',
        clientFormat: 'anthropic',
        targetModel: 'claude-3-sonnet',
      };

      const result = await collectChunks(streamCustomProviderResponse(options));

      // Passthrough: raw bytes forwarded unchanged
      const joined = result.join('');
      const expectedJoined = anthropicChunks.join('');
      expect(joined).toBe(expectedJoined);
    });

    it('invokes onChunk callback for each Anthropic passthrough chunk', async () => {
      const anthropicChunks = [
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Test"}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ];

      const response = createMockResponse(anthropicChunks);
      const receivedChunks: string[] = [];
      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'anthropic',
        clientFormat: 'anthropic',
        targetModel: 'claude-3-sonnet',
        onChunk: (chunk) => receivedChunks.push(chunk),
      };

      await collectChunks(streamCustomProviderResponse(options));

      const joinedCallbacks = receivedChunks.join('');
      const expectedJoined = anthropicChunks.join('');
      expect(joinedCallbacks).toBe(expectedJoined);
    });
  });

  describe('Cross-format conversion: Anthropic→OpenAI (Req 6.3)', () => {
    it('converts Anthropic SSE chunks to OpenAI format when providerFormat=anthropic and clientFormat=openai', async () => {
      // Provider returns Anthropic format, client expects OpenAI format.
      // The streamCustomProviderResponse uses ConversionContext where:
      //   sourceFormat = clientFormat (what the client expects)
      //   targetFormat = providerFormat (what the provider returns)
      // So convertStreamChunk converts from providerFormat → clientFormat.
      const anthropicChunks = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_abc","type":"message","role":"assistant","model":"claude-3","content":[],"usage":{"input_tokens":15,"output_tokens":0}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ];

      const response = createMockResponse(anthropicChunks);
      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'anthropic',
        clientFormat: 'openai',
        targetModel: 'claude-3-sonnet',
      };

      const result = await collectChunks(streamCustomProviderResponse(options));

      // Each converted chunk should be in OpenAI SSE format: "data: {...}\n\n"
      for (const chunk of result) {
        expect(chunk).toMatch(/^data: /);
        expect(chunk).toMatch(/\n\n$/);
      }

      // The message_start event should produce a chunk with role: "assistant"
      const firstChunk = result[0];
      expect(firstChunk).toContain('"role":"assistant"');
      expect(firstChunk).toContain('"object":"chat.completion.chunk"');

      // The content_block_delta should produce a chunk with content: "Hello"
      const contentChunk = result[1];
      expect(contentChunk).toContain('"content":"Hello"');
      expect(contentChunk).toContain('"object":"chat.completion.chunk"');

      // The message_delta with stop_reason should produce a finish_reason chunk
      const finishChunk = result[2];
      expect(finishChunk).toContain('"finish_reason"');
      expect(finishChunk).toContain('"stop"');

      // The message_stop event should produce data: [DONE]
      const doneChunk = result[3];
      expect(doneChunk).toBe('data: [DONE]\n\n');
    });

    it('invokes onChunk callback for each converted chunk', async () => {
      const anthropicChunks = [
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ];

      const response = createMockResponse(anthropicChunks);
      const receivedChunks: string[] = [];
      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'anthropic',
        clientFormat: 'openai',
        targetModel: 'claude-3-sonnet',
        onChunk: (chunk) => receivedChunks.push(chunk),
      };

      const result = await collectChunks(streamCustomProviderResponse(options));

      // onChunk should receive the same chunks as the generator yields
      expect(receivedChunks).toEqual(result);
    });

    it('skips events that produce no meaningful conversion output', async () => {
      // content_block_start with type "text" doesn't produce output in the converter
      const anthropicChunks = [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Data"}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ];

      const response = createMockResponse(anthropicChunks);
      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'anthropic',
        clientFormat: 'openai',
        targetModel: 'claude-3-sonnet',
      };

      const result = await collectChunks(streamCustomProviderResponse(options));

      // content_block_start for text type returns null from converter, so it's skipped.
      // We should get the content delta and the DONE marker.
      expect(result.length).toBeGreaterThanOrEqual(2);

      // Verify the content chunk is present
      const contentChunk = result.find((c) => c.includes('"content":"Data"'));
      expect(contentChunk).toBeDefined();

      // Verify DONE marker is present
      const doneChunk = result.find((c) => c.includes('[DONE]'));
      expect(doneChunk).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('throws when response has no readable body', async () => {
      // Create a Response with null body
      const response = new Response(null);

      const options: CustomProviderStreamOptions = {
        response,
        providerFormat: 'openai',
        clientFormat: 'openai',
        targetModel: 'gpt-4',
      };

      const gen = streamCustomProviderResponse(options);
      await expect(gen.next()).rejects.toThrow('no readable body');
    });
  });
});
