/**
 * R40 / G10 — cron/rdv-reminder and cron/gdpr-purge on BOTH database levels: a database migrated only to 0042 (Production today: no guest-booking columns)
 * and one migrated to 0044 (guest booking + guest reminder consent). The jobs detect the guest columns once per run (information_schema) and skip only the
 * guest parts when they are absent. Rows are written with raw SQL so the seed itself does not depend on the migration level.
 * Run: DBN=ada_r40_jobs42_test bash $S/r40/jobs/int.sh tests/integration/r40-jobs-schema-db.test.js   (and DBN=ada_r40_jobs_test)
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
const kvState = vi.hoisted(() => ({ store: new Map() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  incr: async () => 1, expire: async () => 1,
  get: async (k) => kvState.store.get(k) ?? null,
  set: async (k, v, o) => { if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
} }));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { approvedTestPolicy, executableStepIds, setApprovalEnv } from '../helpers/gdpr-purge-approval.js';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const ID = { str: `r40s-str-${TS}`, svc: `r40s-svc-${TS}`, agent: `r40s-pro-${TS}`, citizen: `r40s-cit-${TS}`, citizen2: `r40s-cit2-${TS}`, aptTomorrow: `r40s-apt-j1-${TS}`, aptOld: `r40s-apt-old-${TS}`,
  hold: `r40s-hold-${TS}`, aptHeld: `r40s-apt-held-${TS}` };

describe.skipIf(!hasDatabase)('R40 G10 — jobs on a 0042 and a 0044 database (real DB)', () => {
  let db, rdvReminder, gdprPurge, notices, mailer, features;
  let guest = false;
  const run = async (handler, url) => { const r = mk(); await handler({ method: 'GET', url, query: {}, headers: { host: 'x', 'x-cron-secret': process.env.CRON_SECRET } }, r); return r; };
  const one = async (q) => (await db.execute(q)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: rdvReminder } = await import('../../api/_handlers/cron/rdv-reminder.js'));
    gdprPurge = (await import('../../api/_handlers/cron/gdpr-purge.js')).createGdprPurgeHandler({ policy: approvedTestPolicy() });   // R44: what an EXECUTING purge does — a test copy of the policy marked approved (production keeps it PROPOSED — NOT APPROVED), every step approved
    notices = await import('../../api/_services/appointment-notices.js');
    mailer = await import('../../api/_utils/mailer.js');
    guest = Number((await one(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'ProAppointment' AND column_name = 'guestHoldExpiresAt'`)).n) === 1;
    const tomorrowNoon = new Date(notices.parisDayWindow(new Date(), 1).start.getTime() + 12 * 3_600_000);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${ID.str}, 'R40 S', ${'r40s-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${ID.svc}, ${ID.str}, 'S', 30, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt")
      VALUES (${ID.agent}, ${`r40s-pro-${TS}@example.test`}, 'x', 'AGENT', 'active', ${ID.str}, true, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES (${ID.citizen}, ${`r40s-cit-${TS}@example.test`}, 'x', NOW())`);
    const apt = (id, startAt, createdAt, citizen = ID.citizen) => sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "beneficiaryPhone", notes,
      "createdByProUserId", "citizenUserId", "createdAt", "updatedAt") VALUES (${id}, ${ID.str}, ${ID.svc}, ${startAt}, ${new Date(startAt.getTime() + 1_800_000)}, 'confirmed', 'Jean Dupont',
      '0600000000', 'note', ${ID.agent}, ${citizen}, ${createdAt}, NOW())`;
    await db.execute(apt(ID.aptTomorrow, tomorrowNoon, ago(1)));
    await db.execute(apt(ID.aptOld, ago(800), ago(800)));
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES (${ID.citizen2}, ${`r40s-cit2-${TS}@example.test`}, 'x', NOW())`);
    await db.execute(apt(ID.aptHeld, ago(800), ago(800), ID.citizen2));   // G7: same age, but its citizen is under an active legal hold below — never anonymised
    await db.execute(sql`INSERT INTO "LegalHold" (id, "dataCategory", "recordId", "reasonCode", "createdBy", status, "createdAt") VALUES (${'r40s-lh-' + TS}, 'CitizenUser', ${ID.citizen2}, 'R40 TEST', 'test', 'ACTIVE', NOW())`);
    if (guest) {
      // an account-free hold never confirmed, expired two days ago, with its sealed e-mail: cleared by the purge (0043+ only)
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "guestEmail", "guestEmailHash", "guestHoldExpiresAt", "createdAt", "updatedAt")
        VALUES (${ID.hold}, ${ID.str}, ${ID.svc}, ${tomorrowNoon}, ${new Date(tomorrowNoon.getTime() + 1_800_000)}, 'requested', 'G. H.', 'sealed', ${'r40s-hash-' + TS}, ${ago(2)}, ${ago(2)}, NOW())`);
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" LIKE ${'r40s-%-' + TS}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "userId" = ${ID.agent}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${ID.str}`);
    await db.execute(sql`DELETE FROM "LegalHold" WHERE id = ${'r40s-lh-' + TS}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${ID.svc}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id = ${ID.agent}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${ID.citizen}, ${ID.citizen2})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ID.str}`);
  });

  it('detects the guest columns of this database once per run', async () => {
    features = await import('../../api/_utils/schema-features.js');
    const f = await features.appointmentGuestSchema(db);
    expect(f.guestBooking).toBe(guest);
    expect(typeof f.guestReminderConsent).toBe('boolean');
  });

  it('rdv-reminder runs on this schema: tomorrow\'s appointment is reminded, the agent is reached, the claim is closed', async () => {
    const r = await run(rdvReminder, '/api/cron/rdv-reminder');
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.appointmentsFound).toBeGreaterThanOrEqual(1);
    const row = await one(sql`SELECT reminder_sent_at FROM "ProAppointment" WHERE id = ${ID.aptTomorrow}`);
    expect(row.reminder_sent_at).not.toBeNull();
    expect(mailer.__getTestOutbox().some((m) => m.to === `r40s-pro-${TS}@example.test` && /Rappel RDV demain/.test(m.subject))).toBe(true);
    if (guest) expect((await one(sql`SELECT reminder_sent_at FROM "ProAppointment" WHERE id = ${ID.hold}`)).reminder_sent_at).toBeNull();   // an unconfirmed hold is never reminded
  });

  it('gdpr-purge runs on this schema: old appointments anonymised, guest holds cleared only where the columns exist, success status', async () => {
    const restore = setApprovalEnv(executableStepIds((await import('../../api/_handlers/cron/gdpr-purge.js')).PURGE_STEPS));   // R33 + R44: enabled and approved
    const r = await run(gdprPurge, '/api/cron/gdpr-purge').finally(restore);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('success');
    const old = await one(sql`SELECT "beneficiaryName", "beneficiaryPhone", notes FROM "ProAppointment" WHERE id = ${ID.aptOld}`);
    expect(old).toMatchObject({ beneficiaryName: '[anonymisé]', beneficiaryPhone: null, notes: null });
    const held = await one(sql`SELECT "beneficiaryName", "beneficiaryPhone" FROM "ProAppointment" WHERE id = ${ID.aptHeld}`);
    expect(held).toMatchObject({ beneficiaryName: 'Jean Dupont', beneficiaryPhone: '0600000000' });   // G7: legal hold honoured
    if (guest) {
      const h = await one(sql`SELECT status, "guestEmail", "cancelledBy" FROM "ProAppointment" WHERE id = ${ID.hold}`);
      expect(h).toMatchObject({ status: 'cancelled', guestEmail: null, cancelledBy: 'GUEST_HOLD_EXPIRED' });
      expect(r.body.guest_holds_cleared).toBeGreaterThanOrEqual(1);
      expect(r.body.skipped_steps).toBeUndefined();
    } else {
      expect(r.body.guest_holds_cleared).toBe(0);
      expect(r.body.skipped_steps).toEqual(['clearedGuestHoldsCount']);   // said, not hidden: the guest step cannot exist before migration 0043
    }
  });
});
