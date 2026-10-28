/**
 * DTA S9 — WS2 provenance honesty and publication safety (independent review items R1 / R2 / T1 / T2; this register is separate from S8's internal D1-D5).
 *  R1  the seed used `new Date()` for date_verification => the import time was served as `provenance.verifiedAt`, shown as "Vérifié le …" and made the assistant treat unverified rows as verified.
 *  R2  the public read path filters on statut='publie' only; the database has no launch column; two seeded demarches declare launchEligible=false / verifiedCurrent=false yet are 'publie'.
 *  T1  generate-sitemap called parseArgs() without options (limit always undefined, --limit would throw).  T2  chained .where() replaced the first predicate.
 * Nothing here verifies a record against an official source; unknown stays unknown.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const read = (p) => readFileSync(p, 'utf8');

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows; return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

describe('R1 — the seed never invents a verification date', () => {
  const seed = read('scripts/seed-strasbourg.mjs');
  it('no date_verification alias is built from new Date(); fetched_at (the collection time) still is', () => {
    expect(seed).not.toMatch(/date_?verification\s*:\s*new Date\(/i);
    expect(seed).toMatch(/fetched_at: new Date\(\)/);
  });
  it('the alias is omitted (undefined): a new row stores NULL and a re-seed keeps a human-verified date', () => {
    const alias = seed.slice(seed.indexOf('const aliases = {'), seed.indexOf('return aliases[columnName]')).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(alias).not.toMatch(/dateverification|date_verification/);
    expect(seed).toMatch(/if \(value !== undefined\) values\[column\.column_name\]/);
  });
  it('a date carried by the source row itself is still honoured (exact-name lookup precedes the aliases)', () => {
    expect(seed.indexOf('const direct = Object.entries(row)')).toBeLessThan(seed.indexOf('const aliases = {'));
  });
});

describe('R1 — every consumer treats a null verification date as UNKNOWN', () => {
  it('buildProvenance(null) => verifiedAt null', async () => {
    const { buildProvenance } = await import('../../api/_utils/provenance.js');
    expect(buildProvenance({ verifiedAt: null, fetchedAt: '2026-10-18T10:00:00Z', sourceUrl: 'https://example.test/x' }).verifiedAt).toBeNull();
  });
  it('FreshnessTag renders nothing (no "Vérifié le", no badge) for null / undefined / invalid, and the verified badge only for a real recent date', async () => {
    const { FreshnessTag } = await import('../../src/components/molecules/FreshnessTag.tsx');
    for (const v of [null, undefined, 'not-a-date']) expect(renderToStaticMarkup(createElement(FreshnessTag, { verifiedAt: v }))).toBe('');
    const html = renderToStaticMarkup(createElement(FreshnessTag, { verifiedAt: new Date('2026-10-01T00:00:00Z'), now: new Date('2026-10-18T00:00:00Z') }));
    expect(html).toMatch(/Vérifié le/);
  });
  it('the publication validator keeps warning that no verification date exists (a warning, as designed — publication is gated by WS2, not by this check)', async () => {
    const mod = await import('../../api/lib/publication-validator.js');
    const fn = mod.validatePublication || mod.validateForPublication || mod.default;
    expect(typeof fn).toBe('function');
    const res = fn({ titre: 'x', slug: 'x', date_verification: null });
    const warnings = res.warnings || [];
    expect(JSON.stringify(warnings)).toMatch(/Aucune date de vérification/);
  });
  it('assistant: a record without verifiedAt is NOT usable as a verified source (fail closed)', () => {
    const src = read('api/_handlers/assistant/chat.js');
    expect(src).toMatch(/if \(!entityId \|\| !sourceUrl \|\| !verifiedAt\) return null;/);
  });
});

describe('R1 — PDF export with a null verification date', () => {
  const S = vi.hoisted(() => ({ aide: null }));
  vi.mock('../../src/db/index.js', () => ({ db: { query: { Aide: { findFirst: async () => S.aide }, Demarche: { findFirst: async () => null } } } }));
  vi.mock('../../api/lib/logger.js', () => { const m = () => {}; return { logger: { info: m, warn: m, error: m, debug: m } }; });
  vi.mock('@sentry/node', () => ({ captureException: () => {}, withScope: () => {}, default: {} }));
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(d) { this.body = d; return this; } });
  const base = { id: 'a1', slug: 'apl', titre: 'APL', categorie: 'logement', cest_quoi: 'x', pour_qui: 'y', ce_que_ca_aide: 'z', documents_necessaires: '', etapes: '', ou_demander: '', apply_url: null, lien_demande: null, source_name: null, source_url: null, sourceDocument: null };
  beforeEach(() => { S.aide = null; });
  const hex = (t) => Buffer.from(t, 'latin1').toString('hex');
  it('exports a PDF that says "À vérifier" and "Non renseignée", never "Invalid Date"', async () => {
    S.aide = { ...base, date_verification: null };
    const { default: handler } = await import('../../api/_handlers/pdf.js');
    const r = mk(); await handler({ method: 'GET', url: '/api/pdf/aides/apl', headers: { host: 'x' } }, r);
    expect(r.statusCode).toBe(200);
    expect(Buffer.isBuffer(r.body) || r.body instanceof Uint8Array).toBe(true);
    const raw = Buffer.from(r.body).toString('latin1');
    expect(raw.startsWith('%PDF')).toBe(true);
    expect(raw.includes('Invalid Date') || raw.includes(hex('Invalid Date'))).toBe(false);
  });
});

describe('R2 — publication eligibility', () => {
  it('guardedStatut: a row whose own flags are not both true is never seeded as published; a verified one is unchanged; non-published statuses are untouched', async () => {
    const { guardedStatut: g } = await import('../../scripts/seed-strasbourg.mjs');
    expect(g({ launchEligible: 'false', verifiedCurrent: 'false' }, 'publie')).toBe('brouillon');
    expect(g({ launchEligible: 'true', verifiedCurrent: 'false' }, 'publie')).toBe('brouillon');
    expect(g({ launchEligible: 'false', verifiedCurrent: 'true' }, 'publie')).toBe('brouillon');
    expect(g({}, 'publie')).toBe('brouillon');
    expect(g({ launchEligible: 'true', verifiedCurrent: 'true' }, 'publie')).toBe('publie');
    expect(g({ launchEligible: 'false', verifiedCurrent: 'false' }, '')).toBe('');
    expect(g({ launchEligible: 'false' }, 'brouillon')).toBe('brouillon');
  });
  it('on the REAL data files: exactly the two reviewed records are demoted, nothing else changes', async () => {
    const { guardedStatut: g } = await import('../../scripts/seed-strasbourg.mjs');
    const demoted = [];
    for (const f of ['aides', 'demarches', 'structures']) {
      for (const row of parseCsv(read(`data/${f}-alsace.csv`))) if (g(row, row.statut) !== row.statut) demoted.push(`${f}/${row.slug}`);
    }
    expect(demoted.sort()).toEqual(['demarches/inscription-ccas', 'demarches/rdv-social-alsace']);
  });
  it('the CSV files are NOT edited: the publication decision stays with the human reviewers', () => {
    const csv = parseCsv(read('data/demarches-alsace.csv'));
    expect(csv.find((r) => r.slug === 'inscription-ccas').statut).toBe('publie');
    expect(csv.find((r) => r.slug === 'rdv-social-alsace').statut).toBe('publie');
  });
  it('PKG-1 / D-5 (deliberate supersession of the S9 documented limit): the read path now goes through the central fail-closed visibility contract', () => {
    expect(read('src/db/schema.ts')).toMatch(/launch_eligible/i);
    expect(read('api/_handlers/pdf.js')).toMatch(/visibleWhere\(/);
    expect(read('api/_handlers/pdf.js')).not.toMatch(/eq\(t\.statut, 'publie'\)/);
  });
  it('launchReady stays false in the authoritative manifest', () => {
    expect(JSON.parse(read('data/strasbourg/ws2-source-manifest.json')).launchReady).toBe(false);
  });
});

describe('T1 / T2 — scripts', () => {
  it('sitemap: parseArgs gets an options object, limit is validated, no argument means unbounded', () => {
    const s = read('scripts/generate-sitemap.mjs');
    expect(s).not.toMatch(/const \{ limit \} = parseArgs\(\)/);
    expect(s).toMatch(/parseArgs\(\{ options: \{ limit: \{ type: 'string' \}(, \w+: \{ type: '\w+' \})* \}/);   // R11: --static added beside --limit
    expect(s).toMatch(/positive integer/);
  });
  it('sitemap and prerender combine slug and statut predicates with and(...) instead of a second .where()', () => {
    // P22 (R11): prerender.mjs renders no record page any more (a page built once would keep a withdrawn record's claims): it reads no content table at all
    expect(read('scripts/prerender.mjs')).not.toMatch(/from\((Aide|Demarche|Structure)\)/);
    for (const f of ['scripts/generate-sitemap.mjs']) {
      const s = read(f);
      expect(s, f).not.toMatch(/\.where\(isNotNull\(\w+\.slug\)\)\s*\.where\(/);
      // PKG-1 / D-5: the bare statut predicate became the central visibility contract (still one and(...) per query).
      expect((s.match(/\.where\(and\(isNotNull\(\w+\.slug\), visibleWhere\(\w+, '(aide|demarche|structure)'\)\)\)/g) || []).length, f).toBe(3);
    }
  });
});
