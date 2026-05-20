/**
 * Configuration Validator for Custom Providers
 *
 * Validates custom provider configurations at load time, ensuring all required
 * fields are present and correctly formatted before registering providers.
 *
 * @packageDocumentation
 */

import type { CustomProviderConfig } from './provider-registry.js';

export interface ValidationResult {
  valid: CustomProviderConfig[];
  errors: Array<{ provider: string; field: string; message: string }>;
  warnings: Array<{ provider: string; message: string }>;
}

/**
 * Validates an array of custom provider configurations.
 *
 * Checks required fields, URL validity, apiCompatibility values, and generates
 * warnings for name conflicts with built-in providers and missing API keys.
 *
 * @param configs - Raw configuration entries (unknown type for safety)
 * @param builtInNames - List of built-in provider names for conflict detection
 * @returns ValidationResult with valid configs, errors, and warnings
 */
export function validateCustomProviders(
  configs: unknown[],
  builtInNames: string[]
): ValidationResult {
  const valid: CustomProviderConfig[] = [];
  const errors: Array<{ provider: string; field: string; message: string }> = [];
  const warnings: Array<{ provider: string; message: string }> = [];

  for (const config of configs) {
    if (typeof config !== 'object' || config === null) {
      errors.push({
        provider: '<unknown>',
        field: 'entry',
        message: 'Provider entry must be a non-null object',
      });
      continue;
    }

    const entry = config as Record<string, unknown>;
    const providerName = typeof entry.name === 'string' && entry.name.trim() !== ''
      ? entry.name
      : '<unknown>';

    let hasError = false;

    // Validate name: required, non-empty string
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      errors.push({
        provider: providerName,
        field: 'name',
        message: 'Field "name" is required and must be a non-empty string',
      });
      hasError = true;
    }

    // Validate baseUrl: required, valid URL
    if (typeof entry.baseUrl !== 'string' || entry.baseUrl.trim() === '') {
      errors.push({
        provider: providerName,
        field: 'baseUrl',
        message: 'Field "baseUrl" is required and must be a non-empty string',
      });
      hasError = true;
    } else {
      try {
        new URL(entry.baseUrl);
      } catch {
        errors.push({
          provider: providerName,
          field: 'baseUrl',
          message: `Field "baseUrl" is not a valid URL: "${entry.baseUrl}"`,
        });
        hasError = true;
      }
    }

    // Validate apiCompatibility: required, must be 'openai' or 'anthropic'
    if (entry.apiCompatibility !== 'openai' && entry.apiCompatibility !== 'anthropic') {
      errors.push({
        provider: providerName,
        field: 'apiCompatibility',
        message: 'Field "apiCompatibility" must be "openai" or "anthropic"',
      });
      hasError = true;
    }

    // Validate apiKeyEnvVar: required, non-empty string
    if (typeof entry.apiKeyEnvVar !== 'string' || entry.apiKeyEnvVar.trim() === '') {
      errors.push({
        provider: providerName,
        field: 'apiKeyEnvVar',
        message: 'Field "apiKeyEnvVar" is required and must be a non-empty string',
      });
      hasError = true;
    }

    if (hasError) {
      continue;
    }

    // At this point all required fields are valid — cast to CustomProviderConfig
    const validConfig: CustomProviderConfig = {
      name: entry.name as string,
      baseUrl: entry.baseUrl as string,
      apiCompatibility: entry.apiCompatibility as 'openai' | 'anthropic',
      apiKeyEnvVar: entry.apiKeyEnvVar as string,
    };

    // Copy optional fields if present
    if (typeof entry.apiKeyValue === 'string') {
      validConfig.apiKeyValue = entry.apiKeyValue;
    }
    if (typeof entry.headers === 'object' && entry.headers !== null && !Array.isArray(entry.headers)) {
      validConfig.headers = entry.headers as Record<string, string>;
    }
    if (typeof entry.authHeader === 'string') {
      validConfig.authHeader = entry.authHeader;
    }
    if (Array.isArray(entry.models)) {
      validConfig.models = entry.models as Array<string | { name: string; remoteModel: string }>;
    }
    if (typeof entry.modelPrefix === 'string') {
      validConfig.modelPrefix = entry.modelPrefix;
    }
    if (typeof entry.costPer1kInput === 'number') {
      validConfig.costPer1kInput = entry.costPer1kInput;
    }
    if (typeof entry.costPer1kOutput === 'number') {
      validConfig.costPer1kOutput = entry.costPer1kOutput;
    }
    if (typeof entry.contextWindow === 'number') {
      validConfig.contextWindow = entry.contextWindow;
    }
    if (typeof entry.maxOutputTokens === 'number') {
      validConfig.maxOutputTokens = entry.maxOutputTokens;
    }

    // Generate warning for name conflicts with built-in providers
    if (builtInNames.includes(validConfig.name)) {
      warnings.push({
        provider: validConfig.name,
        message: `Custom provider "${validConfig.name}" overrides a built-in provider with the same name`,
      });
    }

    // Generate warning for missing API key (env var not set, no apiKeyValue)
    if (!validConfig.apiKeyValue) {
      const envValue = process.env[validConfig.apiKeyEnvVar];
      if (!envValue) {
        warnings.push({
          provider: validConfig.name,
          message: `API key not available: environment variable "${validConfig.apiKeyEnvVar}" is not set and no "apiKeyValue" is provided. Provider will not be usable until the key is configured.`,
        });
      }
    }

    valid.push(validConfig);
  }

  return { valid, errors, warnings };
}
