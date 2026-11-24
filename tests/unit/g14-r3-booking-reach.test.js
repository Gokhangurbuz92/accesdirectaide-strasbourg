/**
 * G14 release 3 (owner approval 24/11/2026, « cover everyone and everything » in find-and-book) — server side:
 *   A. the needs of a bookable service (subdomains of the 20 × 86 taxonomy, migration 0063) and the directory's need filter;
 *   B. « appointments on our own system »: URL rules, recognised public platforms (RDV Solidarités / RDV Service Public), the public switch
 *      ADA_EXTERNAL_BOOKING (default closed), the professional and administrator routes, their gates.
 * No database: the DB behaviour is tests/integration/g14-r3-booking-reach-db.test.js.
 */
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EXTERNAL_BOOKING_SWITCH, PLATFORMS, externalBookingMode, publicExternalBooking, validateExternalBookingUrl } from '../../api/lib/external-booking.js';
import { MAX_SERVICE_SUBDOMAINS, needFilterSubdomains, parseServiceSubdomains, sensitiveTags } from '../../api/lib/service-needs.js';
import { bookableStructureSql } from '../../api/lib/bookable-structures.js';
import { externalBookingSql } from '../../api/_services/external-booking.js';
import { isAllowedInPublicBeta, surfaceOf } from '../../api/_utils/public-beta.js';
import { capabilitiesOfRoute } from '../../api/_utils/capabilities.js';
import { suggestSensitivity } from '../../api/lib/service-sensitivity.js';

const sqlOf = (q) => new PgDialect().sqlToQuery(q);

describe('B. external booking URL rules', () => {
  it('accepts a public https page and classifies an ordinary site as « other »', () => {
    expect(validateExternalBookingUrl('https://www.example.org/rendez-vous')).toEqual({ ok: true, url: 'https://www.example.org/rendez-vous', platform: 'other', host: 'www.example.org' });
  });
  it('refuses http, credentials, IP literals, ports, local / test hosts, control characters, overlong URLs', () => {
    const code = (u) => validateExternalBookingUrl(u).code;
    expect(code('http://www.example.org/rdv')).toBe('HTTPS_REQUIRED');
    expect(code('javascript:alert(1)')).toBe('HTTPS_REQUIRED');
    expect(code('https://user:pw@www.example.org/rdv')).toBe('CREDENTIALS_IN_URL');
    expect(code('https://user@www.example.org/rdv')).toBe('CREDENTIALS_IN_URL');
    expect(code('https://192.168.1.10/rdv')).toBe('HOST_NOT_PUBLIC');
    expect(code('https://[::1]/rdv')).toBe('HOST_NOT_PUBLIC');
    expect(code('https://www.example.org:8443/rdv')).toBe('HOST_NOT_PUBLIC');
    expect(code('https://localhost/rdv')).toBe('HOST_NOT_PUBLIC');
    expect(code('https://ada.test/rdv')).toBe('HOST_NOT_PUBLIC');
    expect(code('https://intranet/rdv')).toBe('HOST_NOT_PUBLIC');
    expect(code('https://www.example.org/a b')).toBe('URL_INVALID');
    expect(code(`https://www.example.org/${'a'.repeat(2100)}`)).toBe('URL_TOO_LONG');
    expect(code('')).toBe('URL_REQUIRED');
    expect(code(42)).toBe('URL_REQUIRED');
  });
  it('refuses a URL carrying a person\'s data or a credential (e-mail, name, phone, token…)', () => {
    for (const u of ['https://www.example.org/rdv?email=a%40b.fr', 'https://www.example.org/rdv/jean@exemple.fr', 'https://www.example.org/rdv?nom=Dupont',
      'https://www.example.org/rdv?telephone=0600000000', 'https://www.example.org/rdv?token=abc', 'https://www.example.org/rdv?access_token=abc',
      'https://www.example.org/rdv?invitation_token=abc', 'https://www.example.org/rdv?adresse=1+rue']) {
      expect(validateExternalBookingUrl(u).code, u).toBe('PERSONAL_DATA_IN_URL');
    }
  });
  it('recognises the public deep links of the ANCT booking platforms and strips the visitor\'s position parameters', () => {
    expect(PLATFORMS.map((p) => p.id)).toEqual(['rdv-solidarites', 'rdv-aide-numerique', 'rdv-service-public', 'rdv-service-public-etat']);
    expect(validateExternalBookingUrl('https://rdv.anct.gouv.fr/org/1234/mairie-de-x')).toMatchObject({ ok: true, platform: 'rdv-service-public' });
    expect(validateExternalBookingUrl('https://www.rdv-solidarites.fr/org/ext/67/abc-12')).toMatchObject({ ok: true, platform: 'rdv-solidarites' });
    expect(validateExternalBookingUrl('https://rdv.numerique.gouv.fr/motif/987')).toMatchObject({ ok: true, platform: 'rdv-service-public-etat' });
    const v = validateExternalBookingUrl('https://www.rdv-solidarites.fr/prendre_rdv?departement=67&service_id=3&address=1+rue+X+Strasbourg&latitude=48.5&longitude=7.7&city_code=67482&street_ban_id=67482_1234');
    expect(v).toMatchObject({ ok: true, platform: 'rdv-solidarites' });
    expect(v.url).toBe('https://www.rdv-solidarites.fr/prendre_rdv?departement=67&service_id=3');
    // the platform's home page (or another path) is accepted as « other », after the same review
    expect(validateExternalBookingUrl('https://rdv.anct.gouv.fr/')).toMatchObject({ ok: true, platform: 'other' });
    expect(validateExternalBookingUrl('https://rdv.anct.gouv.fr.autre-site.fr/org/1')).toMatchObject({ ok: true, platform: 'other' });
  });
});

describe('B. the public switch ADA_EXTERNAL_BOOKING (default closed)', () => {
  const approved = { url: 'https://www.example.org/rdv', platform: 'other', status: 'APPROVED', subdomains: ['aide-alimentaire'] };
  const onPlatform = { url: 'https://rdv.anct.gouv.fr/org/12', platform: 'rdv-service-public', status: 'APPROVED', subdomains: [] };
  it('closed unless exactly « open » or « platforms »', () => {
    expect(EXTERNAL_BOOKING_SWITCH).toBe('ADA_EXTERNAL_BOOKING');
    for (const v of [undefined, '', '1', 'true', 'yes', 'OPEN-ish', 'all']) expect(externalBookingMode({ ADA_EXTERNAL_BOOKING: v })).toBe('closed');
    expect(externalBookingMode({ ADA_EXTERNAL_BOOKING: 'open' })).toBe('open');
    expect(externalBookingMode({ ADA_EXTERNAL_BOOKING: ' Platforms ' })).toBe('platforms');
  });
  it('nothing public while closed, or for a record that is not APPROVED; « platforms » hides an ordinary site', () => {
    expect(publicExternalBooking(approved, {})).toBeNull();
    expect(publicExternalBooking({ ...approved, status: 'PENDING' }, { ADA_EXTERNAL_BOOKING: 'open' })).toBeNull();
    expect(publicExternalBooking({ ...approved, status: 'REJECTED' }, { ADA_EXTERNAL_BOOKING: 'open' })).toBeNull();
    expect(publicExternalBooking(approved, { ADA_EXTERNAL_BOOKING: 'open' })).toEqual({ url: approved.url, platform: 'other', platformLabel: null, host: 'www.example.org', subdomains: ['aide-alimentaire'] });
    expect(publicExternalBooking(approved, { ADA_EXTERNAL_BOOKING: 'platforms' })).toBeNull();
    expect(publicExternalBooking(onPlatform, { ADA_EXTERNAL_BOOKING: 'platforms' })).toMatchObject({ platform: 'rdv-service-public', platformLabel: 'RDV Service Public' });
    // a stored URL that no longer passes the rules is never shown (fail closed)
    expect(publicExternalBooking({ ...approved, url: 'http://www.example.org/rdv' }, { ADA_EXTERNAL_BOOKING: 'open' })).toBeNull();
  });
  it('the public shape never carries the reviewer, the note, the source or the submitter', () => {
    const out = publicExternalBooking({ ...approved, reviewedBy: 'ops@example.test', reviewNote: 'x', source: 'PRO', submittedBy: 'u1' }, { ADA_EXTERNAL_BOOKING: 'open' });
    expect(Object.keys(out).sort()).toEqual(['host', 'platform', 'platformLabel', 'subdomains', 'url']);
  });
  it('the switch is documented in the activation manifest and .env.example, closed by default', () => {
    const manifest = JSON.parse(fs.readFileSync('config/activation-manifest.json', 'utf8'));
    const entry = Object.values(manifest).map((x) => x && x.ADA_EXTERNAL_BOOKING).find(Boolean) || manifest.variables?.ADA_EXTERNAL_BOOKING;
    expect(entry).toMatchObject({ class: 'decision', format: '^(open|platforms)?$' });
    expect(fs.readFileSync('.env.example', 'utf8')).toMatch(/^ADA_EXTERNAL_BOOKING=$/m);
  });
});

describe('A. needs of a bookable service (20 × 86 taxonomy)', () => {
  it('accepts known subdomains with their domain, sorted and deduplicated; refuses unknown ids, malformed input and more than the limit', () => {
    expect(parseServiceSubdomains(['urgence-sociale', 'aide-alimentaire', 'aide-alimentaire'])).toEqual({ ok: true,
      value: [{ subdomain: 'aide-alimentaire', domain: 'precarite' }, { subdomain: 'urgence-sociale', domain: 'precarite' }] });
    expect(parseServiceSubdomains([])).toEqual({ ok: true, value: [] });
    expect(parseServiceSubdomains(['n-existe-pas'])).toEqual({ ok: false, code: 'NEEDS_UNKNOWN' });
    expect(parseServiceSubdomains(['Aide alimentaire'])).toEqual({ ok: false, code: 'NEEDS_INVALID' });
    expect(parseServiceSubdomains('aide-alimentaire')).toEqual({ ok: false, code: 'NEEDS_INVALID' });
    const ref = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
    const all = ref.domains.flatMap((d) => d.subdomains.map((s) => s.id));
    expect(all).toHaveLength(86);
    expect(parseServiceSubdomains(all.slice(0, MAX_SERVICE_SUBDOMAINS + 1))).toEqual({ ok: false, code: 'NEEDS_TOO_MANY' });
  });
  it('the need filter: a subdomain, every subdomain of a domain, nothing for an unknown id (never the whole list)', () => {
    expect(needFilterSubdomains({})).toBeNull();
    expect(needFilterSubdomains({ subdomain: 'aide-alimentaire' })).toEqual(['aide-alimentaire']);
    expect(needFilterSubdomains({ domain: 'precarite' })).toHaveLength(6);
    expect(needFilterSubdomains({ subdomain: 'aide-alimentaire', domain: 'logement' })).toEqual([]);
    expect(needFilterSubdomains({ subdomain: "x' OR 1=1" })).toEqual([]);
    expect(needFilterSubdomains({ domain: 'inconnu' })).toEqual([]);
  });
  it('the bookable predicate ties the need to THE SAME bookable service; the external predicate needs an APPROVED page', () => {
    const plain = sqlOf(bookableStructureSql()).sql;
    expect(plain).not.toMatch(/ProRdvServiceSubdomain/);
    const q = sqlOf(bookableStructureSql({ subdomains: ['aide-alimentaire', 'bad id'] }));
    expect(q.sql).toMatch(/"ProRdvServiceSubdomain" need WHERE need\."serviceId" = svc\.id AND need\.subdomain = ANY\(\$\d+::text\[\]\)/);
    expect(q.params).toContain('{aide-alimentaire}');
    const e = sqlOf(externalBookingSql({ subdomains: ['psy'], platformsOnly: true }));
    expect(e.sql).toMatch(/eb\.status = 'APPROVED' AND eb\.platform <> 'other' AND eb\.subdomains && \$\d+::text\[\]/);
  });
  it('a sensitive need tag is a SIGNAL for the administrator\'s sensitivity review, never a value', () => {
    expect(sensitiveTags(['psy', 'aide-alimentaire', 'addictions'])).toEqual(['psy', 'addictions']);
    expect(suggestSensitivity({ serviceName: 'Accueil', sensitiveNeeds: ['psy'] })).toEqual({ suggestion: 'sensitive', matched: ['besoin : psy'] });
    expect(suggestSensitivity({ serviceName: 'Accueil', sensitiveNeeds: [] }).suggestion).toBe('no_signal');
  });
});

describe('gates: existing surfaces only', () => {
  const BETA = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
  it('the professional route belongs to « appointments » (pro.agenda); the review route to « admin »; both closed by default during the beta', () => {
    expect(surfaceOf('pro/rdv/external-booking')).toBe('appointments');
    expect(capabilitiesOfRoute('pro/rdv/external-booking')).toEqual(['pro.agenda']);
    expect(surfaceOf('admin/external-booking')).toBe('admin');
    for (const m of ['GET', 'PUT', 'DELETE']) expect(isAllowedInPublicBeta(m, 'pro/rdv/external-booking', BETA), m).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'admin/external-booking', BETA)).toBe(false);
    expect(isAllowedInPublicBeta('PUT', 'pro/rdv/external-booking', { ...BETA, ADA_BETA_OPEN_SURFACES: 'appointments' })).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'admin/external-booking', { ...BETA, ADA_BETA_OPEN_SURFACES: 'admin' })).toBe(true);
    // the directory itself stays a public read; nothing new is opened for writing
    expect(isAllowedInPublicBeta('GET', 'structures', BETA)).toBe(true);
    expect(isAllowedInPublicBeta('POST', 'structures', BETA)).toBe(false);
  });
  it('both routes are registered and documented', () => {
    const routes = fs.readFileSync('api/routes.js', 'utf8');
    expect(routes).toMatch(/path: 'pro\/rdv\/external-booking', match: 'exact'/);
    expect(routes).toMatch(/path: 'admin\/external-booking', match: 'exact'/);
    const spec = JSON.parse(fs.readFileSync('docs/openapi.json', 'utf8'));
    expect(Object.keys(spec.paths['/pro/rdv/external-booking'])).toEqual(['get', 'put', 'delete']);
    expect(spec.paths['/structures'].get.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['subdomain', 'domain']));
  });
});

describe('the professional route /api/pro/rdv/external-booking', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('../../api/_services/external-booking.js'); vi.doUnmock('../../api/_utils/with-pro-rdv-handler.js'); vi.doUnmock('../../api/_utils/auth.js'); });
  const res = () => { const r = { code: 0, body: null, headers: {} }; return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status: (c) => { r.code = c; return { json: (b) => { r.body = b; return r; } }; } }); };
  async function route({ available = true, submit } = {}) {
    vi.resetModules();
    vi.doMock('../../api/_utils/with-pro-rdv-handler.js', () => ({ withProRdvHandler: (_n, fn) => fn }));
    vi.doMock('../../api/_utils/auth.js', async (orig) => ({ ...(await orig()), logProAudit: vi.fn(async () => {}) }));
    const svc = { NOT_AVAILABLE: { status: 503, code: 'EXTERNAL_BOOKING_NOT_AVAILABLE', message: 'x' }, externalBookingAvailable: vi.fn(async () => available),
      readExternalBooking: vi.fn(async () => null), removeExternalBooking: vi.fn(async () => ({ ok: true })),
      submitExternalBooking: submit || vi.fn(async (i) => ({ ok: true, changed: true, record: { url: i.url, platform: 'other', subdomains: [], status: 'PENDING', source: 'PRO' } })) };
    vi.doMock('../../api/_services/external-booking.js', () => svc);
    return { h: (await import('../../api/_handlers/pro/external-booking.js')).default, svc };
  }
  const req = (method, role, body) => ({ method, url: '/api/pro/rdv/external-booking', headers: {}, body, user: { structureId: 's1', userId: 'u1', role } });
  it('answers 503 without migration 0063', async () => {
    const { h } = await route({ available: false });
    const r = res(); await h(req('GET', 'PRO'), r);
    expect([r.code, r.body.code]).toEqual([503, 'EXTERNAL_BOOKING_NOT_AVAILABLE']);
  });
  it('a member reads; only a structure administrator writes; the page is recorded PENDING for the caller\'s structure only', async () => {
    const { h, svc } = await route();
    let r = res(); await h(req('GET', 'PRO'), r);
    expect(r.code).toBe(200); expect(r.body).toMatchObject({ record: null, shownPublicly: false, publicDisplay: 'closed' });
    r = res(); await h(req('PUT', 'PRO', { url: 'https://www.example.org/rdv' }), r);
    expect(r.code).toBe(403); expect(svc.submitExternalBooking).not.toHaveBeenCalled();
    r = res(); await h(req('PUT', 'STRUCTURE_ADMIN', { url: 'https://www.example.org/rdv', structureId: 'someone-else' }), r);
    expect(r.code).toBe(200); expect(r.body.record.status).toBe('PENDING');
    expect(svc.submitExternalBooking).toHaveBeenCalledWith(expect.objectContaining({ structureId: 's1', source: 'PRO', by: 'u1' }), expect.anything());
  });
  it('maps a refused URL to its code and a French message', async () => {
    const { h } = await route({ submit: vi.fn(async () => ({ ok: false, status: 400, code: 'PERSONAL_DATA_IN_URL' })) });
    const r = res(); await h(req('PUT', 'STRUCTURE_ADMIN', { url: 'https://www.example.org/rdv?email=a%40b.fr' }), r);
    expect([r.code, r.body.code]).toEqual([400, 'PERSONAL_DATA_IN_URL']); expect(r.body.error).toMatch(/donnée personnelle/);
  });
});

describe('the administrator route /api/admin/external-booking', () => {
  afterEach(() => { vi.resetModules(); });
  const res = () => { const r = { code: 0, body: null, headers: {} }; return Object.assign(r, { setHeader: (k, v) => { r.headers[k] = v; }, status: (c) => { r.code = c; return { json: (b) => { r.body = b; return r; } }; } }); };
  async function route(auth, review = vi.fn(async () => ({ ok: true, previous: 'PENDING', status: 'APPROVED' }))) {
    vi.resetModules();
    vi.doMock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '192.0.2.9' }));
    vi.doMock('../../api/_utils/auth.js', async (orig) => ({ ...(await orig()), resolveAuthContext: async () => auth }));
    vi.doMock('../../api/lib/search-cache.js', () => ({ bumpContentEpoch: async () => ({ bumped: true }) }));
    vi.doMock('../../api/_services/external-booking.js', () => ({ NOT_AVAILABLE: { status: 503, code: 'EXTERNAL_BOOKING_NOT_AVAILABLE', message: 'x' },
      reviewExternalBooking: review, listExternalBookings: async () => [], submitExternalBooking: vi.fn() }));
    return { h: (await import('../../api/_handlers/admin/external-booking.js')).default, review };
  }
  const human = { role: 'ADMIN', authType: 'admin_jwt', mfa_verified: true, email: 'ops@example.test' };
  const BODY = { action: 'review', structureId: 's1', decision: 'APPROVE', note: 'Page de la mairie vérifiée' };
  it('anonymous, citizen and professional sessions: 401; an administrator without MFA cannot decide; with MFA: decided, named', async () => {
    for (const auth of [null, { role: 'USER', authType: 'user_session' }, { role: 'STRUCTURE_ADMIN', authType: 'pro_jwt', structureId: 's1' }]) {
      const { h, review } = await route(auth);
      const r = res(); await h({ method: 'POST', url: '/api/admin/external-booking', headers: {}, body: BODY }, r);
      expect(r.code, JSON.stringify(auth)).toBe(401); expect(review).not.toHaveBeenCalled();
    }
    let { h, review } = await route({ ...human, mfa_verified: false });
    let r = res(); await h({ method: 'POST', url: '/api/admin/external-booking', headers: {}, body: BODY }, r);
    expect(r.code).toBe(403); expect(review).not.toHaveBeenCalled();
    ({ h, review } = await route(human));
    r = res(); await h({ method: 'POST', url: '/api/admin/external-booking', headers: {}, body: BODY }, r);
    expect(r.code).toBe(200); expect(review).toHaveBeenCalledWith(expect.objectContaining({ structureId: 's1', decision: 'APPROVE', by: 'ops@example.test' }));
    r = res(); await h({ method: 'POST', url: '/api/admin/external-booking', headers: {}, body: { action: 'list' } }, r);
    expect(r.code).toBe(200); expect(r.body).toEqual({ items: [], publicDisplay: 'closed' });
  });
});

describe('migration 0063: additive, journaled, reversible', () => {
  const up = fs.readFileSync('drizzle/0063_g14_r3_booking_needs_external.sql', 'utf8');
  it('creates two tables and their constraints, changes nothing that exists', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS "ProRdvServiceSubdomain"/);
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS "StructureExternalBooking"/);
    const sqlOnly = up.split('\n').filter((l) => !l.startsWith('--')).join('\n');
    expect(sqlOnly).not.toMatch(/^\s*(DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/m);
    expect(sqlOnly).not.toMatch(/ALTER TABLE "(?!ProRdvServiceSubdomain"|StructureExternalBooking")/);
    expect(sqlOnly).toMatch(/"StructureExternalBooking_url_check" CHECK \("StructureExternalBooking"\."url" ~ '\^https:\/\//);
    expect(sqlOnly).toMatch(/"StructureExternalBooking_review_check"/);
  });
  it('the journal ends with 0063, the snapshot has both tables, the rollback drops them and forgets the row', () => {
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
    expect(journal.at(-1)).toMatchObject({ idx: 63, tag: '0063_g14_r3_booking_needs_external', when: 1795050000000 });
    const snap = JSON.parse(fs.readFileSync('drizzle/meta/0063_snapshot.json', 'utf8'));
    expect(Object.keys(snap.tables)).toEqual(expect.arrayContaining(['public.ProRdvServiceSubdomain', 'public.StructureExternalBooking']));
    expect(snap.prevId).toBe(JSON.parse(fs.readFileSync('drizzle/meta/0062_snapshot.json', 'utf8')).id);
    const down = fs.readFileSync('drizzle/rollback/0063_down.sql', 'utf8');
    expect(down).toMatch(/DROP TABLE IF EXISTS "StructureExternalBooking"/); expect(down).toMatch(/DROP TABLE IF EXISTS "ProRdvServiceSubdomain"/);
    expect(down).toMatch(/created_at = 1795050000000/);
  });
});

describe('open-data import: a source\'s booking link is only PROPOSED (data·inclusion)', () => {
  it('reads « lien_mobilisation » when a person can use it (schema v1) or « prise_rdv » (v0), https only, one per place', async () => {
    const os = await import('node:os'); const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g14r3-di-'));
    const structures = path.join(dir, 's.json'); const services = path.join(dir, 'v.json');
    fs.writeFileSync(structures, JSON.stringify([
      { id: 'dora--a', source: 'dora', nom: 'Asso A', code_postal: '67000', code_insee: '67482', commune: 'Strasbourg' },
      { id: 'dora--b', source: 'dora', nom: 'Asso B', code_postal: '67000', code_insee: '67482', commune: 'Strasbourg' },
      { id: 'dora--c', source: 'dora', nom: 'Asso C', code_postal: '67000', code_insee: '67482', commune: 'Strasbourg' },
    ]));
    fs.writeFileSync(services, JSON.stringify([
      { id: 'dora--s1', structure_id: 'dora--a', source: 'dora', nom: 'Accueil', modes_mobilisation: ['utiliser-lien-mobilisation'], mobilisable_par: ['usagers'], lien_mobilisation: 'https://www.asso-a.fr/rdv' },
      { id: 'dora--s2', structure_id: 'dora--b', source: 'dora', nom: 'Accueil', modes_mobilisation: ['utiliser-lien-mobilisation'], mobilisable_par: ['professionnels'], lien_mobilisation: 'https://www.asso-b.fr/orienter' },
      { id: 'dora--s3', structure_id: 'dora--c', source: 'dora', nom: 'Accueil', prise_rdv: 'http://www.asso-c.fr/rdv' },
    ]));
    const { readDataInclusion } = await import('../../api/_services/verification/datainclusion.js');
    const r = await readDataInclusion({ structures, services });
    expect([...r.bookingOf.entries()]).toEqual([['dora--a', { url: 'https://www.asso-a.fr/rdv', ref: 'data-inclusion:dora--s1' }]]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
