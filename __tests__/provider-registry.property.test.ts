import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ProviderRegistry, type CustomProviderConfig } from '../src/provider-registry.js';

// ─── Mock DEFAULT_ENDPOINTS and MODEL_MAPPING ────────────────────────────────

const MOCK_DEFAULT_ENDPOINTS: Record<string, { baseUrl: string; apiKeyEnv: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyEnv: 'GEMINI_API_KEY' },
};

const MOCK_MODEL_MAPPING: Record<string, { provider: string; model: string }> = {
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'claude-sonnet-4': { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  'gemini-2.5-pro': { provider: 'google', model: 'gemini-2.5-pro' },
};

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
 * Generates a valid provider name: lowercase alphanumeric with hyphens,
 * avoiding collisions with built-in provider names.
 */
const providerNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/).filter(
  (name) => !['openai', 'anthropic', 'google'].includes(name)
);

/**
 * Generates a valid model name: alphanumeric with hyphens and dots.
 */
const modelNameArb = fc.stringMatching(/^[a-z][a-z0-9.-]{1,30}$/).filter(
  (name) => !Object.keys(MOCK_MODEL_MAPPING).includes(name)
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
 * Generates a model entry (string or object form).
 */
const modelEntryArb = (providerModels: string[]) =>
  fc.oneof(
    modelNameArb.filter((n) => !providerModels.includes(n)),
    fc.record({
      name: modelNameArb.filter((n) => !providerModels.includes(n)),
      remoteModel: fc.stringMatching(/^[a-z][a-z0-9.-]{1,30}$/),
    })
  );

/**
 * Generates a valid CustomProviderConfig with unique model names.
 */
const customProviderConfigArb: fc.Arbitrary<CustomProviderConfig> = fc.record({
  name: providerNameArb,
  baseUrl: baseUrlArb,
  apiCompatibility: apiCompatibilityArb,
  apiKeyEnvVar: fc.stringMatching(/^[A-Z][A-Z0-9_]{2,20}$/),
  models: fc.array(
    fc.oneof(
      modelNameArb,
      fc.record({
        name: modelNameArb,
        remoteModel: fc.stringMatching(/^[a-z][a-z0-9.-]{1,30}$/),
      })
    ),
    { minLength: 0, maxLength: 5 }
  ),
});

/**
 * Generates an array of custom provider configs with unique names.
 */
const uniqueProviderArrayArb = fc
  .array(customProviderConfigArb, { minLength: 1, maxLength: 8 })
  .map((configs) => {
    // Ensure unique provider names
    const seen = new Set<string>();
    return configs.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
  })
  .filter((arr) => arr.length > 0);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 1: Provider loading completeness', () => {
  /**
   * **Validates: Requirements 1.1**
   *
   * For any valid array of custom provider configs, every provider
   * is retrievable by name after loading.
   */
  it('every custom provider is retrievable by name after loading', () => {
    fc.assert(
      fc.property(uniqueProviderArrayArb, (configs) => {
        const registry = new ProviderRegistry();
        registry.load(configs);

        for (const config of configs) {
          const provider = registry.getProvider(config.name);
          expect(provider).not.toBeNull();
          expect(provider!.name).toBe(config.name);
          expect(provider!.baseUrl).toBe(config.baseUrl);
          expect(provider!.apiCompatibility).toBe(config.apiCompatibility);
          expect(provider!.isCustom).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('all custom provider names appear in getProviderNames()', () => {
    fc.assert(
      fc.property(uniqueProviderArrayArb, (configs) => {
        const registry = new ProviderRegistry();
        registry.load(configs);

        const names = registry.getProviderNames();
        for (const config of configs) {
          expect(names).toContain(config.name);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: configurable-providers, Property 5: Custom provider overrides built-in', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * Custom provider with same name as built-in returns custom config.
   */
  it('custom provider with built-in name overrides the built-in config', () => {
    fc.assert(
      fc.property(
        baseUrlArb,
        apiCompatibilityArb,
        fc.stringMatching(/^[A-Z][A-Z0-9_]{2,20}$/),
        (baseUrl, apiCompatibility, apiKeyEnvVar) => {
          const builtInName = 'openai'; // Known built-in provider
          const customConfig: CustomProviderConfig = {
            name: builtInName,
            baseUrl,
            apiCompatibility,
            apiKeyEnvVar,
          };

          const registry = new ProviderRegistry();
          registry.load([customConfig]);

          const provider = registry.getProvider(builtInName);
          expect(provider).not.toBeNull();
          expect(provider!.baseUrl).toBe(baseUrl);
          expect(provider!.apiCompatibility).toBe(apiCompatibility);
          expect(provider!.isCustom).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('overridden built-in provider no longer returns original baseUrl', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('openai', 'anthropic', 'google'),
        baseUrlArb,
        apiCompatibilityArb,
        (builtInName, customBaseUrl, apiCompat) => {
          const customConfig: CustomProviderConfig = {
            name: builtInName,
            baseUrl: customBaseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'CUSTOM_KEY',
          };

          const registry = new ProviderRegistry();
          registry.load([customConfig]);

          const provider = registry.getProvider(builtInName);
          expect(provider).not.toBeNull();
          // The provider should have the custom baseUrl, not the built-in one
          expect(provider!.baseUrl).toBe(customBaseUrl);
          expect(provider!.isCustom).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: configurable-providers, Property 6: Model entry resolution', () => {
  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * String entries resolve as { provider, remoteModel: s }.
   * Object entries resolve as { provider, remoteModel: r }.
   */
  it('string model entries resolve with remoteModel equal to the string', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        fc.array(modelNameArb, { minLength: 1, maxLength: 5 }).map((arr) => [...new Set(arr)]).filter((a) => a.length > 0),
        (name, baseUrl, apiCompat, models) => {
          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'TEST_KEY',
            models,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          for (const modelName of models) {
            const route = registry.resolveModel(modelName);
            expect(route).not.toBeNull();
            expect(route!.provider).toBe(name);
            expect(route!.remoteModel).toBe(modelName);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('object model entries resolve with remoteModel equal to the remoteModel field', () => {
    const objectModelEntryArb = fc.record({
      name: modelNameArb,
      remoteModel: fc.stringMatching(/^[a-z][a-z0-9.-]{1,30}$/),
    });

    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        fc.array(objectModelEntryArb, { minLength: 1, maxLength: 5 })
          .map((arr) => {
            const seen = new Set<string>();
            return arr.filter((e) => {
              if (seen.has(e.name)) return false;
              seen.add(e.name);
              return true;
            });
          })
          .filter((a) => a.length > 0),
        (name, baseUrl, apiCompat, models) => {
          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'TEST_KEY',
            models,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          for (const entry of models) {
            const route = registry.resolveModel(entry.name);
            expect(route).not.toBeNull();
            expect(route!.provider).toBe(name);
            expect(route!.remoteModel).toBe(entry.remoteModel);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: configurable-providers, Property 7: Custom model overrides built-in mapping', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * Custom model definitions take priority over MODEL_MAPPING.
   */
  it('custom provider model with same name as built-in model overrides the built-in route', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        fc.constantFrom('gpt-4o', 'claude-sonnet-4', 'gemini-2.5-pro'),
        fc.stringMatching(/^[a-z][a-z0-9.-]{1,30}$/),
        (provName, baseUrl, apiCompat, builtInModel, remoteModel) => {
          const config: CustomProviderConfig = {
            name: provName,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'TEST_KEY',
            models: [{ name: builtInModel, remoteModel }],
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const route = registry.resolveModel(builtInModel);
          expect(route).not.toBeNull();
          // Custom provider should win over built-in MODEL_MAPPING
          expect(route!.provider).toBe(provName);
          expect(route!.remoteModel).toBe(remoteModel);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: configurable-providers, Property 8: Prefix-based routing', () => {
  /**
   * **Validates: Requirements 2.5**
   *
   * Models starting with prefix route to provider; others do not.
   */
  it('models starting with the prefix route to the provider', () => {
    const prefixArb = fc.stringMatching(/^[a-z]{2,6}\/$/).map((s) => s);

    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        prefixArb,
        fc.stringMatching(/^[a-z][a-z0-9.-]{1,20}$/),
        (name, baseUrl, apiCompat, prefix, modelSuffix) => {
          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'TEST_KEY',
            modelPrefix: prefix,
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const modelName = prefix + modelSuffix;
          const route = registry.resolveModel(modelName);
          expect(route).not.toBeNull();
          expect(route!.provider).toBe(name);
          expect(route!.remoteModel).toBe(modelName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('models NOT starting with the prefix do NOT route to the provider via prefix', () => {
    const prefixArb = fc.stringMatching(/^[a-z]{2,6}\/$/);

    fc.assert(
      fc.property(
        providerNameArb,
        baseUrlArb,
        apiCompatibilityArb,
        prefixArb,
        modelNameArb,
        (name, baseUrl, apiCompat, prefix, modelName) => {
          // Ensure the model does NOT start with the prefix
          fc.pre(!modelName.startsWith(prefix));

          const config: CustomProviderConfig = {
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'TEST_KEY',
            modelPrefix: prefix,
            // No explicit models registered
          };

          const registry = new ProviderRegistry();
          registry.load([config]);

          const route = registry.resolveModel(modelName);
          // The model should NOT route to this provider (it may route to a built-in or be null)
          if (route !== null) {
            expect(route.provider).not.toBe(name);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
