import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const BUILT_IN_NAMES = ['openai', 'anthropic', 'google'];

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Generates a valid custom provider name that does NOT collide with built-in names.
 */
const providerNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/).filter(
  (name) => !BUILT_IN_NAMES.includes(name)
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
 * Generates a valid CustomProviderConfig given a specific name.
 */
function customProviderConfigWithName(name: string): fc.Arbitrary<CustomProviderConfig> {
  return fc.record({
    name: fc.constant(name),
    baseUrl: baseUrlArb,
    apiCompatibility: apiCompatibilityArb,
    apiKeyEnvVar: fc.stringMatching(/^[A-Z][A-Z0-9_]{2,20}$/),
  }) as fc.Arbitrary<CustomProviderConfig>;
}

/**
 * Generates an array of CustomProviderConfig with unique names drawn from a given set.
 */
function configsFromNames(names: string[]): fc.Arbitrary<CustomProviderConfig[]> {
  if (names.length === 0) return fc.constant([]);
  return fc.tuple(
    ...names.map((name) => customProviderConfigWithName(name))
  ) as fc.Arbitrary<CustomProviderConfig[]>;
}

/**
 * Generates a set of unique custom provider names (no built-in collisions).
 */
const uniqueNameSetArb = fc
  .array(providerNameArb, { minLength: 1, maxLength: 8 })
  .map((names) => [...new Set(names)])
  .filter((arr) => arr.length >= 1);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 14: Reload diff correctness', () => {
  /**
   * **Validates: Requirements 8.1, 8.4**
   *
   * For any two provider configuration states (before and after), the reload
   * response SHALL list: in `added` all provider names present in after but not
   * before, in `removed` all names present in before but not after, and in
   * `unchanged` all names present in both.
   */
  it('added contains exactly the custom names in after but not in before', () => {
    fc.assert(
      fc.property(
        uniqueNameSetArb,
        uniqueNameSetArb,
        (beforeNames, afterNames) => {
          const beforeSet = new Set(beforeNames);
          const afterSet = new Set(afterNames);

          // Build configs for before and after states
          const beforeConfigs: CustomProviderConfig[] = beforeNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          const afterConfigs: CustomProviderConfig[] = afterNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          // Load before state
          const registry = new ProviderRegistry();
          registry.load(beforeConfigs);

          // Reload with after state
          const result = registry.reload(afterConfigs);

          // Expected added: names in after that are NOT in before AND NOT built-in
          // (built-in names are always present, so they appear in unchanged)
          const expectedAdded = afterNames.filter(
            (name) => !beforeSet.has(name) && !BUILT_IN_NAMES.includes(name)
          );

          expect(result.added.sort()).toEqual(expectedAdded.sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('removed contains exactly the custom names in before but not in after', () => {
    fc.assert(
      fc.property(
        uniqueNameSetArb,
        uniqueNameSetArb,
        (beforeNames, afterNames) => {
          const afterSet = new Set(afterNames);

          const beforeConfigs: CustomProviderConfig[] = beforeNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          const afterConfigs: CustomProviderConfig[] = afterNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          // Load before state
          const registry = new ProviderRegistry();
          registry.load(beforeConfigs);

          // Reload with after state
          const result = registry.reload(afterConfigs);

          // Expected removed: names in before that are NOT in after AND NOT built-in
          // (built-in names are always present regardless of custom configs)
          const expectedRemoved = beforeNames.filter(
            (name) => !afterSet.has(name) && !BUILT_IN_NAMES.includes(name)
          );

          expect(result.removed.sort()).toEqual(expectedRemoved.sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('unchanged contains exactly the names present in both before and after (including built-ins)', () => {
    fc.assert(
      fc.property(
        uniqueNameSetArb,
        uniqueNameSetArb,
        (beforeNames, afterNames) => {
          const beforeSet = new Set(beforeNames);
          const afterSet = new Set(afterNames);

          const beforeConfigs: CustomProviderConfig[] = beforeNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          const afterConfigs: CustomProviderConfig[] = afterNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          // Load before state
          const registry = new ProviderRegistry();
          registry.load(beforeConfigs);

          // Reload with after state
          const result = registry.reload(afterConfigs);

          // Expected unchanged: names in both before and after states
          // This includes built-in names (always present in both) plus custom names in both
          const allBeforeNames = new Set([...beforeNames, ...BUILT_IN_NAMES]);
          const allAfterNames = new Set([...afterNames, ...BUILT_IN_NAMES]);

          const expectedUnchanged = [...allAfterNames].filter(
            (name) => allBeforeNames.has(name)
          );

          expect(result.unchanged.sort()).toEqual(expectedUnchanged.sort());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('added, removed, and unchanged are mutually exclusive and cover all names', () => {
    fc.assert(
      fc.property(
        uniqueNameSetArb,
        uniqueNameSetArb,
        (beforeNames, afterNames) => {
          const beforeConfigs: CustomProviderConfig[] = beforeNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          const afterConfigs: CustomProviderConfig[] = afterNames.map((name) => ({
            name,
            baseUrl: 'https://api.example.com/v1',
            apiCompatibility: 'openai' as const,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          // Load before state
          const registry = new ProviderRegistry();
          registry.load(beforeConfigs);

          // Reload with after state
          const result = registry.reload(afterConfigs);

          const addedSet = new Set(result.added);
          const removedSet = new Set(result.removed);
          const unchangedSet = new Set(result.unchanged);

          // Mutual exclusivity: no name appears in more than one category
          for (const name of result.added) {
            expect(removedSet.has(name)).toBe(false);
            expect(unchangedSet.has(name)).toBe(false);
          }
          for (const name of result.removed) {
            expect(addedSet.has(name)).toBe(false);
            expect(unchangedSet.has(name)).toBe(false);
          }
          for (const name of result.unchanged) {
            expect(addedSet.has(name)).toBe(false);
            expect(removedSet.has(name)).toBe(false);
          }

          // Coverage: all names from before and after (plus built-ins) are accounted for
          const allNames = new Set([...beforeNames, ...afterNames, ...BUILT_IN_NAMES]);
          const categorizedNames = new Set([...result.added, ...result.removed, ...result.unchanged]);
          for (const name of allNames) {
            expect(categorizedNames.has(name)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('diff is correct with randomized provider configurations', () => {
    fc.assert(
      fc.property(
        fc.array(providerNameArb, { minLength: 0, maxLength: 6 })
          .map((names) => [...new Set(names)]),
        fc.array(providerNameArb, { minLength: 0, maxLength: 6 })
          .map((names) => [...new Set(names)]),
        baseUrlArb,
        apiCompatibilityArb,
        (beforeNames, afterNames, baseUrl, apiCompat) => {
          const beforeConfigs: CustomProviderConfig[] = beforeNames.map((name) => ({
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          const afterConfigs: CustomProviderConfig[] = afterNames.map((name) => ({
            name,
            baseUrl,
            apiCompatibility: apiCompat,
            apiKeyEnvVar: 'TEST_KEY',
          }));

          const registry = new ProviderRegistry();
          registry.load(beforeConfigs);
          const result = registry.reload(afterConfigs);

          const beforeSet = new Set([...beforeNames, ...BUILT_IN_NAMES]);
          const afterSet = new Set([...afterNames, ...BUILT_IN_NAMES]);

          // Verify each added name is in after but not before
          for (const name of result.added) {
            expect(afterSet.has(name)).toBe(true);
            expect(beforeSet.has(name)).toBe(false);
          }

          // Verify each removed name is in before but not after
          for (const name of result.removed) {
            expect(beforeSet.has(name)).toBe(true);
            expect(afterSet.has(name)).toBe(false);
          }

          // Verify each unchanged name is in both
          for (const name of result.unchanged) {
            expect(beforeSet.has(name)).toBe(true);
            expect(afterSet.has(name)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
