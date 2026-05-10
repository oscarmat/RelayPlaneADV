/**
 * Unit tests for proxy integration with custom providers (Task 5.4)
 *
 * Validates:
 * - Circuit breaker trips after consecutive failures to custom provider (Req 5.1)
 * - Cross-provider cascade includes custom providers (Req 5.4)
 * - Rate limiting applied to custom providers (Req 5.5)
 * - Cooldown applied after failures (Req 5.6)
 * - Telemetry records include custom provider name (Req 5.7)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { ProviderRegistry, type CustomProviderConfig } from '../src/provider-registry.js';
import { RateLimiter } from '../src/rate-limiter.js';
import { CrossProviderCascadeManager } from '../src/cross-provider-cascade.js';

// ─── Mock standalone-proxy.js ────────────────────────────────────────────────

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

// ─── Test Data ───────────────────────────────────────────────────────────────

const CUSTOM_PROVIDER: CustomProviderConfig = {
  name: 'my-custom-llm',
  baseUrl: 'https://custom-llm.example.com/v1',
  apiCompatibility: 'openai',
  apiKeyEnvVar: 'CUSTOM_LLM_KEY',
  apiKeyValue: 'sk-custom-test-key',
  models: ['custom-model-a', { name: 'custom-model-b', remoteModel: 'internal-model-b' }],
  costPer1kInput: 0.005,
  costPer1kOutput: 0.015,
};

const CUSTOM_ANTHROPIC_PROVIDER: CustomProviderConfig = {
  name: 'my-anthropic-proxy',
  baseUrl: 'https://anthropic-proxy.internal/v1',
  apiCompatibility: 'anthropic',
  apiKeyEnvVar: 'ANTHROPIC_PROXY_KEY',
  apiKeyValue: 'sk-anthropic-proxy-key',
  models: ['proxy-claude'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker with Custom Providers (Req 5.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('Circuit breaker trips after consecutive failures to custom provider', () => {
  let breakers: Map<string, CircuitBreaker>;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new Map();
    // Simulate creating a circuit breaker per custom provider (as done in proxy integration)
    breakers.set('my-custom-llm', new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 }));
    breakers.set('my-anthropic-proxy', new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 }));
  });

  afterEach(() => {
    for (const cb of breakers.values()) cb.destroy();
    vi.useRealTimers();
  });

  it('custom provider circuit breaker starts healthy', () => {
    const cb = breakers.get('my-custom-llm')!;
    expect(cb.isHealthy()).toBe(true);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('trips to OPEN after 3 consecutive failures to custom provider', () => {
    const cb = breakers.get('my-custom-llm')!;
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.isHealthy()).toBe(false);
  });

  it('custom provider circuit breaker is independent from other providers', () => {
    const customCb = breakers.get('my-custom-llm')!;
    const anthropicCb = breakers.get('my-anthropic-proxy')!;

    // Trip the custom provider
    customCb.recordFailure();
    customCb.recordFailure();
    customCb.recordFailure();

    expect(customCb.isHealthy()).toBe(false);
    expect(anthropicCb.isHealthy()).toBe(true); // other provider unaffected
  });

  it('custom provider circuit breaker recovers after cooldown period', () => {
    const cb = breakers.get('my-custom-llm')!;
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isHealthy()).toBe(false);

    // Advance past reset timeout
    vi.advanceTimersByTime(30_000);
    expect(cb.getState()).toBe('HALF-OPEN');
    expect(cb.isHealthy()).toBe(true);

    cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Provider Cascade Includes Custom Providers (Req 5.4)
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-provider cascade includes custom providers', () => {
  let registry: ProviderRegistry;
  let cascade: CrossProviderCascadeManager;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.load([CUSTOM_PROVIDER, CUSTOM_ANTHROPIC_PROVIDER]);
    cascade = new CrossProviderCascadeManager();
  });

  it('custom provider names are valid in cascade providers array', () => {
    cascade.configure({
      enabled: true,
      providers: ['anthropic', 'my-custom-llm', 'openai'],
    });
    expect(cascade.enabled).toBe(true);
    expect(cascade.getConfig().providers).toContain('my-custom-llm');
  });

  it('cascade falls back to custom provider when primary fails', async () => {
    cascade.configure({
      enabled: true,
      providers: ['anthropic', 'my-custom-llm'],
    });

    const fallbacks = cascade.getFallbackProviders('anthropic');
    expect(fallbacks).toContain('my-custom-llm');
  });

  it('custom provider can be the primary in cascade', () => {
    cascade.configure({
      enabled: true,
      providers: ['my-custom-llm', 'anthropic', 'openai'],
    });

    const fallbacks = cascade.getFallbackProviders('my-custom-llm');
    expect(fallbacks).toEqual(['anthropic', 'openai']);
  });

  it('cascade executes fallback to custom provider on 429', async () => {
    cascade.configure({
      enabled: true,
      providers: ['anthropic', 'my-custom-llm'],
    });

    const makeRequest = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: { id: 'custom-resp' },
    });
    const log = vi.fn();

    const { result } = await cascade.execute(
      'anthropic',
      'claude-sonnet-4-6',
      429,
      makeRequest,
      log,
    );

    expect(result.success).toBe(true);
    expect(result.provider).toBe('my-custom-llm');
  });

  it('registry resolves custom provider models for cascade routing', () => {
    const route = registry.resolveModel('custom-model-a');
    expect(route).not.toBeNull();
    expect(route!.provider).toBe('my-custom-llm');
    expect(route!.remoteModel).toBe('custom-model-a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting Applied to Custom Providers (Req 5.5)
// ─────────────────────────────────────────────────────────────────────────────

describe('Rate limiting applied to custom providers', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it('rate limit can be configured for a custom provider name', () => {
    limiter.configureProviders({
      'my-custom-llm': { rateLimit: { rpm: 5 } },
    });

    // First 5 requests should be allowed
    for (let i = 0; i < 5; i++) {
      const check = limiter.checkLimit('workspace-1', 'custom-model-a', 'my-custom-llm');
      expect(check.allowed).toBe(true);
    }

    // 6th request should be blocked
    const blocked = limiter.checkLimit('workspace-1', 'custom-model-a', 'my-custom-llm');
    expect(blocked.allowed).toBe(false);
  });

  it('rate limit for custom provider is isolated from built-in providers', () => {
    limiter.configureProviders({
      'my-custom-llm': { rateLimit: { rpm: 2 } },
      anthropic: { rateLimit: { rpm: 10 } },
    });

    // Exhaust custom provider limit
    limiter.checkLimit('workspace-1', 'custom-model-a', 'my-custom-llm');
    limiter.checkLimit('workspace-1', 'custom-model-a', 'my-custom-llm');
    const customBlocked = limiter.checkLimit('workspace-1', 'custom-model-a', 'my-custom-llm');
    expect(customBlocked.allowed).toBe(false);

    // Anthropic should still be available
    const anthropicCheck = limiter.checkLimit('workspace-1', 'claude-sonnet-4', 'anthropic');
    expect(anthropicCheck.allowed).toBe(true);
  });

  it('custom provider without explicit rate limit uses default', () => {
    // No configureProviders call for this provider — should use default rpm (60)
    const check = limiter.checkLimit('workspace-1', 'custom-model-a', 'my-custom-llm');
    expect(check.allowed).toBe(true);
    expect(check.limit).toBe(60); // default rpm
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cooldown Applied After Failures (Req 5.6)
// ─────────────────────────────────────────────────────────────────────────────

describe('Cooldown applied after failures to custom provider', () => {
  let breakers: Map<string, CircuitBreaker>;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new Map();
    breakers.set('my-custom-llm', new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 }));
  });

  afterEach(() => {
    for (const cb of breakers.values()) cb.destroy();
    vi.useRealTimers();
  });

  it('cooldown prevents requests during OPEN state', () => {
    const cb = breakers.get('my-custom-llm')!;
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    // Provider is in cooldown (OPEN state)
    expect(cb.isHealthy()).toBe(false);

    // Requests should not be sent during cooldown
    // (proxy checks isHealthy() before forwarding)
    expect(cb.getState()).toBe('OPEN');
  });

  it('cooldown duration matches resetTimeoutMs', () => {
    const cb = breakers.get('my-custom-llm')!;
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    // Still in cooldown at 59 seconds
    vi.advanceTimersByTime(59_000);
    expect(cb.getState()).toBe('OPEN');

    // Cooldown expires at 60 seconds
    vi.advanceTimersByTime(1_000);
    expect(cb.getState()).toBe('HALF-OPEN');
    expect(cb.isHealthy()).toBe(true);
  });

  it('probe failure during HALF-OPEN re-enters cooldown', () => {
    const cb = breakers.get('my-custom-llm')!;
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(60_000);
    expect(cb.getState()).toBe('HALF-OPEN');

    // Probe fails
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.isHealthy()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry Records Include Custom Provider Name (Req 5.7)
// ─────────────────────────────────────────────────────────────────────────────

describe('Telemetry records include custom provider name', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.load([CUSTOM_PROVIDER]);
  });

  it('resolved provider includes custom provider name', () => {
    const provider = registry.getProvider('my-custom-llm');
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('my-custom-llm');
    expect(provider!.isCustom).toBe(true);
  });

  it('model resolution returns custom provider name for telemetry use', () => {
    const route = registry.resolveModel('custom-model-a');
    expect(route).not.toBeNull();
    expect(route!.provider).toBe('my-custom-llm');
  });

  it('custom provider name is available in provider names list for telemetry enumeration', () => {
    const names = registry.getProviderNames();
    expect(names).toContain('my-custom-llm');
  });

  it('custom provider with remoteModel mapping preserves provider name in route', () => {
    const route = registry.resolveModel('custom-model-b');
    expect(route).not.toBeNull();
    expect(route!.provider).toBe('my-custom-llm');
    expect(route!.remoteModel).toBe('internal-model-b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// In-Flight Request Tracking (supports hot-reload safety)
// ─────────────────────────────────────────────────────────────────────────────

describe('In-flight request tracking for custom providers', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.load([CUSTOM_PROVIDER]);
  });

  it('initially has no in-flight requests', () => {
    expect(registry.hasInFlightRequests('my-custom-llm')).toBe(false);
  });

  it('trackRequestStart marks provider as having in-flight requests', () => {
    registry.trackRequestStart('my-custom-llm');
    expect(registry.hasInFlightRequests('my-custom-llm')).toBe(true);
  });

  it('trackRequestEnd decrements in-flight count', () => {
    registry.trackRequestStart('my-custom-llm');
    registry.trackRequestStart('my-custom-llm');
    registry.trackRequestEnd('my-custom-llm');
    expect(registry.hasInFlightRequests('my-custom-llm')).toBe(true);

    registry.trackRequestEnd('my-custom-llm');
    expect(registry.hasInFlightRequests('my-custom-llm')).toBe(false);
  });

  it('trackRequestEnd does not go below zero', () => {
    registry.trackRequestEnd('my-custom-llm');
    registry.trackRequestEnd('my-custom-llm');
    expect(registry.hasInFlightRequests('my-custom-llm')).toBe(false);
  });
});
