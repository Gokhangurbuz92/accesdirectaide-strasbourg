/**
 * RECON Pro B02 — the read marker of pro conversations, offline: the service against a database double with and without "RdvConversationRead", and the
 * shape of migration 0049 (additive, rollback forgets the journal row). The real-database proof on both levels is tests/integration/pa-pro-messages-read-db.
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
import { conversationReadAvailable, forgetConversationReadSchema, markConversationRead, unreadConversationCount, unreadConversationIds } from '../../api/_services/conversation-read.js';
import { expectedObjects } from '../../scripts/db-migrate-guard.mjs';

const dialect = new PgDialect();
function fakeDb({ table, unread = [] }) {
  const statements = [];
  return { statements, execute: async (q) => {
    const text = dialect.sqlToQuery(q).sql; statements.push(text);
    if (/information_schema\.tables/.test(text)) return { rows: table ? [{ ok: 1 }] : [] };
    if (/count\(\*\)/.test(text)) return { rows: [{ n: unread.length }] };
    if (/^\s*SELECT c\.id/.test(text)) return { rows: unread.map((id) => ({ id })) };
    return { rows: [] };
  } };
}
const ctx = { structureId: 's1', userId: 'u1' };

describe('B02 conversation read marker', () => {
  it('without the table (database before 0049): unknown, never zero; nothing names the table; the message notices are still marked read', async () => {
    const db = fakeDb({ table: false });
    expect(await conversationReadAvailable(db)).toBe(false);
    expect(await unreadConversationCount(ctx, db)).toBeNull();
    expect(await unreadConversationIds(ctx, db)).toBeNull();
    expect(await markConversationRead({ conversationId: 'c1', appointmentId: 'a1', ...ctx }, db)).toEqual({ marked: false });
    expect(db.statements.some((s) => /"RdvConversationRead"/.test(s))).toBe(false);
    expect(db.statements.some((s) => /UPDATE "ProNotification"/.test(s) && /message_received/.test(s))).toBe(true);
    expect(db.statements.filter((s) => /information_schema/.test(s)), 'the catalogue is asked once, then remembered').toHaveLength(1);
  });
  it('with the table: the count and the ids come from the marker; opening a thread upserts the member’s marker', async () => {
    const db = fakeDb({ table: true, unread: ['c1', 'c2'] });
    expect(await unreadConversationCount(ctx, db)).toBe(2);
    expect([...(await unreadConversationIds(ctx, db))]).toEqual(['c1', 'c2']);
    expect(await markConversationRead({ conversationId: 'c1', appointmentId: 'a1', ...ctx }, db)).toEqual({ marked: true });
    const upsert = db.statements.find((s) => /INSERT INTO "RdvConversationRead"/.test(s));
    expect(upsert).toMatch(/ON CONFLICT \("conversationId", "proUserId"\) DO UPDATE SET "lastReadAt" = now\(\)/);
    const unread = db.statements.find((s) => /^\s*SELECT c\.id/.test(s));
    expect(unread).toMatch(/c\."structureId" = \$/);   // the member's own structure only
    expect(unread).toMatch(/GREATEST/);                // after the member's marker AND the team's last reply
  });
  it('a failed catalogue read is not remembered; a marker write that fails never throws', async () => {
    let calls = 0;
    const db = { execute: async () => { calls += 1; throw new Error('down'); } };
    await expect(conversationReadAvailable(db)).rejects.toThrow();
    await expect(conversationReadAvailable(db)).rejects.toThrow();
    expect(calls).toBe(2);
    expect(await markConversationRead({ conversationId: 'c1', appointmentId: 'a1', ...ctx }, db)).toEqual({ marked: false });
    forgetConversationReadSchema(db);
  });
  it('the unread-count endpoint reports the unknown state exactly as before when there is no marker', () => {
    const src = fs.readFileSync('api/_handlers/pro/notifications/unread-count.js', 'utf8');
    expect(src).toMatch(/countScope: messages === null \? 'notifications_only' : 'notifications_and_messages'/);
    expect(src).toMatch(/messageReadStateAvailable: messages !== null/);
    expect(src).toMatch(/total: notifCount/);
  });
});

describe('B02 migration 0049', () => {
  const up = fs.readFileSync('drizzle/0049_pa_conversation_read.sql', 'utf8');
  const down = fs.readFileSync('drizzle/rollback/0049_down.sql', 'utf8');
  const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
  const entry = journal.find((e) => e.tag === '0049_pa_conversation_read');
  it('is additive: one new table with its keys and index, nothing altered or dropped elsewhere', () => {
    const ops = expectedObjects(up);
    expect(ops.every((o) => o.op === 'add')).toBe(true);
    expect(ops.filter((o) => o.kind === 'table').map((o) => o.key)).toEqual(['RdvConversationRead']);
    expect(ops.every((o) => o.kind === 'table' || o.table === 'RdvConversationRead')).toBe(true);
    expect(up.replace(/--[^\n]*/g, '')).not.toMatch(/\bDROP\b|\bINSERT INTO\b|\bDELETE FROM\b|\bUPDATE "/);
  });
  it('journal entry 49 is later than every earlier entry; the rollback drops the table and forgets that journal row', () => {
    expect(entry).toMatchObject({ idx: 49, version: '7', breakpoints: true });
    expect(journal.filter((e) => e.idx < 49).every((e) => e.when < entry.when)).toBe(true);
    expect(down).toMatch(/DROP TABLE IF EXISTS "RdvConversationRead";/);
    expect(down.trim().endsWith(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when};`)).toBe(true);
    expect(fs.existsSync('drizzle/meta/0049_snapshot.json')).toBe(true);
    expect(JSON.parse(fs.readFileSync('drizzle/meta/0049_snapshot.json', 'utf8')).tables['public.RdvConversationRead']).toBeTruthy();
  });
  it('no relation is declared on the table and only the read service names it (existing queries are identical on a database without it)', () => {
    const schema = fs.readFileSync('src/db/schema.ts', 'utf8');
    expect(schema).toMatch(/export const RdvConversationRead = pgTable\('RdvConversationRead'/);
    expect(schema).not.toMatch(/RdvConversationReadRelations|many\(RdvConversationRead|one\(RdvConversationRead/);
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : /\.js$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    expect(files('api').filter((f) => fs.readFileSync(f, 'utf8').includes('RdvConversationRead'))).toEqual(['api/_services/conversation-read.js']);
  });
});
