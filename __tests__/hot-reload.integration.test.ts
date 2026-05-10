import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRegistry, type CustomProviderConfig } from '../src/provider-registry.js';
import { validateCustomProviders } from '../src/config-validator.js';

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
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeProvider(name: string, overrides?: Partial<CustomProviderConfig>): CustomProviderConfig {
  return {
    name,
    baseUrl: `https://${name}.example.com/v1`,
    apiCompatibility: 'openai',
    apiKeyEnvVar: `${name.toUpperCase().replace(/-/g, '_')}_KEY`,
    apiKeyValue: `sk-${name}-test-key`,
    models: [`${name}-model`],
    ...overrides,
  };
}

// ─── Integration Tests: Hot-Reload ──────────────────────────────────────────

describe('Hot-Reload Integration', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe('Reload preserves in-flight requests (Requirement 8.2)', () => {
    it('should preserve in-flight request counter after provider is removed via reload', () => {
      // Load providers A and B
      const providerA = makeProvider('provider-a');
      const providerB = makeProvider('provider-b');
      registry.load([providerA, providerB]);

      // Simulate an in-flight request to provider A
      registry.trackRequestStart('provider-a');

      // Reload with only provider B (removing A)
      registry.reload([providerB]);

      // The in-flight counter for provider A should still be tracked
      expect(registry.hasInFlightRequests('provider-a')).toBe(true);
    });

    it('should preserve multiple in-flight requests after reload removes the provider', () => {
      const providerA = makeProvider('provider-a');
      const providerB = makeProvider('provider-b');
      registry.load([providerA, providerB]);

      // Simulate multiple in-flight requests to provider A
      registry.trackRequestStart('provider-a');
      registry.trackRequestStart('provider-a');
      registry.trackRequestStart('provider-a');

      // Reload with only provider B
      registry.reload([providerB]);

      // All in-flight requests should still be tracked
      expect(registry.hasInFlightRequests('provider-a')).toBe(true);
    });
  });

  describe('Removed provider allows in-flight completion (Requirement 8.3)', () => {
    it('should report removed provider in reload result', () => {
      const providerA = makeProvider('provider-a');
      const providerB = makeProvider('provider-b');
      registry.load([providerA, providerB]);

      // Simulate in-flight request to provider A
      registry.trackRequestStart('provider-a');

      // Reload removing provider A
      const result = registry.reload([providerB]);

      // Provider A should be in the removed list
      expect(result.removed).toContain('provider-a');
    });

    it('should allow trackRequestEnd on a removed provider without throwing', () => {
      const providerA = makeProvider('provider-a');
      const providerB = makeProvider('provider-b');
      registry.load([providerA, providerB]);

      // Simulate in-flight request
      registry.trackRequestStart('provider-a');

      // Reload removing provider A
      registry.reload([providerB]);

      // Completing the in-flight request should not throw
      expect(() => registry.trackRequestEnd('provider-a')).not.toThrow();
    });

    it('should report no in-flight requests after all complete on removed provider', () => {
      const providerA = makeProvider('provider-a');
      const providerB = makeProvider('provider-b');
      registry.load([providerA, providerB]);

      // Simulate in-flight request
      registry.trackRequestStart('provider-a');

      // Reload removing provider A
      registry.reload([providerB]);

      // Complete the in-flight request
      registry.trackRequestEnd('provider-a');

      // No more in-flight requests for provider A
      expect(registry.hasInFlightRequests('provider-a')).toBe(false);
    });

    it('should not route new requests to removed provider', () => {
      const providerA = makeProvider('provider-a', { models: ['model-a'] });
      const providerB = makeProvider('provider-b', { models: ['model-b'] });
      registry.load([providerA, providerB]);

      // Reload removing provider A
      registry.reload([providerB]);

      // Model from removed provider should no longer resolve
      const route = registry.resolveModel('model-a');
      expect(route).toBeNull();

      // Model from remaining provider should still resolve
      const routeB = registry.resolveModel('model-b');
      expect(routeB).not.toBeNull();
      expect(routeB!.provider).toBe('provider-b');
    });
  });

  describe('Invalid config preserves current state (Requirement 8.2, 8.3)', () => {
    it('should return validation errors for config missing required fields', () => {
      const providerA = makeProvider('provider-a');
      const providerB = makeProvider('provider-b');
      registry.load([providerA, providerB]);

      // Attempt to validate an invalid config (missing baseUrl and apiCompatibility)
      const invalidConfigs = [
        { name: 'bad-provider' }, // missing baseUrl, apiCompatibility, apiKeyEnvVar
      ];

      const builtInNames = ['openai', 'anthropic'];
      const validationResult = validateCustomProviders(invalidConfigs, builtInNames);

      // Validation should report errors
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.valid).toHaveLength(0);
    });

    it('should preserve registry state when validation fails (no reload called)', () => {
      const providerA = makeProvider('provider-a');
      const providerB = makeProvider('provider-b');
      registry.load([providerA, providerB]);

      // Simulate the reload endpoint flow: validate first, only reload if valid
      const invalidConfigs = [
        { name: 'bad-provider', baseUrl: 'not-a-url' }, // invalid baseUrl
      ];

      const builtInNames = ['openai', 'anthropic'];
      const validationResult = validateCustomProviders(invalidConfigs, builtInNames);

      // Validation fails — do NOT call reload
      expect(validationResult.errors.length).toBeGreaterThan(0);

      // Registry should still have both original providers
      const names = registry.getProviderNames();
      expect(names).toContain('provider-a');
      expect(names).toContain('provider-b');
    });

    it('should preserve model routes when config is invalid and reload is skipped', () => {
      const providerA = makeProvider('provider-a', { models: ['model-a'] });
      const providerB = makeProvider('provider-b', { models: ['model-b'] });
      registry.load([providerA, providerB]);

      // Invalid config — missing apiKeyEnvVar
      const invalidConfigs = [
        { name: 'bad-provider', baseUrl: 'https://bad.example.com', apiCompatibility: 'openai' },
      ];

      const builtInNames = ['openai', 'anthropic'];
      const validationResult = validateCustomProviders(invalidConfigs, builtInNames);

      // Validation fails
      expect(validationResult.errors.length).toBeGreaterThan(0);

      // Models should still be resolvable (state preserved)
      expect(registry.resolveModel('model-a')).not.toBeNull();
      expect(registry.resolveModel('model-b')).not.toBeNull();
    });
  });
});
