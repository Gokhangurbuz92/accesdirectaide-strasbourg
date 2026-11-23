/**
 * G14-OBS — anonymous demand signals: registry, switches, the counted shape, small-cell suppression, gaps, the CSV, the database schema (no personal data),
 * the public handlers and the beta gate. Pure: no database (the real-database cases are in tests/integration/g14-obs-demand-signals-db.test.js).
 *   R  registry: closed lists (86 subdomains, 74 situations, 28 Mon Parcours types, 10 referral reasons, 12 aid categories), K_MIN = the observatory's 5
 *   S  switches closed by default and exact; one family never opens another
 *   N  the only shape counted: closed-list code; commune only for searches, only Eurométropole / « HORS », NEVER for a sensitive subdomain
 *   P  publication: < 5 masked (zero included), complementary suppression, commune table only from 20, marginal protection, totals = published sums
 *   G  gaps: NO_PLACE / FEW_PLACES / RATIO / NOT_MEASURED and the commune leads
 *   C  CSV: RFC 4180 (CRLF), fixed header, masked cells empty with « masque », no row-level field
 *   D  schema: the two tables hold no identifier, address, text or time of day (migration, Drizzle schema and snapshot agree)
 *   H  handlers: 404 closed, 405, 400 on any other query / field, JSON passes assertAggregateOnly, CSV served, the counter records only the id
 *   B  beta gate: the exact paths and methods, only under their switch
 *   K  hooks: the search passes the analysis codes and the filters, never the query; Mon Parcours passes the step-type code only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })), getClientIp: () => '203.0.113.9', getRateLimitStatus: () => 429 }));

const L = await import('../../api/lib/demand-signals.js');
const { alignColumns, marginalIntervals, protectMarginals } = await import('../../api/_services/territorial-stats.js');
const { K_MIN: ORG_K_MIN } = await import('../../api/_services/org-stats.js');
const { assertAggregateOnly } = await import('../../api/lib/public-indicators.js');
const { isAllowedInPublicBeta } = await import('../../api/_utils/public-beta.js');
const { default: obsHandler, _resetObservatoireCache } = await import('../../api/_handlers/public/observatoire.js');
const { default: signalHandler } = await import('../../api/_handlers/public/signal.js');

const protect = (a, c) => { const [x, y] = alignColumns(a, c); return protectMarginals(x, y, { lowerA: 0, lowerC: 0, kMin: 5 }); };
const res = () => { const r = { statusCode: 0, body: undefined, headers: {}, status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; }, end() { return r; }, setHeader(k, v) { r.headers[k.toLowerCase()] = v; } }; return r; };
const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
const { sampleBody } = await import('../fixtures/g14-obs-sample.js');

describe('G14-OBS R registry', () => {
  it('closed lists of the reference files, and the observatory threshold', () => {
    expect(L.codesOf('search_need')).toHaveLength(86);
    expect(L.socialReference().domains).toHaveLength(20);
    expect(L.codesOf('situation')).toHaveLength(74);   // g14-rg widened « Ma situation » to 74 situations (the mirror follows data/reference/life-situations.v1.json)
    expect(L.codesOf('parcours_added')).toHaveLength(28);
    expect(L.codesOf('social_referral')).toHaveLength(10);
    expect(L.emsCommunes()).toHaveLength(33);
    expect(L.emsCommunes().map((c) => c.code)).toContain('67482');
    expect(L.K_MIN).toBe(ORG_K_MIN);
    expect(L.K_MIN).toBe(5);
    for (const s of Object.values(L.SITUATIONS)) expect(L.socialReference().domains).toContain(s.domain);
  });
  it('mirrors: AidCategoryCode, and — when present in this tree — the Rights Graph situations and the social-referral reasons', async () => {
    const schema = fs.readFileSync('src/db/schema.ts', 'utf8');
    const m = schema.match(/AidCategoryCode = pgEnum\('AidCategoryCode', \[([^\]]+)\]/);
    expect(m && m[1].match(/'([A-Z]+)'/g).map((x) => x.replace(/'/g, ''))).toEqual([...L.AID_CATEGORIES]);
    if (fs.existsSync('data/reference/life-situations.v1.json')) {
      const ids = JSON.parse(fs.readFileSync('data/reference/life-situations.v1.json', 'utf8')).situations.map((s) => s.id);
      expect(Object.keys(L.SITUATIONS).sort()).toEqual([...ids].sort());
    }
    if (fs.existsSync('api/lib/social-referral-policy.js')) {
      const { SOCIAL_REASON_CODES } = await import('../../api/lib/social-referral-policy.js');
      expect([...L.SOCIAL_REFERRAL_REASONS].sort()).toEqual([...SOCIAL_REASON_CODES].sort());
    }
  });
});

describe('G14-OBS S switches', () => {
  it('ADA_DEMAND_SIGNALS: closed by default, families only, no wildcard', () => {
    for (const v of [undefined, '', '*', 'all', 'open', '1', 'true', 'searches']) expect([...L.recordedSignals({ ADA_DEMAND_SIGNALS: v })], String(v)).toEqual([]);
    expect([...L.recordedSignals({ ADA_DEMAND_SIGNALS: 'search' })]).toEqual(['search_need', 'search_category']);
    expect(L.signalRecorded('situation', { ADA_DEMAND_SIGNALS: 'search,parcours' })).toBe(false);
    expect(L.signalRecorded('parcours_closed', { ADA_DEMAND_SIGNALS: ' Search , PARCOURS ' })).toBe(true);
    expect(L.signalRecorded('social_referral', { ADA_DEMAND_SIGNALS: 'referral' })).toBe(true);
  });
  it('ADA_OBSERVATOIRE: exactly « open »', () => {
    for (const v of [undefined, '', '1', 'true', 'on', 'opened']) expect(L.observatoireOpen({ ADA_OBSERVATOIRE: v }), String(v)).toBe(false);
    expect(L.observatoireOpen({ ADA_OBSERVATOIRE: ' OPEN ' })).toBe(true);
  });
});

describe('G14-OBS N the counted shape', () => {
  it('a code of the closed list, else nothing', () => {
    expect(L.normaliseSignal('search_need', 'aide-alimentaire')).toEqual({ signal: 'search_need', code: 'aide-alimentaire', commune: '' });
    for (const [s, c] of [['search_need', 'je cherche une aide'], ['search_need', ''], ['situation', 'loyer impayé'], ['parcours_added', 'rsa_demande'], ['unknown', 'x'], ['social_referral', 'HEALTH'], ['search_category', 'logement']]) {
      expect(L.normaliseSignal(s, c), `${s}:${c}`).toBeNull();
    }
  });
  it('a commune only for searches: Eurométropole code, otherwise « HORS »; never for a sensitive subdomain; never for another signal', () => {
    expect(L.normaliseSignal('search_need', 'aide-alimentaire', '67482').commune).toBe('67482');
    expect(L.normaliseSignal('search_need', 'aide-alimentaire', '75056').commune).toBe('HORS');
    expect(L.normaliseSignal('search_need', 'aide-alimentaire', '2A004').commune).toBe('HORS');
    for (const sensitive of ['violences-conjugales', 'titre-sejour', 'psy', 'mdph-droits', 'addictions', 'pjj-spip', 'lgbtqi']) {
      expect(L.normaliseSignal('search_need', sensitive, '67482'), sensitive).toEqual({ signal: 'search_need', code: sensitive, commune: '' });
    }
    expect(L.normaliseSignal('situation', 'violences', '67482').commune).toBe('');
    expect(L.normaliseSignal('parcours_added', 'RSA_DEMANDE', '67482').commune).toBe('');
  });
  it('days and quarters are UTC calendar quarters', () => {
    expect(L.utcDay(new Date('2026-09-30T23:59:59.999Z'))).toBe('2026-09-30');
    expect(L.quarterOfDay('2026-09-30')).toBe('2026-T3');
    expect(L.quarterOfDay('2026-10-01')).toBe('2026-T4');
    expect(L.quarterBounds('2026-T4')).toEqual({ start: '2026-10-01', end: '2027-01-01' });
  });
});

describe('G14-OBS P publication', () => {
  it('below 5 masked (zero included); a single masked cell takes the smallest published one with it', () => {
    expect(L.publishColumn([0, 4, 5, 9])).toEqual([null, null, 5, 9]);
    expect(L.publishColumn([3, 7, 9, 12])).toEqual([null, null, 9, 12]);
    expect(L.publishColumn([5, 6])).toEqual([5, 6]);
    expect(L.columnTotal([null, 7, 9])).toEqual({ publishedSum: 16, maskedCells: 1 });
  });
  it('every code is listed, totals are sums of published cells, and no published cell is below 5', () => {
    const body = sampleBody(); const s = body.quarters[0].search;
    expect(s.domains.map((d) => d.domain)).toEqual(L.socialReference().domains);
    expect(s.domains.flatMap((d) => d.subdomains)).toHaveLength(86);
    for (const d of s.domains) {
      expect(d.publishedSum).toBe(d.subdomains.reduce((t, x) => t + (x.value ?? 0), 0));
      for (const x of d.subdomains) if (x.value !== null) expect(x.value).toBeGreaterThanOrEqual(5);
      if (d.byCommune) for (const c of [...d.byCommune.communes.map((y) => y.value), d.byCommune.noCommune, d.byCommune.outside]) if (c !== null) expect(c).toBeGreaterThanOrEqual(5);
    }
    const prec = s.domains.find((d) => d.domain === 'precarite');
    expect(prec.subdomains.find((x) => x.code === 'aide-alimentaire').value).toBe(45);
    expect(prec.subdomains.find((x) => x.code === 'urgence-sociale').value).toBeNull();
  });
  it('commune × category only from 20 searches in the domain; a sensitive subdomain never reaches a commune cell', () => {
    const s = sampleBody().quarters[0].search;
    const prec = s.domains.find((d) => d.domain === 'precarite');
    expect(prec.byCommune).not.toBeNull();
    expect(prec.byCommune.communes.find((c) => c.commune === '67482').value).toBe(30);
    const viol = s.domains.find((d) => d.domain === 'violences');
    expect(viol.byCommune, '7 searches: no commune table').toBeNull();
    // 19 searches in one commune: below the commune-table minimum, nothing by commune
    const small = L.publishSearches(Array.from({ length: 19 }, () => ({ code: 'aide-alimentaire', commune: '67482', n: 1 })), protect);
    expect(small.domains.find((d) => d.domain === 'precarite').byCommune).toBeNull();
  });
  it('the two marginal tables of a domain cannot be differenced into a narrow masked cell (C8 bound protection)', () => {
    // one subdomain 22 = communes 20 + 2: « 22 − 20 » must not pin the commune of 2
    for (const rows of [[{ code: 'aide-alimentaire', commune: '67482', n: 20 }, { code: 'aide-alimentaire', commune: '67447', n: 2 }],
      [{ code: 'aide-alimentaire', commune: '67482', n: 18 }, { code: 'urgence-sociale', commune: '67447', n: 3 }, { code: 'acces-aux-droits', commune: '', n: 9 }]]) {
      const d = L.publishSearches(rows, protect).domains.find((x) => x.domain === 'precarite');
      const a = d.subdomains.map((x) => x.value); const c = [...d.byCommune.communes.map((x) => x.value), d.byCommune.noCommune, d.byCommune.outside];
      const iv = marginalIntervals(a, c, { kMin: 5 });
      for (const x of [...iv.a, ...iv.c]) if (x && x[1] !== Infinity) expect(x[1] - x[0] + 1, JSON.stringify(x)).toBeGreaterThanOrEqual(5);
      expect(c.find((v, i) => i === d.byCommune.communes.findIndex((y) => y.commune === '67447'))).toBeNull();
    }
  });
  it('supply bands: 0 exact, 1 to 4 masked, from 5 exact', () => {
    expect([0, 1, 4, 5, 40].map(L.supplyCell)).toEqual([0, null, null, 5, 40]);
  });
});

describe('G14-OBS G gaps', () => {
  it('reads each domain in words, never a rate', () => {
    const g = sampleBody().quarters[0].gaps;
    expect(g.byDomain.find((x) => x.domain === 'precarite')).toMatchObject({ kind: 'NO_PLACE', searches: 45, places: 0, perPlace: null });
    expect(g.byDomain.find((x) => x.domain === 'violences')).toMatchObject({ kind: 'FEW_PLACES', searches: 7 });
    expect(g.byDomain.find((x) => x.domain === 'logement')).toMatchObject({ kind: 'NOT_MEASURED', searches: null });
    const ratio = L.computeGaps({ domains: [{ domain: 'logement', publishedSum: 25, byCommune: null }] }, { byDomain: [{ domain: 'logement', places: 10 }], byCommune: [] });
    expect(ratio.byDomain[0]).toMatchObject({ kind: 'RATIO', perPlace: 2.5 });
    expect(g.byCommune.find((x) => x.commune === '67482')).toMatchObject({ domain: 'precarite', searches: 30, kind: 'NO_PLACE_IN_COMMUNE' });
  });
});

describe('G14-OBS C the open-data CSV', () => {
  it('RFC 4180, fixed header, masked cells empty, no row-level field', () => {
    const csv = L.observatoireCsv(sampleBody());
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('jeu,trimestre,date_gel,signal,domaine,code,commune_insee,commune,valeur,statut');
    expect(lines.at(-1)).toBe('');
    expect(csv).not.toMatch(/(?<!\r)\n/);
    const width = lines[0].split(',').length;
    for (const l of lines.slice(1, -1)) expect(l.split(',').length, l).toBe(width);
    expect(csv).toContain('demande,2026-T3,2026-10-01,search_need,precarite,aide-alimentaire,,,45,exact');
    expect(csv).toContain('demande,2026-T3,2026-10-01,search_need,precarite,urgence-sociale,,,,masque');
    expect(csv).toContain('demande,2026-T3,2026-10-01,search_need_commune,precarite,,67482,Strasbourg,30,exact');
    expect(csv).toContain('ecart,2026-T3,2026-10-01,NO_PLACE,precarite,,,,,indicatif');
    expect(csv).toMatch(/\noffre,,2026-11-23,places,precarite,,,,0,exact/);
    expect(csv).toMatch(/\noffre,,2026-11-23,places,logement,,,,12,exact/);
    expect(csv).not.toMatch(/@|https?:|userId|citizen|\bip\b/i);
    // no cell below 5 is ever written as an exact demand value
    for (const l of lines.slice(1, -1)) { const c = l.split(','); if (c[0] === 'demande' && c[9] === 'exact') expect(Number(c[8]), l).toBeGreaterThanOrEqual(5); }
  });
});

describe('G14-OBS D the schema holds no personal data', () => {
  const migration = fs.readFileSync('drizzle/0062_g14_obs_demand_signals.sql', 'utf8');
  const columnsOf = (table) => {
    const body = migration.split(`CREATE TABLE "${table}" (`)[1].split(/\n\);/)[0];
    return [...body.matchAll(/^\t"([A-Za-z]+)"/gm)].map((m) => m[1]);
  };
  it('exactly these columns, none naming a person, an address, a session, a text or a time', () => {
    expect(columnsOf('DemandSignalDaily')).toEqual(['day', 'signal', 'code', 'commune', 'count']);
    expect(columnsOf('DemandSignalQuarter')).toEqual(['quarter', 'schemaVersion', 'rules', 'published', 'frozenAt', 'release']);
    for (const c of [...columnsOf('DemandSignalDaily'), ...columnsOf('DemandSignalQuarter')]) expect(c).not.toMatch(/user|ip|session|email|query|text|name|phone|address|adresse|agent|referer|hour|time$/i);
    expect(migration).toMatch(/"day" date NOT NULL/);   // a day, never a time of day
    expect(migration).toMatch(/DemandSignalDaily_code_check" CHECK \("DemandSignalDaily"\."code" ~ '\^\[A-Za-z0-9_-\]\{1,64\}\$'\)/);
    expect(migration).toMatch(/"commune" = '' OR "DemandSignalDaily"\."signal" = 'search_need'/);
    expect(migration).toMatch(/CREATE TRIGGER "DemandSignalQuarter_no_update" BEFORE UPDATE/);
    expect(migration).not.toMatch(/ALTER TABLE|DROP |INSERT /);
  });
  it('the Drizzle schema, the snapshot and the journal agree; the rollback drops both tables', () => {
    const schema = fs.readFileSync('src/db/schema.ts', 'utf8');
    for (const c of ["day: date('day')", "signal: text('signal')", "code: text('code')", "commune: text('commune')", "count: integer('count')", "published: jsonb('published')"]) expect(schema).toContain(c);
    const snap = JSON.parse(fs.readFileSync('drizzle/meta/0062_snapshot.json', 'utf8'));
    expect(Object.keys(snap.tables['public.DemandSignalDaily'].columns)).toEqual(['day', 'signal', 'code', 'commune', 'count']);
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    expect(journal.find((e) => e.idx === 62)).toMatchObject({ tag: '0062_g14_obs_demand_signals', when: 1795040000000 });
    const down = fs.readFileSync('drizzle/rollback/0062_down.sql', 'utf8');
    expect(down).toMatch(/DROP TABLE IF EXISTS "DemandSignalDaily"/); expect(down).toMatch(/DROP TABLE IF EXISTS "DemandSignalQuarter"/);
    expect(down).toMatch(/created_at = 1795040000000/);
  });
});

describe('G14-OBS H handlers', () => {
  beforeEach(() => { _resetObservatoireCache(); delete process.env.ADA_OBSERVATOIRE; delete process.env.ADA_DEMAND_SIGNALS; });
  afterEach(() => { delete process.env.ADA_OBSERVATOIRE; delete process.env.ADA_DEMAND_SIGNALS; });

  it('observatoire: 404 while closed (nothing computed)', async () => {
    const compute = vi.fn(); const r = res();
    await obsHandler({ method: 'GET', query: {}, headers: {} }, r, { compute });
    expect(r.statusCode).toBe(404); expect(compute).not.toHaveBeenCalled();
  });
  it('observatoire: 405 for a write, 400 for any other query parameter (before anything is read)', async () => {
    process.env.ADA_OBSERVATOIRE = 'open'; const compute = vi.fn(async () => sampleBody());
    const a = res(); await obsHandler({ method: 'POST', query: {}, headers: {} }, a, { compute }); expect(a.statusCode).toBe(405);
    for (const query of [{ commune: '67482' }, { quarter: '2026-T3' }, { format: 'xlsx' }, { format: 'csv', t: '1' }]) {
      const r = res(); await obsHandler({ method: 'GET', query, headers: {} }, r, { compute });
      expect(r.statusCode, JSON.stringify(query)).toBe(400); expect(r.body.error).toBe('QUERY_PARAMETER_NOT_ACCEPTED');
    }
    expect(compute).not.toHaveBeenCalled();
  });
  it('observatoire: JSON passes the aggregate-only guard; CSV is served as an attachment; a non-aggregate body is never sent', async () => {
    process.env.ADA_OBSERVATOIRE = 'open';
    const body = sampleBody(); expect(assertAggregateOnly(body)).toBe(true);
    const j = res(); await obsHandler({ method: 'GET', query: {}, headers: {} }, j, { compute: async () => body });
    expect(j.statusCode).toBe(200); expect(j.body.schema).toBe('ada.observatoire.v1'); expect(j.body.licence).toBe('etalab-2.0');
    const c = res(); await obsHandler({ method: 'GET', query: { format: 'csv' }, headers: {} }, c, { compute: async () => body });
    expect(c.statusCode).toBe(200); expect(c.headers['content-type']).toMatch(/text\/csv/); expect(c.headers['content-disposition']).toMatch(/attachment/);
    expect(String(c.body).startsWith('jeu,trimestre')).toBe(true);
    _resetObservatoireCache();
    const bad = res(); await obsHandler({ method: 'GET', query: {}, headers: {} }, bad, { compute: async () => ({ ...body, userId: 'u1' }) });
    expect(bad.statusCode).toBe(500); expect(JSON.stringify(bad.body)).not.toContain('u1');
  });
  it('signal: 404 closed; only POST { situation } of the list; records the id and nothing else', async () => {
    const record = vi.fn(async () => 1);
    const closed = res(); await signalHandler({ method: 'POST', body: { situation: 'dettes' }, headers: {} }, closed, { record }); expect(closed.statusCode).toBe(404);
    process.env.ADA_DEMAND_SIGNALS = 'search';
    const other = res(); await signalHandler({ method: 'POST', body: { situation: 'dettes' }, headers: {} }, other, { record }); expect(other.statusCode, 'search does not open situation').toBe(404);
    process.env.ADA_DEMAND_SIGNALS = 'situation';
    const get = res(); await signalHandler({ method: 'GET', headers: {} }, get, { record }); expect(get.statusCode).toBe(405);
    const extra = res(); await signalHandler({ method: 'POST', body: { situation: 'dettes', commune: '67482', text: 'x' }, headers: {} }, extra, { record });
    expect(extra.statusCode).toBe(400); expect(extra.body).toEqual({ error: 'FIELD_NOT_ALLOWED', fields: ['commune', 'text'] });
    const unknown = res(); await signalHandler({ method: 'POST', body: { situation: 'je suis à la rue' }, headers: {} }, unknown, { record }); expect(unknown.statusCode).toBe(400);
    const arr = res(); await signalHandler({ method: 'POST', body: ['dettes'], headers: {} }, arr, { record }); expect(arr.statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
    const ok = res(); await signalHandler({ method: 'POST', body: { situation: 'dettes' }, headers: {} }, ok, { record });
    expect(ok.statusCode).toBe(204); expect(ok.headers['cache-control']).toBe('no-store'); expect(record).toHaveBeenCalledWith('dettes');
  });
});

describe('G14-OBS B beta gate', () => {
  it('the observatoire GET and the signal POST pass only under their own switch', () => {
    expect(isAllowedInPublicBeta('GET', 'public/observatoire', BETA)).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'public/observatoire', { ...BETA, ADA_OBSERVATOIRE: 'open' })).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'public/observatoire', { ...BETA, ADA_OBSERVATOIRE: 'open' })).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'public/signal', { ...BETA, ADA_OBSERVATOIRE: 'open' })).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'public/signal', { ...BETA, ADA_DEMAND_SIGNALS: 'search,parcours' })).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'public/signal', { ...BETA, ADA_DEMAND_SIGNALS: 'situation' })).toBe(true);
    expect(isAllowedInPublicBeta('GET', 'public/signal', { ...BETA, ADA_DEMAND_SIGNALS: 'situation' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'public/observatoire/x', { ...BETA, ADA_OBSERVATOIRE: 'open' })).toBe(false);
  });
});

describe('G14-OBS K hooks', () => {
  it('the search counts the analysis codes and the filters, never the query', () => {
    const src = fs.readFileSync('api/_handlers/search.js', 'utf8');
    const call = src.match(/await recordSearch\(([^;]+)\);/);
    expect(call, 'the search calls recordSearch').not.toBeNull();
    expect(call[1]).toBe('analysis, { category: payload.category || null, territory: payload.territory || null }');
    expect(call[1]).not.toMatch(/query/);
  });
  it('Mon Parcours counts the step-type code only (added, and the first move to a final state)', () => {
    const src = fs.readFileSync('api/_services/mon-espace.js', 'utf8');
    expect(src).toContain('await recordParcoursAdded(type.code);');
    expect(src).toMatch(/if \(FINAL_STATUSES\.includes\(next\) && !FINAL_STATUSES\.includes\(row\.status\) && stepTypeOfItem\(row\)\) await recordParcoursClosed\(stepTypeOfItem\(row\)\.code\);/);
  });
  it('the daily freeze job also freezes the demand quarters', () => {
    expect(fs.readFileSync('api/_handlers/cron/observatory-freeze.js', 'utf8')).toMatch(/freezeDemandQuarters\)\(database/);
  });
});
