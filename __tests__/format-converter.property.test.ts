import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  convertRequestBody,
  detectRequestFormat,
  type ApiFormat,
  type ConversionContext,
} from '../src/format-converter.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generates a valid model name string.
 */
const modelNameArb = fc.stringMatching(/^[a-z][a-z0-9.-]{1,30}$/);

/**
 * Generates a random non-empty string for message content.
 */
const messageContentArb = fc.string({ minLength: 1, maxLength: 200 });

/**
 * Generates a valid OpenAI message with role system, user, or assistant.
 */
const openAIMessageArb = fc.oneof(
  fc.record({
    role: fc.constant('system' as const),
    content: messageContentArb,
  }),
  fc.record({
    role: fc.constant('user' as const),
    content: messageContentArb,
  }),
  fc.record({
    role: fc.constant('assistant' as const),
    content: messageContentArb,
  })
);

/**
 * Generates a valid OpenAI chat completion request body.
 * Contains messages array with at least one user message,
 * a model field, and optional max_tokens.
 */
const openAIRequestBodyArb = fc
  .record({
    model: modelNameArb,
    messages: fc
      .tuple(
        // Optional system messages (0-2)
        fc.array(
          fc.record({ role: fc.constant('system' as const), content: messageContentArb }),
          { minLength: 0, maxLength: 2 }
        ),
        // At least one user message
        fc.array(
          fc.oneof(
            fc.record({ role: fc.constant('user' as const), content: messageContentArb }),
            fc.record({ role: fc.constant('assistant' as const), content: messageContentArb })
          ),
          { minLength: 1, maxLength: 5 }
        )
      )
      .map(([systemMsgs, otherMsgs]) => [...systemMsgs, ...otherMsgs]),
    max_tokens: fc.option(fc.integer({ min: 1, max: 8192 }), { nil: undefined }),
    temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
  })
  .map((body) => {
    const result: Record<string, unknown> = {
      model: body.model,
      messages: body.messages,
    };
    if (body.max_tokens !== undefined) {
      result['max_tokens'] = body.max_tokens;
    }
    if (body.temperature !== undefined) {
      result['temperature'] = body.temperature;
    }
    return result;
  });

/**
 * Generates a valid Anthropic messages request body.
 * Contains messages array with user/assistant roles,
 * optional top-level system field, model, and max_tokens.
 */
const anthropicRequestBodyArb = fc
  .record({
    model: modelNameArb,
    messages: fc.array(
      fc.oneof(
        fc.record({ role: fc.constant('user' as const), content: messageContentArb }),
        fc.record({ role: fc.constant('assistant' as const), content: messageContentArb })
      ),
      { minLength: 1, maxLength: 5 }
    ),
    system: fc.option(messageContentArb, { nil: undefined }),
    max_tokens: fc.integer({ min: 1, max: 8192 }),
    temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
  })
  .map((body) => {
    const result: Record<string, unknown> = {
      model: body.model,
      messages: body.messages,
      max_tokens: body.max_tokens,
    };
    if (body.system !== undefined) {
      result['system'] = body.system;
    }
    if (body.temperature !== undefined) {
      result['temperature'] = body.temperature;
    }
    return result;
  });

/**
 * Generates a random request body (arbitrary JSON-like object)
 * for passthrough testing.
 */
const arbitraryRequestBodyArb = fc
  .record({
    model: modelNameArb,
    messages: fc.array(
      fc.record({
        role: fc.constantFrom('system', 'user', 'assistant'),
        content: messageContentArb,
      }),
      { minLength: 1, maxLength: 5 }
    ),
    max_tokens: fc.option(fc.integer({ min: 1, max: 8192 }), { nil: undefined }),
    stream: fc.boolean(),
  })
  .map((body) => {
    const result: Record<string, unknown> = {
      model: body.model,
      messages: body.messages,
      stream: body.stream,
    };
    if (body.max_tokens !== undefined) {
      result['max_tokens'] = body.max_tokens;
    }
    return result;
  });

/**
 * Generates an ApiFormat value.
 */
const apiFormatArb = fc.constantFrom('openai' as ApiFormat, 'anthropic' as ApiFormat);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 9: Format passthrough when compatible', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * For any valid request body in format F targeting a provider with
   * apiCompatibility equal to F, the forwarded request body is structurally
   * identical to the input body (no format conversion applied).
   */
  it('no conversion applied when sourceFormat === targetFormat (same reference returned)', () => {
    fc.assert(
      fc.property(
        arbitraryRequestBodyArb,
        apiFormatArb,
        modelNameArb,
        fc.boolean(),
        (body, format, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: format,
            targetFormat: format,
            targetModel,
            stream,
          };

          const result = convertRequestBody(body, context);

          // When source === target, the body should be returned as-is (reference equality)
          expect(result).toBe(body);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('passthrough preserves all fields in the body unchanged', () => {
    fc.assert(
      fc.property(
        arbitraryRequestBodyArb,
        apiFormatArb,
        modelNameArb,
        fc.boolean(),
        (body, format, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: format,
            targetFormat: format,
            targetModel,
            stream,
          };

          const result = convertRequestBody(body, context);

          // Deep equality check — all fields preserved
          expect(result).toEqual(body);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: configurable-providers, Property 10: OpenAI-to-Anthropic conversion produces valid structure', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any valid OpenAI chat completion request body, converting it to
   * Anthropic format produces an object containing: a `messages` array
   * (with no system-role entries), a `model` field, a `max_tokens` field,
   * and if the original had a system message, a top-level `system` field.
   */
  it('converted body has messages array with no system-role entries', () => {
    fc.assert(
      fc.property(
        openAIRequestBodyArb,
        modelNameArb,
        fc.boolean(),
        (body, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: 'openai',
            targetFormat: 'anthropic',
            targetModel,
            stream,
          };

          const result = convertRequestBody(body, context);

          // Must have messages array
          expect(result).toHaveProperty('messages');
          expect(Array.isArray(result['messages'])).toBe(true);

          // No system-role entries in messages
          const messages = result['messages'] as Array<Record<string, unknown>>;
          for (const msg of messages) {
            expect(msg['role']).not.toBe('system');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('converted body has model field and max_tokens field', () => {
    fc.assert(
      fc.property(
        openAIRequestBodyArb,
        modelNameArb,
        fc.boolean(),
        (body, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: 'openai',
            targetFormat: 'anthropic',
            targetModel,
            stream,
          };

          const result = convertRequestBody(body, context);

          // Must have model field
          expect(result).toHaveProperty('model');
          expect(typeof result['model']).toBe('string');

          // Must have max_tokens field (defaults to 4096 if not in original)
          expect(result).toHaveProperty('max_tokens');
          expect(typeof result['max_tokens']).toBe('number');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('if original had system message, converted body has top-level system field', () => {
    fc.assert(
      fc.property(
        openAIRequestBodyArb,
        modelNameArb,
        fc.boolean(),
        (body, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: 'openai',
            targetFormat: 'anthropic',
            targetModel,
            stream,
          };

          const messages = body['messages'] as Array<Record<string, unknown>>;
          const hasSystemMessage = messages.some(
            (m) => m['role'] === 'system' && typeof m['content'] === 'string' && (m['content'] as string).length > 0
          );

          const result = convertRequestBody(body, context);

          if (hasSystemMessage) {
            // Top-level system field should exist
            expect(result).toHaveProperty('system');
            expect(typeof result['system']).toBe('string');
            expect((result['system'] as string).length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: configurable-providers, Property 11: Anthropic-to-OpenAI conversion produces valid structure', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For any valid Anthropic messages request body, converting it to OpenAI
   * format produces an object containing: a `messages` array where system
   * content appears as a message with role:"system", and a `model` field.
   */
  it('converted body has messages array and model field', () => {
    fc.assert(
      fc.property(
        anthropicRequestBodyArb,
        modelNameArb,
        fc.boolean(),
        (body, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: 'anthropic',
            targetFormat: 'openai',
            targetModel,
            stream,
          };

          const result = convertRequestBody(body, context);

          // Must have messages array
          expect(result).toHaveProperty('messages');
          expect(Array.isArray(result['messages'])).toBe(true);

          // Must have model field
          expect(result).toHaveProperty('model');
          expect(typeof result['model']).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('if original had top-level system field, converted body has system as role:"system" message', () => {
    fc.assert(
      fc.property(
        anthropicRequestBodyArb,
        modelNameArb,
        fc.boolean(),
        (body, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: 'anthropic',
            targetFormat: 'openai',
            targetModel,
            stream,
          };

          const hasSystem = body['system'] !== undefined && typeof body['system'] === 'string' && (body['system'] as string).length > 0;

          const result = convertRequestBody(body, context);
          const messages = result['messages'] as Array<Record<string, unknown>>;

          if (hasSystem) {
            // There should be a message with role: "system" containing the system content
            const systemMessages = messages.filter((m) => m['role'] === 'system');
            expect(systemMessages.length).toBeGreaterThan(0);

            // The system message content should match the original system field
            const systemContent = systemMessages
              .map((m) => m['content'] as string)
              .join('\n');
            expect(systemContent).toBe(body['system'] as string);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('converted messages preserve user and assistant roles from original', () => {
    fc.assert(
      fc.property(
        anthropicRequestBodyArb,
        modelNameArb,
        fc.boolean(),
        (body, targetModel, stream) => {
          const context: ConversionContext = {
            sourceFormat: 'anthropic',
            targetFormat: 'openai',
            targetModel,
            stream,
          };

          const originalMessages = body['messages'] as Array<Record<string, unknown>>;
          const result = convertRequestBody(body, context);
          const resultMessages = result['messages'] as Array<Record<string, unknown>>;

          // Filter out system messages from result (those come from top-level system field)
          const nonSystemMessages = resultMessages.filter((m) => m['role'] !== 'system');

          // The number of non-system messages should match the original messages count
          expect(nonSystemMessages.length).toBe(originalMessages.length);

          // Each original message role should be preserved in order
          for (let i = 0; i < originalMessages.length; i++) {
            expect(nonSystemMessages[i]['role']).toBe(originalMessages[i]['role']);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
