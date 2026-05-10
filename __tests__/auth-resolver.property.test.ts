import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildAuthHeaders } from '../src/auth-resolver.js';
import type { ResolvedProvider } from '../src/provider-registry.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generates a non-empty API key string.
 */
const apiKeyArb = fc.stringMatching(/^sk-[a-zA-Z0-9]{10,40}$/);

/**
 * Generates a custom auth header name that is NOT the default for either compatibility type.
 */
const customAuthHeaderArb = fc.constantFrom(
  'X-Custom-Auth',
  'X-Api-Token',
  'X-Provider-Key',
  'X-Secret-Header',
  'Api-Key',
  'X-Access-Token'
);

/**
 * Generates a valid apiCompatibility value.
 */
const apiCompatibilityArb = fc.constantFrom('openai' as const, 'anthropic' as const);

/**
 * Generates a custom headers map with 0-4 entries.
 */
const customHeadersArb = fc.dictionary(
  fc.constantFrom('x-custom-1', 'x-custom-2', 'x-request-id', 'x-org-id', 'api-version'),
  fc.stringMatching(/^[a-zA-Z0-9-]{1,20}$/),
  { minKeys: 0, maxKeys: 4 }
);

/**
 * Generates a ResolvedProvider with a custom authHeader and an apiKey.
 */
const providerWithCustomAuthHeaderArb: fc.Arbitrary<ResolvedProvider> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
  baseUrl: fc.constantFrom('https://api.example.com/v1', 'https://llm.corp.net/v1'),
  apiCompatibility: apiCompatibilityArb,
  apiKey: apiKeyArb,
  apiKeyEnvVar: fc.constant('TEST_API_KEY'),
  headers: customHeadersArb,
  authHeader: customAuthHeaderArb,
  costPer1kInput: fc.constant(0),
  costPer1kOutput: fc.constant(0),
  isCustom: fc.constant(true),
});

/**
 * Generates a ResolvedProvider with openai compatibility and default Authorization header.
 */
const providerOpenAIDefaultArb: fc.Arbitrary<ResolvedProvider> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
  baseUrl: fc.constantFrom('https://api.openai.com/v1', 'https://openai-proxy.internal/v1'),
  apiCompatibility: fc.constant('openai' as const),
  apiKey: apiKeyArb,
  apiKeyEnvVar: fc.constant('OPENAI_API_KEY'),
  headers: customHeadersArb,
  authHeader: fc.constant('Authorization'),
  costPer1kInput: fc.constant(0),
  costPer1kOutput: fc.constant(0),
  isCustom: fc.constant(true),
});

/**
 * Generates a ResolvedProvider with anthropic compatibility and default x-api-key header.
 */
const providerAnthropicDefaultArb: fc.Arbitrary<ResolvedProvider> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
  baseUrl: fc.constantFrom('https://api.anthropic.com/v1', 'https://anthropic-proxy.internal/v1'),
  apiCompatibility: fc.constant('anthropic' as const),
  apiKey: apiKeyArb,
  apiKeyEnvVar: fc.constant('ANTHROPIC_API_KEY'),
  headers: customHeadersArb,
  authHeader: fc.constant('x-api-key'),
  costPer1kInput: fc.constant(0),
  costPer1kOutput: fc.constant(0),
  isCustom: fc.constant(true),
});

/**
 * Generates a ResolvedProvider with no API key (apiKey is null).
 */
const providerNoApiKeyArb: fc.Arbitrary<ResolvedProvider> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
  baseUrl: fc.constantFrom('https://api.example.com/v1', 'https://llm.corp.net/v1'),
  apiCompatibility: apiCompatibilityArb,
  apiKey: fc.constant(null),
  apiKeyEnvVar: fc.constant('MISSING_API_KEY'),
  headers: customHeadersArb,
  authHeader: fc.constantFrom('Authorization', 'x-api-key', 'X-Custom-Auth'),
  costPer1kInput: fc.constant(0),
  costPer1kOutput: fc.constant(0),
  isCustom: fc.constant(true),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 12: Auth header matches provider configuration', () => {
  /**
   * **Validates: Requirements 3.5, 3.6, 3.7**
   *
   * For any resolved provider, the outgoing auth header SHALL be:
   * - the `authHeader` field value if defined (custom),
   * - otherwise `"Authorization"` if `apiCompatibility === 'openai'`,
   * - otherwise `"x-api-key"` if `apiCompatibility === 'anthropic'`.
   */

  it('when provider has custom authHeader and apiKey, that header name is used with the key', () => {
    fc.assert(
      fc.property(providerWithCustomAuthHeaderArb, (provider) => {
        const headers = buildAuthHeaders(provider);

        // The custom auth header should be present with the API key as value
        expect(headers[provider.authHeader]).toBe(provider.apiKey);

        // The default headers for either compatibility type should NOT be present
        // (unless the custom header happens to be one of them, which our generator excludes)
        if (provider.authHeader !== 'Authorization') {
          expect(headers['Authorization']).toBeUndefined();
        }
        if (provider.authHeader !== 'x-api-key') {
          expect(headers['x-api-key']).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('when provider has apiCompatibility openai and default authHeader Authorization, uses Bearer token format', () => {
    fc.assert(
      fc.property(providerOpenAIDefaultArb, (provider) => {
        const headers = buildAuthHeaders(provider);

        // Should use Authorization: Bearer <key> format
        expect(headers['Authorization']).toBe(`Bearer ${provider.apiKey}`);

        // x-api-key should NOT be present (unless it's in custom headers)
        if (!provider.headers['x-api-key']) {
          expect(headers['x-api-key']).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('when provider has apiCompatibility anthropic and default authHeader x-api-key, uses raw key format', () => {
    fc.assert(
      fc.property(providerAnthropicDefaultArb, (provider) => {
        const headers = buildAuthHeaders(provider);

        // Should use x-api-key: <key> format (raw key, no Bearer prefix)
        expect(headers['x-api-key']).toBe(provider.apiKey);

        // Authorization should NOT be present (unless it's in custom headers)
        if (!provider.headers['Authorization']) {
          expect(headers['Authorization']).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('when provider has no apiKey, no auth header is present but custom headers still are', () => {
    fc.assert(
      fc.property(providerNoApiKeyArb, (provider) => {
        const headers = buildAuthHeaders(provider);

        // No auth-related header should be set from the auth logic
        // (only custom headers from provider.headers should be present)
        const authHeaderName = provider.authHeader;

        // If the authHeader name is NOT in custom headers, it should be absent
        if (!provider.headers[authHeaderName]) {
          expect(headers[authHeaderName]).toBeUndefined();
        }

        // Authorization should not be set by auth logic when no apiKey
        if (!provider.headers['Authorization']) {
          expect(headers['Authorization']).toBeUndefined();
        }

        // x-api-key should not be set by auth logic when no apiKey
        if (!provider.headers['x-api-key']) {
          expect(headers['x-api-key']).toBeUndefined();
        }

        // All custom headers from provider.headers SHOULD still be present
        for (const [key, value] of Object.entries(provider.headers)) {
          expect(headers[key]).toBe(value);
        }
      }),
      { numRuns: 100 }
    );
  });
});
