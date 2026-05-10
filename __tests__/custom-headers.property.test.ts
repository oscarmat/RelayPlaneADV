import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { buildAuthHeaders } from '../src/auth-resolver.js';
import type { ResolvedProvider } from '../src/provider-registry.js';

// ─── Mock standalone-proxy (required by provider-registry imports) ────────────

vi.mock('../src/standalone-proxy.js', () => ({
  DEFAULT_ENDPOINTS: {},
  MODEL_MAPPING: {},
}));

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generates a valid HTTP header name: lowercase alphanumeric with hyphens,
 * following common header naming conventions.
 */
const httpHeaderNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,30}$/).filter(
  // Exclude names that conflict with default auth headers to isolate custom header testing
  (name) => !['authorization', 'x-api-key'].includes(name)
);

/**
 * Generates a valid HTTP header value: printable ASCII, non-empty.
 */
const httpHeaderValueArb = fc.stringMatching(/^[a-zA-Z0-9 _./:;=+@!#$%^&*()-]{1,50}$/);

/**
 * Generates a Record<string, string> of custom headers with 1-5 entries
 * and unique header names.
 */
const headersMapArb = fc
  .array(fc.tuple(httpHeaderNameArb, httpHeaderValueArb), { minLength: 1, maxLength: 5 })
  .map((entries) => {
    const seen = new Set<string>();
    const result: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (!seen.has(key)) {
        seen.add(key);
        result[key] = value;
      }
    }
    return result;
  })
  .filter((map) => Object.keys(map).length >= 1);

/**
 * Generates a valid apiCompatibility value.
 */
const apiCompatibilityArb = fc.constantFrom('openai' as const, 'anthropic' as const);

/**
 * Generates a ResolvedProvider with a custom headers map.
 */
const resolvedProviderWithHeadersArb = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
  baseUrl: fc.constantFrom(
    'https://api.example.com/v1',
    'https://my-provider.internal/api',
    'https://llm.corp.net/v1/chat'
  ),
  apiCompatibility: apiCompatibilityArb,
  apiKey: fc.oneof(fc.constant(null), fc.stringMatching(/^sk-[a-zA-Z0-9]{10,30}$/)),
  apiKeyEnvVar: fc.constant('TEST_API_KEY'),
  headers: headersMapArb,
  authHeader: fc.oneof(
    fc.constant('Authorization'),
    fc.constant('x-api-key'),
    fc.stringMatching(/^X-[A-Z][a-zA-Z0-9-]{2,20}$/)
  ),
  costPer1kInput: fc.constant(0),
  costPer1kOutput: fc.constant(0),
  isCustom: fc.constant(true),
}) as fc.Arbitrary<ResolvedProvider>;

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 4: Custom headers inclusion', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any custom provider with a `headers` map containing N entries,
   * calling `buildAuthHeaders(provider)` should return an object that
   * includes all N custom headers with their specified values.
   */
  it('all entries in provider headers map are present in outgoing request headers', () => {
    fc.assert(
      fc.property(resolvedProviderWithHeadersArb, (provider) => {
        const result = buildAuthHeaders(provider);

        // Every custom header must be present with its exact value
        for (const [headerName, headerValue] of Object.entries(provider.headers)) {
          expect(result[headerName]).toBe(headerValue);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('custom headers count is at least N (the number of entries in the headers map)', () => {
    fc.assert(
      fc.property(resolvedProviderWithHeadersArb, (provider) => {
        const result = buildAuthHeaders(provider);
        const customHeaderKeys = Object.keys(provider.headers);

        // The result must contain at least all custom header keys
        for (const key of customHeaderKeys) {
          expect(key in result).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('custom headers values are not modified or transformed', () => {
    fc.assert(
      fc.property(resolvedProviderWithHeadersArb, (provider) => {
        const result = buildAuthHeaders(provider);

        // Values must be exactly as specified, not trimmed, lowercased, or otherwise transformed
        for (const [headerName, headerValue] of Object.entries(provider.headers)) {
          expect(result[headerName]).toStrictEqual(headerValue);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('custom headers are present regardless of whether provider has an API key', () => {
    // Test specifically with null apiKey to ensure headers are included even without auth
    const providerWithoutKeyArb = fc.record({
      name: fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
      baseUrl: fc.constant('https://api.example.com/v1'),
      apiCompatibility: apiCompatibilityArb,
      apiKey: fc.constant(null as string | null),
      apiKeyEnvVar: fc.constant('MISSING_API_KEY'),
      headers: headersMapArb,
      authHeader: fc.constant('Authorization'),
      costPer1kInput: fc.constant(0),
      costPer1kOutput: fc.constant(0),
      isCustom: fc.constant(true),
    }) as fc.Arbitrary<ResolvedProvider>;

    fc.assert(
      fc.property(providerWithoutKeyArb, (provider) => {
        const result = buildAuthHeaders(provider);

        for (const [headerName, headerValue] of Object.entries(provider.headers)) {
          expect(result[headerName]).toBe(headerValue);
        }
      }),
      { numRuns: 100 }
    );
  });
});
