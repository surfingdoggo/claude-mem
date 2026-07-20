
import type { ObservationSearchResult, SessionSummarySearchResult, UserPromptSearchResult, SearchOptions, DateRange } from '../../sqlite/types.js';

export type { ObservationSearchResult, SessionSummarySearchResult, UserPromptSearchResult, SearchOptions, DateRange };

export const SEARCH_CONSTANTS = {
  get RECENCY_WINDOW_DAYS() {
    const val = process.env.CLAUDE_MEM_SEARCH_WINDOW_DAYS;
    return val !== undefined && val !== '' ? Number(val) : 90;
  },
  get RECENCY_WINDOW_MS() {
    return this.RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  },
  DEFAULT_LIMIT: 20,
  CHROMA_BATCH_SIZE: 100
};

export type ChromaDocType = 'observation' | 'session_summary' | 'user_prompt';

export interface ChromaQueryResult {
  ids: number[];
  distances: number[];
  metadatas: ChromaMetadata[];
}

export interface ChromaMetadata {
  sqlite_id: number;
  doc_type: ChromaDocType;
  memory_session_id: string;
  project: string;
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
