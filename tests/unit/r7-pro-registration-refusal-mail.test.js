/**
 * R7: the sign-up page promises the person an e-mail once the request is handled (register.js NOTICE_EXISTING). A refusal now sends one short,
 * generic message to the requester (never the administrator's internal reason), after the refusal is committed; a mail failure never undoes it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mail = { calls: [] , fail: false };
vi.mock('../../api/_utils/mailer.js', async (importOriginal) => ({ ...(await importOriginal()), sendMail: vi.fn(async (m) => { mail.calls.push(m); if (mail.fail) throw new Error('down'); return { outcome: 'TEST_RECORDED' }; }) }));
vi.mock('../../src/db/index.js', () => ({ db: new Proxy({}, { get() { throw new Error('default database touched'); } }) }));
vi.mock('../../api/_services/pro-account-admin.js', () => ({ administerProAccount: vi.fn(async () => ({ ok: true })) }));

const fakeDb = (row) => ({ transaction: async (fn) => fn({ execute: async () => ({ rows: row ? [row] : [] }), insert: () => ({ values: async () => {} }) }) });
const pending = { id: 'u1', email: 'demandeur@example.test', role: 'STRUCTURE_ADMIN', status: 'pending_verification', structureId: 's1', mfa_enabled: false };

describe('R7 — ADA Pro sign-up refusal notice', () => {
  beforeEach(() => { mail.calls = []; mail.fail = false; });

  it('sends one generic notice to the requester, without the internal reason', async () => {
    const { refuseSelfRegistration } = await import('../../api/_services/pro-self-registration.js');
    const out = await refuseSelfRegistration({ userId: 'u1', reason: 'SIRET ne correspond pas — note interne' }, { email: 'admin@example.test' }, { db: fakeDb(pending) });
    expect(out.ok).toBe(true);
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0].to).toBe('demandeur@example.test');
    expect(mail.calls[0].category).toBe('pro-registration-refused');
    expect(mail.calls[0].text).toMatch(/n’a pas été acceptée/);
    expect(mail.calls[0].text).toMatch(/contact@accesdirectaide\.fr/);
    expect(mail.calls[0].text).not.toMatch(/note interne|SIRET ne correspond/);
  });

  it('keeps the refusal when the mail fails, and sends nothing when there is no pending request', async () => {
    const { refuseSelfRegistration } = await import('../../api/_services/pro-self-registration.js');
    mail.fail = true;
    expect((await refuseSelfRegistration({ userId: 'u1', reason: 'motif suffisant' }, { email: 'a@example.test' }, { db: fakeDb(pending) })).ok).toBe(true);
    mail.fail = false; mail.calls = [];
    expect((await refuseSelfRegistration({ userId: 'u1', reason: 'motif suffisant' }, { email: 'a@example.test' }, { db: fakeDb(null) })).ok).toBe(false);
    expect(mail.calls).toHaveLength(0);
  });
});
