/**
 * R7 — database egress of the nightly veille (Neon consumption, 26/11/2026: ≈ 200 MB a day). The due scan of every slot used to read every column of every
 * Aide / Démarche / Dispositif / Structure — auto_check.official.text (up to 40 000 characters) and the Aide embedding (768 floats) included — only to decide
 * which records are due; the publication audit read the whole auto_check of every public record. Now:
 *  (a) the scan selects only the columns isDue / rememberIdentity / select / the journal use, and of auto_check only its scheduling keys; never the embedding;
 *  (b) the same records are checked as with the whole rows (due, not due, held, archived, DILA changed / unchanged / gone, data·inclusion change);
 *  (c) a checked record reaches the check with its whole row (but the embedding, which the chain never reads), so it gets the same writes; the state re-reads
 *      of publish / withdraw / personDecision still carry every field those functions read.
 * Synthetic data only; no database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Column, getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { eachRecord, scanColumns, fullColumns, stateColumns, SCAN_AUTO_CHECK_KEYS } = await import('../../api/_services/verification/chain.js');
const { publicationAudit, AUDIT_AUTO_CHECK } = await import('../../api/_services/verification/audit.js');
const { Aide, Demarche, Dispositif, Structure } = await import('../../src/db/schema.js');

const NOW = new Date('2026-11-26T03:00:00Z');
const PAST = '2026-11-20T00:00:00.000Z'; const FUTURE = '2026-12-20T00:00:00.000Z';
const BIG = 'x'.repeat(40000);
const EMB = Array.from({ length: 768 }, (_, i) => i / 768);
const TABLES = { aide: Aide, demarche: Demarche, dispositif: Dispositif, structure: Structure };
const dialect = new PgDialect();
const scanSql = (kind) => new QueryBuilder().select(scanColumns(kind)).from(TABLES[kind]).orderBy(sql`${TABLES[kind].last_checked_at} ASC NULLS FIRST`).toSQL().sql;

const aide = (id, x = {}, ac = {}) => ({ id, titre: `Aide ${id}`, statut: 'publie', verification_status: 'VERIFIED', publication_hold: null, last_checked_at: null, description: 'texte long',
  embedding: EMB, auto_check: { nextCheckAt: FUTURE, origin: 'PAGE', checkedAt: PAST, official: { text: BIG }, texts: { at: PAST }, ...ac }, ...x });
const AIDES = [
  aide('due', {}, { nextCheckAt: PAST }),                                                               // its interval is over
  aide('notDue'),                                                                                        // shown, interval not over
  aide('held', { publication_hold: 'Veille automatique : source officielle retirée' }),                // not shown: every run
  aide('archived', { statut: 'archive' }),                                                               // not shown: every run (personDecision decides)
  aide('pending', { verification_status: 'UNVERIFIED', statut: 'brouillon' }),
  aide('noAuto', { auto_check: null }),                                                                  // never checked
  aide('noNext', {}, { nextCheckAt: null }),
  aide('dilaChanged', {}, { origin: 'DILA', sourceId: 'F1', importantChangeAt: '2026-01-01', sourceModifiedAt: '2026-01-02' }),
  aide('dilaSame', {}, { origin: 'DILA', sourceId: 'F2', importantChangeAt: '2026-01-01', sourceModifiedAt: '2026-01-02' }),
  aide('dilaModified', {}, { origin: 'DILA', sourceId: 'F3', importantChangeAt: '2026-01-01', sourceModifiedAt: '2026-01-02' }),
  aide('dilaGone', {}, { origin: 'DILA', sourceId: 'F404' }),
  aide('dilaMoved', {}, { origin: 'DILA', sourceId: 'F5', importantChangeAt: '2026-01-01' }),          // redirected to F2 (same dates: importantChangeAt only)
  aide('dossier', {}, { origin: 'DILA', sourceId: 'N9', importantChangeAt: '2020-01-01', sourceModifiedAt: '2026-01-02' }),   // a dossier: modifiedAt only (unchanged)
];
const META = new Map([['F1', { importantChangeAt: '2026-03-01', modifiedAt: '2026-03-01' }], ['F2', { importantChangeAt: '2026-01-01', modifiedAt: '2026-01-02' }],
  ['F3', { importantChangeAt: '2026-01-01', modifiedAt: '2026-02-02' }], ['N9', { importantChangeAt: '2026-05-05', modifiedAt: '2026-01-02' }]]);
const structure = (id, x = {}, ac = {}) => ({ id, nom: `Lieu ${id}`, statut: 'actif', verification_status: 'VERIFIED', publication_hold: null, siret: null, numero_finess: null, source_annuaire: null,
  source_url: null, adresse: '1 rue X', last_checked_at: null, auto_check: { nextCheckAt: FUTURE, origin: 'SIRENE', services: [{ long: BIG }], ...ac }, ...x });
const STRUCTURES = [
  structure('sDue', { siret: '11111111111111' }, { nextCheckAt: PAST }),
  structure('sNotDue', { siret: '22222222222222', source_annuaire: 'ann-1', source_url: 'https://lannuaire.service-public.fr/x' }),
  structure('sDi', { siret: '33333333333333' }),                                                       // tonight's data·inclusion export changed its services
  structure('sHeldDup', { siret: '44444444444444', publication_hold: 'DOUBLON: même établissement' }), // held: due, never an identity
  structure('sOther', { siret: '55555555555555' }, { nextCheckAt: PAST }),                             // excluded by the run's select
];
const DATA = { Aide: AIDES, Structure: STRUCTURES };

/** a db double: the scan projects each row on the selected columns (auto_check: its scheduling keys, as jsonb_build_object returns them); `legacy` returns whole rows */
function fakeDb({ legacy = false } = {}) {
  const calls = [];
  const project = (row, cols) => {
    const o = {};
    for (const [k, c] of Object.entries(cols)) {
      if (is(c, Column)) o[k] = row[c.name];
      else if (k === 'auto_check') o[k] = row.auto_check == null ? null : Object.fromEntries(SCAN_AUTO_CHECK_KEYS.map((x) => [x, row.auto_check[x] ?? null]));
      else throw new Error(`unexpected expression ${k}`);
    }
    return o;
  };
  const db = {
    calls,
    select(cols) {
      return { from(table) {
        const name = getTableName(table); const all = DATA[name] || [];
        return {
          orderBy() { calls.push({ step: 'scan', table: name, cols }); return Promise.resolve(all.map((r) => (legacy ? structuredClone(r) : project(r, cols)))); },
          where(cond) { const id = dialect.sqlToQuery(cond).params[0]; calls.push({ step: 'load', table: name, cols, id }); return Promise.resolve(all.filter((r) => r.id === id).map((r) => project(r, cols))); },
        };
      } };
    },
  };
  return db;
}
const ctxFor = (db, x = {}) => ({ db, force: false, counts: {}, lastBeat: Date.now(), stop: null, progress: {}, log: () => {}, machine: null, env: {}, scope: 'partial',
  select: () => true, halted: () => false, now: () => NOW, archive: { redirections: new Map([['F5', 'F2']]) }, metaById: META,
  di: { changed: new Set(['sDi']), gone: new Set() }, ...x });
async function run(kind, { legacy = false, select } = {}) {
  const db = fakeDb({ legacy }); const seen = [];
  const ctx = ctxFor(db, select ? { select } : {});
  await eachRecord(ctx, kind, async (_ctx, _kind, row) => { seen.push(row); });
  return { db, ctx, seen };
}
const omitEmbedding = ({ embedding: _e, ...r }) => r;

describe('R7 (a) — the due scan reads no text, no embedding, no whole auto_check', () => {
  it('the scan query of every kind selects neither the embedding nor the auto_check document, only its scheduling keys', () => {
    for (const kind of Object.keys(TABLES)) {
      const q = scanSql(kind);
      expect(q, kind).not.toMatch(/"embedding"/);
      // every mention of auto_check is a key lookup or the NULL test: the document itself (official.text, services…) never leaves the database
      expect(q.match(/"auto_check"(?!\s*(->|IS NULL))/g), `${kind}: ${q}`).toBeNull();
      for (const k of SCAN_AUTO_CHECK_KEYS) expect(q, `${kind} ${k}`).toContain(`'${k}', "${getTableName(TABLES[kind])}"."auto_check" -> '${k}'`);
      for (const col of ['description', 'cest_quoi', 'contenu_detaille', 'description_falc', 'services', 'horaires']) expect(q, `${kind} ${col}`).not.toContain(`."${col}"`);
    }
  });
  it('the run itself scans with those columns, and loads the whole row only for the records it checks', async () => {
    const { db, seen } = await run('aide');
    const scans = db.calls.filter((c) => c.step === 'scan'); const loads = db.calls.filter((c) => c.step === 'load');
    expect(scans).toHaveLength(1);
    expect(Object.keys(scans[0].cols).sort()).toEqual(Object.keys(scanColumns('aide')).sort());
    expect(Object.keys(scans[0].cols)).not.toContain('embedding');
    expect(loads.map((c) => c.id)).toEqual(seen.map((r) => r.id));   // one load per checked record, none for the others
    expect(loads.every((c) => !('embedding' in c.cols))).toBe(true);
  });
  it('the publication audit reads only the keys of auto_check its clauses use', async () => {
    const texts = [];
    const db = { execute: async (q) => { texts.push(dialect.sqlToQuery(q).sql); return { rows: [] }; } };
    await publicationAudit({ db, now: NOW });
    expect(texts).toHaveLength(4);
    for (const t of texts) {
      expect(t).toContain(AUDIT_AUTO_CHECK);
      expect(t.match(/x\.auto_check(?!\s*(->|IS NULL))/g), t).toBeNull();
      for (const k of ['importantChangeAt', 'nextCheckAt', 'checkedAt']) expect(t).toContain(`'${k}', x.auto_check -> '${k}'`);
      expect(t).toContain(`'texts', jsonb_build_object('at', x.auto_check -> 'texts' -> 'at')`);
    }
  });
});

describe('R7 (b) — the same records are checked as with the whole rows', () => {
  it('aides: due, held, archived, pending, never checked, DILA changed / gone / moved, a dossier — and not the others', async () => {
    const narrow = await run('aide'); const legacy = await run('aide', { legacy: true });
    const ids = (r) => r.seen.map((x) => x.id);
    // not due: notDue, dilaSame, dilaMoved (its redirected fiche did not change), dossier (a dossier's important-change date is its fiches', read at the check)
    expect(ids(narrow)).toEqual(['due', 'held', 'archived', 'pending', 'noAuto', 'noNext', 'dilaChanged', 'dilaModified', 'dilaGone']);
    expect(ids(narrow)).toEqual(ids(legacy));
    expect(narrow.ctx.counts).toEqual(legacy.ctx.counts);
    expect(narrow.ctx.counts).toEqual({ 'aide:checked': 9, 'aide:notDue': 4 });
  });
  it('structures: the same checks, the same identities remembered for the duplicates, the run’s select on the narrow row', async () => {
    const select = (kind, r) => r.id !== 'sOther' && (r.siret || '').length === 14;
    const narrow = await run('structure', { select }); const legacy = await run('structure', { legacy: true, select });
    expect(narrow.seen.map((x) => x.id)).toEqual(['sDue', 'sDi', 'sHeldDup']);
    expect(narrow.seen.map((x) => x.id)).toEqual(legacy.seen.map((x) => x.id));
    expect([...narrow.ctx.structureIdentity]).toEqual([['sNotDue', { siret: '22222222222222', annuaireId: 'ann-1', evidenceUrl: 'https://lannuaire.service-public.fr/x' }]]);
    expect([...narrow.ctx.structureIdentity]).toEqual([...legacy.ctx.structureIdentity]);
    expect(narrow.ctx.counts).toEqual(legacy.ctx.counts);
  });
  it('force: every selected record is checked, as before', async () => {
    const db = fakeDb(); const seen = [];
    await eachRecord(ctxFor(db, { force: true }), 'aide', async (_c, _k, row) => { seen.push(row.id); });
    expect(seen).toEqual(AIDES.map((a) => a.id));
  });
});

describe('R7 (c) — a checked record gets the same writes', () => {
  it('the check receives the whole record (texts, whole auto_check) but the embedding', async () => {
    const { seen } = await run('aide');
    const due = seen.find((r) => r.id === 'due');
    expect(due).toEqual(omitEmbedding(AIDES[0]));
    expect(due.auto_check.official.text).toHaveLength(40000);
    expect(Object.keys(fullColumns('aide')).sort()).toEqual(Object.keys(getTableColumns(Aide)).filter((k) => k !== 'embedding').sort());
    for (const kind of ['demarche', 'dispositif', 'structure']) expect(Object.keys(fullColumns(kind)).sort(), kind).toEqual(Object.keys(getTableColumns(TABLES[kind])).sort());
  });
  it('the chain never reads an embedding (so leaving it out changes no decision and no write)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'api/_services/verification/chain.js'), 'utf8');
    // outside comments, the only mention is fullColumns' filter: no read of row.embedding, no destructuring of it
    expect(src.split('\n').filter((l) => /embedding/.test(l) && !/^\s*(\*|\/\/|\/\*\*)/.test(l))).toEqual([expect.stringContaining("k !== 'embedding'")]);
  });
  it('a record deleted since the scan is skipped and counted, not checked from a stale row', async () => {
    const db = fakeDb(); const seen = [];
    const select = db.select.bind(db);
    db.select = (cols) => { const b = select(cols); return { from: (t) => { const f = b.from(t); return { orderBy: f.orderBy, where: async (c) => ((await f.where(c))[0]?.id === 'due' ? [] : f.where(c)) }; } }; };
    const ctx = ctxFor(db);
    await eachRecord(ctx, 'aide', async (_c, _k, row) => { seen.push(row.id); });
    expect(seen).not.toContain('due');
    expect(ctx.counts['aide:gone']).toBe(1);
  });
  it('publish / withdraw / personDecision / lastSnapshot read back only fields their narrowed selects carry', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'api/_services/verification/chain.js'), 'utf8');
    const body = (name) => { const at = src.indexOf(`async function ${name}(`); expect(at, name).toBeGreaterThan(0); const end = src.indexOf('\n}\n', at); return src.slice(at, end); };
    const read = (text, v) => new Set([...text.matchAll(new RegExp(`\\b${v}\\??\\.(\\w+)`, 'g'))].map((m) => m[1]));
    const used = new Set([...read(body('publish'), 'before'), ...read(body('publish'), 'cur'), ...read(body('withdraw'), 'cur'), ...read(body('personDecision'), 'cur')]);
    expect(used.size).toBeGreaterThan(5);
    for (const kind of Object.keys(TABLES)) {
      const have = new Set(Object.keys(stateColumns(kind)));
      // commentaire_statut: read for a structure only (a dispositif has no such column: undefined before as now)
      const missing = [...used].filter((f) => !have.has(f) && !(f === 'commentaire_statut' && kind === 'dispositif'));
      expect(missing, kind).toEqual([]);
      for (const f of have) expect(getTableColumns(TABLES[kind]), `${kind}.${f}`).toHaveProperty(f);
    }
    const snap = body('lastSnapshot');
    expect([...read(snap, 's')].sort()).toEqual(['content_hash', 'final_url', 'raw_excerpt']);
    expect(snap).toMatch(/select\(\{ raw_excerpt: SourceSnapshot\.raw_excerpt, content_hash: SourceSnapshot\.content_hash, final_url: SourceSnapshot\.final_url \}\)/);
  });
  it('the audit still finds TEXTS and FRESHNESS violations from the projected keys', async () => {
    const rows = [{ id: 'old', title: 'Ancienne', verified_by: 'ada-veille-automatique', auto_check: { texts: { at: '2026-10-01' }, importantChangeAt: '2026-10-20', nextCheckAt: '2026-10-02', checkedAt: '2026-10-01' } },
      { id: 'fresh', title: 'Fraîche', verified_by: 'ada-veille-automatique', auto_check: { texts: { at: null }, importantChangeAt: null, nextCheckAt: FUTURE, checkedAt: PAST } }];
    const db = { execute: async (q) => {
      const t = JSON.stringify(dialect.sqlToQuery(q).sql);
      if (/ContentVerification/.test(t)) return { rows: rows.map((r) => ({ id: r.id, url: 'https://www.service-public.gouv.fr/x', reviewer: 'ada-veille-automatique' })) };
      return { rows: t.includes('FROM \\"Aide\\"') ? rows : [] };
    } };
    const out = await publicationAudit({ db, now: NOW });
    expect(out.violations.map((v) => [v.id, v.code])).toEqual([['old', 'TEXTS'], ['old', 'FRESHNESS']]);
  });
});
