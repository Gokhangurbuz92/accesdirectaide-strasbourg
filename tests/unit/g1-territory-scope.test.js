/**
 * Owner decision G1 = b, without a database — the authorised territory of an institutional account and what a scoped view may contain:
 *   S  territoryScope: an official label or code names ONE set of communes; anything missing, unknown or ambiguous names none (deny, never « everything »);
 *   L  communeOfAddress: an organization is in a commune only when its name and postal code agree (audit A16: three spellings, one commune);
 *   R  restrictToScope: a view is a restriction of block tables — commune rows of the territory, the table by need of the blocks entirely inside it;
 *   H  the handler: the scope comes from the account, a territory parameter is refused with one answer, no scope ⇒ 403 and nothing is read; reads and
 *      downloads are journaled (audit A18);
 *   and the audit findings fixed with it: A16 (commune key), A19 (« masked » is not « inactive »), A27 (the reserved service-area model).
 * The same rules on real PostgreSQL: tests/integration/g1-territory-scope-db.test.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const who = vi.hoisted(() => ({ current: null, observatoire: vi.fn(async () => ({ ok: true, window: { period: '2026-T3' }, byNeed: [] })), csv: vi.fn(async () => ({ ok: true, csv: 'x', period: '2026-T3', sha256: 'h' })),
  read: vi.fn(async () => undefined), download: vi.fn(async () => undefined) }));
vi.mock('../../api/_utils/institution-auth.js', () => ({ resolveInstitution: vi.fn(async () => who.current) }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_services/institutions.js', () => ({ institutionLogin: vi.fn(), changeInstitutionPassword: vi.fn(), institutionLogout: vi.fn(), requestInstitutionReset: vi.fn(), completeInstitutionReset: vi.fn(), INSTITUTION_RESET_MINUTES: 30,
  recordObservatoireRead: who.read, recordExportDownload: who.download }));
vi.mock('../../api/_services/feature-flags.js', () => ({ isFeatureOn: vi.fn(async () => true) }));
vi.mock('../../api/_utils/capabilities.js', async (orig) => ({ ...(await orig()), requireCapability: () => true }));
vi.mock('../../api/_services/territorial-stats.js', async (orig) => ({ ...(await orig()), scopedObservatoire: who.observatoire, scopedTerritoryCsv: who.csv,
  observatoire: async () => { throw new Error('unscoped'); }, territoryCsv: async () => { throw new Error('unscoped'); } }));

const { territoryScope, communeOfAddress, scopeLabel } = await import('../../api/lib/geography/territoryScope.js');
const { officialTerritory } = await import('../../api/lib/geography/officialTerritory.js');
const { restrictToScope, publishTables, scopedObservatoire, scopedTerritoryCsv } = await vi.importActual('../../api/_services/territorial-stats.js');
const src = (f) => fs.readFileSync(path.resolve(f), 'utf8');

describe('S territoryScope: the authorised territory of an account', () => {
  it('an official label names its communes: département, EPCI, commune, région', () => {
    expect(territoryScope('Bas-Rhin')).toMatchObject({ ok: true, kind: 'departement', code: '67' });
    const ems = territoryScope('Eurométropole de Strasbourg');
    expect(ems).toMatchObject({ ok: true, kind: 'epci', code: '246700488' }); expect(ems.communes.size).toBe(33); expect(ems.communes.has('67482')).toBe(true); expect(ems.communes.has('67180')).toBe(false);
    const city = territoryScope('Strasbourg (67482)');
    expect(city).toMatchObject({ ok: true, kind: 'commune', code: '67482' }); expect([...city.communes]).toEqual(['67482']);
    const region = territoryScope('Grand Est');
    expect(region).toMatchObject({ ok: true, kind: 'region', code: '44' }); expect(region.communes.has('67482')).toBe(true); expect(region.communes.has('75056')).toBe(false);
    // nested as the official reference says: commune ⊂ EPCI ⊂ département ⊂ région
    const dep = territoryScope('Bas-Rhin');
    for (const c of ems.communes) { expect(dep.communes.has(c)).toBe(true); expect(region.communes.has(c)).toBe(true); }
    expect(territoryScope('  bas rhin ')).toMatchObject({ ok: true, code: '67' });   // case, accents and hyphens do not matter, as in officialTerritory
  });

  it('a bare official code is read like officialTerritory reads it; a région that is also a département covers the same communes', () => {
    expect(territoryScope('67')).toMatchObject({ ok: true, kind: 'departement', code: '67' });
    expect(territoryScope('246700488')).toMatchObject({ ok: true, kind: 'epci' }); expect(territoryScope('67482')).toMatchObject({ ok: true, kind: 'commune' });
    expect(territoryScope('2A')).toMatchObject({ ok: true, kind: 'departement', code: '2A' });
    const reunion = territoryScope('La Réunion'); expect(reunion.ok).toBe(true); expect(reunion.communes.size).toBe(territoryScope('974').communes.size);
  });

  it('missing, unknown, free text, « everything » or ambiguous: NO scope — never every commune', () => {
    for (const [label, reason] of [['', 'MISSING'], ['   ', 'MISSING'], [null, 'MISSING'], [undefined, 'MISSING'], ['mon secteur', 'UNKNOWN'], ['France', 'UNKNOWN'], ['France entière', 'UNKNOWN'], ['*', 'UNKNOWN'],
      ['%', 'UNKNOWN'], ['all', 'UNKNOWN'], ['national', 'UNKNOWN'], ['99', 'UNKNOWN'], ['00000', 'UNKNOWN'], ['Strasbourg', 'UNKNOWN'], ['Strasbourg (67483)', 'UNKNOWN'], ['Haguenau (67482)', 'UNKNOWN'],
      ['Bas-Rhin, Haut-Rhin', 'UNKNOWN'], ['Bas-Rhin (67)', 'UNKNOWN'], ['Communauté de communes des Deux Vallées', 'AMBIGUOUS'], ["' OR 1=1 --", 'UNKNOWN'], [{}, 'UNKNOWN'], [['67'], 'UNKNOWN']]) {
      const s = territoryScope(label);
      expect(s, JSON.stringify(label)).toEqual({ ok: false, reason }); expect(s.communes).toBeUndefined();
    }
    // the reference cannot be read: no scope either
    expect(territoryScope('Bas-Rhin', { root: '/nonexistent-root-g1' })).toEqual({ ok: false, reason: 'UNAVAILABLE' });
  });

  it('every label officialTerritory can write reads back to that territory (scopeLabel adds the SIREN when two EPCI share a name)', () => {
    for (const input of ['Bas-Rhin', '67', 'Eurométropole de Strasbourg', '67482', 'Grand Est', 'Paris', '246000772', '249100157', '974', '971']) {
      const place = officialTerritory(input); expect(place.ok, input).toBe(true);
      const label = scopeLabel(place); expect(label, input).toBeTruthy();
      const scope = territoryScope(label); expect(scope.ok, `${input} → ${label}`).toBe(true);
      if (place.kind === 'epci' || place.kind === 'commune') expect(scope).toMatchObject({ kind: place.kind, code: place.code });
    }
    expect(scopeLabel(officialTerritory('246000772'))).toBe('Communauté de communes des Deux Vallées (246000772)');
    expect(scopeLabel({ label: 'Territoire inventé', kind: 'epci', code: '000000000' })).toBeNull();
  });
});

describe('L communeOfAddress: where an organization is (audit A16)', () => {
  it('three spellings of one commune are ONE commune, published under its official name', () => {
    const a = communeOfAddress({ ville: 'Strasbourg', code_postal: '67000' }); const b = communeOfAddress({ ville: 'STRASBOURG', code_postal: '67100' });
    const c = communeOfAddress({ ville: 'Strasbourg Cedex', code_postal: '67075' }); const d = communeOfAddress({ ville: ' strasbourg  CEDEX 2 ', code_postal: '67000' });
    for (const x of [a, b, c, d]) expect(x).toEqual({ code: '67482', nom: 'Strasbourg', block: 'epci:246700488' });
    expect(communeOfAddress({ ville: 'Saint Denis', code_postal: '93200' })).toMatchObject({ code: '93066', nom: 'Saint-Denis' });
    expect(communeOfAddress({ ville: 'Lyon 3e Arrondissement', code_postal: '69003' })).toMatchObject({ code: '69123' }); expect(communeOfAddress({ ville: 'Paris', code_postal: '75011' })).toMatchObject({ code: '75056' });
    expect(communeOfAddress({ ville: "L'Île-d'Yeu", code_postal: '85350' })).toMatchObject({ code: '85113', block: 'commune:85113' });   // no EPCI: its own block
  });

  it('a name and a postal code that do not agree, or a name several communes bear without a postal code: not located (never guessed)', () => {
    for (const address of [{ ville: 'Strasbourg', code_postal: '75001' }, { ville: 'Haguenau', code_postal: '68000' }, { ville: 'QA-Commune-1', code_postal: '67000' }, { ville: '', code_postal: '67000' },
      { ville: 'Strasbourg', code_postal: '6700' }, { ville: 'Saint-Denis' }, { ville: 'Saint-Denis', code_postal: null }, { code_postal: '67000' }, {}, null, undefined]) expect(communeOfAddress(address), JSON.stringify(address)).toBeNull();
    expect(communeOfAddress({ ville: 'Strasbourg' })).toMatchObject({ code: '67482' });   // one commune of France bears this name
  });
});

describe('R restrictToScope: a view is a restriction of the block tables', () => {
  // block X = communes a, b (one EPCI); block Y = commune c
  const X = { communes: ['a', 'b'], pub: publishTables([{ need: 'HOUSING', sent: 16, unmet: 2, outOfScope: 0 }, { need: 'HEALTH', sent: 7, unmet: 0, outOfScope: 0 }, { need: 'FOOD_AID', sent: 2, unmet: 0, outOfScope: 0 }],
    [{ commune: 'a', sent: 15, unmet: 2, outOfScope: 0 }, { commune: 'b', sent: 10, unmet: 0, outOfScope: 0 }]) };
  const Y = { communes: ['c'], pub: publishTables([{ need: 'HOUSING', sent: 3, unmet: 0, outOfScope: 0 }, { need: 'EMPLOYMENT', sent: 8, unmet: 0, outOfScope: 0 }, { need: 'HEALTH', sent: 6, unmet: 0, outOfScope: 0 }], [{ commune: 'c', sent: 17, unmet: 0, outOfScope: 0 }]) };
  const view = (codes) => restrictToScope([X, Y], (c) => codes.includes(c));
  const cell = (v, need) => v.byNeed.find((r) => r.need === need)?.sent ?? 0;

  it('a whole block: its two tables as published; a commune of the block: its row and NO table by need; nothing of a block outside', () => {
    const whole = view(['a', 'b']);
    expect(whole.byNeedCoverage).toBe('ALL'); expect(whole.byNeed).toEqual([...X.pub.byNeed].sort((p, q) => p.need.localeCompare(q.need))); expect(whole.byCommune).toEqual(X.pub.byCommune);
    const part = view(['a']);
    expect(part.byNeedCoverage).toBe('NONE'); expect(part.byNeed).toEqual([]); expect(part.byCommune).toEqual(X.pub.byCommune.filter((r) => r.commune === 'a'));
    expect(JSON.stringify(whole)).not.toMatch(/EMPLOYMENT|"c"/);
    expect(view(['z'])).toEqual({ byNeed: [], byCommune: [], byNeedCoverage: 'NONE' }); expect(view([])).toEqual({ byNeed: [], byCommune: [], byNeedCoverage: 'NONE' });
  });

  it('several blocks: published cells are added, a masked cell adds nothing — the larger view minus the smaller is never a masked count', () => {
    const both = view(['a', 'b', 'c']); const whole = view(['a', 'b']);
    expect(both.byNeedCoverage).toBe('ALL');
    expect(cell(whole, 'HOUSING')).toBe(16); expect(cell(both, 'HOUSING'), 'Y\'s 3 housing referrals are masked in Y: they add nothing').toBe(16);
    expect(cell(both, 'EMPLOYMENT')).toBe(8);
    for (const need of ['HOUSING', 'HEALTH', 'FOOD_AID', 'EMPLOYMENT']) { const d = cell(both, need) - cell(whole, need); expect(d === 0 || d >= 5, `${need}: ${d}`).toBe(true); }
    // a territory that holds one block and a part of another: the table by need covers the whole block only, and says so
    const mixed = view(['a', 'c']);
    expect(mixed.byNeedCoverage).toBe('PARTIAL'); expect(mixed.byNeed).toEqual([...Y.pub.byNeed].sort((p, q) => p.need.localeCompare(q.need)));
    expect(mixed.byCommune.map((r) => r.commune)).toEqual(['a', 'c']);
  });

  it('a change inside a masked cell of any block changes no view', () => {
    const Y2 = { communes: ['c'], pub: publishTables([{ need: 'HOUSING', sent: 4, unmet: 0, outOfScope: 0 }, { need: 'EMPLOYMENT', sent: 8, unmet: 0, outOfScope: 0 }, { need: 'HEALTH', sent: 6, unmet: 0, outOfScope: 0 }], [{ commune: 'c', sent: 18, unmet: 0, outOfScope: 0 }]) };
    for (const codes of [['a'], ['a', 'b'], ['c'], ['a', 'b', 'c'], ['a', 'c']]) expect(restrictToScope([X, Y2], (c) => codes.includes(c)), codes.join()).toEqual(view(codes));
  });

  it('without a scope produced by territoryScope the service refuses before reading anything', async () => {
    const db = new Proxy({}, { get() { throw new Error('the database must not be read without a scope'); } });
    for (const scope of [undefined, null, {}, { ok: false, reason: 'UNKNOWN' }, { ok: true }, { ok: true, communes: new Set() }, { ok: true, communes: ['67482'] }, territoryScope(''), territoryScope('mon secteur')]) {
      expect(await scopedObservatoire(scope, db)).toMatchObject({ ok: false, status: 403, code: 'TERRITORY_SCOPE_UNDEFINED' });
      expect(await scopedTerritoryCsv('quarter', scope, db)).toMatchObject({ ok: false, status: 403, code: 'TERRITORY_SCOPE_UNDEFINED' });
    }
  });
});

describe('H institution handler: the scope is the account\'s, on the server', () => {
  let handler;
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
  const call = async (p, query = {}) => { const r = mk(); await handler({ method: 'GET', url: `/api/institution/${p}`, query, headers: { authorization: 'Bearer t' }, socket: {} }, r); return r; };
  const account = (territory) => ({ id: 'i1', email: 'p@example.test', organisation: 'QA Collectivité', territory, temporaryPassword: false, authType: 'institution_jwt' });
  beforeEach(async () => { for (const f of [who.observatoire, who.csv, who.read, who.download]) f.mockClear(); handler = (await import('../../api/_handlers/institution.js')).default; });

  it('the statistics are read with the scope of the account row — and journaled (A18): account id, territory, period, file hash; nothing personal', async () => {
    who.current = account('Eurométropole de Strasbourg');
    expect((await call('observatoire')).statusCode).toBe(200); expect((await call('export', { period: 'quarter' })).statusCode).toBe(200);
    const scope = who.observatoire.mock.calls[0][0];
    expect(scope).toMatchObject({ ok: true, kind: 'epci', code: '246700488' }); expect(scope.communes.size).toBe(33);
    expect(who.csv.mock.calls[0]).toEqual(['quarter', scope]);
    expect(who.read).toHaveBeenCalledTimes(1); expect(who.read.mock.calls[0][1]).toEqual({ kind: 'epci', code: '246700488', period: '2026-T3' });
    expect(who.download).toHaveBeenCalledTimes(1); expect(who.download.mock.calls[0][1]).toEqual({ kind: 'epci', code: '246700488', period: '2026-T3', sha256: 'h' });
    expect((await call('me')).body.territoryScope).toEqual({ defined: true, kind: 'epci', code: '246700488' });
    const service = src('api/_services/institutions.js'); const fn = service.slice(service.indexOf('export async function recordObservatoireRead'), service.indexOf('/** R21 — « Se déconnecter »'));
    expect(fn).toContain('INSTITUTION_OBSERVATOIRE_READ'); expect(fn).toContain('INSTITUTION_EXPORT_DOWNLOADED'); expect(fn).toContain("date_trunc('day', NOW())");
    expect(fn).not.toMatch(/inst\.email|\bip\b|organisation/);
  });

  it('no defined territory: 403 TERRITORY_SCOPE_UNDEFINED, nothing read, nothing journaled; `me` says so', async () => {
    for (const territory of ['', 'mon secteur', 'France entière', '*', 'Communauté de communes des Deux Vallées', null, undefined]) {
      who.current = account(territory);
      for (const p of ['observatoire', 'export']) { const r = await call(p, { period: 'quarter' }); expect(r.statusCode, `${territory} ${p}`).toBe(403); expect(r.body.error).toBe('TERRITORY_SCOPE_UNDEFINED'); }
      expect((await call('me')).body.territoryScope).toEqual({ defined: false });
    }
    for (const f of [who.observatoire, who.csv, who.read, who.download]) expect(f).not.toHaveBeenCalled();
  });

  it('a territory named in the request is refused with one answer and nothing is read; the scope never comes from the request', async () => {
    who.current = account('Haut-Rhin');
    const bodies = new Set();
    for (const q of [{ territory: 'Bas-Rhin' }, { territory: 'Nulle-Part' }, { territoire: '67' }, { commune: '67482' }, { communes: '67482' }, { 'commune[]': '67482' }, { insee: '67482' }, { code_insee: '67482' }, { code: '67' }, { epci: '246700488' },
      { departement: '67' }, { department: '67' }, { region: '44' }, { scope: 'all' }, { all: '1' }, { national: '1' }, { Territory: 'Bas-Rhin' }, { ville: 'Strasbourg' }, { territories: 'x' }]) {
      for (const p of ['observatoire', 'export']) { const r = await call(p, q); expect(r.statusCode, JSON.stringify(q)).toBe(400); expect(r.body.error).toBe('SCOPE_PARAMETER_NOT_ACCEPTED'); bodies.add(JSON.stringify(r.body)); }
    }
    expect(bodies.size).toBe(1); expect(who.observatoire).not.toHaveBeenCalled(); expect(who.csv).not.toHaveBeenCalled();
    expect((await call('observatoire', { limit: '9999', page: '3', id: 'other-account' })).statusCode).toBe(200);
    expect(who.observatoire.mock.calls[0][0]).toMatchObject({ kind: 'departement', code: '68' }); expect(who.observatoire.mock.calls[0]).toHaveLength(1);
    // the handler has no other way to the statistics: it imports the scoped functions only, and reads no territory from the request
    const code = src('api/_handlers/institution.js');
    expect(code).toMatch(/import \{ scopedObservatoire, scopedTerritoryCsv \} from '\.\.\/_services\/territorial-stats\.js'/);
    expect(code).toContain('territoryScope(inst.territory)'); expect(code).not.toMatch(/territoryScope\(\s*req|req\.(query|body)\??\.(territory|territoire|commune|scope)/);
  });
});

describe('audit findings fixed with G1', () => {
  it('A16 + C8: every cross-organization table places an organization in its INSEE commune (name AND postal code), through ONE base — no table keys on the text as typed', () => {
    const org = src('api/_services/org-stats.js'); const terr = src('api/_services/territorial-stats.js');
    const regional = org.slice(org.indexOf('export async function regionalStats'), org.indexOf('const PERIODS'));
    expect(regional).toContain('base.locatedPopulation(db)'); expect(regional).toContain('base.blockAppointments(db, pop, q)'); expect(regional).not.toMatch(/s\.ville|GROUP BY o\.commune/);
    expect(terr).toContain('const at = communeOfAddress(r); if (!at) continue;');
    // the preview and the unscoped CSV are the restriction of the one base to every block — no second, name-keyed computation
    for (const fn of ['export async function observatoire', 'export async function territoryCsv']) expect(terr.slice(terr.indexOf(fn), terr.indexOf(fn) + 600), fn).toMatch(/observatoireOf\(db, everywhere|csvOf\(db, everywhere/);
    for (const code of [org, terr]) { expect(code).not.toContain('communeOrgCte'); expect(code).not.toMatch(/trim\(s\.ville\)/); }
  });

  it('A19: a masked commune is « masked », never « inactive »; the interface and the six languages say « masked value (< 5) »', () => {
    const org = src('api/_services/org-stats.js'); const page = src('src/pages/pro/RegionalDashboard.jsx');
    expect(org).toContain("status: c.rdv === null ? 'masked' : 'published'"); expect(org).not.toMatch(/'optimal'|'inactive'/);
    expect(page).toContain("t('pro:regional.masked', 'valeur masquée (< 5)')"); expect(page).toContain("city.status === 'masked'"); expect(page).not.toMatch(/optimal|regional\.inactive|'inactif'/);
    for (const lang of ['en', 'tr', 'ar', 'de', 'uk']) {
      const pro = JSON.parse(src(`src/i18n/locales/${lang}/pro.json`));
      expect(pro['regional.masked'], lang).toMatch(/< 5/); expect(pro['regional.published'], lang).toBeTruthy(); expect(pro['regional.inactive'], lang).toBeUndefined(); expect(pro['regional.active'], lang).toBeUndefined();
    }
  });

  it('A27: "StructureServiceArea" is reserved — documented where it is read, and nothing writes it (the live service area is Structure.insee_codes)', () => {
    const search = src('api/lib/search-query.js');
    expect(search).toMatch(/Audit A27 — RESERVED, not live/); expect(search).toContain('= ANY(coalesce("Structure"."insee_codes"');
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? files(path.join(dir, e.name)) : /\.(m?js|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const writers = [...files('api'), ...files('scripts')].filter((f) => /INSERT INTO "StructureServiceArea"|UPDATE "StructureServiceArea"|insert\(StructureServiceArea\)|update\(StructureServiceArea\)/.test(fs.readFileSync(f, 'utf8')));
    expect(writers, 'a writer appeared: decide which service-area model is the truth, then update the search and this test').toEqual([]);
  });
});
