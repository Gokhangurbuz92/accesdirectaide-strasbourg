/**
 * R40 — scheduled jobs made safe to open later (they all stay CLOSED in Production): G1 veille registered as a job, G2 no « all jobs » switch and hive-scan
 * refused without an approved provider, G3 only authorised aid sources + Aides-territoires cursor / connexion / identity, G8 no veille alert while it is
 * closed, G9 an administrator's feed choice kept, G10 guest columns detected, and the coverage mapping of four subdomains + acces-au-droit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
vi.mock('../../api/lib/logger.js', () => { const m = () => {}; return { logger: { info: m, warn: m, error: m, debug: m } }; });
import { isAllowedInPublicBeta, openJobs, openSurfaces, jobStates, SCHEDULED_JOBS } from '../../api/_utils/public-beta.js';
import { appointmentColumns, columnFlags, GUEST_BOOKING_COLUMNS, GUEST_REMINDER_COLUMN } from '../../api/_utils/schema-features.js';
import { SCOPE } from '../../api/_services/verification/finess-scope.js';
import { OFFICE_KINDS } from '../../api/_services/verification/offices.js';
import { coverage } from '../../scripts/social-coverage.mjs';

const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('../../api/_utils/kv.js'); });

describe('G2 — no « all jobs » switch: jobs open one at a time', () => {
  it('ADA_BETA_OPEN_SURFACES=jobs opens no cron and no monitor route (hive-scan and the legacy importers included)', () => {
    const e = { ...BETA, ADA_BETA_OPEN_SURFACES: 'jobs' };
    expect(openSurfaces(e).size).toBe(0);
    for (const p of ['cron/hive-scan', 'cron/pipeline', 'cron/ingest-demarches', 'cron/backup-db', 'cron/actualites', 'cron/veille', 'monitor/core', 'monitor/csp-report'])
      for (const m of ['GET', 'POST']) expect(isAllowedInPublicBeta(m, p, e), `${m} ${p}`).toBe(false);
  });
  it('default unchanged: nothing is open, every known job is CLOSED (or LEGACY_CLOSED)', () => {
    for (const j of Object.keys(SCHEDULED_JOBS)) expect(isAllowedInPublicBeta('GET', `cron/${j}`, BETA), j).toBe(false);
    expect(jobStates(BETA).map((x) => x.state).every((s) => s === 'CLOSED' || s === 'LEGACY_CLOSED')).toBe(true);
  });
  it('the edge middleware refuses a cron route when only the « jobs » surface is named', async () => {
    vi.stubEnv('ADA_PUBLIC_BETA_RESTRICTED', '1'); vi.stubEnv('ADA_BETA_OPEN_SURFACES', 'jobs');
    const { directFunctionResponse } = await import('../../middleware.js');
    expect(directFunctionResponse(new URL('https://www.accesdirectaide.fr/api/cron/hive-scan')).status).toBe(503);
    expect(directFunctionResponse(new URL('https://www.accesdirectaide.fr/api/monitor/core')).status).toBe(503);
  });
  it('hive-scan refuses to run without an approved AI provider, whatever ENABLE_AI_AGENT says, before any database or model call', async () => {
    vi.doMock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: () => ({ ok: true }), getHeader: () => null, scheduledByVercel: () => false }));
    const dbCalls = []; vi.doMock('../../src/db/index.js', () => ({ db: new Proxy({}, { get: (_, k) => { dbCalls.push(k); return () => { throw new Error('db used'); }; } }) }));
    const genAI = vi.fn(); vi.doMock('../../api/lib/gemini.js', () => ({ getGenAI: genAI }));
    process.env.ENABLE_AI_AGENT = 'true';
    const { default: handler } = await import('../../api/_handlers/cron/hive-scan.js');
    const res = { statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; } };
    await handler({ method: 'POST', headers: {}, query: {} }, res);
    expect([res.statusCode, res.body.skipped, res.body.reason]).toEqual([200, 'provider_not_approved', 'BLOCKED_PENDING_PROVIDER_REVIEW']);
    expect(dbCalls).toEqual([]); expect(genAI).not.toHaveBeenCalled();
    vi.doUnmock('../../api/_utils/cronAuth.js'); vi.doUnmock('../../src/db/index.js'); vi.doUnmock('../../api/lib/gemini.js');
  });
  it('the release gate asks for the alert channel as soon as one job is opened by name', async () => {
    const { evaluateReleasePreflight } = await import('../../scripts/release-preflight.mjs');
    const st = (env) => evaluateReleasePreflight({ ...BETA, MAILER_PROVIDER: 'noop', ...env }, { legalText: 'ok' }).find((c) => c.id === 'alerts.webhook')?.status;
    expect(st({})).toBe('WARN');
    expect(st({ ADA_BETA_OPEN_JOBS: 'veille' })).toBe('FAIL');
    expect(st({ ADA_BETA_OPEN_JOBS: 'veille', ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' })).toBe('PASS');
  });
});

describe('G1 — the veille is a known job, closed by default, openable alone', () => {
  it('category A; closed by default; ADA_BETA_OPEN_JOBS=veille opens only cron/veille', () => {
    expect(SCHEDULED_JOBS.veille).toBe('A');
    expect(isAllowedInPublicBeta('GET', 'cron/veille', BETA)).toBe(false);
    const e = { ...BETA, ADA_BETA_OPEN_JOBS: 'veille' };
    expect([...openJobs(e)]).toEqual(['veille']);
    expect(isAllowedInPublicBeta('GET', 'cron/veille', e)).toBe(true);
    for (const p of ['cron/actualites', 'cron/ingest-aids', 'cron/hive-scan', 'monitor/core']) expect(isAllowedInPublicBeta('GET', p, e), p).toBe(false);
  });
  // V1c (R43 E5): the veille has a schedule — six bounded runs a night (00:37–05:37 UTC, 4 min each, away from :00 actualites and :07 health-alert) —
  // but stays CLOSED until the owner opens it by name in ADA_BETA_OPEN_JOBS (frequency and Production writes remain the owner's decision): while closed,
  // the scheduled call is refused server-side (503) and writes nothing
  it('the veille is scheduled nightly and still closed by default', () => {
    const crons = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons;
    expect(crons.find((c) => c.path === '/api/cron/veille')?.schedule).toBe('37 0-5 * * *');
    expect(crons).toHaveLength(9);
    expect(isAllowedInPublicBeta('GET', 'cron/veille', BETA)).toBe(false);
  });
});

describe('G10 — guest columns detected, only existing columns selected', () => {
  it('on a 0042 database no guest column is selected or returned; on 0044 every column is', () => {
    const at42 = columnFlags({ guestBooking: false, guestReminderConsent: false });
    for (const c of [...GUEST_BOOKING_COLUMNS, GUEST_REMINDER_COLUMN]) expect(at42[c], c).toBeUndefined();
    expect(at42).toMatchObject({ id: true, startAt: true, reminder_sent_at: true, reminder_locked_at: true, citizenUserId: true });
    const at44 = appointmentColumns({ guestBooking: true, guestReminderConsent: true });
    for (const c of [...GUEST_BOOKING_COLUMNS, GUEST_REMINDER_COLUMN]) expect(at44[c], c).toBeDefined();
    expect(appointmentColumns({ guestBooking: true, guestReminderConsent: false })[GUEST_REMINDER_COLUMN]).toBeUndefined();   // 0043 only
  });
});

describe('G3 — ingest-aids reads only authorised sources; Aides-territoires connector', () => {
  it('« all » runs Aides-territoires only; naming Grand Est, AGEFIPH or DREES is refused before any fetch', async () => {
    const f = vi.fn(async () => { throw new Error('no network in unit tests'); }); vi.stubGlobal('fetch', f);
    const { AUTHORISED_AID_SOURCES, runIngestAids } = await import('../../api/_handlers/cron/ingest-aids.js');
    expect([...AUTHORISED_AID_SOURCES]).toEqual(['aides-territoires']);
    for (const s of ['Grand Est', 'AGEFIPH', 'drees']) expect(await runIngestAids({ source: s, runId: 't' }), s).toMatchObject({ error: 'SOURCE_NOT_AUTHORISED' });
    expect(await runIngestAids({ source: 'nope', runId: 't' })).toMatchObject({ error: 'Unknown source: nope' });
    expect(f).not.toHaveBeenCalled();
  });
  const kvMock = () => { const store = new Map(); vi.doMock('../../api/_utils/kv.js', () => ({ kv: { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); return 'OK'; } } })); return store; };
  const atFetch = (pages) => vi.fn(async (u, init) => {
    if (String(u).includes('/connexion/')) return { ok: true, json: async () => ({ token: 'b'.repeat(40) }), init };
    const p = pages[String(u)]; if (!p) throw new Error(`unexpected ${u}`);
    return { ok: true, json: async () => p };
  });
  it('the connexion request is the documented one: POST, X-AUTH-TOKEN, Content-Type JSON, body {}', async () => {
    kvMock(); process.env.AIDES_TERRITOIRES_API_KEY = 'synthetic-key';
    const f = atFetch({ 'https://aides-territoires.beta.gouv.fr/api/aids/?published=true&page_size=50': { count: 0, next: null, results: [] } }); vi.stubGlobal('fetch', f);
    const { AidesTerritoiresConnector } = await import('../../api/lib/ingestion/AidesTerritoiresConnector.js');
    await new AidesTerritoiresConnector().getDetailUrls();
    const [, init] = f.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST', body: '{}', headers: { 'X-AUTH-TOKEN': 'synthetic-key', 'Content-Type': 'application/json' } });
  });
  it('pagination resumes at the API « next » URL saved by the previous run, and restarts at page 1 once the list is finished', async () => {
    const store = kvMock(); process.env.AIDES_TERRITOIRES_API_KEY = 'synthetic-key';
    const B = 'https://aides-territoires.beta.gouv.fr/api/aids/';
    const pages = {}; for (let i = 1; i <= 21; i++) pages[i === 1 ? `${B}?published=true&page_size=50` : `${B}?page=${i}&published=true&page_size=50`] = { count: 21, next: i < 21 ? `${B}?page=${i + 1}&published=true&page_size=50` : null, results: [{ id: i, slug: `a${i}`, name: `Aide ${i}` }] };
    const f = atFetch(pages); vi.stubGlobal('fetch', f);
    const { AidesTerritoiresConnector } = await import('../../api/lib/ingestion/AidesTerritoiresConnector.js');
    expect(await new AidesTerritoiresConnector().getDetailUrls()).toHaveLength(20);   // PAGES_PER_RUN
    expect(store.get('at-connector:next-url')).toBe(`${B}?page=21&published=true&page_size=50`);
    const second = await new AidesTerritoiresConnector().getDetailUrls();
    expect(second).toEqual(['https://aides-territoires.beta.gouv.fr/aides/a21/']);
    expect(store.get('at-connector:next-url')).toBe('');
    store.set('at-connector:next-url', 'https://evil.example/api/aids/?x');   // a stored value of another host is never followed
    f.mockClear(); await new AidesTerritoiresConnector().getDetailUrls();
    expect(String(f.mock.calls[1][0])).toBe(`${B}?published=true&page_size=50`);
  });
  it('the provider id becomes the record identity (external_id)', async () => {
    const { AidesTerritoiresConnector } = await import('../../api/lib/ingestion/AidesTerritoiresConnector.js');
    const c = new AidesTerritoiresConnector();
    expect((await c.parse(JSON.stringify({ id: 4242, name: 'Aide au permis', url: '/aides/x/' }), 'u')).external_id).toBe('aides-territoires:4242');
    expect((await c.parse(JSON.stringify({ name: 'Sans id' }), 'u')).external_id).toBeNull();
  });
});

describe('G8 / G9 — source pins', () => {
  it('health-alert checks the veille only when it is meant to run (beta lifted or ADA_BETA_OPEN_JOBS=veille); ingest-structures counts for ingestion freshness', () => {
    const src = fs.readFileSync('api/_handlers/cron/health-alert.js', 'utf8');
    expect(src).toMatch(/const veilleExpected = !isPublicBetaRestricted\(process\.env\) \|\| openJobs\(process\.env\)\.has\('veille'\);/);
    expect(src).toMatch(/checks\.veille = \{ ok: true, skipped: 'JOB_NOT_OPENED' \}/);
    expect(src).toMatch(/'actualites', 'ingest-structures'\)/);
  });
  it('the RSS seed never re-enables a feed an administrator disabled (it writes enabled only to switch a feed off)', () => {
    const src = fs.readFileSync('api/_handlers/cron/ingest-actualites-rss.js', 'utf8');
    expect(src).toMatch(/\.\.\.\(enabled \? \{\} : \{ enabled: false \}\)/);
    expect(src).not.toMatch(/onConflictDoUpdate\([^)]*set: \{[^}]*enabled: (true|enabled)\b/s);
  });
});

describe('coverage mapping — exact type labels of published records', () => {
  const REF = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
  const RT = JSON.parse(fs.readFileSync('data/reference/service-response-types.v1.json', 'utf8'));
  const sub = (id) => REF.domains.flatMap((d) => d.subdomains).find((s) => s.id === id);
  it('psy, sante-sexuelle, pmi-petite-enfance and chrs-insertion name the FINESS / Annuaire labels the records carry (no invented type)', () => {
    expect(sub('psy').structureTypes).toEqual([SCOPE[156][0], SCOPE[189][0], SCOPE[221][0]]);   // R41-IJ: + BAPU (FINESS 221)
    expect(sub('sante-sexuelle').structureTypes).toEqual([SCOPE[228][0], SCOPE[638][0], SCOPE[231][0]]);
    expect(sub('pmi-petite-enfance').structureTypes).toEqual([SCOPE[223][0], OFFICE_KINDS.pmi.label]);
    expect(sub('chrs-insertion').structureTypes).toEqual([SCOPE[214][0]]);
    expect(sub('acces-au-droit').structureTypes).toEqual([OFFICE_KINDS.point_justice.label]);
    // every structure type of the reference is a label some writer of Structure.type_structure uses (FINESS scope, Annuaire offices) or was already there
    const known = new Set([...Object.values(SCOPE).map((x) => x[0]), ...Object.values(OFFICE_KINDS).map((x) => x.label)]);
    for (const id of ['psy', 'sante-sexuelle', 'pmi-petite-enfance', 'chrs-insertion', 'acces-au-droit']) for (const t of sub(id).structureTypes) expect(known.has(t), t).toBe(true);
  });
  it('acces-au-droit: a Point-justice record of the Annuaire is the public service (placeIsService); the official title is still required', () => {
    expect(RT.subdomains['acces-au-droit']).toMatchObject({ placeIsService: true, national: false });
    const ref = { version: 't', domains: [{ id: 'k', letter: 'K', fr: 'K', lexicon: [], subdomains: [sub('acces-au-droit')] }] };
    const place = { id: 'p', type_structure: 'Point-justice (accès au droit)', ville: 'Strasbourg', code_postal: '67000', telephone: '03', services: [], date_verification: new Date().toISOString(), source_url: 'https://lannuaire.service-public.gouv.fr/grand-est/bas-rhin/x' };
    const data = (extra) => ({ aide: [], demarche: [], dispositif: [], actualite: [], structures: [place], guide: [], ...extra });
    const titled = { guide: [{ slug: 'g', titre: 'Aide juridictionnelle' }] };
    expect(coverage(ref, data(titled), new Set(), new Map(), RT.subdomains).rows[0].serviceStatus).toBe('SERVICE_VERIFIED');
    expect(coverage(ref, data({}), new Set(), new Map(), RT.subdomains).rows[0].serviceStatus).not.toBe('SERVICE_VERIFIED');
  });
  it('a published CMP / CHRS / PMI / sexual-health centre now counts as a place of its subdomain', () => {
    for (const [id, type] of [['psy', SCOPE[156][0]], ['chrs-insertion', SCOPE[214][0]], ['pmi-petite-enfance', SCOPE[223][0]], ['sante-sexuelle', SCOPE[228][0]]]) {
      const ref = { version: 't', domains: [{ id: 'x', letter: 'X', fr: 'X', lexicon: [], subdomains: [sub(id)] }] };
      const p = { id: 'p', type_structure: type, ville: 'Strasbourg', code_postal: '67000', telephone: '03', services: [], source_url: 'https://finess.esante.gouv.fr/x' };
      expect(coverage(ref, { aide: [], demarche: [], guide: [], dispositif: [], actualite: [], structures: [p] }, new Set()).rows[0].places, id).toBe(1);
    }
  });
});
