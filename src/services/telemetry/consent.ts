import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolveDataDir } from '../../shared/paths.js';
import { readJsonSafe } from '../../utils/json-utils.js';
import { logger } from '../../utils/logger.js';

export type TelemetryConfig = {
  /** Explicit user decision. Absent = no decision recorded; the opt-out default applies. */
  enabled?: boolean;
  installId: string;
  decidedAt: string;
};

const TELEMETRY_CONFIG_FILENAME = 'telemetry.json';

/**
 * DO_NOT_TRACK convention (consoledonottrack.com): the variable counts as
 * "set" when it has any non-empty value other than '0' or 'false'.
 */
function isDoNotTrackSet(env: NodeJS.ProcessEnv): boolean {
  const value = env.DO_NOT_TRACK;
  if (value === undefined || value === '') return false;
  return value !== '0' && value !== 'false';
}

/** Which layer of the precedence chain decided the consent outcome. */
export type TelemetryConsentSource = 'DO_NOT_TRACK' | 'env' | 'config' | 'default';

export type TelemetryConsentExplanation = {
  enabled: boolean;
  source: TelemetryConsentSource;
};

/**
 * FORK PATCH — telemetry is OFF AT BUILD LEVEL and cannot be turned back on.
 *
 * Owner ruling, 2026-08-24: "oh yuck, no phoning home at all."
 *
 * Upstream defaults telemetry ON (opt-out) as of 13.5.0, and 13.6.0 additionally
 * ships a ONE-TIME HISTORICAL BACKFILL that walks the local database and emits
 * inferred-install/activity events on first start. In an opt-out design the
 * kill-switch is an env var, which makes a single missing export — a cron, a
 * systemd unit, a bare `node worker-service.cjs`, a future wrapper that
 * sanitizes the environment — enough to silently start sending. That is a
 * failure mode we do not accept, so the fork does not rely on configuration at
 * all: consent is resolved to `false` unconditionally, here, at the one
 * chokepoint every send path funnels through.
 *
 * This is deliberately stronger than the upstream precedence chain: an explicit
 * CLAUDE_MEM_TELEMETRY=1 does NOT re-enable it. Nothing does, short of editing
 * this function. `DO_NOT_TRACK` / `CLAUDE_MEM_TELEMETRY=0` are still set in our
 * environment as belt-and-braces, but nothing here is load-bearing on them.
 *
 * Reported `source` stays 'DO_NOT_TRACK' so `claude-mem telemetry status` and
 * the install flow render "disabled" through their existing, unmodified paths.
 *
 * The upstream chain is preserved verbatim below as dead code, so a future
 * rebase can see exactly what was overridden rather than guessing.
 */
export function explainTelemetryConsent(
  _env: NodeJS.ProcessEnv,
  _config: TelemetryConfig | null
): TelemetryConsentExplanation {
  return { enabled: false, source: 'DO_NOT_TRACK' };
}

/**
 * Upstream's precedence chain, retained for rebase reference only. Not called.
 *
 * Precedence (first match wins):
 * 1. DO_NOT_TRACK set (truthy) -> always off
 * 2. CLAUDE_MEM_TELEMETRY env: '0'/'false'/'off' -> off, '1'/'true'/'on' -> on
 * 3. telemetry.json config: enabled === true -> on, enabled === false -> off
 * 4. Default: on (opt-out — anonymous events only; see docs.claude-mem.ai/telemetry)
 */
export function explainTelemetryConsentUpstream(
  env: NodeJS.ProcessEnv,
  config: TelemetryConfig | null
): TelemetryConsentExplanation {
  if (isDoNotTrackSet(env)) return { enabled: false, source: 'DO_NOT_TRACK' };

  const override = env.CLAUDE_MEM_TELEMETRY?.toLowerCase();
  if (override === '0' || override === 'false' || override === 'off') {
    return { enabled: false, source: 'env' };
  }
  if (override === '1' || override === 'true' || override === 'on') {
    return { enabled: true, source: 'env' };
  }

  if (config?.enabled === true) return { enabled: true, source: 'config' };
  if (config?.enabled === false) return { enabled: false, source: 'config' };

  return { enabled: true, source: 'default' };
}

/**
 * Resolves whether telemetry is allowed. Pure function — no I/O.
 * Thin wrapper over explainTelemetryConsent.
 */
export function resolveTelemetryConsent(
  env: NodeJS.ProcessEnv,
  config: TelemetryConfig | null
): boolean {
  return explainTelemetryConsent(env, config).enabled;
}

/**
 * Error-tracking kill-switch, INDEPENDENT of the analytics consent chain above.
 *
 * `CLAUDE_MEM_TELEMETRY_ERRORS=0` (or 'false'/'off') disables real exception
 * capture ($exception with redacted message/stack) WITHOUT touching analytics:
 * an operator who is fine with anonymous counters but not error text can opt out
 * of just the error path. Defaults ON whenever telemetry consent is on — error
 * capture is always additionally gated by the normal consent chain upstream, so
 * "consent off" already implies "no errors". Pure — no I/O.
 */
export function isErrorTelemetryEnabled(_env: NodeJS.ProcessEnv): boolean {
  // FORK PATCH (see explainTelemetryConsent above): hard off. Error capture
  // sends redacted exception messages and stack frames — the most identifying
  // payload in the whole telemetry surface, since stack frames carry absolute
  // paths. "No phoning home at all" covers this path explicitly.
  return false;
}

/** Absolute path of telemetry.json inside the claude-mem data dir. */
export function getTelemetryConfigPath(): string {
  return join(resolveDataDir(), TELEMETRY_CONFIG_FILENAME);
}

/**
 * Reads telemetry.json from the data dir. Returns null if the file is
 * missing, corrupt, or malformed — never throws.
 */
export function loadTelemetryConfig(): TelemetryConfig | null {
  let raw: Partial<TelemetryConfig> | null;
  try {
    raw = readJsonSafe<Partial<TelemetryConfig> | null>(getTelemetryConfigPath(), null);
  } catch (error) {
    // Corrupt JSON — treat as no recorded consent
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn('SYSTEM', 'Telemetry: corrupt telemetry.json; treating as no recorded consent', undefined, err);
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.installId !== 'string') return null;
  // enabled may be absent (no decision recorded — default applies), but a
  // present non-boolean value means the file is malformed.
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  return {
    enabled: raw.enabled,
    installId: raw.installId,
    decidedAt: typeof raw.decidedAt === 'string' ? raw.decidedAt : '',
  };
}

export function saveTelemetryConfig(config: TelemetryConfig): void {
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, TELEMETRY_CONFIG_FILENAME), JSON.stringify(config, null, 2) + '\n');
}

/**
 * Returns the stable anonymous install ID, generating and persisting one on
 * first use. Records ONLY the ID — never a consent decision — so the opt-out
 * default (and any future default change) still applies to this install.
 */
export function getOrCreateInstallId(): string {
  const existing = loadTelemetryConfig();
  if (existing?.installId) return existing.installId;

  const installId = randomUUID();
  saveTelemetryConfig({
    installId,
    decidedAt: '',
  });
  return installId;
}
