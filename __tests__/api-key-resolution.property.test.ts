import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ProviderRegistry, type CustomProviderConfig } from '../src/provider-registry.js';

// ─── Mock DEFAULT_ENDPOINTS and MODEL_MAPPING ────────────────────────────────

vi.mock('../src/standalone-proxy.js', () => ({
  DEFAULT_ENDPOINTS: {
    openai: { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GEMINI_API_KEY' },
  },
  MODEL_MAPPING: {
    'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
    'claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    'gemini-2.5-pro': { provider: 'google', model: 'gemini-2.5-pro' },
  },
}));

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generates a valid provider name that doesn't collide with built-in providers.
 */
const providerNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/).filter(
  (name) => !['openai', 'anthropic', 'google'].includes(name)
);

/**
 * Generates a valid base URL.
 */
const baseUrlArb = fc.constantFrom(
  'https://api.example.com/v1',
  'https://my-provider.internal/api',
  'https://llm.corp.net/v1/chat',
  'https://custom-ai.io/inference',
  'https://api.localai.dev:8080/v1'
);

/**
 * Generates a valid apiCompatibility value.
 */
const apiCompatibilityArb = fc.constantFrom('openai' as const, 'anthropic' as const);

/**
 * Generates a valid environment variable name.
 */
const envVarNameArb = fc.stringMatching(/^[A-Z][A-Z0-9_]{2,20}$/);

/**
 * Generates a non-empty API key value (simulating a direct key).
 */
const apiKeyValueArb = fc.stringMatching(/^sk-[a-zA-Z0-9]{10,40}$/);

/**
 * Generates a non-empty env var value that is different from the apiKeyValue.
 * We use a distinct prefix to ensure they are always different.
 */
const envVarValueArb = fc.stringMatching(/^env-[a-zA-Z0-9]{10,40}$/);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 3: API key resolution priority', () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * For any custom provider with both `apiKeyEnvVar` and `apiKeyValue` defined,
   * the resolved API key SHALL equal `apiKeyValue` regardless of the environment
   * variable's value.
   */

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolved API key equals apiKeyValue when both apiKeyEnvVar and apiKeyValue are defined', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        envVarNameArb,
        apiKeyValueArb,
        envVarValueArb,
        (name, baseUrl, apiCompat, envVarName, directKeyValue, envKeyValue) => {
          // Ensure the direct key and env var value are different
          fc.pre(directKeyValue !== envKeyValue);

          // Set the environment variable to a different value than apiKeyValue
          vi.stubEnv(envVarName, envKeyValue);

          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: envVarName,
            apiKeyValue: directKeyValue,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const provider = registry.getProvider(name);
          expect(provider).not.toBeNull();
          // apiKeyValue takes priority over the env var value
          expect(provider!.apiKey).toBe(directKeyValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('resolved API key equals apiKeyValue even when env var is unset', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        envVarNameArb,
        apiKeyValueArb,
        (name, baseUrl, apiCompat, envVarName, directKeyValue) => {
          // Ensure the env var is NOT set
          delete process.env[envVarName];

          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: envVarName,
            apiKeyValue: directKeyValue,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const provider = registry.getProvider(name);
          expect(provider).not.toBeNull();
          // apiKeyValue is used even when env var is not set
          expect(provider!.apiKey).toBe(directKeyValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('resolved API key falls back to env var when apiKeyValue is not defined', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        envVarNameArb,
        envVarValueArb,
        (name, baseUrl, apiCompat, envVarName, envKeyValue) => {
          // Set the environment variable
          vi.stubEnv(envVarName, envKeyValue);

          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: envVarName,
            // No apiKeyValue defined
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const provider = registry.getProvider(name);
          expect(provider).not.toBeNull();
          // Falls back to env var value when apiKeyValue is absent
          expect(provider!.apiKey).toBe(envKeyValue);
        }
      ),
      { numRuns: 100 }
    );
  });
});
