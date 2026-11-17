/**
 * FA-D9 (reference 09) — the observatory red team without a database, and the metric definitions.
 *   H1  filter changes: the institutional statistics take no filter (observatoire: none; export: `period` only) — refused before anything is read
 *   H2  query rate: reads of the statistics are counted per account (OBSERVATORY_READ); a burst is refused before anything is read or journaled
 *   H3  the administrators' preview and the professional observatoire read nothing from the request
 *   P   Production publishes frozen quarters only (publishFrozenOnly); configuration can only tighten
 *   M   every published key names one defined metric; nothing publishes a NOT_COMPUTED metric, a person count or « people helped »
 *   T   the words: « besoins non couverts » / « unmet needs » no longer name a refused referral, in six locales; the Impact page never promises
 *       « people helped » from visits
 * The same attacks on real PostgreSQL: tests/integration/d9-observatory-redteam-db.test.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const who = vi.hoisted(() => ({ current: null, observatoire: vi.fn(async () => ({ ok: true, window: { period: '2026-T3' }, byNeed: [] })), csv: vi.fn(async () => ({ ok: true, csv: 'x', period: '2026-T3', sha256: 'h' })),
  read: vi.fn(async () => undefined), download: vi.fn(async () => undefined) }));
vi.mock('../../api/_utils/institution-auth.js', () => ({ resolveInstitution: vi.fn(async () => who.current) }));
vi.mock('../../api/_services/institutions.js', () => ({ institutionLogin: vi.fn(), changeInstitutionPassword: vi.fn(), institutionLogout: vi.fn(), requestInstitutionReset: vi.fn(), completeInstitutionReset: vi.fn(), INSTITUTION_RESET_MINUTES: 30,
  recordObservatoireRead: who.read, recordExportDownload: who.download }));
vi.mock('../../api/_services/feature-flags.js', () => ({ isFeatureOn: vi.fn(async () => true) }));
vi.mock('../../api/_utils/capabilities.js', async (orig) => ({ ...(await orig()), requireCapability: () => true }));
vi.mock('../../api/_services/territorial-stats.js', async (orig) => ({ ...(await orig()), scopedObservatoire: who.observatoire, scopedTerritoryCsv: who.csv }));

const src = (f) => fs.readFileSync(path.resolve(f), 'utf8');
const LOCALES = ['en', 'de', 'tr', 'ar', 'uk'];
const locale = (l, ns) => JSON.parse(src(`src/i18n/locales/${l}/${ns}.json`));

describe('H institution handler: no filter, a counted read rate', () => {
  let handler;
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
  const call = async (p, query = {}) => { const r = mk(); await handler({ method: 'GET', url: `/api/institution/${p}`, query, headers: { authorization: 'Bearer t' }, socket: {} }, r); return r; };
  const account = (id) => ({ id, email: `${id}@example.test`, organisation: 'QA Collectivité', territory: 'Bas-Rhin', temporaryPassword: false, authType: 'institution_jwt' });
  beforeEach(async () => { for (const f of [who.observatoire, who.csv, who.read, who.download]) f.mockClear(); handler = (await import('../../api/_handlers/institution.js')).default; });

  it('H1 two queries differing by one filter: every filter is refused with ONE answer before anything is read (need, dates, cohort, period on the observatoire…)', async () => {
    who.current = account(`h1-${Date.now()}`);
    const bodies = new Set();
    for (const q of [{ need: 'HOUSING' }, { reasonCode: 'LEGAL' }, { from: '2026-07-01' }, { to: '2026-09-30' }, { period: 'year' }, { quarter: '2026-T2' }, { age: '18-25' }, { sexe: 'F' },
      { cohort: 'x' }, { structure: 'abc' }, { status: 'ACCEPTED' }, { limit: '1' }, { _: '1700000000' }]) {
      const r = await call('observatoire', q); expect(r.statusCode, JSON.stringify(q)).toBe(400); expect(r.body.error).toBe('QUERY_PARAMETER_NOT_ACCEPTED'); bodies.add(JSON.stringify(r.body));
      if (!('period' in q)) { const e = await call('export', { period: 'quarter', ...q }); expect(e.statusCode, `export ${JSON.stringify(q)}`).toBe(400); bodies.add(JSON.stringify(e.body)); }
    }
    expect(bodies.size).toBe(1);
    for (const f of [who.observatoire, who.csv, who.read, who.download]) expect(f).not.toHaveBeenCalled();
    expect((await call('observatoire')).statusCode).toBe(200); expect((await call('export', { period: 'quarter' })).statusCode).toBe(200);
  });

  it('H2 query rate: 30 reads an hour per account; the 31st is refused before anything is read or journaled; another account is not affected', async () => {
    const id = `h2-${Date.now()}`; who.current = account(id);
    for (let i = 0; i < 30; i += 1) expect((await call(i % 2 ? 'observatoire' : 'export', i % 2 ? {} : { period: 'quarter' })).statusCode, `read ${i + 1}`).toBe(200);
    const calls = who.observatoire.mock.calls.length + who.csv.mock.calls.length;
    const refused = await call('observatoire');
    expect(refused.statusCode).toBe(429);
    expect(who.observatoire.mock.calls.length + who.csv.mock.calls.length).toBe(calls);
    expect(who.read.mock.calls.length + who.download.mock.calls.length).toBe(30);
    who.current = account(`${id}-other`);
    expect((await call('observatoire')).statusCode).toBe(200);
    expect(src('api/_utils/rateLimit.js')).toMatch(/OBSERVATORY_READ: \{ limit: 30, window: 3600 \}/);
  });

  it('H3 the administrators\' preview and the professional observatoire read nothing from the request', () => {
    const admin = src('api/_handlers/admin/institutions.js');
    expect(admin).toMatch(/req\.query\?\.view === 'observatoire' \? await observatoire\(\) : undefined/);
    const pro = src('api/_handlers/pro/regional-stats.js');
    expect(pro).toMatch(/await regionalStats\(ctx\)/); expect(pro).not.toMatch(/req\.(query|body)/);
  });
});

describe('P Production publishes frozen quarters only', () => {
  it('on in Production whatever the configuration; off in the LAB unless asked; configuration only tightens', async () => {
    const { publishFrozenOnly } = await vi.importActual('../../api/_services/territorial-stats.js');
    expect(publishFrozenOnly({ VERCEL_ENV: 'production' })).toBe(true);
    expect(publishFrozenOnly({ VERCEL_ENV: 'production', OBS_PUBLISH_FROZEN_ONLY: '0' })).toBe(true);
    expect(publishFrozenOnly({ VERCEL_ENV: 'development' })).toBe(false);
    expect(publishFrozenOnly({ VERCEL_ENV: 'preview', OBS_PUBLISH_FROZEN_ONLY: 'true' })).toBe(true);
    expect(publishFrozenOnly({})).toBe(false);
  });
});

describe('M metric definitions', () => {
  it('every published key of the observatories names exactly one PUBLISHED metric; DEFINED_NOT_PUBLISHED and NOT_COMPUTED metrics are published nowhere', async () => {
    const { METRICS, PUBLISHED_KEYS, metricsOf } = await import('../../api/lib/observatory-metrics.js');
    expect(Object.keys(metricsOf(['sent', 'unmet', 'outOfScope']))).toEqual(['sent', 'unmet', 'outOfScope']);
    expect(metricsOf(['unmet']).unmet).toEqual({ metric: 'referral_declined_no_capacity', label: 'Orientation refusée faute de capacité', unit: 'EVENT' });
    expect(metricsOf(['peopleWithAppointment']).peopleWithAppointment.unit).toBe('ACCOUNT');
    expect(() => metricsOf(['citizensHelped'])).toThrow();
    for (const m of METRICS) {
      expect(m.label && m.definition && m.isNot, m.id).toBeTruthy();
      if (m.status !== 'PUBLISHED') expect(m.publishedAs, m.id).toBeUndefined();
      if (m.status === 'NOT_COMPUTED') expect(m.unit, m.id).toBeNull();
      expect(['EVENT', 'ACCOUNT', null]).toContain(m.unit);   // no published figure counts PEOPLE
    }
    for (const id of ['need_expressed', 'aid_found', 'action_started', 'service_rendered', 'non_take_up', 'page_view']) expect(METRICS.find((m) => m.id === id).status, id).toBe('NOT_COMPUTED');
    for (const id of ['referral_accepted', 'referral_expired', 'appointment_honoured', 'support_closed_declared']) expect(METRICS.find((m) => m.id === id).status, id).toBe('DEFINED_NOT_PUBLISHED');
    expect(Object.values(PUBLISHED_KEYS).sort()).toEqual(['appointment_not_cancelled', 'appointment_not_cancelled', 'citizen_accounts_with_appointment', 'citizen_accounts_with_appointment', 'referral_declined_no_capacity', 'referral_declined_out_of_scope', 'referral_sent']);
  });

  it('no code publishes a « people helped » figure, and the statistics never read a person\'s own space (Mon Parcours, history, assistant)', () => {
    const files = ['api/_services/territorial-stats.js', 'api/_services/org-stats.js', 'api/_handlers/institution.js', 'api/_handlers/pro/regional-stats.js', 'src/pages/pro/RegionalDashboard.jsx', 'src/pages/institution/Espace.jsx', 'src/pages/Impact.jsx'];
    for (const f of files) expect(src(f), f).not.toMatch(/\b(totalCitizensHelped|citizensHelped|peopleHelped|helpedCount)\s*[:=]/);
    for (const f of ['api/_services/territorial-stats.js', 'api/_services/org-stats.js']) expect(src(f), f).not.toMatch(/"(ParcoursItem|ParcoursEvent|CitizenHistoryEntry|ConversationLog|CitizenProfile)"/);
  });

  it('the methodology says what is not measured, and that a refusal for capacity is not an unmet need', async () => {
    const { METHODOLOGY, SCHEMA_VERSION } = await vi.importActual('../../api/_services/territorial-stats.js');
    expect(METHODOLOGY.besoinsNonCouverts).toMatch(/Ce n’est pas un nombre de besoins non couverts/);
    expect(METHODOLOGY.nonRecours).toMatch(/ne mesurent ni le non-recours, ni les services effectivement rendus, ni les personnes aidées/);
    expect(METHODOLOGY.gel).toMatch(/En production, un trimestre clos n’est publié qu’une fois figé/);
    // source completeness and bias are published with the figures (reference 09: explicit missing-data limits)
    expect(METHODOLOGY.completude).toMatch(/^Couverture et biais : seules les structures inscrites, vérifiées et situées/);
    expect(METHODOLOGY.completude).toMatch(/pas la situation du territoire\.$/);
    expect(SCHEMA_VERSION).toBe('ada.territory-stats.v3');
  });
});

describe('T the words, six locales', () => {
  it('the institutional observatoire is named for what it counts; « unmet » never labels a refused referral', () => {
    const page = src('src/pages/institution/Espace.jsx');
    expect(page).not.toMatch(/'Observatoire des besoins non couverts'|'Non couverts'|besoins non couverts \(pas de capacité\)/);
    expect(page).toMatch(/t\('institution:space\.observatoire_orientations', 'Observatoire des orientations'\)/);
    const forbidden = { en: /unmet need|Observatory of unmet/i, de: /ungedeckte|nicht gedeckte Bedarf/i, tr: /karşılanma(yan|mış)/i, ar: /غير الملب|غير ملب/, uk: /незадоволен/i };
    for (const l of LOCALES) {
      const j = locale(l, 'institution');
      for (const k of ['space.observatoire_orientations', 'space.refusees_capacite', 'space.period_totals_v3', 'space.method.declined_capacity', 'space.method.non_recours', 'space.method.completeness', 'space.quarter_withheld']) expect(j[k], `${l} ${k}`).toBeTruthy();
      for (const k of ['space.observatoire_orientations', 'space.refusees_capacite', 'space.period_totals_v3']) expect(j[k], `${l} ${k}`).not.toMatch(forbidden[l]);
      for (const k of ['space.observatoire_des_besoins_non', 'space.non_couverts', 'space.period_totals_v2', 'space.method.unmet_capacity']) expect(j[k], `${l} ${k} removed`).toBeUndefined();
    }
  });

  it('the professional observatoire counts accounts and appointments not cancelled; the Impact page never promises « people helped » from visits', () => {
    const dash = src('src/pages/pro/RegionalDashboard.jsx');
    expect(dash).toMatch(/pro:regional\.kpi_accounts_with_appointment/); expect(dash).toMatch(/pro:regional\.kpi_quarter_not_cancelled/);
    const impact = src('src/pages/Impact.jsx');
    expect(impact).toMatch(/about:impact\.not_measured\.text_v2/); expect(impact).not.toMatch(/Ces chiffres seront publiés lorsqu’ils seront mesurés/);
    for (const l of LOCALES) {
      expect(locale(l, 'pro')['regional.kpi_accounts_with_appointment'], l).toBeTruthy(); expect(locale(l, 'pro')['regional.kpi_quarter_not_cancelled'], l).toBeTruthy();
      expect(locale(l, 'pro')['regional.quarter_withheld'], l).toBeTruthy();
      expect(locale(l, 'about')['impact.not_measured.text_v2'], l).toBeTruthy(); expect(locale(l, 'about')['impact.not_measured.text'], l).toBeUndefined();
    }
  });
});
