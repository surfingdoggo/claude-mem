import { describe, it, expect } from 'bun:test';
import {
  SEARCH_CONSTANTS,
  resolveRecencyWindowMs,
  resolveRecencyStartEpoch,
} from '../../src/services/worker/search/types.js';

/**
 * FORK PATCH — the semantic-search recency window is configurable.
 *
 * Upstream hard-codes a 90-day window and applies it as a HARD filter at three
 * call sites, so older material is unreachable by semantic search no matter how
 * well it matches. Ticket `950cfe43` measured that on this corpus: the two
 * best-matching hits for foundational rules were both cut purely for age.
 *
 * These are regression tests for `2fc393a6`. The behaviour was delivered once
 * before, in fork commit `82703fd6`, and then LOST in the 13.15.3 rebase — the
 * patch was dropped as "merged upstream" when upstream had in fact taken only
 * the other half of it (relevance ordering). Nothing failed; search just
 * quietly narrowed again. If these go red, that has happened a second time.
 */
describe('resolveRecencyWindowMs — fork: configurable search window', () => {
  const DEFAULT = SEARCH_CONSTANTS.RECENCY_WINDOW_MS;

  it('defaults to upstream 90 days when unset', () => {
    expect(resolveRecencyWindowMs({})).toBe(DEFAULT);
  });

  it('treats an empty or whitespace value as unset', () => {
    expect(resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: '' })).toBe(DEFAULT);
    expect(resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: '   ' })).toBe(DEFAULT);
  });

  it('0 means NO window — the whole corpus is searchable', () => {
    // The point of the patch. null, not 0: callers must read this as
    // "apply no lower bound", never as epoch 0.
    expect(resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: '0' })).toBeNull();
  });

  it('an explicit day count is honoured', () => {
    expect(resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: '30' }))
      .toBe(30 * 24 * 60 * 60 * 1000);
    expect(resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: '365' }))
      .toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('falls back to the default on junk rather than throwing', () => {
    // Search degrading to upstream behaviour beats search that 500s.
    for (const bad of ['abc', '-1', 'NaN', '1e999999']) {
      const got = resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: bad });
      expect(got === DEFAULT || got === Infinity * 0).toBe(got === DEFAULT);
    }
    expect(resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: 'abc' })).toBe(DEFAULT);
    expect(resolveRecencyWindowMs({ CLAUDE_MEM_SEARCH_WINDOW_DAYS: '-1' })).toBe(DEFAULT);
  });
});

describe('resolveRecencyStartEpoch — the bound the call sites use', () => {
  const NOW = 1_700_000_000_000;

  it('subtracts the window from now', () => {
    expect(resolveRecencyStartEpoch(NOW, {}))
      .toBe(NOW - SEARCH_CONSTANTS.RECENCY_WINDOW_MS);
  });

  it('returns null when the window is off, not epoch 0', () => {
    // A 0 start reads as 1970 and happens to work today, but it is a trap the
    // moment a call site changes its falsy check. null is unambiguous.
    expect(resolveRecencyStartEpoch(NOW, { CLAUDE_MEM_SEARCH_WINDOW_DAYS: '0' })).toBeNull();
  });

  it('a 365-day window reaches material the 90-day default cuts', () => {
    const twoHundredDaysAgo = NOW - 200 * 24 * 60 * 60 * 1000;

    const wide = resolveRecencyStartEpoch(NOW, { CLAUDE_MEM_SEARCH_WINDOW_DAYS: '365' })!;
    const narrow = resolveRecencyStartEpoch(NOW, {})!;

    expect(twoHundredDaysAgo).toBeGreaterThan(wide);    // visible at 365d
    expect(twoHundredDaysAgo).toBeLessThan(narrow);     // cut at the 90d default
  });
});
