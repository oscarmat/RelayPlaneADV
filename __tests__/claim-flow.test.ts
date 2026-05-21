/**
 * Tests for claim-flow.ts: auto-initiated device auth at 100-request threshold
 *
 * Covers:
 *  (a) when device/start returns a valid code, banner is written to stderr and fallback is NOT shown
 *  (b) when device/start throws, fallback static URL message is shown instead
 *  (c) initiateClaimFlow does not throw when fetch is unavailable
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// This import will fail (module-not-found) until claim-flow.ts is created; valid failing test
import { initiateClaimFlow } from '../src/claim-flow.js';

describe('initiateClaimFlow', () => {
  let stderrOutput: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    stderrOutput = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('(a) writes banner with userCode and verificationUrl to stderr when device/start succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        userCode: 'ABCD-1234',
        verificationUrl: 'https://relayplane.com/activate?code=ABCD-1234',
      }),
    } as Response);

    await initiateClaimFlow();

    expect(stderrOutput).toContain('ABCD-1234');
    expect(stderrOutput).toContain('https://relayplane.com/activate');
    // fallback static URL must NOT appear as primary message
    expect(stderrOutput).not.toContain('relayplane.com/signup');
  });

  it('(b) falls back to static signup URL when device/start throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    await initiateClaimFlow();

    expect(stderrOutput).toContain('relayplane.com/signup');
  });

  it('(c) does not throw when fetch is not available', async () => {
    (globalThis as any).fetch = undefined;

    await expect(initiateClaimFlow()).resolves.toBeUndefined();
    // fallback should appear since fetch failed
    expect(stderrOutput).toContain('relayplane.com/signup');
  });

  it('(b) falls back to static signup URL when device/start returns non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal server error' }),
    } as Response);

    await initiateClaimFlow();

    expect(stderrOutput).toContain('relayplane.com/signup');
  });
});
