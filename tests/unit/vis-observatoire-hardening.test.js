/**
 * Visibility audit (2026-11) — the two observatoires, without a database:
 *   P1  publishTables (the only place that decides what the institution observatoire and its CSV publish): no unmasked table beside a masked one, never exactly
 *       one masked cell, a change inside a masked cell is invisible; alignColumns;
 *   P2  institution handler: a session on a temporary password gets 403 PASSWORD_CHANGE_REQUIRED for everything but `me` (password change and logout stay open);
 *   P4  professional observatoire: complete calendar quarters (no month-to-date figure, no rolling days);
 *   labels: « Citoyens aidés » is gone in the six languages; OUT_OF_SCOPE is its own indicator; the OpenAPI text of pro/interop-siao no longer says « transmises ».
 * The attacks on real PostgreSQL: tests/integration/vis-observatoire-differencing-db.test.js.
 */
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const who = vi.hoisted(() => ({ current: null, observatoire: vi.fn(async () => ({ ok: true, byNeed: [] })), territoryCsv: vi.fn(async () => ({ ok: true, csv: 'x', period: '2026-T3', sha256: 'h' })) }));
vi.mock('../../api/_utils/institution-auth.js', () => ({ resolveInstitution: vi.fn(async () => who.current) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_services/institutions.js', () => ({ institutionLogin: vi.fn(), changeInstitutionPassword: vi.fn(async () => ({ ok: true, token: 'new', message: 'ok' })), institutionLogout: vi.fn(async () => undefined), requestInstitutionReset: vi.fn(), completeInstitutionReset: vi.fn(), INSTITUTION_RESET_MINUTES: 30 }));
vi.mock('../../api/_services/feature-flags.js', () => ({ isFeatureOn: vi.fn(async () => true) }));
vi.mock('../../api/_utils/capabilities.js', async (orig) => ({ ...(await orig()), requireCapability: () => true }));
vi.mock('../../api/_services/territorial-stats.js', async (orig) => ({ ...(await orig()), observatoire: who.observatoire, territoryCsv: who.territoryCsv }));

const { publishTables, alignColumns, complementColumn, publishedSum, METHODOLOGY, SCHEMA_VERSION, lastQuarters, periodWindow } = await vi.importActual('../../api/_services/territorial-stats.js');
const src = (p) => fs.readFileSync(p, 'utf8');
const MEASURES = ['sent', 'unmet', 'outOfScope'];
const row = (key, name, sent, unmet = 0, outOfScope = 0) => ({ [key]: name, sent, unmet, outOfScope });
const masked = (rows, m) => rows.filter((r) => r[m] === null).length;

describe('P1 publishTables: nothing published gives back a masked cell', () => {
  it('alignColumns: an unmasked column beside a masked one loses its two smallest cells; two masked or two unmasked columns are left alone', () => {
    expect(alignColumns([null, null, 15], [9, 9, 8])).toEqual([[null, null, 15], [null, 9, null]]);
    expect(alignColumns([9, 8, 7], [null, null, 20])).toEqual([[9, null, null], [null, null, 20]]);
    expect(alignColumns([9, 8], [7, 6])).toEqual([[9, 8], [7, 6]]);
    expect(alignColumns([null, null], [null, 6, null])).toEqual([[null, null], [null, 6, null]]);
    expect(alignColumns([null], [12])).toEqual([[null], [null]]);
    expect(complementColumn([3, 8, 9].map((v) => (v >= 5 ? v : null)))).toEqual([null, null, 9]);
  });

  it('the differencing attack on a synthetic quarter: no published sum is the true total, no difference is the sum of the masked cells', () => {
    // true counts: 28 referrals; by need 15 + 3 + 8 + 2, by commune 9 + 9 + 8 + 2 (the fixture of the integration test, here with no other commune)
    const need = [row('need', 'FOOD_AID', 3), row('need', 'HEALTH', 8, 6, 2), row('need', 'HOUSING', 15, 2, 6), row('need', 'OTHER', 2)];
    const commune = [row('commune', 'A', 9, 2, 1), row('commune', 'B', 9, 0, 5), row('commune', 'C', 8, 6, 2), row('commune', 'D', 2)];
    const TRUE = { sent: 28, unmet: 8, outOfScope: 8 };
    const out = publishTables(need, commune);
    for (const m of MEASURES) {
      const sums = [publishedSum(out.byNeed, m), publishedSum(out.byCommune, m)];
      for (const [i, t] of [out.byNeed, out.byCommune].entries()) {
        const secret = TRUE[m] - sums[i];
        expect(secret, m).toBeGreaterThan(0);
        for (const a of sums) { expect(a, `${m}: true total published`).not.toBe(TRUE[m]); expect(a - sums[i], `${m}: differencing gives the masked sum`).not.toBe(secret); }
        expect(masked(t, m), `${m}: never exactly one masked cell`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(out.byNeed.map((r) => r.sent)).toEqual([null, 8, 15, null]);
    expect(out.byCommune.map((r) => r.sent), 'D masked, then the smallest published cell (C)').toEqual([9, 9, null, null]);
    expect(out.byNeed.find((r) => r.need === 'HOUSING')).toEqual({ need: 'HOUSING', sent: 15, unmet: null, outOfScope: 6 });
  });

  it('an unmasked table beside a masked one was a true total: both tables carry masked cells, or neither', () => {
    // by need nothing is small (40 + 30 + 25 = 95); by commune one small cell (3) and its complement
    const need = [row('need', 'HEALTH', 40), row('need', 'HOUSING', 30), row('need', 'LEGAL', 25)];
    const commune = [row('commune', 'A', 50), row('commune', 'B', 42), row('commune', 'C', 3)];
    const out = publishTables(need, commune);
    expect(out.byCommune.map((r) => r.sent)).toEqual([50, null, null]);
    expect(out.byNeed.map((r) => r.sent), 'before: 95 published as the sum by need, 95 − 50 = the two masked communes').toEqual([40, null, null]);
    expect(publishedSum(out.byNeed, 'sent')).not.toBe(95);
    // nothing small anywhere: nothing is masked
    const clear = publishTables(need, [row('commune', 'A', 50), row('commune', 'B', 45)]);
    expect(clear.byNeed.map((r) => r.sent)).toEqual([40, 30, 25]); expect(clear.byCommune.map((r) => r.sent)).toEqual([50, 45]);
  });

  it('seeded random quarters: every published cell is the true count and at least 5; one masked cell never stands alone; a table is never unmasked beside a masked one', () => {
    let seed = 20261115; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 300; run += 1) {
      const nNeeds = 1 + rnd(5); const nCommunes = 1 + rnd(6);
      const cells = Array.from({ length: nNeeds }, () => Array.from({ length: nCommunes }, () => (rnd(3) === 0 ? 0 : rnd(14))));
      const need = cells.map((r, i) => row('need', `N${i}`, r.reduce((a, b) => a + b, 0))).filter((r) => r.sent > 0);   // a need without referral has no row
      const commune = Array.from({ length: nCommunes }, (_, j) => row('commune', `C${j}`, cells.reduce((a, r) => a + r[j], 0)));   // every shown commune, zeros included
      const out = publishTables(need, commune);
      for (const [raw, table] of [[need, out.byNeed], [commune, out.byCommune]]) {
        table.forEach((r, i) => { if (r.sent !== null) { expect(r.sent).toBe(raw[i].sent); expect(r.sent).toBeGreaterThanOrEqual(5); } });
        if (table.length > 1) expect(masked(table, 'sent'), JSON.stringify({ need, commune })).not.toBe(1);
      }
      if (need.length) expect(masked(out.byNeed, 'sent') > 0, JSON.stringify({ need, commune })).toBe(masked(out.byCommune, 'sent') > 0);
    }
  });

  it('the methodology says it; the export schema moved with its new column; the grid is still complete quarters', () => {
    expect(METHODOLOGY.totaux).toMatch(/Aucun total réel n’est publié/); expect(METHODOLOGY.totaux).toMatch(/deux plus petites valeurs/);
    expect(METHODOLOGY.besoinsNonCouverts).toBe('Orientations auxquelles la structure destinataire a répondu « pas de capacité ».');
    expect(METHODOLOGY.horsPerimetre).toMatch(/« hors de notre champ ».*ce n’est pas un besoin non couvert/);
    expect(METHODOLOGY.limites).toMatch(/inférieure à 5/); expect(METHODOLOGY.limites).toMatch(/au moins 3 structures vérifiées/);
    expect(SCHEMA_VERSION).toBe('ada.territory-stats.v2');
    expect(lastQuarters(new Date('2026-11-20T10:00:00Z')).map((q) => q.label)).toEqual(['2025-T4', '2026-T1', '2026-T2', '2026-T3']);
    expect(periodWindow('quarter', new Date('2026-01-05T00:00:00Z')).label).toBe('2025-T4');
    const code = src('api/_services/territorial-stats.js');
    expect(code, 'OUT_OF_SCOPE is never folded into the unmet needs').not.toMatch(/IN \('NO_CAPACITY', 'OUT_OF_SCOPE'\)/);
    expect(code, 'the CSV keeps its formula-injection guard').toContain("/^[=+\\-@\\t\\r]/.test(s) ? `'${s}` : s");
    expect(code).toContain('orientations_hors_perimetre');
  });
});

describe('P2 institution handler: the temporary-password gate is on the server', () => {
  let handler;
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
  const call = async (method, path, body) => { const r = mk(); await handler({ method, url: `/api/institution/${path}`, query: { period: 'quarter' }, body, headers: { authorization: 'Bearer t' }, socket: {} }, r); return r; };
  const account = (temporaryPassword) => ({ id: 'i1', email: 'p@example.test', organisation: 'QA Collectivité', territory: 'Bas-Rhin', temporaryPassword, authType: 'institution_jwt' });
  beforeEach(async () => { who.observatoire.mockClear(); who.territoryCsv.mockClear(); handler = (await import('../../api/_handlers/institution.js')).default; });

  it('a temporary password: `me`, the password change and the logout only; observatoire, export and anything else answer 403 PASSWORD_CHANGE_REQUIRED and read nothing', async () => {
    who.current = account(true);
    const me = await call('GET', 'me'); expect(me.statusCode).toBe(200); expect(me.body.temporaryPassword).toBe(true);
    for (const path of ['observatoire', 'export', 'anything-else']) {
      const r = await call('GET', path);
      expect(r.statusCode, path).toBe(403); expect(r.body.error, path).toBe('PASSWORD_CHANGE_REQUIRED'); expect(r.body.message).toMatch(/mot de passe/);
    }
    expect(who.observatoire).not.toHaveBeenCalled(); expect(who.territoryCsv).not.toHaveBeenCalled();
    expect((await call('POST', 'password', { currentPassword: 'a', newPassword: 'b' })).statusCode).toBe(200);
    expect((await call('POST', 'logout', {})).statusCode).toBe(200);
  });

  it('a personal password reads the statistics and the export; no session stays 401 (never 403: nothing says an account exists)', async () => {
    who.current = account(false);
    expect((await call('GET', 'observatoire')).statusCode).toBe(200); expect((await call('GET', 'export')).statusCode).toBe(200);
    expect(who.observatoire).toHaveBeenCalledTimes(1); expect(who.territoryCsv).toHaveBeenCalledTimes(1);
    expect((await call('GET', 'nope')).statusCode).toBe(404);
    who.current = null;
    for (const path of ['me', 'observatoire', 'export']) expect((await call('GET', path)).statusCode, path).toBe(401);
  });
});

describe('P4 and labels: what the professional observatoire measures, and how it is called', () => {
  const org = src('api/_services/org-stats.js'); const page = src('src/pages/pro/RegionalDashboard.jsx');
  const regional = org.slice(org.indexOf('export async function regionalStats'), org.indexOf('const PERIODS'));

  it('complete calendar quarters only: no month-to-date figure, no rolling days, no NOW() in a period', () => {
    expect(regional).not.toMatch(/date_trunc\('month'/); expect(regional).not.toMatch(/interval '6 days'|generate_series/); expect(regional).not.toMatch(/NOW\(\)/);
    expect(regional).toContain('lastQuarters(now)');
    expect(regional).toMatch(/appointmentsLastQuarter/); expect(regional).not.toMatch(/appointmentsThisMonth/);
  });

  it('« Citoyens aidés » is gone: the key, the French label and the five translations say « with an appointment »', () => {
    expect(regional).not.toMatch(/helped|Helped/); expect(regional).toMatch(/peopleWithAppointment/);
    expect(page).not.toMatch(/Citoyens aidés|totalCitizensHelped|kpi_citizens|RDV ce mois|7 derniers jours/);
    expect(page).toContain("t('pro:regional.kpi_people_with_appointment', 'Personnes avec un rendez-vous (trimestre)')");
    expect(page).toContain("t('pro:regional.kpi_quarter', 'RDV du dernier trimestre complet')");
    const claims = { en: /helped|supported/i, de: /unterstützt|geholfen/i, tr: /yardım/i, uk: /допомог/i, ar: /مساعد/ };
    for (const [lang, claim] of Object.entries(claims)) {
      const pro = JSON.parse(src(`src/i18n/locales/${lang}/pro.json`));
      expect(pro['regional.kpi_citizens'], lang).toBeUndefined(); expect(pro['regional.kpi_month'], lang).toBeUndefined(); expect(pro['regional.trend_title'], lang).toBeUndefined();
      for (const key of ['regional.kpi_people_with_appointment', 'regional.kpi_quarter', 'regional.trend_title_quarters']) expect(pro[key], `${lang} ${key}`).toBeTruthy();
      expect(pro['regional.kpi_people_with_appointment'], lang).not.toMatch(claim);
      const inst = JSON.parse(src(`src/i18n/locales/${lang}/institution.json`));
      for (const key of ['space.hors_perimetre', 'space.method.out_of_scope', 'space.method.unmet_capacity', 'space.method.totals', 'space.method.limits_v2']) expect(inst[key], `${lang} ${key}`).toBeTruthy();
      expect(inst['space.period_totals_v2'], lang).toContain('{{outOfScope}}');
      expect(inst['space.method.unmet'], `${lang}: the text that called an out-of-scope answer an unmet need`).toBeUndefined();
    }
  });

  it('OpenAPI: pro/interop-siao is a manual handover sheet, nothing is « transmis »', () => {
    const op = JSON.parse(src('docs/openapi.json')).paths['/pro/interop-siao'].post;
    const text = JSON.stringify(op);
    expect(text).not.toMatch(/Données SIAO transmises/);
    expect(op.responses['200'].description).toMatch(/non transmise/); expect(op.description).toMatch(/rien n'est envoyé/); expect(op.description).toContain('NOT_TRANSMITTED');
    expect(src('api/_handlers/pro/interop-siao.js')).toContain("transmissionStatus: 'NOT_TRANSMITTED'");   // what the handler really answers
  });
});
