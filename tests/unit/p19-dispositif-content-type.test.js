/**
 * P19 (RECON public A-6) — the ContentType value DISPOSITIF (migration 0051). With it, POST /api/feedback files a dispositif report as DISPOSITIF; on a
 * database without it (Production until 0051 is authorised), when the catalogue read fails, or for a database double without execute(), exactly as before:
 * AIDE + « dispositif:<id> ». An insert refused for the value (0051 rolled back inside the cache delay) is retried in the pre-0051 form, never lost.
 * The migration, its rollback and the journal entry are pinned. The real-database proof on both levels: tests/integration/p19-dispositif-report-db.test.js.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const state = vi.hoisted(() => ({ values: /** @type {any[]} */ ([]), enumRows: /** @type {any[] | Error} */ ([]), refuseDispositif: false, reads: 0 }));
vi.mock('../../src/db/index.js', () => ({
  db: {
    execute: async () => { state.reads += 1; if (state.enumRows instanceof Error) throw state.enumRows; return { rows: state.enumRows }; },
    insert: () => ({ values: (/** @type {any} */ v) => ({ returning: async () => {
      if (state.refuseDispositif && v.contentType === 'DISPOSITIF') throw Object.assign(new Error('invalid input value for enum "ContentType": "DISPOSITIF"'), { code: '22P02' });
      state.values.push(v); return [{ id: `cr-${state.values.length}`, ...v }];
    } }) }),
  },
}));
vi.mock('../../api/_services/feature-flags.js', () => ({ isFeatureOn: async () => true }));

import handler from '../../api/_handlers/feedback.js';
import { db } from '../../src/db/index.js';
import { contentTypeSchema, dispositifReportKind, dispositifReportRow, forgetContentTypeSchema, isEnumValueRefusal } from '../../api/_utils/schema-features.js';

let n = 0;
const call = async (body) => {
  const res = { statusCode: 200, body: /** @type {any} */ (null), status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
  await handler({ method: 'POST', url: '/api/feedback', headers: { 'x-forwarded-for': `198.51.100.${10 + (++n % 200)}` }, body }, res);
  return res;
};
beforeEach(() => { state.values.length = 0; state.enumRows = []; state.refuseDispositif = false; state.reads = 0; forgetContentTypeSchema(db); });

describe('P19: dispositif reports and migration 0051', () => {
  it('with 0051 a dispositif report is DISPOSITIF with its bare target (id, or slug:<slug>)', async () => {
    state.enumRows = [{ present: 1 }];
    const res = await call({ type: 'dispositif', id: 'dp-1', message: 'Le lien officiel a changé.' });
    expect(res.statusCode).toBe(201);
    await call({ type: 'dispositif', slug: 'carte-vitale', message: 'Le lien officiel a changé.' });
    expect(state.values.map((v) => [v.contentType, v.contentId])).toEqual([['DISPOSITIF', 'dp-1'], ['DISPOSITIF', 'slug:carte-vitale']]);
    expect(state.reads).toBe(1);   // read once, then cached
  });
  it('without 0051 (no enum row) the report is filed exactly as before: AIDE + « dispositif:<id> »', async () => {
    const res = await call({ type: 'dispositif', id: 'dp-1', message: 'Le lien officiel a changé.' });
    expect(res.statusCode).toBe(201);
    expect(state.values[0]).toMatchObject({ contentType: 'AIDE', contentId: 'dispositif:dp-1', reason: 'AUTRE' });
  });
  it('a failed catalogue read answers « without 0051 » and is not remembered', async () => {
    state.enumRows = new Error('catalogue unavailable');
    await call({ type: 'dispositif', id: 'dp-2', message: 'Le lien officiel a changé.' });
    expect(state.values[0]).toMatchObject({ contentType: 'AIDE', contentId: 'dispositif:dp-2' });
    state.enumRows = [{ present: 1 }];
    await call({ type: 'dispositif', id: 'dp-3', message: 'Le lien officiel a changé.' });
    expect(state.values[1]).toMatchObject({ contentType: 'DISPOSITIF', contentId: 'dp-3' });
  });
  it('a DISPOSITIF insert refused by the database (0051 rolled back meanwhile) is filed in the pre-0051 form, and the cache is forgotten', async () => {
    state.enumRows = [{ present: 1 }]; state.refuseDispositif = true;
    const res = await call({ type: 'dispositif', id: 'dp-4', message: 'Le lien officiel a changé.' });
    expect(res.statusCode).toBe(201);
    expect(state.values).toEqual([expect.objectContaining({ contentType: 'AIDE', contentId: 'dispositif:dp-4' })]);
    state.enumRows = [];
    expect(await contentTypeSchema(db)).toEqual({ dispositif: false });
  });
  it('the other kinds are unchanged on both levels', async () => {
    for (const rows of [[], [{ present: 1 }]]) {
      state.enumRows = rows; forgetContentTypeSchema(db); state.values.length = 0;
      await call({ type: 'aide', id: 'a-1', message: 'Montant à vérifier.' });
      await call({ type: 'structure', slug: 'lieu', message: 'Horaires à corriger.' });
      expect(state.values.map((v) => [v.contentType, v.contentId])).toEqual([['AIDE', 'a-1'], ['STRUCTURE', 'slug:lieu']]);
    }
  });
  it('helpers: the row on each level, the kind of both forms, the refusal code, a double without execute()', async () => {
    expect(dispositifReportRow({ dispositif: true }, 'dp-1')).toEqual({ contentType: 'DISPOSITIF', contentId: 'dp-1' });
    expect(dispositifReportRow({ dispositif: true }, 'dispositif:dp-1')).toEqual({ contentType: 'DISPOSITIF', contentId: 'dp-1' });
    expect(dispositifReportRow({ dispositif: false }, 'dp-1')).toEqual({ contentType: 'AIDE', contentId: 'dispositif:dp-1' });
    expect(dispositifReportRow({ dispositif: false }, 'dispositif:dp-1')).toEqual({ contentType: 'AIDE', contentId: 'dispositif:dp-1' });
    expect(dispositifReportKind({ contentType: 'AIDE', contentId: 'dispositif:slug:x' })).toEqual({ kind: 'DISPOSITIF', target: 'slug:x', legacyDispositif: true });
    expect(dispositifReportKind({ contentType: 'DISPOSITIF', contentId: 'dp-1' })).toEqual({ kind: 'DISPOSITIF', target: 'dp-1', legacyDispositif: false });
    expect(dispositifReportKind({ contentType: 'AIDE', contentId: 'a-1' })).toEqual({ kind: 'AIDE', target: 'a-1', legacyDispositif: false });
    expect(isEnumValueRefusal({ code: '22P02' })).toBe(true);
    expect(isEnumValueRefusal({ cause: { code: '22P02' } })).toBe(true);
    expect(isEnumValueRefusal({ code: '23505' })).toBe(false);
    expect(await contentTypeSchema({})).toEqual({ dispositif: false });
    expect(await contentTypeSchema(null)).toEqual({ dispositif: false });
  });
});

describe('P19 migration 0051', () => {
  const up = fs.readFileSync('drizzle/0051_p19_dispositif_content_type.sql', 'utf8');
  const down = fs.readFileSync('drizzle/rollback/0051_down.sql', 'utf8');
  const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
  const entry = journal.find((e) => e.tag === '0051_p19_dispositif_content_type');
  const statements = up.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
  it('is one additive, idempotent statement: the enum value, nothing else', () => {
    expect(statements).toEqual([`ALTER TYPE "public"."ContentType" ADD VALUE IF NOT EXISTS 'DISPOSITIF'`]);
    expect(up).not.toMatch(/\b(UPDATE|DELETE|DROP|INSERT)\b/);
  });
  it('the journal entry is after 0050\'s « when » (C12) and numbered 0051; the snapshot has the value', () => {
    expect(entry).toMatchObject({ idx: 51, version: '7', breakpoints: true });
    expect(entry.when).toBeGreaterThan(1794911505815);
    const snap = JSON.parse(fs.readFileSync('drizzle/meta/0051_snapshot.json', 'utf8'));
    expect(snap.enums['public.ContentType'].values).toEqual(['AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE', 'DISPOSITIF']);
  });
  it('the rollback refuses while a DISPOSITIF row exists, rewrites no report, rebuilds the type and forgets its journal row', () => {
    expect(down).toMatch(/RAISE EXCEPTION '0051_down refused/);
    expect(down).not.toMatch(/\bUPDATE\b|DELETE FROM "?(public"?\.)?"?ContentReport/);
    expect(down).toContain(`CREATE TYPE "public"."ContentType" AS ENUM('AIDE', 'DEMARCHE', 'STRUCTURE', 'ACTUALITE');`);
    expect(down).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when};`);
  });
});
