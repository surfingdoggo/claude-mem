// SPDX-License-Identifier: Apache-2.0
//
// Coverage for PostgresServerSessionsRepository.findByContentSessionIdForScope,
// the lookup that lets /v1/events link an event to its session when the caller
// sends contentSessionId (as hooks do) but no serverSessionId.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import pg from 'pg';
import {
  bootstrapServerBetaPostgresSchema,
  createPostgresStorageRepositories,
  type PostgresPoolClient,
  type PostgresStorageRepositories,
} from '../../src/storage/postgres/index.js';

const testDatabaseUrl = process.env.CLAUDE_MEM_TEST_POSTGRES_URL;

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

describe('PostgresServerSessionsRepository.findByContentSessionIdForScope', () => {
  if (!testDatabaseUrl) {
    it.skip('requires CLAUDE_MEM_TEST_POSTGRES_URL', () => {});
    return;
  }

  const pool = new pg.Pool({ connectionString: testDatabaseUrl });
  let client: PostgresPoolClient;
  let schemaName: string;
  let storage: PostgresStorageRepositories;
  let teamId: string;
  let projectId: string;

  beforeEach(async () => {
    client = await pool.connect();
    schemaName = `cm_csid_${crypto.randomUUID().replaceAll('-', '_')}`;
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await client.query(`SET search_path TO ${quoteIdentifier(schemaName)}`);
    await bootstrapServerBetaPostgresSchema(client);
    storage = createPostgresStorageRepositories(client);

    const team = await storage.teams.create({ name: 'team' });
    const project = await storage.projects.create({ teamId: team.id, name: 'money-marathon/prolific' });
    teamId = team.id;
    projectId = project.id;
  });

  afterEach(async () => {
    if (!client) return;
    try {
      if (schemaName) {
        await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('resolves a session by its content session id within scope', async () => {
    const created = await storage.sessions.create({
      projectId,
      teamId,
      externalSessionId: 'ext-1',
      contentSessionId: 'content-1',
    });

    const found = await storage.sessions.findByContentSessionIdForScope({
      contentSessionId: 'content-1',
      projectId,
      teamId,
    });

    expect(found?.id).toBe(created.id);
    expect(found?.contentSessionId).toBe('content-1');
  });

  it('returns null for an unknown content session id', async () => {
    await storage.sessions.create({
      projectId,
      teamId,
      contentSessionId: 'content-1',
    });

    const found = await storage.sessions.findByContentSessionIdForScope({
      contentSessionId: 'no-such-content-id',
      projectId,
      teamId,
    });

    expect(found).toBeNull();
  });

  it('does not cross tenant scope (wrong team/project yields null)', async () => {
    await storage.sessions.create({
      projectId,
      teamId,
      contentSessionId: 'content-1',
    });

    const otherTeam = await storage.teams.create({ name: 'other-team' });
    const otherProject = await storage.projects.create({ teamId: otherTeam.id, name: 'other' });

    // Right content id, wrong project — must not leak across projects.
    const wrongProject = await storage.sessions.findByContentSessionIdForScope({
      contentSessionId: 'content-1',
      projectId: otherProject.id,
      teamId,
    });
    expect(wrongProject).toBeNull();

    // Right content id, wrong team — must not leak across teams.
    const wrongTeam = await storage.sessions.findByContentSessionIdForScope({
      contentSessionId: 'content-1',
      projectId,
      teamId: otherTeam.id,
    });
    expect(wrongTeam).toBeNull();
  });
});
