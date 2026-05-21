/**
 * Auto-initiated device auth flow for the signup nudge.
 * Fires at the 100-request threshold; falls back to static URL on any error.
 */

const VERSION = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('../package.json') as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function printFallback(): void {
  process.stderr.write(
    `\n💡 You've made 100+ requests through RelayPlane. Connect a free cloud account to sync savings history → relayplane.com/signup\n\n`
  );
}

function tryOpenBrowser(url: string): void {
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const openCmd =
      process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    execSync(`${openCmd} "${url}" 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
  } catch {
    // best-effort, ignore failures
  }
}

export async function initiateClaimFlow(): Promise<void> {
  try {
    if (typeof globalThis.fetch !== 'function') {
      throw new Error('fetch unavailable');
    }

    const res = await globalThis.fetch('https://api.relayplane.com/v1/cli/device/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: 'relayplane-proxy-claim', version: VERSION }),
    });

    if (!res.ok) {
      throw new Error(`device/start returned ${res.status}`);
    }

    const { userCode, verificationUrl } = (await res.json()) as {
      userCode: string;
      verificationUrl: string;
    };

    process.stderr.write(
      `\n╔══════════════════════════════════════════╗\n` +
      `║  Connect your RelayPlane account          ║\n` +
      `╚══════════════════════════════════════════╝\n` +
      `\n  Your one-time code:\n\n` +
      `    📋 ${userCode}\n\n` +
      `  Open: ${verificationUrl}\n\n`
    );

    const hasDisplay =
      process.platform === 'darwin' ||
      process.platform === 'win32' ||
      !!process.env.DISPLAY ||
      !!process.env.WAYLAND_DISPLAY;

    if (hasDisplay) {
      tryOpenBrowser(verificationUrl);
    }
  } catch {
    printFallback();
  }
}
