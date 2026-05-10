/**
 * Auth Resolver
 *
 * Resolves the correct authentication headers for a provider based on its
 * configuration: custom authHeader, apiCompatibility defaults, and any
 * additional custom headers defined in the provider config.
 *
 * @packageDocumentation
 */

import type { ResolvedProvider } from './provider-registry.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface AuthHeaders {
  [headerName: string]: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the complete set of headers for an outgoing request to a provider.
 *
 * Resolution logic:
 * 1. If the provider has an apiKey:
 *    - If `authHeader` is a custom value (not the default for the compatibility type),
 *      use that header name with the raw key as the value.
 *    - If `apiCompatibility === 'openai'`, use `Authorization: Bearer <key>`.
 *    - If `apiCompatibility === 'anthropic'`, use `x-api-key: <key>`.
 * 2. Merge with the provider's custom `headers` map (custom headers take precedence
 *    over auth headers in case of conflict).
 * 3. If no apiKey is available, skip the auth header but still include custom headers.
 */
export function buildAuthHeaders(provider: ResolvedProvider): AuthHeaders {
  const result: AuthHeaders = {};

  // Add authentication header if an API key is available
  if (provider.apiKey) {
    const authHeaderName = provider.authHeader;

    if (provider.apiCompatibility === 'openai' && authHeaderName === 'Authorization') {
      // Default OpenAI-style: Bearer token
      result['Authorization'] = `Bearer ${provider.apiKey}`;
    } else if (provider.apiCompatibility === 'anthropic' && authHeaderName === 'x-api-key') {
      // Default Anthropic-style: x-api-key
      result['x-api-key'] = provider.apiKey;
    } else {
      // Custom auth header name: use raw key as value
      result[authHeaderName] = provider.apiKey;
    }
  }

  // Merge custom headers (they take precedence over auth headers on conflict)
  if (provider.headers) {
    for (const [key, value] of Object.entries(provider.headers)) {
      result[key] = value;
    }
  }

  return result;
}
