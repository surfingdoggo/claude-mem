
import type { ObservationSearchResult, SessionSummarySearchResult, UserPromptSearchResult, SearchOptions, DateRange } from '../../sqlite/types.js';
import { loadFromFileOnce } from '../../../shared/hook-settings.js';

export type { ObservationSearchResult, SessionSummarySearchResult, UserPromptSearchResult, SearchOptions, DateRange };

export const SEARCH_CONSTANTS = {
  RECENCY_WINDOW_MS: 90 * 24 * 60 * 60 * 1000,
  DEFAULT_LIMIT: 20,
  CHROMA_BATCH_SIZE: 100
} as const;

/**
 * FORK PATCH — the semantic-search recency window is CONFIGURABLE, and can be
 * switched off entirely.
 *
 * `CLAUDE_MEM_SEARCH_WINDOW_DAYS`:
 *   unset  -> the 90-day default above (upstream behaviour, unchanged)
 *   `0`    -> NO window; search the whole corpus
 *   `<n>`  -> an n-day window
 *
 * Why this exists. Upstream applies RECENCY_WINDOW_MS as a HARD filter at three
 * call sites, so anything older than 90 days is unreachable by semantic search
 * no matter how well it matches. Ticket `950cfe43` measured the consequence on
 * this corpus: the two highest-relevance hits for foundational rules —
 * "never-edit-other-repos" (rank #1) and "discuss-before-building" (rank #2) —
 * were both cut purely for age. Those are exactly the rules whose absence reads
 * as an agent ignoring canon, and the affected share grows with the corpus.
 *
 * Returns `null` when there is no window, which every call site must treat as
 * "apply no lower bound" rather than as epoch 0 — a `0` start silently reads as
 * "1970", which happens to work today but is a trap if the check ever changes.
 *
 * Invalid, negative and non-numeric values fall back to the default rather than
 * throwing: search degrading to upstream behaviour beats search that 500s.
 */
export function resolveRecencyWindowMs(
  env: NodeJS.ProcessEnv = process.env
): number | null {
  // process.env first, settings.json second — the same precedence
  // useRemoteProjectName() uses, and for the same reason.
  //
  // settings.json does NOT populate process.env: it is read separately via
  // loadFromFileOnce(). An env-only resolver therefore ignores the settings
  // file completely, so writing CLAUDE_MEM_SEARCH_WINDOW_DAYS there is a
  // SILENT NO-OP — the setting appears configured, nothing changes, and the
  // 90-day cut stays in place. That is the exact shape of bug this patch
  // exists to fix, so it must not be the shape of the fix.
  let raw = env.CLAUDE_MEM_SEARCH_WINDOW_DAYS;
  if (raw === undefined || raw.trim() === '') {
    try {
      raw = loadFromFileOnce().CLAUDE_MEM_SEARCH_WINDOW_DAYS;
    } catch {
      raw = undefined;
    }
  }
  if (raw === undefined || String(raw).trim() === '') return SEARCH_CONSTANTS.RECENCY_WINDOW_MS;

  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0) return SEARCH_CONSTANTS.RECENCY_WINDOW_MS;
  if (days === 0) return null;

  return days * 24 * 60 * 60 * 1000;
}

/**
 * Lower epoch bound for a search, or `null` for "no lower bound".
 * Thin helper so the three call sites cannot drift apart again.
 */
export function resolveRecencyStartEpoch(
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env
): number | null {
  const windowMs = resolveRecencyWindowMs(env);
  return windowMs === null ? null : now - windowMs;
}

export type ChromaDocType = 'observation' | 'session_summary' | 'user_prompt';

export interface ChromaMetadata {
  sqlite_id: number;
  doc_type: ChromaDocType;
  memory_session_id: string;
  project: string;
  platform_source?: string;
  created_at_epoch: number;
  type?: string;
  title?: string;
  subtitle?: string;
  concepts?: string;
  files_read?: string;
  files_modified?: string;
  field_type?: string;
  prompt_number?: number;
}

export type SearchResult = ObservationSearchResult | SessionSummarySearchResult | UserPromptSearchResult;

export interface SearchResults {
  observations: ObservationSearchResult[];
  sessions: SessionSummarySearchResult[];
  prompts: UserPromptSearchResult[];
}

export interface ExtendedSearchOptions extends SearchOptions {
  searchType?: 'observations' | 'sessions' | 'prompts' | 'all';
  obsType?: string | string[];
  concepts?: string | string[];
  files?: string | string[];
  format?: 'text' | 'json';
}

export type SearchStrategyHint = 'chroma' | 'sqlite' | 'hybrid' | 'auto';

export interface StrategySearchOptions extends ExtendedSearchOptions {
  query?: string;
  strategyHint?: SearchStrategyHint;
}

export interface StrategySearchResult {
  results: SearchResults;
  usedChroma: boolean;
  strategy: SearchStrategyHint;
}

export interface CombinedResult {
  type: 'observation' | 'session' | 'prompt';
  data: SearchResult;
  epoch: number;
  created_at: string;
}
