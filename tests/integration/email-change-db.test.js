/**
 * Launch-readiness item 66 on REAL PostgreSQL — the right of rectification of the contact data (api/_services/email-change.js):
 *  - an e-mail change needs the current password; the new address is stored encrypted, a single-use link goes to it and a notice to the old one;
 *  - the link changes the address (verified) and ends every session; reused, expired or unknown links change nothing; a taken address is refused at the end;
 *  - a provider that sends nothing is never reported as « sent »;
 *  - the phone can be changed or removed and is then not verified (nothing is sent to it).
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const U = `ec-${TS}`; const OTHER = `ec-other-${TS}`;
const OLD = `old-${TS}@example.test`; const NEW = `new-${TS}@example.test`; const TAKEN = `taken-${TS}@example.test`;
const PASSWORD = `Planted-Pass-${TS}`;

describe.skipIf(!hasDatabase)('contact data rectification (real DB)', () => {
  let db, svc; const outbox = [];
  const send = async (m) => { outbox.push(m); return { outcome: 'TEST_RECORDED', accepted: true, delivered: true, provider: 'test' }; };
  const linkToken = () => decodeURIComponent(String(outbox.filter((m) => m.category === 'email_change').at(-1)?.text || '').split('token=')[1] || '');
  const row = async () => (await db.execute(sql`SELECT email, "emailVerifiedAt", "sessionsValidAfter", phone, "phoneVerifiedAt" FROM "CitizenUser" WHERE id = ${U}`)).rows[0];
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    svc = await import('../../api/_services/email-change.js');
    const { hashPassword } = await import('../../api/_utils/password-hash.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", phone, "phoneVerifiedAt", "updatedAt") VALUES
      (${U}, ${OLD}, ${await hashPassword(PASSWORD)}, NOW() - interval '30 days', '0612345678', NOW(), NOW()), (${OTHER}, ${TAKEN}, 'x', NOW(), NULL, NULL, NOW())`);
  }, 60000);
  afterAll(async () => { if (db) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${U}, ${OTHER})`).catch(() => {}); });

  it('refuses a wrong password, an invalid or identical address — nothing stored', async () => {
    expect(await svc.requestEmailChange(U, { newEmail: NEW, password: 'wrong' }, { db, send })).toMatchObject({ ok: false, code: 'INVALID_PASSWORD' });
    expect(await svc.requestEmailChange(U, { newEmail: 'not-an-address', password: PASSWORD }, { db, send })).toMatchObject({ ok: false, code: 'INVALID_EMAIL' });
    expect(await svc.requestEmailChange(U, { newEmail: OLD, password: PASSWORD }, { db, send })).toMatchObject({ ok: false, code: 'SAME_EMAIL' });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM "EmailChangeRequest" WHERE "userId" = ${U}`)).rows[0].n).toBe(0);
  });

  it('a request stores the new address encrypted, sends the link to it and a notice to the old one', async () => {
    const r = await svc.requestEmailChange(U, { newEmail: NEW, password: PASSWORD }, { db, send });
    expect(r).toMatchObject({ ok: true, status: 202, linkSent: true });
    const [req] = (await db.execute(sql`SELECT "newEmailEncrypted" AS e FROM "EmailChangeRequest" WHERE "userId" = ${U}`)).rows;
    expect(req.e).toMatch(/^v2:/); expect(req.e).not.toContain(NEW);
    expect(outbox.map((m) => [m.to, m.category])).toEqual([[NEW, 'email_change'], [OLD, 'email_change_notice']]);
    expect(outbox[1].text).not.toContain(NEW);   // the notice does not reveal the new address
    expect((await row()).email).toBe(OLD);       // nothing changes before the confirmation
  });

  it('the link changes the address and ends every session; it cannot be used twice', async () => {
    const token = linkToken();
    expect(await svc.confirmEmailChange('unknown-token', { db })).toEqual({ ok: false, status: 'invalid' });
    expect(await svc.confirmEmailChange(token, { db })).toEqual({ ok: true, status: 'changed' });
    const after = await row();
    expect(after.email).toBe(NEW);
    expect(after.sessionsValidAfter).not.toBeNull();
    expect(await svc.confirmEmailChange(token, { db })).toEqual({ ok: false, status: 'expired' });
    const audit = (await db.execute(sql`SELECT action, details FROM "AuditLog" WHERE entity_id = ${U} AND action LIKE 'CITIZEN_EMAIL_%' ORDER BY timestamp`)).rows;
    expect(audit.map((a) => a.action)).toEqual(['CITIZEN_EMAIL_CHANGE_REQUESTED', 'CITIZEN_EMAIL_CHANGED']);
    expect(JSON.stringify(audit)).not.toMatch(/@example\.test/);
  });

  it('a taken address is refused at the confirmation; an expired link changes nothing; an unconfigured provider is not « sent »', async () => {
    await svc.requestEmailChange(U, { newEmail: TAKEN, password: PASSWORD }, { db, send });
    expect(await svc.confirmEmailChange(linkToken(), { db })).toEqual({ ok: false, status: 'taken' });
    await svc.requestEmailChange(U, { newEmail: `late-${TS}@example.test`, password: PASSWORD }, { db, send, now: new Date(Date.now() - 2 * 3600000) });
    expect(await svc.confirmEmailChange(linkToken(), { db })).toEqual({ ok: false, status: 'expired' });
    expect((await row()).email).toBe(NEW);
    const noop = async () => ({ outcome: 'NOT_SENT', accepted: false, delivered: false, provider: 'noop' });
    expect(await svc.requestEmailChange(U, { newEmail: `x-${TS}@example.test`, password: PASSWORD }, { db, send: noop })).toMatchObject({ ok: true, status: 200, linkSent: false });
  });

  it('the phone is changed or removed and is then not verified', async () => {
    expect(await svc.setPhone(U, { phone: '12' }, { db })).toMatchObject({ ok: false, code: 'INVALID_PHONE' });
    expect(await svc.setPhone(U, { phone: '07 65 43 21 09' }, { db })).toMatchObject({ ok: true, phone: '0765432109', phoneVerified: false });
    expect(await row()).toMatchObject({ phone: '0765432109', phoneVerifiedAt: null });
    expect(await svc.setPhone(U, { phone: null }, { db })).toMatchObject({ ok: true, phone: null });
    expect((await row()).phone).toBeNull();
  });
});
