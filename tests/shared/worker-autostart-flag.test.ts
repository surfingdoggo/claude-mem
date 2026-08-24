import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Drives what loadFromFileOnce() returns per test (the settings object).
let settings: Record<string, unknown> = {};

// Record fetch calls so we can assert the worker was never contacted in the
// opt-out path (no health check, no lazy-spawn).
const fetchLog: Array<{ url: string; method: string }> = [];

mock.module('../../src/shared/hook-settings.js', () => ({
  loadFromFileOnce: () => settings,
}));

// For the default (autostart on) path, present a healthy/version-matched worker
// so ensureWorkerRunning() resolves true without an actual spawn.
//
// DELIBERATELY NOT MOCKING src/supervisor/index.js. An earlier revision stubbed
// that whole namespace (validateWorkerPidFile: () => 'alive') "only so the
// static import resolves". bun's mock.module is PROCESS-GLOBAL and mock.restore()
// does not undo it, so the stub outlived this file and every later test that
// imported the real supervisor got the stub instead: tests/supervisor/index.test.ts
// then failed with `expected "missing", received "alive"` — six failures whose
// stack traces point at innocent files, and which pass when run in isolation.
// Nothing here needs the stub: the health fetch is mocked below, so
// ensureWorkerAliveOnce() resolves without ever reaching getSupervisor().
mock.module('../../src/services/infrastructure/index.js', () => ({
  checkVersionMatch: () =>
    Promise.resolve({ matches: true, pluginVersion: '13.4.1', workerVersion: '13.4.1' }),
}));

function installFetchMock(): void {
  fetchLog.length = 0;
  global.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    fetchLog.push({ url: u, method: (init?.method ?? 'GET').toUpperCase() });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    } as unknown as Response);
  }) as unknown as typeof fetch;
}

describe('ensureWorkerAliveOnce — CLAUDE_MEM_WORKER_AUTOSTART opt-out', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    installFetchMock();
    const { resetAliveCache } = await import('../../src/shared/worker-utils.js');
    resetAliveCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mock.restore();
  });

  it('returns false and never contacts the worker when AUTOSTART=false', async () => {
    settings = { CLAUDE_MEM_WORKER_AUTOSTART: 'false' };

    const { ensureWorkerAliveOnce } = await import('../../src/shared/worker-utils.js');

    expect(await ensureWorkerAliveOnce()).toBe(false);
    expect(fetchLog).toHaveLength(0); // short-circuited before any spawn/health check
  });

  it('proceeds normally (true for a live worker) when AUTOSTART is unset (default)', async () => {
    settings = {};

    const { ensureWorkerAliveOnce } = await import('../../src/shared/worker-utils.js');

    expect(await ensureWorkerAliveOnce()).toBe(true);
  });

  it('treats AUTOSTART=true the same as unset', async () => {
    settings = { CLAUDE_MEM_WORKER_AUTOSTART: 'true' };

    const { ensureWorkerAliveOnce } = await import('../../src/shared/worker-utils.js');

    expect(await ensureWorkerAliveOnce()).toBe(true);
  });
});
