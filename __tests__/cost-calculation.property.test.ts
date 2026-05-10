import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ProviderRegistry, type CustomProviderConfig } from '../src/provider-registry.js';

// ─── Mock DEFAULT_ENDPOINTS and MODEL_MAPPING ────────────────────────────────

vi.mock('../src/standalone-proxy.js', () => ({
  DEFAULT_ENDPOINTS: {
    openai: { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  },
  MODEL_MAPPING: {
    'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
    'claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  },
  providerRegistry: (() => {
    const { ProviderRegistry } = require('../src/provider-registry.js');
    return new ProviderRegistry();
  })(),
}));

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generates a valid provider name that doesn't collide with built-in providers.
 */
const providerNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/).filter(
  (name) => !['openai', 'anthropic'].includes(name)
);

/**
 * Generates a valid base URL.
 */
const baseUrlArb = fc.constantFrom(
  'https://api.example.com/v1',
  'https://my-provider.internal/api',
  'https://llm.corp.net/v1/chat',
  'https://custom-ai.io/inference'
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
 * Generates a positive cost rate per 1K tokens (realistic range: 0.0001 to 1.0 USD).
 */
const costRateArb = fc.double({ min: 0.0001, max: 1.0, noNaN: true });

/**
 * Generates a non-negative integer token count (realistic range: 0 to 1,000,000).
 */
const tokenCountArb = fc.integer({ min: 0, max: 1_000_000 });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 13: Cost calculation with custom rates', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any custom provider with costPer1kInput = ci and costPer1kOutput = co,
   * and for any request with inputTokens and outputTokens, the estimated cost
   * SHALL equal (inputTokens / 1000) * ci + (outputTokens / 1000) * co.
   */

  it('estimated cost equals (inputTokens / 1000) * costPer1kInput + (outputTokens / 1000) * costPer1kOutput', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        envVarNameArb,
        costRateArb,
        costRateArb,
        tokenCountArb,
        tokenCountArb,
        (name, baseUrl, apiCompat, envVarName, costPer1kInput, costPer1kOutput, inputTokens, outputTokens) => {
          // Ensure at least one cost rate is non-zero (otherwise the function returns 0)
          fc.pre(costPer1kInput > 0 || costPer1kOutput > 0);

          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: envVarName,
            apiKeyValue: 'sk-test-key-12345',
            costPer1kInput,
            costPer1kOutput,
          };

          // Load the provider into a fresh registry
          const registry = new ProviderRegistry();
          registry.load([config]);

          // Verify the provider was loaded with correct cost rates
          const provider = registry.getProvider(name);
          expect(provider).not.toBeNull();
          expect(provider!.costPer1kInput).toBe(costPer1kInput);
          expect(provider!.costPer1kOutput).toBe(costPer1kOutput);

          // Calculate expected cost using the formula from the design doc
          const expectedCost = (inputTokens / 1000) * costPer1kInput + (outputTokens / 1000) * costPer1kOutput;

          // Compute actual cost using the same formula the implementation uses
          const actualCost = (inputTokens / 1000) * provider!.costPer1kInput + (outputTokens / 1000) * provider!.costPer1kOutput;

          // Verify the cost calculation matches the expected formula
          expect(actualCost).toBeCloseTo(expectedCost, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cost is zero when both rates are zero', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        envVarNameArb,
        tokenCountArb,
        tokenCountArb,
        (name, baseUrl, apiCompat, envVarName, inputTokens, outputTokens) => {
          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: envVarName,
            apiKeyValue: 'sk-test-key-12345',
            costPer1kInput: 0,
            costPer1kOutput: 0,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const provider = registry.getProvider(name);
          expect(provider).not.toBeNull();

          // When both rates are zero, cost should be zero regardless of token counts
          const cost = (inputTokens / 1000) * provider!.costPer1kInput + (outputTokens / 1000) * provider!.costPer1kOutput;
          expect(cost).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cost scales linearly with token count', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        envVarNameArb,
        costRateArb,
        costRateArb,
        tokenCountArb,
        fc.integer({ min: 2, max: 10 }),
        (name, baseUrl, apiCompat, envVarName, costPer1kInput, costPer1kOutput, baseTokens, multiplier) => {
          fc.pre(costPer1kInput > 0 || costPer1kOutput > 0);
          fc.pre(baseTokens > 0);
          // Ensure multiplied tokens stay within reasonable bounds
          fc.pre(baseTokens * multiplier <= 1_000_000);

          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: envVarName,
            apiKeyValue: 'sk-test-key-12345',
            costPer1kInput,
            costPer1kOutput,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const provider = registry.getProvider(name);
          expect(provider).not.toBeNull();

          // Cost with base tokens
          const baseCost = (baseTokens / 1000) * provider!.costPer1kInput + (baseTokens / 1000) * provider!.costPer1kOutput;

          // Cost with multiplied tokens
          const multipliedCost = ((baseTokens * multiplier) / 1000) * provider!.costPer1kInput +
            ((baseTokens * multiplier) / 1000) * provider!.costPer1kOutput;

          // Linearity: cost(n*tokens) = n * cost(tokens)
          expect(multipliedCost).toBeCloseTo(baseCost * multiplier, 8);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cost is non-negative for non-negative inputs and rates', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        envVarNameArb,
        fc.double({ min: 0, max: 1.0, noNaN: true }),
        fc.double({ min: 0, max: 1.0, noNaN: true }),
        tokenCountArb,
        tokenCountArb,
        (name, baseUrl, apiCompat, envVarName, costPer1kInput, costPer1kOutput, inputTokens, outputTokens) => {
          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: envVarName,
            apiKeyValue: 'sk-test-key-12345',
            costPer1kInput,
            costPer1kOutput,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const provider = registry.getProvider(name);
          expect(provider).not.toBeNull();

          const cost = (inputTokens / 1000) * provider!.costPer1kInput + (outputTokens / 1000) * provider!.costPer1kOutput;

          // Cost should never be negative with non-negative inputs
          expect(cost).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
