/**
 * Add-ons to M1 (reconciliation of 15/11/2026) on REAL PostgreSQL, through the real handlers and signed session cookies:
 *  A-10 — a PUBLIC place (structure) becomes a tracked step of Mon Parcours like an aide: by id or slug, idempotent, titled with the place's name, linked to
 *         its page; a place that is not public is the uniform 404 (no existence oracle); a place withdrawn later is flagged without its name or address;
 *  A-19 — the Parcours reminder job never sends an SMS to an account whose number is not verified, even with the SMS reminder switched on (which is why
 *         the screens do not offer it for deadlines): the e-mail reminder goes, the SMS is recorded NO_CONSENT and the sender is never called.
 * Works on a database with or without migration 0046. Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
// G14: these are proofs of the FORMER Mon Parcours contract (free titles, records, plan data, consent, import, delegate read): reachable only in the
// test suites (api/lib/parcours-limited.js legacyContractAllowed). The limited contract has its own proof: tests/integration/g14-parcours-limited-db.test.js
process.env.ADA_PARCOURS_LEGACY_CONTRACT = 'test-only';
process.env.ADA_PARCOURS_EXTERNAL_REMINDERS = 'on';   // G14: external reminders are off by default; this file proves the job itself

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const A = { id: `m1x-a-${TS}`, email: `m1x-a-${TS}@example.test` };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });

describe.skipIf(!hasDatabase)('M1 add-ons A-10 / A-19 (real DB)', () => {
  let db, userAuth, parcours, S;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const call = async ({ method = 'GET', body, query = {}, as } = {}) => { const r = mk(); await parcours({ method, url: '/api/citizen/parcours', query, body, headers: { host: 'localhost', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const add = (body) => call({ method: 'POST', as: A, body: { action: 'add', ...body } });
  const list = async () => (await call({ as: A })).body.items;
  const structures = [];
  const PUBLIC = { statut: 'actif', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'rev@example.test', territory_verified: true, data_origin: 'official', date_verification: new Date(Date.now() - 3 * 86400000), source_url: 'https://www.service-public.fr/x' };
  const structure = async (name, extra = {}) => {
    const id = `m1x-st-${name}-${TS}`; structures.push(id);
    await db.insert(S.Structure).values({ id, slug: `${id}-slug`, nom: `Lieu de test ${name}`, services: [], publics_accueillis: [], categories_aidees: [], ...PUBLIC, ...extra });
    return id;
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    S = await import('../../src/db/schema.js');
    userAuth = await import('../../api/_utils/user-auth.js');
    parcours = (await import('../../api/_handlers/citizen/parcours.js')).default;
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt", phone) VALUES (${A.id}, ${A.email}, 'x', NOW(), NOW(), '+33600000000')`);
  });
  afterAll(async () => {
    if (!db) return;
    for (const id of structures) await db.execute(sql`DELETE FROM "Structure" WHERE id = ${id}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${A.id}`);
  });

  describe('A-10 — a place as a step', () => {
    let sid, stepId;
    it('a public place becomes ONE step: by id, by slug, again — titled with its name, linked to its page, with its contact details flagged', async () => {
      sid = await structure('permanence', { telephone: '03 00 00 00 00', adresse: '1 place de Test' });
      const first = await add({ records: [{ type: 'structure', id: sid }] });
      expect(first.statusCode, JSON.stringify(first.body)).toBe(201); expect(first.body).toMatchObject({ added: true, item: { title: 'Lieu de test permanence', origin: 'MANUAL', itemCodes: [`structure:${sid}`], status: 'NOT_STARTED' } });
      stepId = first.body.item.id;
      for (const id of [`${sid}-slug`, sid]) {
        const again = await add({ records: [{ type: 'structure', id }] });
        expect([again.statusCode, again.body.added, again.body.item.id], id).toEqual([200, false, stepId]);
      }
      expect((await list()).find((i) => i.id === stepId)).toMatchObject({ available: true, records: [{ code: `structure:${sid}`, type: 'structure', available: true, title: 'Lieu de test permanence', href: `/structures/${sid}-slug`, contact: true }] });
      expect((await db.execute(sql`SELECT count(*)::int n FROM "ParcoursEvent" WHERE "itemId" = ${stepId}`)).rows[0].n).toBe(1);
    });
    it('a place together with an aide-type record in one step, and with the person’s own title', async () => {
      const other = await structure('accueil');
      const r = await add({ records: [{ type: 'structure', id: other }, { type: 'structure', id: sid }], title: 'Aller aux deux permanences' });
      expect(r.statusCode, JSON.stringify(r.body)).toBe(201);
      expect(r.body.item).toMatchObject({ title: 'Aller aux deux permanences', itemCodes: [`structure:${other}`, `structure:${sid}`].sort() });
    });
    it('a place that is not public, or does not exist, is the same 404 and creates nothing', async () => {
      const hidden = await structure('brouillon', { statut: 'brouillon' });
      const held = await structure('retenue', { publication_hold: 'en cours de vérification' });
      const before = (await list()).length;
      const answers = [];
      for (const id of [hidden, held, `m1x-st-inconnu-${TS}`]) { const r = await add({ records: [{ type: 'structure', id }] }); answers.push([r.statusCode, r.body]); }
      expect(answers[0][0]).toBe(404); expect(answers[1]).toEqual(answers[0]); expect(answers[2]).toEqual(answers[0]);
      expect((await list()).length).toBe(before);
    });
    it('a place withdrawn later is flagged in the step without its name or address, and comes back when it is public again', async () => {
      await db.execute(sql`UPDATE "Structure" SET publication_hold = 'retirée' WHERE id = ${sid}`);
      const flagged = (await list()).find((i) => i.id === stepId);
      expect(flagged).toMatchObject({ available: false, title: 'Lieu de test permanence', records: [{ code: `structure:${sid}`, type: 'structure', available: false, title: null, href: null, contact: false }] });
      await db.execute(sql`UPDATE "Structure" SET publication_hold = NULL WHERE id = ${sid}`);
      expect((await list()).find((i) => i.id === stepId)).toMatchObject({ available: true, records: [{ title: 'Lieu de test permanence' }] });
    });
  });

  describe('A-19 — no SMS for a Mon Parcours deadline', () => {
    it('with the SMS reminder switched on and an (unverified) number on the account, the job sends the e-mail and never calls the SMS sender', async () => {
      const { runParcoursReminders } = await import('../../api/_handlers/cron/parcours-reminder.js');
      const item = (await add({ title: 'Renvoyer le formulaire' })).body.item;
      const now = new Date('2031-03-10T10:00:00Z');   // 11:00 in Paris: inside the SMS sending hours, so a quiet-hours deferral cannot explain the absence
      await db.execute(sql`UPDATE "ParcoursItem" SET "dueDate" = ${new Date(now.getTime() + 6.5 * 86400000)}, "dueSourceUrl" = 'https://www.service-public.gouv.fr/x' WHERE id = ${item.id}`);
      expect((await db.execute(sql`SELECT phone, "phoneVerifiedAt" FROM "CitizenUser" WHERE id = ${A.id}`)).rows[0]).toEqual({ phone: '+33600000000', phoneVerifiedAt: null });
      const sendSms = vi.fn().mockResolvedValue('PROVIDER_ACCEPTED'); const sendMail = vi.fn().mockResolvedValue({ ok: true, accepted: true });
      const out = await runParcoursReminders({ now, deps: { sendSms, sendMail, sendToUser: vi.fn().mockResolvedValue({ sent: 0 }), canNotify: async (userId, channel) => userId === A.id && channel !== 'push' } });
      expect(out).toBeTruthy();
      expect(sendSms).not.toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledTimes(1);
      const ledger = (await db.execute(sql`SELECT channel, status FROM "ParcoursReminder" WHERE "itemId" = ${item.id} ORDER BY channel`)).rows;
      expect(ledger.find((r) => r.channel === 'sms')).toEqual({ channel: 'sms', status: 'NO_CONSENT' });
      expect(ledger.find((r) => r.channel === 'email').status).not.toBe('NO_CONSENT');
    });
  });
});
