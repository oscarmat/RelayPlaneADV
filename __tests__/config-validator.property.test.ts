/**
 * Property-Based Tests for ConfigValidator
 *
 * Feature: configurable-providers
 * Property 2: Validation rejects invalid configurations
 *
 * Configs missing required fields or with invalid values are excluded
 * from valid results with corresponding error entries.
 *
 * Validates: Requirements 1.2, 4.2, 4.3, 4.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateCustomProviders } from '../src/config-validator.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid non-empty string (for name, apiKeyEnvVar) */
const nonEmptyString = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

/** Generate a valid URL string */
const validUrl = fc.oneof(
  fc.constant('https://api.example.com/v1'),
  fc.constant('https://my-provider.internal:8080/api'),
  fc.constant('http://localhost:3000'),
  fc.constant('https://openai.azure.com/deployments/gpt4'),
  nonEmptyString.map(s => `https://${s.replace(/[^a-zA-Z0-9]/g, 'x')}.example.com/v1`),
);

/** Generate an invalid URL string (not parseable by new URL()) */
const invalidUrl = fc.oneof(
  fc.constant('not-a-url'),
  fc.constant('://missing-protocol'),
  fc.constant('just some text'),
  fc.constant('ftp//missing-colon.com'),
  fc.constant(''),
);

/** Generate a valid apiCompatibility value */
const validApiCompatibility = fc.oneof(
  fc.constant('openai' as const),
  fc.constant('anthropic' as const),
);

/** Generate an invalid apiCompatibility value (not 'openai' or 'anthropic') */
const invalidApiCompatibility = fc.oneof(
  fc.constant('gpt'),
  fc.constant('claude'),
  fc.constant('azure'),
  fc.constant(''),
  fc.constant('OPENAI'),
  fc.constant('Anthropic'),
  fc.integer().map(n => String(n)),
);

/** Generate a fully valid custom provider config object */
const validProviderConfig = fc.record({
  name: nonEmptyString,
  baseUrl: validUrl,
  apiCompatibility: validApiCompatibility,
  apiKeyEnvVar: nonEmptyString,
});

/** Built-in provider names for testing */
const builtInNames = ['openai', 'anthropic', 'google', 'xai', 'openrouter', 'deepseek', 'groq', 'mistral', 'together', 'fireworks', 'perplexity', 'ollama'];

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: configurable-providers, Property 2: Validation rejects invalid configurations', () => {

  it('configs missing "name" field are excluded from valid results with a corresponding error', () => {
    fc.assert(
      fc.property(
        validUrl,
        validApiCompatibility,
        nonEmptyString,
        (baseUrl, apiCompatibility, apiKeyEnvVar) => {
          // Config with name missing entirely
          const configMissingName = { baseUrl, apiCompatibility, apiKeyEnvVar };
          const result = validateCustomProviders([configMissingName], builtInNames);

          expect(result.valid).toHaveLength(0);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some(e => e.field === 'name')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('configs with empty string "name" field are excluded from valid results with a corresponding error', () => {
    fc.assert(
      fc.property(
        validUrl,
        validApiCompatibility,
        nonEmptyString,
        (baseUrl, apiCompatibility, apiKeyEnvVar) => {
          // Config with name as empty string
          const configEmptyName = { name: '', baseUrl, apiCompatibility, apiKeyEnvVar };
          const result = validateCustomProviders([configEmptyName], builtInNames);

          expect(result.valid).toHaveLength(0);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some(e => e.field === 'name')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('configs missing "baseUrl" field are excluded from valid results with a corresponding error', () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        validApiCompatibility,
        nonEmptyString,
        (name, apiCompatibility, apiKeyEnvVar) => {
          const configMissingBaseUrl = { name, apiCompatibility, apiKeyEnvVar };
          const result = validateCustomProviders([configMissingBaseUrl], builtInNames);

          expect(result.valid).toHaveLength(0);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some(e => e.field === 'baseUrl')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('configs with invalid "baseUrl" (not parseable URL) are excluded from valid results with a corresponding error', () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        invalidUrl,
        validApiCompatibility,
        nonEmptyString,
        (name, baseUrl, apiCompatibility, apiKeyEnvVar) => {
          const configInvalidUrl = { name, baseUrl, apiCompatibility, apiKeyEnvVar };
          const result = validateCustomProviders([configInvalidUrl], builtInNames);

          expect(result.valid).toHaveLength(0);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some(e => e.field === 'baseUrl')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('configs missing "apiCompatibility" field are excluded from valid results with a corresponding error', () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        validUrl,
        nonEmptyString,
        (name, baseUrl, apiKeyEnvVar) => {
          const configMissingCompat = { name, baseUrl, apiKeyEnvVar };
          const result = validateCustomProviders([configMissingCompat], builtInNames);

          expect(result.valid).toHaveLength(0);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some(e => e.field === 'apiCompatibility')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('configs with invalid "apiCompatibility" (not openai or anthropic) are excluded from valid results with a corresponding error', () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        validUrl,
        invalidApiCompatibility,
        nonEmptyString,
        (name, baseUrl, apiCompatibility, apiKeyEnvVar) => {
          const configInvalidCompat = { name, baseUrl, apiCompatibility, apiKeyEnvVar };
          const result = validateCustomProviders([configInvalidCompat], builtInNames);

          expect(result.valid).toHaveLength(0);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some(e => e.field === 'apiCompatibility')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('configs missing "apiKeyEnvVar" field are excluded from valid results with a corresponding error', () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        validUrl,
        validApiCompatibility,
        (name, baseUrl, apiCompatibility) => {
          const configMissingEnvVar = { name, baseUrl, apiCompatibility };
          const result = validateCustomProviders([configMissingEnvVar], builtInNames);

          expect(result.valid).toHaveLength(0);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some(e => e.field === 'apiKeyEnvVar')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('valid configs pass through to the valid array with no errors for those entries', () => {
    fc.assert(
      fc.property(
        validProviderConfig,
        (config) => {
          const result = validateCustomProviders([config], []);

          expect(result.valid).toHaveLength(1);
          expect(result.valid[0].name).toBe(config.name);
          expect(result.valid[0].baseUrl).toBe(config.baseUrl);
          expect(result.valid[0].apiCompatibility).toBe(config.apiCompatibility);
          expect(result.valid[0].apiKeyEnvVar).toBe(config.apiKeyEnvVar);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('in a mixed array, only invalid configs produce errors and only valid configs appear in valid results', () => {
    fc.assert(
      fc.property(
        fc.array(validProviderConfig, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.oneof(
            // Missing name
            fc.record({
              baseUrl: validUrl,
              apiCompatibility: validApiCompatibility,
              apiKeyEnvVar: nonEmptyString,
            }),
            // Invalid baseUrl
            fc.record({
              name: nonEmptyString,
              baseUrl: invalidUrl,
              apiCompatibility: validApiCompatibility,
              apiKeyEnvVar: nonEmptyString,
            }),
            // Invalid apiCompatibility
            fc.record({
              name: nonEmptyString,
              baseUrl: validUrl,
              apiCompatibility: invalidApiCompatibility,
              apiKeyEnvVar: nonEmptyString,
            }),
            // Missing apiKeyEnvVar
            fc.record({
              name: nonEmptyString,
              baseUrl: validUrl,
              apiCompatibility: validApiCompatibility,
            }),
          ),
          { minLength: 1, maxLength: 5 },
        ),
        (validConfigs, invalidConfigs) => {
          const allConfigs = [...validConfigs, ...invalidConfigs];
          const result = validateCustomProviders(allConfigs, []);

          // All valid configs should appear in valid results
          expect(result.valid.length).toBe(validConfigs.length);

          // There should be at least one error for the invalid configs
          expect(result.errors.length).toBeGreaterThanOrEqual(invalidConfigs.length);

          // No valid config name should appear in errors (unless it happens to share a name)
          for (const validEntry of result.valid) {
            expect(validEntry.name).toBeDefined();
            expect(validEntry.baseUrl).toBeDefined();
            expect(validEntry.apiCompatibility).toBeDefined();
            expect(validEntry.apiKeyEnvVar).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
