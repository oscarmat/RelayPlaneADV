/**
 * Provider Registry
 *
 * Central registry that manages all LLM providers (built-in + custom).
 * Merges user-defined custom providers from configuration with the built-in
 * DEFAULT_ENDPOINTS and MODEL_MAPPING, providing unified model resolution,
 * prefix-based routing, and in-flight request tracking for hot-reload safety.
 *
 * @packageDocumentation
 */

import { DEFAULT_ENDPOINTS, MODEL_MAPPING } from './standalone-proxy.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Configuration for a custom provider as defined in the user's config file.
 */
export interface CustomProviderConfig {
  /** Unique identifier for the provider */
  name: string;
  /** Base URL for API requests (e.g., "https://api.example.com/v1") */
  baseUrl: string;
  /** API compatibility type */
  apiCompatibility: 'openai' | 'anthropic';
  /** Environment variable name containing the API key */
  apiKeyEnvVar: string;
  /** Direct API key value (takes priority over env var) */
  apiKeyValue?: string;
  /** Custom headers to include in every request */
  headers?: Record<string, string>;
  /** Custom auth header name (overrides default for the compatibility type) */
  authHeader?: string;
  /** Model definitions */
  models?: Array<string | { name: string; remoteModel: string }>;
  /** Prefix-based routing: all models starting with this prefix route here */
  modelPrefix?: string;
  /** Cost per 1K input tokens (USD) */
  costPer1kInput?: number;
  /** Cost per 1K output tokens (USD) */
  costPer1kOutput?: number;
}

/**
 * A fully resolved provider ready for use at runtime.
 */
export interface ResolvedProvider {
  name: string;
  baseUrl: string;
  apiCompatibility: 'openai' | 'anthropic';
  apiKey: string | null;
  /** The environment variable name for the API key (used in error messages) */
  apiKeyEnvVar: string;
  headers: Record<string, string>;
  authHeader: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  isCustom: boolean;
}

/**
 * A resolved model route indicating which provider handles a model
 * and what remote model name to use upstream.
 */
export interface ModelRoute {
  provider: string;
  remoteModel: string;
}

/**
 * Result of a reload operation, listing what changed.
 */
export interface ReloadResult {
  added: string[];
  removed: string[];
  unchanged: string[];
  errors: string[];
}

// ─── Built-in Provider Compatibility Mapping ─────────────────────────────────

/**
 * Maps built-in provider names to their API compatibility type.
 * Most providers use OpenAI-compatible APIs; Anthropic uses its own format.
 */
const BUILT_IN_COMPATIBILITY: Record<string, 'openai' | 'anthropic'> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'openai',
  xai: 'openai',
  openrouter: 'openai',
  deepseek: 'openai',
  groq: 'openai',
  mistral: 'openai',
  together: 'openai',
  fireworks: 'openai',
  perplexity: 'openai',
  ollama: 'openai',
};

// ─── ProviderRegistry Class ──────────────────────────────────────────────────

export class ProviderRegistry {
  private providers: Map<string, ResolvedProvider>;
  private modelRoutes: Map<string, ModelRoute>;
  private prefixRoutes: Array<{ prefix: string; provider: string }>;
  private inFlightCount: Map<string, number>;

  constructor() {
    this.providers = new Map();
    this.modelRoutes = new Map();
    this.prefixRoutes = [];
    this.inFlightCount = new Map();
  }

  /**
   * Load custom providers from config, merge with built-in providers.
   * Custom providers override built-in ones when names conflict.
   * Custom model definitions override built-in MODEL_MAPPING entries.
   */
  load(customProviders: CustomProviderConfig[]): ReloadResult {
    const result: ReloadResult = { added: [], removed: [], unchanged: [], errors: [] };

    // Snapshot previous provider names for diff
    const previousNames = new Set(this.providers.keys());

    // Clear current state
    this.providers.clear();
    this.modelRoutes.clear();
    this.prefixRoutes = [];

    // 1. Load built-in providers from DEFAULT_ENDPOINTS
    for (const [name, endpoint] of Object.entries(DEFAULT_ENDPOINTS)) {
      const compatibility = BUILT_IN_COMPATIBILITY[name] || 'openai';
      const defaultAuthHeader = compatibility === 'anthropic' ? 'x-api-key' : 'Authorization';

      this.providers.set(name, {
        name,
        baseUrl: endpoint.baseUrl,
        apiCompatibility: compatibility,
        apiKey: process.env[endpoint.apiKeyEnv] || null,
        apiKeyEnvVar: endpoint.apiKeyEnv,
        headers: {},
        authHeader: defaultAuthHeader,
        costPer1kInput: 0,
        costPer1kOutput: 0,
        isCustom: false,
      });
    }

    // 2. Load built-in model routes from MODEL_MAPPING
    for (const [modelName, mapping] of Object.entries(MODEL_MAPPING)) {
      this.modelRoutes.set(modelName, {
        provider: mapping.provider,
        remoteModel: mapping.model,
      });
    }

    // 3. Load custom providers (override built-in if name conflicts)
    for (const config of customProviders) {
      // Resolve API key: apiKeyValue takes priority over env var
      const apiKey = config.apiKeyValue ?? process.env[config.apiKeyEnvVar] ?? null;

      // Determine auth header
      let authHeader: string;
      if (config.authHeader) {
        authHeader = config.authHeader;
      } else if (config.apiCompatibility === 'anthropic') {
        authHeader = 'x-api-key';
      } else {
        authHeader = 'Authorization';
      }

      const resolved: ResolvedProvider = {
        name: config.name,
        baseUrl: config.baseUrl,
        apiCompatibility: config.apiCompatibility,
        apiKey,
        apiKeyEnvVar: config.apiKeyEnvVar,
        headers: config.headers ?? {},
        authHeader,
        costPer1kInput: config.costPer1kInput ?? 0,
        costPer1kOutput: config.costPer1kOutput ?? 0,
        isCustom: true,
      };

      this.providers.set(config.name, resolved);

      // Register explicit model routes (custom models override built-in)
      if (config.models) {
        for (const entry of config.models) {
          if (typeof entry === 'string') {
            this.modelRoutes.set(entry, {
              provider: config.name,
              remoteModel: entry,
            });
          } else {
            this.modelRoutes.set(entry.name, {
              provider: config.name,
              remoteModel: entry.remoteModel,
            });
          }
        }
      }

      // Register prefix route
      if (config.modelPrefix) {
        this.prefixRoutes.push({
          prefix: config.modelPrefix,
          provider: config.name,
        });
      }
    }

    // Sort prefix routes by length descending (longest prefix wins)
    this.prefixRoutes.sort((a, b) => b.prefix.length - a.prefix.length);

    // 4. Compute diff for reload result
    const currentNames = new Set(this.providers.keys());

    for (const name of currentNames) {
      if (previousNames.has(name)) {
        result.unchanged.push(name);
      } else {
        result.added.push(name);
      }
    }

    for (const name of previousNames) {
      if (!currentNames.has(name)) {
        result.removed.push(name);
      }
    }

    return result;
  }

  /**
   * Reload providers from a new set of custom provider configs.
   * Computes diff relative to current state.
   * In-flight requests to removed providers are preserved (tracked separately).
   */
  reload(customProviders: CustomProviderConfig[]): ReloadResult {
    return this.load(customProviders);
  }

  /**
   * Resolve a model name to its target provider and remote model.
   * Resolution order:
   *   1. Exact match in modelRoutes
   *   2. Prefix-based routing (longest prefix wins)
   *   3. null if no match found
   */
  resolveModel(modelName: string): ModelRoute | null {
    // 1. Exact match
    const exactMatch = this.modelRoutes.get(modelName);
    if (exactMatch) {
      return exactMatch;
    }

    // 2. Prefix-based routing (already sorted by length descending)
    for (const { prefix, provider } of this.prefixRoutes) {
      if (modelName.startsWith(prefix)) {
        return {
          provider,
          remoteModel: modelName,
        };
      }
    }

    // 3. No match
    return null;
  }

  /**
   * Get the resolved provider config by name.
   */
  getProvider(name: string): ResolvedProvider | null {
    return this.providers.get(name) ?? null;
  }

  /**
   * Get all registered provider names.
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all registered model names (from explicit model routes only, not prefix routes).
   */
  getModelNames(): string[] {
    return Array.from(this.modelRoutes.keys());
  }

  /**
   * Track the start of an in-flight request to a provider.
   */
  trackRequestStart(provider: string): void {
    const current = this.inFlightCount.get(provider) ?? 0;
    this.inFlightCount.set(provider, current + 1);
  }

  /**
   * Track the end of an in-flight request to a provider.
   */
  trackRequestEnd(provider: string): void {
    const current = this.inFlightCount.get(provider) ?? 0;
    this.inFlightCount.set(provider, Math.max(0, current - 1));
  }

  /**
   * Check if a provider has any in-flight requests.
   * Used during hot-reload to determine if a removed provider
   * still has active connections that need to complete.
   */
  hasInFlightRequests(provider: string): boolean {
    return (this.inFlightCount.get(provider) ?? 0) > 0;
  }
}
