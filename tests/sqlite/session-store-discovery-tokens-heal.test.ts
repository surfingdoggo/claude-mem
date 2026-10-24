import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';

function columns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
}

describe('discovery_tokens column self-heal', () => {
  it('re-adds discovery_tokens to session_summaries when schema_versions already records migration 11', () => {
    const db = new Database(':memory:');
    new SessionStore(db);
    expect(db.query('SELECT version FROM schema_versions WHERE version = 11').get()).toBeTruthy();

    db.run('ALTER TABLE session_summaries DROP COLUMN discovery_tokens');
    expect(columns(db, 'session_summaries')).not.toContain('discovery_tokens');

    new SessionStore(db);

    expect(columns(db, 'session_summaries')).toContain('discovery_tokens');
    db.close();
  });

  it('re-adds discovery_tokens to observations the same way', () => {
    const db = new Database(':memory:');
    new SessionStore(db);

    db.run('ALTER TABLE observations DROP COLUMN discovery_tokens');
    new SessionStore(db);

    expect(columns(db, 'observations')).toContain('discovery_tokens');
    db.close();
  });

  it('leaves a healthy schema untouched', () => {
    const db = new Database(':memory:');
    new SessionStore(db);
    const before = columns(db, 'session_summaries');

    new SessionStore(db);

    expect(columns(db, 'session_summaries')).toEqual(before);
    db.close();
  });
});
