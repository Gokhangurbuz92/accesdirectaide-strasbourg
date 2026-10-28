/**
 * PKG-11 / N02 on REAL PostgreSQL: a provider-signed « STOP » reply ends SMS reminders; the parcours SMS waits for the send window.
 *  - unconfigured: 404; forged signature: 403 and nothing changes; a signed non-STOP text: ignored;
 *  - a signed STOP withdraws the SMS reminder consent of the account(s) holding that number (preference off + a « no » in the append-only ledger, channel
 *    sms_reply_stop) and forgets the number on their appointments, whatever its stored format; another account is untouched; a replay is harmless;
 *  - parcours reminders: at night the SMS is neither sent nor claimed; the next run inside 08:00-20:00 Paris claims it.
 * Synthetic data only; skipped without DATABASE_URL; no SMS provider is called.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = `n02-a-${TS}`, B = `n02-b-${TS}`, P = `n02-p-${TS}`;
const ID = { str: `n02-str-${TS}`, svc: `n02-svc-${TS}`, a1: `n02-a1-${TS}`, a2: `n02-a2-${TS}`, b1: `n02-b1-${TS}`, item: `n02-item-${TS}` };
const ENV = { SMS_INBOUND_URL: 'https://example.test/api/public/sms-inbound', TWILIO_AUTH_TOKEN: 'qa-inbound-token' };
const resOf = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } });

describe.skipIf(!hasDatabase)('PKG-11 / N02 SMS STOP and send window (real DB)', () => {
  let db, schema, svc, inbound, policy, parcours;
  const post = async (body, { env = ENV, sign = true } = {}) => {
    const r = resOf();
    await inbound({ method: 'POST', headers: sign ? { 'x-twilio-signature': policy.twilioSignature(env.TWILIO_AUTH_TOKEN || 'x', env.SMS_INBOUND_URL || 'x', body) } : { 'x-twilio-signature': 'forged' }, body }, r, { env, db });
    return r;
  };
  const phones = async () => Object.fromEntries((await db.execute(sql`SELECT id, "beneficiaryPhone" p FROM "ProAppointment" WHERE id IN (${ID.a1}, ${ID.a2}, ${ID.b1})`)).rows.map((r) => [r.id, r.p]));
  const lastLedger = async (uid) => (await db.execute(sql`SELECT decision, collection_channel, proof_level FROM "ConsentLog" WHERE subject_id = ${uid} AND purpose = 'NOTIF_SMS_REMINDER' ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    svc = await import('../../api/_services/citizen-account.js');
    inbound = (await import('../../api/_services/sms-stop.js')).handleInboundStop;
    policy = await import('../../api/lib/sms-policy.js');
    parcours = await import('../../api/_handlers/cron/parcours-reminder.js');
    for (const u of [A, B]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u}, ${u + '@example.test'}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", phone, "phoneVerifiedAt", "updatedAt") VALUES (${P}, ${P + '@example.test'}, 'x', NOW(), '0655443322', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt") VALUES (${ID.str}, 'N02', ${'n02-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.insert(schema.ProRdvService).values({ id: ID.svc, structureId: ID.str, name: 'S', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, isActive: true });
    const start = new Date(Date.now() + 3 * 86400000); const base = { structureId: ID.str, serviceId: ID.svc, startAt: start, endAt: new Date(start.getTime() + 1800000), status: 'confirmed', beneficiaryName: 'X' };
    await db.insert(schema.ProAppointment).values([{ id: ID.a1, ...base, citizenUserId: A, beneficiaryPhone: '0698765432' }, { id: ID.a2, ...base, citizenUserId: A, beneficiaryPhone: '+33 6 98 76 54 32' }, { id: ID.b1, ...base, citizenUserId: B, beneficiaryPhone: '0611112222' }]);
    for (const u of [A, B, P]) expect((await svc.setPreference(u, { channel: 'sms', category: 'reminder', enabled: true, consentGiven: true })).ok).toBe(true);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ParcoursReminder" WHERE "itemId" = ${ID.item}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ParcoursItem" WHERE id = ${ID.item}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE id IN (${ID.a1}, ${ID.a2}, ${ID.b1})`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${ID.svc}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ID.str}`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${A}, ${B}, ${P})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${A}, ${B}, ${P})`);
  });

  it('unconfigured 404, forged 403, signed non-STOP ignored: nothing changes', async () => {
    expect((await post({ From: '+33698765432', Body: 'STOP' }, { env: {} })).statusCode).toBe(404);
    expect((await post({ From: '+33698765432', Body: 'STOP' }, { sign: false })).statusCode).toBe(403);
    expect((await post({ From: '+33698765432', Body: 'Merci pour le rappel' })).statusCode).toBe(200);
    expect(await svc.canNotify(A, 'sms', 'reminder')).toBe(true);
    expect(await phones()).toEqual({ [ID.a1]: '0698765432', [ID.a2]: '+33 6 98 76 54 32', [ID.b1]: '0611112222' });
  });

  it('a signed STOP withdraws the consent of the account holding that number and forgets the number; another account is untouched; a replay is harmless', async () => {
    const r = await post({ From: '+33698765432', To: '+33600000000', Body: 'Stop' });
    expect([r.statusCode, r.headers['Content-Type']]).toEqual([200, 'text/xml; charset=utf-8']);
    expect(await svc.canNotify(A, 'sms', 'reminder')).toBe(false);
    expect(await lastLedger(A)).toEqual({ decision: false, collection_channel: 'sms_reply_stop', proof_level: 'PROVIDER_SIGNED_REPLY' });
    expect(await phones()).toEqual({ [ID.a1]: null, [ID.a2]: null, [ID.b1]: '0611112222' });
    expect(await svc.canNotify(B, 'sms', 'reminder')).toBe(true);
    expect((await post({ From: '+33698765432', Body: 'STOP' })).statusCode).toBe(200);   // nothing left to change
    expect(await svc.canNotify(A, 'sms', 'reminder')).toBe(false);
  });

  it('parcours: at night the SMS is neither sent nor claimed; the next run inside the window claims it', async () => {
    const d = new Date(); d.setUTCHours(21, 0, 0, 0);                                // 22:00 or 23:00 in Paris
    const night = d, day = new Date(d.getTime() + 13 * 3600000);                       // next day 10:00 UTC: 11:00 or 12:00 in Paris
    expect([policy.isSmsSendWindow(night), policy.isSmsSendWindow(day)]).toEqual([false, true]);
    await db.insert(schema.ParcoursItem).values({ id: ID.item, userId: P, origin: 'MANUAL', stepKind: 'custom', title: 'N02', dueDate: new Date(d.getTime() + 18 * 3600000), dueSourceUrl: 'https://www.service-public.fr/particuliers/vosdroits/F1' });
    const rows = async () => (await db.execute(sql`SELECT channel, status FROM "ParcoursReminder" WHERE "itemId" = ${ID.item} ORDER BY channel`)).rows;
    const n = await parcours.runParcoursReminders({ now: night });
    expect(n.deferredQuietHours).toBeGreaterThanOrEqual(1);
    expect((await rows()).map((r) => r.channel)).not.toContain('sms');
    await parcours.runParcoursReminders({ now: day });
    expect((await rows()).find((r) => r.channel === 'sms')).toBeTruthy();   // claimed and attempted (no provider configured: NOT_DELIVERED, honestly)
  });
});
