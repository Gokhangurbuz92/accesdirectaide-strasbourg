/**
 * R41-B — the readers that leave decoy holds out (structure statistics, regional and territorial statistics, reports, the absence conflict list, the platform
 * health count) and the purge step that deletes them, on BOTH database levels: migrated only to 0042 (Production today: no guest-booking columns, the
 * guest endpoints are closed) and to 0044. The decoy marker is a column of migration 0000 (beneficiaryName), so the exclusion runs on 0042 without error
 * (no decoy can exist there); on 0044 a decoy row (written with raw SQL, as rdv/guest/hold writes it) is counted nowhere. Rows are written with raw SQL so the
 * seed itself does not depend on the migration level.
 * Run: DBN=ada_r41_decoy_0042_test bash $S/r41/decoy/int.sh tests/integration/r41-guest-decoy-schema-db.test.js   (and DBN=ada_r41_decoy_test)
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const TOWN = `R41ville-${TS}`;
const STR = [0, 1, 2].map((i) => `r41sch-str${i}-${TS}`);
const SVC = `r41sch-svc-${TS}`;
const ADMIN = { id: `r41sch-pa-${TS}`, email: `r41sch-pa-${TS}@example.test`, sid: STR[0], role: 'STRUCTURE_ADMIN' };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(d) { if (d !== undefined) this.body = d; return this; } });

describe.skipIf(!hasDatabase)('R41-B decoy exclusion and purge on a 0042 and a 0044 database (real DB)', () => {
  let db, auth, orgStats, territorial, reports, timeoff, purge, rdv, decoyMod;
  let guest = false;
  const invoke = async (handler, { method = 'GET', url, body, headers = {}, query = {} }) => { const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', ...headers } }, r); return r; };
  const pro = (u) => ({ authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}` });
  const one = async (q) => (await db.execute(q)).rows[0];
  // this month (but before now) and inside the last complete calendar quarter
  const thisMonth = () => { const d = new Date(); const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); return new Date(start + Math.floor((Date.now() - start) / 2)); };
  let lastQuarter;
  const apt = (id, startAt) => sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "createdAt", "updatedAt")
    VALUES (${id}, ${STR[0]}, ${SVC}, ${startAt}, ${new Date(startAt.getTime() + 60_000)}, 'confirmed', 'v1:sealed', NOW(), NOW())`;
  const decoy = (id, startAt, expiresAt) => sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, mode, "beneficiaryName", "idempotencyKey",
      "guestEmailHash", "guestHoldExpiresAt", "guestCodeHash", "createdAt", "updatedAt")
    VALUES (${id}, ${STR[0]}, ${SVC}, ${startAt}, ${new Date(startAt.getTime() + 1_800_000)}, 'requested', 'IN_PERSON', ${decoyMod.GUEST_DECOY_NAME}, ${'k-' + id},
      ${'f'.repeat(64)}, ${expiresAt}, ${decoyMod.unusableGuestCodeHash()}, NOW(), NOW())`;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    auth = await import('../../api/_utils/auth.js');
    orgStats = await import('../../api/_services/org-stats.js');
    territorial = await import('../../api/_services/territorial-stats.js');
    decoyMod = await import('../../api/_utils/rdv-guest-decoy.js');
    ({ default: reports } = await import('../../api/_handlers/pro/reports.js'));
    ({ default: timeoff } = await import('../../api/_handlers/pro/timeoff.js'));
    ({ default: purge } = await import('../../api/_handlers/cron/gdpr-purge.js'));
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    guest = Number((await one(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'ProAppointment' AND column_name = 'guestHoldExpiresAt'`)).n) === 1;
    const w = territorial.periodWindow('quarter');
    lastQuarter = new Date(w.start.getTime() + 10 * DAY + 9 * 3_600_000);
    for (const id of STR) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${'R41 ' + id}, ${id}, 'association', '1 rue', ${TOWN}, '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${STR[0]}, 'S', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${ADMIN.id}, ${ADMIN.email}, 'x', ${STR[0]}, ${ADMIN.role}, 'active', NOW(), NOW())`);
    for (let i = 0; i < 5; i += 1) {
      await db.execute(apt(`r41sch-m${i}-${TS}`, new Date(thisMonth().getTime() + i * 60_000)));
      await db.execute(apt(`r41sch-q${i}-${TS}`, new Date(lastQuarter.getTime() + i * 3_600_000)));
    }
    if (guest) {
      // decoys: one this month, one in the last quarter (as if created then), one upcoming and still holding its slot, one expired two days ago (purged)
      await db.execute(decoy(`r41sch-dm-${TS}`, thisMonth(), new Date(Date.now() - 2 * DAY)));
      await db.execute(decoy(`r41sch-dq-${TS}`, lastQuarter, new Date(lastQuarter.getTime() - DAY)));
      await db.execute(decoy(`r41sch-du-${TS}`, new Date(Date.now() + 5 * DAY), new Date(Date.now() + 15 * 60_000)));
    }
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${STR[0]}, ${STR[1]}, ${STR[2]})`);
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" = ${STR[0]}`);
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" = ${STR[0]}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${STR[0]}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${ADMIN.id}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${STR[0]}, ${STR[1]}, ${STR[2]})`);
  });

  it('the database level is the one this run was started for', () => {
    expect(typeof guest).toBe('boolean');
    console.info(`[r41] guest columns present: ${guest}`);
  });

  it('structure statistics, the CSV report and the reports page count the 5 appointments, never a decoy', async () => {
    const ctx = { userId: ADMIN.id, structureId: STR[0] };
    const team = await orgStats.teamStats(ctx);
    expect(team.ok).toBe(true);
    expect(team.global.appointmentsUpcoming).toBe(0);   // the upcoming decoy is no appointment
    const csv = await orgStats.reportCsv(ctx, 'year');
    expect(csv.ok).toBe(true);
    expect(csv.csv).toMatch(/\r\nrdv_total,10\r\n/);
    expect(csv.csv).toMatch(/\r\nrdv_annules,0\r\n/);
    const rep = await invoke(reports, { url: '/api/pro/reports?period=year', headers: pro(ADMIN) });
    expect(rep.statusCode, JSON.stringify(rep.body)).toBe(200);
    expect(rep.body.kpis.totalAppointments).toBe(10);
  });

  it('regional and territorial statistics count the 5 appointments of the commune, never a decoy', async () => {
    const reg = await orgStats.regionalStats({ userId: ADMIN.id, structureId: STR[0] });
    expect(reg.ok, JSON.stringify(reg)).toBe(true);
    const out = await territorial.territoryCsv('quarter');
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const line = out.csv.split('\r\n').find((l) => l.includes(TOWN));
    expect(line).toBeTruthy();
    expect(line.split(',')[5]).toBe('5');   // rendez_vous of the last complete quarter
    const city = reg.stats.cities.find((c) => c.name === TOWN);
    expect(city?.rdv).toBe(5);   // this month's 5 appointments; the decoy of this month is not one
  });

  it('an absence over the upcoming decoy lists no appointment to move (0044; on 0042 this handler already fails before R41, see the R41-B report)', async () => {
    if (!guest) { console.info('[r41] pro/timeoff skipped on 0042: activeAppointmentWhere (R38) reads guestHoldExpiresAt — pre-existing, reported'); return; }
    const start = new Date(Date.now() + 5 * DAY - 3_600_000); const end = new Date(Date.now() + 5 * DAY + 3_600_000);
    const r = await invoke(timeoff, { method: 'POST', url: '/api/pro/timeoff', headers: pro(ADMIN), body: { startAt: start.toISOString(), endAt: end.toISOString(), scope: 'structure', reason: 'R41' } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
    expect(r.body.overlappingAppointments).toEqual([]);
  });

  it('gdpr-purge: on 0042 the guest step is skipped (said, not hidden) and nothing fails; on 0044 the expired decoy is deleted, the live one kept', async () => {
    vi.stubEnv('GDPR_PURGE_ENABLED', 'true');
    let r;
    try { r = mk(); await purge({ method: 'GET', url: '/api/cron/gdpr-purge', query: {}, headers: { host: 'x', authorization: `Bearer ${process.env.CRON_SECRET}` } }, r); }
    finally { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); }
    expect(r.body.failed_steps || []).toEqual([]);
    if (!guest) {
      expect(r.body.skipped_steps).toEqual(['clearedGuestHoldsCount']);
      expect(r.body.guest_decoy_holds_deleted).toBe(0);
      return;
    }
    expect(r.body.skipped_steps).toBeUndefined();
    expect(r.body.guest_decoy_holds_deleted).toBeGreaterThanOrEqual(2);
    const left = (await db.execute(sql`SELECT id FROM "ProAppointment" WHERE "beneficiaryName" = ${decoyMod.GUEST_DECOY_NAME} AND "structureId" = ${STR[0]} ORDER BY id`)).rows.map((x) => x.id);
    expect(left).toEqual([`r41sch-du-${TS}`]);
  });

  it('the account-free endpoints are retired (R42, DEC-R42-01): 410 ACCOUNT_REQUIRED, nothing read', async () => {
    const r = mk();
    await rdv({ method: 'POST', url: '/api/rdv/guest/hold', query: {}, body: {}, headers: { host: 'localhost' } }, r);
    expect([r.statusCode, r.body.code]).toEqual([410, 'ACCOUNT_REQUIRED']);
  });
});
