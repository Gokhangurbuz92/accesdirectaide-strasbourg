/**
 * Owner decision G1 = b — REAL PostgreSQL, synthetic data only. An institutional account reads the communes of its AUTHORISED TERRITORY and nothing else; the
 * limit is the server's (the handler and the queries), the territory comes from the account row, and a missing or unclear territory reads nothing.
 *
 *   A  (service, injected clock, exact counts) what each territory obtains — a commune, its EPCI, the département, the région — and what it never obtains;
 *      the trend by quarter; the differencing attacks between nested territories; a change inside a masked cell changes NOTHING any account can read;
 *   B  (handler, real tokens) cross-territory denial, missing / unclear territory ⇒ 403 and no data, parameter tampering, the CSV export, and no route to the
 *      unscoped aggregates for an institutional session.
 *
 * Real communes are needed (the scope is the INSEE reference): the fixture uses Haguenau, Brumath, Bischwiller (one EPCI), Saverne (another EPCI of the
 * Bas-Rhin) and Colmar (Haut-Rhin), which no other suite uses. Part A is dated 2016 (`now` = 2017-02-15): no other suite writes there.
 * Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const NOW = new Date('2017-02-15T10:00:00Z'); const T4 = new Date('2016-11-10T09:00:00Z'); const T3 = new Date('2016-08-10T09:00:00Z');
// commune key → [ville as declared, postal code]
const PLACES = { H: ['Haguenau', '67500'], B: ['BRUMATH', '67170'], W: ['Bischwiller', '67240'], S: ['Saverne', '67700'], C: ['Colmar', '68000'] };
const NAMES = { H: 'Haguenau', B: 'Brumath', W: 'Bischwiller', S: 'Saverne', C: 'Colmar' };
const org = (k, i) => `g1-${k}${i}-${TS}`;
const DOSSIER = `g1-dos-${TS}`; const FROM = `g1-from-${TS}`; const SVC = `g1-svc-${TS}`;
// [commune, need, response, how many, when] — the TRUE counts (never published as such)
const FIXTURE = [
  ['H', 'HOUSING', null, 7, T4], ['H', 'HOUSING', 'NO_CAPACITY', 2, T4], ['H', 'HEALTH', null, 6, T4],   // Haguenau 15
  ['B', 'HOUSING', null, 7, T4], ['B', 'FOOD_AID', null, 2, T4],                                             // Brumath 9 (FOOD_AID: a small cell)
  ['W', 'HEALTH', null, 1, T4],                                                                              // Bischwiller 1 (a small commune cell)
  ['S', 'EMPLOYMENT', null, 8, T4], ['S', 'HEALTH', null, 6, T4], ['S', 'HOUSING', null, 3, T4],          // Saverne 17 (HOUSING 3: small)
  ['C', 'HOUSING', null, 2, T4],                                                                             // Colmar 2: the small cell OUTSIDE the Bas-Rhin
  ['H', 'HOUSING', null, 6, T3], ['C', 'HOUSING', null, 8, T3],                                              // the quarter before: the trend
];
const MEASURES = ['sent', 'unmet', 'outOfScope'];

describe.skipIf(!hasDatabase)('G1: an institution reads its authorised territory only (real DB)', () => {
  let db, stats, scopeOf, handler, sign; let seq = 0; const turn = {};   // C8 collusion rule: each commune's referrals are spread over its FOUR organizations in turn
  const referral = (k, need, response, when) => db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "responseCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
    VALUES (${`g1-ref-${(seq += 1)}-${TS}`}, ${DOSSIER}, ${FROM}, ${org(k, (turn[k] = (turn[k] ?? -1) + 1) % 4)}, 'COMPLETED', ${need}, ${response}, ${when}, 'g1-grant', ${when}, ${when}, NOW())`);
  const scope = (label) => scopeOf(label);
  const view = (label) => stats.scopedObservatoire(scope(label), db, NOW);
  const csvOf = (label) => stats.scopedTerritoryCsv('quarter', scope(label), db, NOW);
  const mine = (rows) => rows.filter((r) => Object.values(NAMES).includes(r.commune));   // the fixture's communes (a shared database may hold other located organizations)
  const need = (v, n) => v.byNeed.find((r) => r.need === n);
  const TERRITORIES = { commune: 'Haguenau (67180)', epci: 'Communauté d\'agglomération de Haguenau', departement: 'Bas-Rhin', region: 'Grand Est', other: 'Haut-Rhin' };

  const accounts = {};   // key → { id, token }
  const account = async (key, territory, { temporary = false } = {}) => {
    const id = `g1-ia-${key}-${TS}`; const email = `g1-${key}-${TS}@example.test`; const passwordHash = `${temporary ? 'temporary:' : ''}synthetic-not-a-hash-${key}`;
    await db.execute(sql`INSERT INTO "InstitutionAccount" (id, email, "passwordHash", "organisationName", territory, status, "agreementId", "createdBy") VALUES (${id}, ${email}, ${passwordHash}, 'Institution synthétique G1', ${territory}, 'ACTIVE', ${`g1-ag-${TS}`}, 'g1-admin@example.test')`);
    accounts[key] = { id, token: sign({ id, email, passwordHash }) };
  };
  const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; } });
  const call = async (key, path, query = {}) => {
    const r = mk(); const qs = new URLSearchParams(query).toString();
    await handler({ method: 'GET', url: `/api/institution/${path}${qs ? `?${qs}` : ''}`, query, headers: { authorization: `Bearer ${accounts[key].token}` }, socket: {} }, r);
    return r;
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    stats = await import('../../api/_services/territorial-stats.js');
    scopeOf = (await import('../../api/lib/geography/territoryScope.js')).territoryScope;
    handler = (await import('../../api/_handlers/institution.js')).default;
    sign = (await import('../../api/_utils/institution-auth.js')).signInstitutionToken;
    const structure = (id, ville, cp, verification) => db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${id}, ${id}, ${id}, 'association', '1 rue', ${ville}, ${cp}, false, '{}', '{}', '{}', 'actif', ${verification}, NOW(), NOW())`);
    for (const k of Object.keys(PLACES)) for (let i = 0; i < 4; i += 1) await structure(org(k, i), PLACES[k][0], PLACES[k][1], 'VERIFIED');
    // not located: a name and a postal code that do not agree, and a place that is no commune — verified, with referrals, counted NOWHERE in a scoped view
    await structure(`g1-x0-${TS}`, 'Haguenau', '68000', 'VERIFIED'); await structure(`g1-x1-${TS}`, `G1 Lieu-dit ${TS}`, '67500', 'VERIFIED');
    await structure(FROM, 'Strasbourg', '67000', 'PENDING');   // the sender: not verified
    await db.execute(sql`INSERT INTO "SharedDiagnostic" (id, "expiresAt", situation, results, "viewCount") VALUES (${DOSSIER}, NOW() + interval '7 days', '{}'::jsonb, '{}'::jsonb, 0)`);
    for (const [k, n, response, count, when] of FIXTURE) for (let i = 0; i < count; i += 1) await referral(k, n, response, when);
    for (let i = 0; i < 9; i += 1) await db.execute(sql`INSERT INTO "Referral" (id, "sharedDiagnosticId", "fromStructureId", "toStructureId", status, "reasonCode", "citizenDecisionAt", "grantId", "sentAt", "createdAt", "updatedAt")
      VALUES (${`g1-refx-${i}-${TS}`}, ${DOSSIER}, ${FROM}, ${`g1-x0-${TS}`}, 'COMPLETED', 'HOUSING', ${T4}, 'g1-grant', ${T4}, ${T4}, NOW())`);
    // part B (the handler reads the real clock): referrals in the last complete quarter
    const live = new Date(stats.periodWindow('quarter').start.getTime() + 9 * 86400000);
    for (const [k, count] of [['H', 12], ['C', 11]]) for (let i = 0; i < count; i += 1) await referral(k, 'HOUSING', null, live);
    await db.execute(sql`INSERT INTO "PartnerAgreement" (id, "partnerName", kind, status, "recordedBy", "signedAt", "documentRef", "signedByPartner") VALUES (${`g1-ag-${TS}`}, 'Partenaire synthétique G1', 'CONVENTION', 'SIGNED', 'g1-admin@example.test', CURRENT_DATE - 1, 'SYNTHETIC-TEST-ONLY-G1', 'Signataire synthétique')`);
    await account('epci', TERRITORIES.epci); await account('commune', TERRITORIES.commune); await account('dep', TERRITORIES.departement); await account('other', TERRITORIES.other);
    await account('code', '68');   // a bare official code is a defined territory
    await account('empty', ''); await account('legacy', 'mon secteur'); await account('everything', 'France entière'); await account('star', '*');
    await account('ambiguous', 'Communauté de communes des Deux Vallées');   // two EPCI bear this name
    await account('wrongcode', 'Haguenau (67482)');   // a name and a code that do not agree
    await account('temporary', TERRITORIES.epci, { temporary: true });
  }, 120000);

  afterAll(async () => {
    if (!db) return;
    delete process.env.OPEN_DATA_EXPORT_ENABLED;
    await db.execute(sql`DELETE FROM "Referral" WHERE "sharedDiagnosticId" = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "SharedDiagnostic" WHERE id = ${DOSSIER}`);
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "serviceId" = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'InstitutionAccount' AND entity_id LIKE ${`g1-ia-%-${TS}`}`);
    await db.execute(sql`DELETE FROM "InstitutionAccount" WHERE id LIKE ${`g1-ia-%-${TS}`}`);
    await db.execute(sql`DELETE FROM "PartnerAgreement" WHERE id = ${`g1-ag-${TS}`}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${`g1-%-${TS}`}`);
  });

  // ───────────────────────────── A. the service, exact counts
  it('A1 an EPCI reads its own communes and its own table by need; nothing of the rest of the département, of another département, or of a place that is not located', async () => {
    const v = await view(TERRITORIES.epci);
    expect(v.ok).toBe(true); expect(v.window.period).toBe('2016-T4'); expect(v.scope).toMatchObject({ kind: 'epci', code: '200067874', byNeed: 'ALL', totalsBasis: 'byNeed' });
    expect(v.byCommune.map((r) => r.commune)).toEqual(['Bischwiller', 'Brumath', 'Haguenau']);   // the official names, whatever the case typed in the address
    // block totals: HOUSING 16, HEALTH 7, FOOD_AID 2 → FOOD_AID masked (< 5), then HEALTH (never exactly one masked cell)
    expect(v.byNeed).toEqual([{ need: 'FOOD_AID', sent: null, unmet: null, outOfScope: null }, { need: 'HEALTH', sent: null, unmet: null, outOfScope: null }, { need: 'HOUSING', sent: 16, unmet: null, outOfScope: null }]);
    // communes: 15, 9, 1 → Bischwiller masked, then Brumath
    expect(Object.fromEntries(v.byCommune.map((r) => [r.commune, r.sent]))).toEqual({ Bischwiller: null, Brumath: null, Haguenau: 15 });
    expect(v.totals.sent).toBe(16); // 2016-T3: Haguenau's 6 housing referrals are the whole block — its table by need would be a true total beside two masked communes, so it is masked
    expect(v.trend.map((t) => [t.quarter, t.sent])).toEqual([['2016-T1', null], ['2016-T2', null], ['2016-T3', null], ['2016-T4', 16]]);
    const text = JSON.stringify(v);
    for (const outside of ['Saverne', 'Colmar', 'Strasbourg', 'EMPLOYMENT', 'g1-', 'Lieu-dit']) expect(text, outside).not.toContain(outside);
    // the 9 referrals of the organization whose address names no commune (« Haguenau », 68000) are in no cell: Haguenau stays 15, HOUSING 16
    expect(v.methodology.territoire).toMatch(/territoire autorisé/);
  });

  it('A2 a commune inside an EPCI reads its own row only and NO table by need (it would be subtracted from the EPCI\'s)', async () => {
    const v = await view(TERRITORIES.commune);
    expect(v.scope).toMatchObject({ kind: 'commune', code: '67180', byNeed: 'NONE', totalsBasis: 'byCommune' });
    expect(v.byNeed).toEqual([]); expect(v.byCommune).toEqual([{ commune: 'Haguenau', sent: 15, unmet: null, outOfScope: null }]);
    expect(v.totals.sent).toBe(15); expect(v.trend[2]).toMatchObject({ quarter: '2016-T3', sent: 6 });
    expect(JSON.stringify(v)).not.toMatch(/Brumath|Bischwiller|Saverne|Colmar/);
  });

  it('A3 the département and the région add up PUBLISHED block cells only; another département reads none of it', async () => {
    const dep = await view(TERRITORIES.departement); const region = await view(TERRITORIES.region); const other = await view(TERRITORIES.other);
    expect(mine(dep.byCommune).map((r) => r.commune)).toEqual(['Bischwiller', 'Brumath', 'Haguenau', 'Saverne']);
    expect(mine(region.byCommune).map((r) => r.commune)).toEqual(['Bischwiller', 'Brumath', 'Colmar', 'Haguenau', 'Saverne']);
    // Saverne's block: EMPLOYMENT 8, HEALTH 6 (masked with HOUSING 3); its commune row is masked (the table by need has masked cells)
    expect(need(dep, 'HOUSING').sent).toBe(16); expect(need(dep, 'EMPLOYMENT').sent).toBe(8); expect(need(dep, 'HEALTH').sent).toBeNull(); expect(need(dep, 'FOOD_AID').sent).toBeNull();
    expect(dep.byCommune.find((r) => r.commune === 'Saverne').sent).toBeNull();
    // Colmar's 2 housing referrals are masked in their own block: the région's HOUSING is still 16
    expect(need(region, 'HOUSING').sent).toBe(16); expect(region.byCommune.find((r) => r.commune === 'Colmar').sent).toBeNull();
    // the Haut-Rhin: Colmar only, never a commune or a count of the Bas-Rhin
    expect(mine(other.byCommune).map((r) => r.commune)).toEqual(['Colmar']);
    expect(JSON.stringify(other)).not.toMatch(/Haguenau|Brumath|Bischwiller|Saverne|EMPLOYMENT/);
    expect(other.trend[2]).toMatchObject({ quarter: '2016-T3', sent: 8 });   // its own trend: Colmar's 8, not Haguenau's 6
    expect((await view('68')).byCommune).toEqual(other.byCommune);   // the bare official code names the same territory
  });

  it('A4 differencing: no subtraction between nested territories gives a count below 5 — neither the rest of the département nor the outside small cell', async () => {
    const views = { commune: await view(TERRITORIES.commune), epci: await view(TERRITORIES.epci), dep: await view(TERRITORIES.departement), region: await view(TERRITORIES.region) };
    // the secrets: HOUSING in the Bas-Rhin outside the EPCI = 3 (Saverne); HOUSING in the région outside the Bas-Rhin = 2 (Colmar); FOOD_AID = 2; Bischwiller = 1
    const cell = (v, n, m) => (need(v, n) ? need(v, n)[m] ?? 0 : 0);
    expect(cell(views.dep, 'HOUSING', 'sent') - cell(views.epci, 'HOUSING', 'sent'), 'département − EPCI is not Saverne\'s masked 3').toBe(0);
    expect(cell(views.region, 'HOUSING', 'sent') - cell(views.dep, 'HOUSING', 'sent'), 'région − département is not Colmar\'s masked 2').toBe(0);
    const order = ['commune', 'epci', 'dep', 'region'];
    for (let a = 0; a < order.length; a += 1) for (let b = a + 1; b < order.length; b += 1) {
      const small = views[order[a]]; const large = views[order[b]];
      for (const m of MEASURES) {
        for (const n of new Set([...small.byNeed, ...large.byNeed].map((r) => r.need))) {
          const d = cell(large, n, m) - cell(small, n, m);
          expect(d === 0 || d >= 5, `${order[b]} − ${order[a]}, ${n}.${m} = ${d}`).toBe(true);
        }
        // the same commune has the same cell in every view that shows it (nothing to learn from two accounts)
        for (const r of mine(small.byCommune)) expect(large.byCommune.find((x) => x.commune === r.commune)[m], `${r.commune}.${m}`).toBe(r[m]);
      }
    }
    // totals and trend carry nothing more than the tables: each is the sum of the PUBLISHED cells of the view's own table (never a true total to subtract from)
    const sum = (rows, m) => { const t = rows.reduce((x, r) => x + (r[m] ?? 0), 0); return t >= 5 ? t : null; };
    for (const [name, v] of Object.entries(views)) for (const m of MEASURES) {
      expect(v.totals[m], `${name} totals.${m}`).toBe(sum(v[v.scope.totalsBasis], m));
      expect(v.trend[v.trend.length - 1][m], `${name} trend.${m}`).toBe(v.totals[m]);
    }
    // the true totals of the quarter (Bas-Rhin 42 sent, EPCI 25, région 44) are published nowhere
    for (const v of Object.values(views)) for (const t of [25, 42, 44]) expect([v.totals.sent, v.trend[3].sent, sum(v.byNeed, 'sent'), sum(mine(v.byCommune), 'sent')]).not.toContain(t);
    // every published number is at least 5
    for (const v of Object.values(views)) for (const r of [...v.byNeed, ...v.byCommune, ...v.trend, v.totals]) for (const m of MEASURES) expect(r[m] === null || r[m] >= 5).toBe(true);
  });

  it('A5 a change inside a masked cell — inside the territory, in the rest of the département or outside it — changes nothing any account reads (JSON and CSV)', async () => {
    const labels = Object.values(TERRITORIES);
    const snapshot = async () => { const out = []; for (const l of labels) { out.push(JSON.stringify(await view(l))); const c = await csvOf(l); expect(c.ok).toBe(true); out.push(c.csv, c.sha256); } return out; };
    const before = await snapshot();
    for (const [k, n] of [['C', 'HOUSING'], ['S', 'HOUSING'], ['W', 'HEALTH'], ['B', 'FOOD_AID']]) await referral(k, n, null, T4);   // 2→3, 3→4, 1→2, 2→3: still masked
    expect(await snapshot()).toEqual(before);
    await db.execute(sql`DELETE FROM "Referral" WHERE id IN (${`g1-ref-${seq}-${TS}`}, ${`g1-ref-${seq - 1}-${TS}`}, ${`g1-ref-${seq - 2}-${TS}`}, ${`g1-ref-${seq - 3}-${TS}`})`);
  });

  it('A6 the CSV of a territory: its communes only, the observatoire\'s own cells, appointments masked the same way; no scope = no file', async () => {
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${org('H', 0)}, 'S', 30, NOW())`);
    const appointment = (k, i) => db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "beneficiaryName", "startAt", "endAt", status, "updatedAt")
      VALUES (${`g1-apt-${k}-${i}-${TS}`}, ${org(k, i % 4)}, ${SVC}, 'Personne synthétique', ${T4}, ${new Date(T4.getTime() + 1800000)}, 'done', NOW())`);
    for (let i = 0; i < 6; i += 1) await appointment('H', i);
    for (let i = 0; i < 7; i += 1) await appointment('B', i);
    for (let i = 0; i < 3; i += 1) await appointment('W', i);   // masked; then the smallest published of the block (Haguenau's 6)
    for (let i = 0; i < 9; i += 1) await appointment('C', i);
    const rows = (csv) => csv.replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(','));
    const epci = rows((await csvOf(TERRITORIES.epci)).csv);
    expect(epci[0].join(',')).toBe('schema,licence,periode,commune,organisations_verifiees,rendez_vous,orientations_recues,orientations_refusees_capacite,orientations_hors_perimetre');
    expect(epci.slice(1)).toEqual([
      ['ada.territory-stats.v3', 'PENDING_OWNER_DECISION', '2016-T4', 'Bischwiller', '4', '', '', '', ''],
      ['ada.territory-stats.v3', 'PENDING_OWNER_DECISION', '2016-T4', 'Brumath', '4', '7', '', '', ''],
      ['ada.territory-stats.v3', 'PENDING_OWNER_DECISION', '2016-T4', 'Haguenau', '4', '', '15', '', ''],
      ['ada.territory-stats.v3', 'PENDING_OWNER_DECISION', '2016-T4', 'TOTAL (cellules publiées)', '12', '7', '15', '', ''],
    ]);
    const commune = rows((await csvOf(TERRITORIES.commune)).csv);
    expect(commune.slice(1).map((r) => r[3])).toEqual(['Haguenau', 'TOTAL (cellules publiées)']); expect(commune[1]).toEqual(epci[3]);   // the same cells as in the EPCI's file
    const other = (await csvOf(TERRITORIES.other)).csv;
    expect(other).toMatch(/Colmar,4,9,,,/); expect(other).not.toMatch(/Haguenau|Brumath|Bischwiller|Saverne/);
    expect(await stats.scopedTerritoryCsv('month', scope(TERRITORIES.epci), db, NOW)).toMatchObject({ ok: false, code: 'PERIOD_NOT_OFFERED' });
    for (const bad of ['', 'mon secteur', 'France entière', '*', 'Communauté de communes des Deux Vallées', null, undefined]) {
      expect(await stats.scopedTerritoryCsv('quarter', scope(bad), db, NOW), String(bad)).toMatchObject({ ok: false, status: 403, code: 'TERRITORY_SCOPE_UNDEFINED' });
      expect(await stats.scopedObservatoire(scope(bad), db, NOW), String(bad)).toMatchObject({ ok: false, status: 403, code: 'TERRITORY_SCOPE_UNDEFINED' });
    }
    // a scope object that was not produced by territoryScope (no commune set) is refused too
    for (const forged of [{ ok: true }, { ok: true, communes: new Set() }, { ok: true, communes: ['67180'] }, {}, null]) expect((await stats.scopedObservatoire(forged, db, NOW)).ok, JSON.stringify(forged)).toBe(false);
  });

  // ───────────────────────────── B. the handler, real institutional sessions
  it('B1 cross-territory denial: each session reads its own territory, whatever it asks for', async () => {
    const epci = await call('epci', 'observatoire'); const other = await call('other', 'observatoire'); const commune = await call('commune', 'observatoire');
    expect(epci.statusCode).toBe(200); expect(other.statusCode).toBe(200); expect(commune.statusCode).toBe(200);
    expect(epci.body.byCommune.map((r) => r.commune)).toEqual(['Bischwiller', 'Brumath', 'Haguenau']);
    expect(epci.body.byCommune.find((r) => r.commune === 'Haguenau').sent).toBe(12); expect(epci.body.scope).toMatchObject({ kind: 'epci', code: '200067874' });
    expect(JSON.stringify(epci.body)).not.toMatch(/Colmar|Saverne/);
    expect(mine(other.body.byCommune).map((r) => r.commune)).toEqual(['Colmar']); expect(JSON.stringify(other.body)).not.toMatch(/Haguenau|Brumath|Bischwiller/);
    expect(commune.body.byCommune.map((r) => r.commune)).toEqual(['Haguenau']); expect(commune.body.byNeed).toEqual([]);
    expect((await call('code', 'observatoire')).body.byCommune).toEqual(other.body.byCommune);
    const me = await call('epci', 'me');
    expect(me.body).toMatchObject({ territory: TERRITORIES.epci, territoryScope: { defined: true, kind: 'epci', code: '200067874' } });
  });

  it('B2 a missing or unclear territory reads NOTHING: 403 TERRITORY_SCOPE_UNDEFINED on the observatoire and the export, never « every commune »', async () => {
    process.env.OPEN_DATA_EXPORT_ENABLED = 'true';
    for (const key of ['empty', 'legacy', 'everything', 'star', 'ambiguous', 'wrongcode']) {
      for (const path of ['observatoire', 'export']) {
        const r = await call(key, path, path === 'export' ? { period: 'quarter' } : {});
        expect(r.statusCode, `${key} ${path}`).toBe(403); expect(r.body.error).toBe('TERRITORY_SCOPE_UNDEFINED');
        expect(JSON.stringify(r.body)).not.toMatch(/Haguenau|Colmar|byCommune|byNeed|schema/);
      }
      const me = await call(key, 'me'); expect(me.statusCode).toBe(200); expect(me.body.territoryScope).toEqual({ defined: false });
    }
    // the temporary-password gate still comes first
    expect((await call('temporary', 'observatoire')).body.error).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('B3 parameter tampering: a territory sent with the request is refused with ONE answer (a real place, another account\'s territory or nothing that exists); other parameters do not widen the scope', async () => {
    const own = JSON.stringify((await call('other', 'observatoire')).body);
    const answers = new Set();
    for (const q of [{ territory: 'Bas-Rhin' }, { territory: 'Atlantide' }, { territoire: TERRITORIES.epci }, { commune: '67180' }, { commune: 'Haguenau' }, { communes: '67180,67067' }, { insee: '67180' }, { code: '67' },
      { epci: '200067874' }, { departement: '67' }, { region: '44' }, { scope: 'all' }, { scope: 'national' }, { all: '1' }, { national: 'true' }, { TERRITORY: 'Bas-Rhin' }, { 'commune[]': '67180' }, { ville: 'Haguenau' }]) {
      for (const path of ['observatoire', 'export']) {
        const r = await call('other', path, path === 'export' ? { period: 'quarter', ...q } : q);
        expect(r.statusCode, JSON.stringify(q)).toBe(400); expect(r.body.error).toBe('SCOPE_PARAMETER_NOT_ACCEPTED');
        answers.add(JSON.stringify(r.body));
      }
    }
    expect(answers.size, 'the refusal never depends on what was named').toBe(1);
    // parameters that name no territory are refused too (FA-D9: they used to be ignored) — one answer, and the account's own view is unchanged
    const other = new Set();
    for (const q of [{ id: accounts.epci.id }, { account: accounts.epci.id }, { organisation: 'x' }, { limit: '100000' }, { page: '2' }, { offset: '0' }, { quarter: '2016-T4' }, { from: '2000-01-01' }]) {
      const r = await call('other', 'observatoire', q); expect(r.statusCode, JSON.stringify(q)).toBe(400); expect(r.body.error).toBe('QUERY_PARAMETER_NOT_ACCEPTED'); other.add(JSON.stringify(r.body));
    }
    expect(other.size).toBe(1); expect(JSON.stringify((await call('other', 'observatoire')).body)).toBe(own);
    // an institutional token names its account: a token of one account with another account's id in the request stays the first account
    const forged = mk();
    await handler({ method: 'GET', url: '/api/institution/observatoire', query: {}, headers: { authorization: `Bearer ${accounts.other.token}`, 'x-institution-id': accounts.epci.id, 'x-territory': 'Bas-Rhin' }, body: { territory: 'Bas-Rhin' }, socket: {} }, forged);
    expect(JSON.stringify(forged.body)).toBe(own);
  });

  it('B4 the CSV export is scoped the same way, and matches the observatoire of the same session', async () => {
    process.env.OPEN_DATA_EXPORT_ENABLED = 'true';
    const rows = (r) => String(r.body).replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(','));
    const epci = await call('epci', 'export', { period: 'quarter' }); const other = await call('other', 'export', { period: 'quarter' });
    expect(epci.statusCode).toBe(200); expect(epci.headers['content-type']).toMatch(/text\/csv/);
    expect(rows(epci).slice(1).map((r) => r[3])).toEqual(['Bischwiller', 'Brumath', 'Haguenau', 'TOTAL (cellules publiées)']);
    expect(rows(epci)[3].slice(4)).toEqual(['4', '', '12', '', '']);
    expect(String(other.body)).toMatch(/Colmar/); expect(String(other.body)).not.toMatch(/Haguenau|Brumath|Bischwiller/);
    const obs = (await call('epci', 'observatoire')).body;
    for (const r of obs.byCommune) expect(rows(epci).find((l) => l[3] === r.commune)[6]).toBe(r.sent === null ? '' : String(r.sent));
    expect((await call('epci', 'export', { period: 'year' })).statusCode).toBe(400);
    delete process.env.OPEN_DATA_EXPORT_ENABLED;
    expect((await call('epci', 'export', { period: 'quarter' })).body.error).toBe('EXPORT_NOT_OPEN');
  });

  it('B5 an institutional session reaches no unscoped aggregate: the administrators\' preview and the professional observatoire refuse it', async () => {
    const req = (url) => ({ method: 'GET', url, query: { view: 'observatoire' }, headers: { authorization: `Bearer ${accounts.dep.token}` }, cookies: {}, socket: {} });
    const admin = mk(); await (await import('../../api/_handlers/admin/institutions.js')).default(req('/api/admin/institutions?view=observatoire'), admin);
    expect([401, 403]).toContain(admin.statusCode); expect(JSON.stringify(admin.body)).not.toMatch(/byCommune|byNeed/);
    const pro = mk(); await (await import('../../api/_handlers/pro/regional-stats.js')).default(req('/api/pro/regional-stats'), pro);
    expect([401, 403]).toContain(pro.statusCode); expect(JSON.stringify(pro.body)).not.toMatch(/cities|trend/);
  });

  it('B7 audit A18: an observatoire read leaves ONE row per account and day, every download one row with the file hash; refusals leave none; nothing personal', async () => {
    process.env.OPEN_DATA_EXPORT_ENABLED = 'true';
    const rows = async (key, action) => (await db.execute(sql`SELECT actor, actor_id, entity_id, ip, ip_hash, details FROM "AuditLog" WHERE action = ${action} AND entity = 'InstitutionAccount' AND entity_id = ${accounts[key].id} ORDER BY "timestamp"`)).rows;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'InstitutionAccount' AND entity_id LIKE ${`g1-ia-%-${TS}`}`);
    for (let i = 0; i < 3; i += 1) expect((await call('epci', 'observatoire')).statusCode).toBe(200);
    const read = await rows('epci', 'INSTITUTION_OBSERVATOIRE_READ');
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ actor: 'institution', actor_id: accounts.epci.id, ip: null, ip_hash: null, details: { territoryKind: 'epci', territoryCode: '200067874', period: stats.periodWindow('quarter').label } });
    const e1 = await call('epci', 'export', { period: 'quarter' }); await call('epci', 'export', { period: 'quarter' });
    const down = await rows('epci', 'INSTITUTION_EXPORT_DOWNLOADED');
    expect(down).toHaveLength(2); expect(down[0].details).toEqual({ territoryKind: 'epci', territoryCode: '200067874', period: stats.periodWindow('quarter').label, sha256: e1.headers['x-content-sha256'], format: 'csv' });
    expect(JSON.stringify([...read, ...down])).not.toMatch(/@|example\.test|Institution synthétique/);
    // refused requests read nothing and are not « reads »: no scope, a territory parameter, a period that is not offered
    await call('legacy', 'observatoire'); await call('legacy', 'export', { period: 'quarter' }); await call('other', 'observatoire', { territory: 'Bas-Rhin' }); await call('other', 'export', { period: 'year' });
    for (const key of ['legacy', 'other']) for (const action of ['INSTITUTION_OBSERVATOIRE_READ', 'INSTITUTION_EXPORT_DOWNLOADED']) expect(await rows(key, action), `${key} ${action}`).toHaveLength(0);
    delete process.env.OPEN_DATA_EXPORT_ENABLED;
  });

  it('A16 + C8 on the unscoped tables (administrators\' preview, professional observatoire): three spellings of one commune are ONE commune (located by name AND postal code), so the 3-organization threshold counts them together; a name that is no commune is counted nowhere', async () => {
    const ORTHO = `g1-sp%-${TS}`;
    for (const [i, ville] of ['Sarre-Union', 'SARRE UNION', 'Sarre-Union Cedex 2'].entries()) await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${`g1-sp${i}-${TS}`}, ${`g1-sp${i}-${TS}`}, ${`g1-sp${i}-${TS}`}, 'association', '1 rue', ${ville}, '67260', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    const communes = (await stats.observatoire(db, NOW)).byCommune.map((r) => r.commune).filter((c) => c === 'Sarre-Union');
    expect(communes, 'one row, under the official name').toEqual(['Sarre-Union']);
    const csv = (await stats.territoryCsv('quarter', db, NOW)).csv.split('\r\n').filter((l) => l.split(',')[3] === 'Sarre-Union');
    expect(csv).toHaveLength(1); expect(csv[0].split(',')[4]).toBe('3');
    // the place that is no commune (« G1 Lieu-dit ») and the name / postal code that disagree (« Haguenau, 68000 ») are in no unscoped table either
    expect(JSON.stringify(await stats.observatoire(db, NOW))).not.toMatch(/Lieu-dit/);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${`g1-pro-${TS}`}, ${`g1-pro-${TS}@example.test`}, 'x', ${`g1-sp0-${TS}`}, 'STRUCTURE_ADMIN', 'active', NOW(), NOW())`);
    const regional = await (await import('../../api/_services/org-stats.js')).regionalStats({ structureId: `g1-sp0-${TS}`, userId: `g1-pro-${TS}`, role: 'STRUCTURE_ADMIN' }, db, NOW);
    expect(regional.ok).toBe(true);
    const city = regional.stats.cities.filter((c) => c.name === 'Sarre-Union');
    expect(city).toHaveLength(1); expect(city[0].city).toBe('3 structures vérifiées');
    expect(regional.stats.cities.find((c) => c.name === 'Haguenau').orgs, 'the organization « Haguenau, 68000 » is not located: Haguenau keeps its 4').toBe(4);
    // audit A19: its appointments are masked (none, so « < 5 »): the status says « masked », never « inactive »
    expect(city[0]).toMatchObject({ rdv: null, status: 'masked' }); expect(regional.stats.cities.every((c) => ['masked', 'published'].includes(c.status))).toBe(true);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${`g1-pro-${TS}`}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id LIKE ${ORTHO}`);
  });

  it('B6 the administrator\'s list says which accounts have no defined territory; a new account is stored under a label that reads back to one territory', async () => {
    const { listAll, createAccount } = await import('../../api/_services/institutions.js');
    const list = (await listAll(db)).accounts;
    const of = (key) => list.find((a) => a.id === accounts[key].id).territoryScope;
    expect(of('epci')).toEqual({ defined: true, kind: 'epci', code: '200067874', communes: 36 });
    expect(of('legacy')).toEqual({ defined: false, reason: 'UNKNOWN' }); expect(of('empty')).toEqual({ defined: false, reason: 'MISSING' }); expect(of('ambiguous')).toEqual({ defined: false, reason: 'AMBIGUOUS' });
    // an EPCI whose name two EPCI bear, given by its SIREN: stored with the code, and it reads back
    const made = await createAccount({ email: `g1-made-${TS}@example.test`, organisationName: 'Institution synthétique G1', territory: '246000772', agreementId: `g1-ag-${TS}` }, 'g1-admin@example.test', db);
    expect(made.ok).toBe(true);
    const [row] = (await db.execute(sql`SELECT territory FROM "InstitutionAccount" WHERE id = ${made.id}`)).rows;
    expect(row.territory).toBe('Communauté de communes des Deux Vallées (246000772)'); expect(scope(row.territory)).toMatchObject({ ok: true, kind: 'epci', code: '246000772' });
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity_id = ${made.id}`); await db.execute(sql`DELETE FROM "InstitutionAccount" WHERE id = ${made.id}`);
  });
});
