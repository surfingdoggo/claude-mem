import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';

function summariesFk(db: Database): { on_update: string; on_delete: string } {
  return (db.query('PRAGMA foreign_key_list(session_summaries)').all() as { table: string; on_update: string; on_delete: string }[])
    .find(fk => fk.table === 'sdk_sessions')!;
}

function summaryTriggers(db: Database): string[] {
  return (db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='session_summaries' ORDER BY name").all() as { name: string }[])
    .map(t => t.name);
}

// Reproduce what the v7 rebuild left on the live DB (d9754a31): the table
// recreated with ON DELETE CASCADE only, and its FTS triggers gone with it.
function dropCascadeAndTriggers(db: Database): void {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session_summaries'").get() as { sql: string };
  const dependents = db.query(
    "SELECT sql FROM sqlite_master WHERE tbl_name='session_summaries' AND type='index' AND sql IS NOT NULL"
  ).all() as { sql: string }[];
  db.run('PRAGMA foreign_keys = OFF');
  db.run(sql.replace(/\s+ON UPDATE CASCADE/i, '').replace(/CREATE TABLE\s+"?session_summaries"?/i, 'CREATE TABLE session_summaries_old_shape'));
  db.run('INSERT INTO session_summaries_old_shape SELECT * FROM session_summaries');
  db.run('DROP TABLE session_summaries');
  db.run('ALTER TABLE session_summaries_old_shape RENAME TO session_summaries');
  for (const dep of dependents) db.run(dep.sql);
  db.run('PRAGMA foreign_keys = ON');
}

function seedSessionWithSummary(db: Database, memorySessionId: string): void {
  db.run(
    `INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
     VALUES ('content-1', ?, 'proj', '2026-10-27T00:00:00Z', 1)`,
    [memorySessionId]
  );
  db.run(
    `INSERT INTO session_summaries (memory_session_id, project, request, created_at, created_at_epoch)
     VALUES (?, 'proj', 'summary request text', '2026-10-27T00:00:00Z', 1)`,
    [memorySessionId]
  );
}

describe('session_summaries FK cascade and FTS trigger self-heal', () => {
  it('restores ON UPDATE CASCADE so re-keying a session with a summary succeeds', () => {
    const db = new Database(':memory:');
    new SessionStore(db);
    dropCascadeAndTriggers(db);
    expect(summariesFk(db).on_update).toBe('NO ACTION');

    seedSessionWithSummary(db, 'old-id');
    expect(() => db.run("UPDATE sdk_sessions SET memory_session_id = 'new-id' WHERE memory_session_id = 'old-id'"))
      .toThrow(/FOREIGN KEY/);

    new SessionStore(db);

    expect(summariesFk(db)).toMatchObject({ on_update: 'CASCADE', on_delete: 'CASCADE' });
    db.run("UPDATE sdk_sessions SET memory_session_id = 'new-id' WHERE memory_session_id = 'old-id'");
    expect(db.query("SELECT memory_session_id FROM session_summaries").get()).toEqual({ memory_session_id: 'new-id' });
    db.close();
  });

  it('keeps every column and row through the heal', () => {
    const db = new Database(':memory:');
    new SessionStore(db);
    const columnsBefore = db.query('PRAGMA table_info(session_summaries)').all();
    dropCascadeAndTriggers(db);
    seedSessionWithSummary(db, 'id-1');

    new SessionStore(db);

    expect(db.query('PRAGMA table_info(session_summaries)').all()).toEqual(columnsBefore);
    expect(db.query('SELECT count(*) AS n FROM session_summaries').get()).toEqual({ n: 1 });
    db.close();
  });

  it('restores the FTS triggers and indexes summaries written while they were missing', () => {
    const db = new Database(':memory:');
    new SessionStore(db);
    new SessionSearch(db);
    const triggersBefore = summaryTriggers(db);
    expect(triggersBefore).toHaveLength(3);
    dropCascadeAndTriggers(db);
    seedSessionWithSummary(db, 'id-1');

    new SessionStore(db);

    expect(summaryTriggers(db)).toEqual(triggersBefore);
    expect(db.query("SELECT rowid FROM session_summaries_fts WHERE session_summaries_fts MATCH 'request'").all()).toHaveLength(1);
    db.close();
  });

  it('leaves a healthy schema untouched', () => {
    const db = new Database(':memory:');
    new SessionStore(db);
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE name='session_summaries'").get();

    new SessionStore(db);

    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='session_summaries'").get()).toEqual(before);
    db.close();
  });
});
