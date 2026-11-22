/**
 * A-15 remainder — the five account e-mails that had no template (Mon Parcours reminder, delegation invitation, e-mail change, restriction lift, ownership
 * recovery) are written in the person's stored language (REAL PostgreSQL, real services, an injected mailer that records the messages, synthetic accounts):
 * subject, plain text and HTML in that language, the French text kept below; French (or nothing stored) = exactly the French message as before (no HTML part
 * where there was none). The delegation invitation goes to an address that may have no account: that account's stored language, else the inviter's page
 * language, else French. Nothing new is stored.
 */
import { vi, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
// G14: proofs of the FORMER Mon Parcours contract (free titles, plan import, delegate read): reachable only in the test suites
// (api/lib/parcours-limited.js legacyContractAllowed). The limited contract has its own proof: tests/integration/g14-parcours-limited-db.test.js
process.env.ADA_PARCOURS_LEGACY_CONTRACT = 'test-only';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const H = 3600000;
const SRC = 'https://www.service-public.fr/particuliers/vosdroits/F1';
const PASSWORD = 'Synthetic-QA-Pass-01';
const addr = (k) => `a15n-${k}-${TS}@example.test`;
const U = {
  ar: { id: `a15n-ar-${TS}`, email: addr('ar'), lang: 'ar' }, fr: { id: `a15n-fr-${TS}`, email: addr('fr'), lang: null },
  de: { id: `a15n-de-${TS}`, email: addr('de'), lang: 'de' }, uk: { id: `a15n-uk-${TS}`, email: addr('uk'), lang: 'uk' }, en: { id: `a15n-en-${TS}`, email: addr('en'), lang: 'en' },
};
const OK = { accepted: true, delivered: true, provider: 'resend', outcome: 'PROVIDER_ACCEPTED' };

describe.skipIf(!hasDatabase)('A-15 remainder — account notices in the person’s language (real DB)', () => {
  let db, cat, sent;
  const sendMail = async (m) => { sent.push(m); return OK; };
  const to = (email) => sent.filter((m) => m.to === email);
  const subjectOf = (kind, lang) => cat.mailText(kind, lang).subject;

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); cat = await import('../../api/_utils/mail-catalogue.js');
    const { hashPassword } = await import('../../api/_utils/user-auth.js');
    const hash = await hashPassword(PASSWORD);
    for (const u of Object.values(U)) {
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, ${hash}, NOW(), NOW())`);
      if (u.lang) await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "preferredLanguage", "updatedAt") VALUES (${u.id}, ${u.lang}, NOW())`);
    }
  });
  beforeEach(() => { sent = []; });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email LIKE ${`a15n-%-${TS}@example.test`}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE email LIKE ${`a15n-%-${TS}-moved@example.test`}`);
  });

  it('Mon Parcours reminder: Arabic for the account that stores Arabic (HTML right-to-left, French text with the date kept); French account exactly as before', async () => {
    const { runParcoursReminders } = await import('../../api/_handlers/cron/parcours-reminder.js');
    const now = new Date(); const due = new Date(now.getTime() + 10 * H);
    for (const u of [U.ar, U.fr]) {
      await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "dueDate", "dueSourceUrl", "updatedAt") VALUES (${`a15n-i-${u.id}`}, ${u.id}, 'MANUAL', 'custom', 'Étape', ${due}, ${SRC}, NOW())`);
    }
    await runParcoursReminders({ now, deps: { sendMail, canNotify: async (_u, ch) => ch === 'email', sendToUser: async () => ({ status: 'NO_SUBSCRIPTION' }) } });
    const [ar] = to(U.ar.email); const [fr] = to(U.fr.email);
    expect(ar.subject).toBe(subjectOf('parcours_reminder', 'ar'));
    expect(ar.html).toMatch(/dir="rtl" lang="ar"/); expect(ar.html).toMatch(/lang="fr"/);
    expect(ar.text.startsWith(cat.mailText('parcours_reminder', 'ar').heading)).toBe(true);
    expect(ar.text).toMatch(/Une étape de votre parcours arrive à échéance le /);
    expect(fr.subject).toBe('Rappel : une étape de Mon Parcours arrive à échéance');
    expect(fr.text).toMatch(/^Une étape de votre parcours arrive à échéance le .*Connectez-vous à Mon Espace \(Mon Parcours\) pour la voir\.$/);
    expect(fr).not.toHaveProperty('html');
  });

  it('delegation invitation: no account → the inviter’s page language; an account → its stored language; neither → French exactly as before', async () => {
    const { inviteDelegate } = await import('../../api/_services/delegation.js');
    const deps = { sendMail, buildUrl: (p) => `http://localhost${p}`, db };
    const invite = (email, language) => inviteDelegate({ id: U.fr.id, email: U.fr.email }, { email, role: 'AIDANT', scopes: ['PARCOURS_READ'], days: 30, ...(language ? { language } : {}) }, deps);
    const stranger = addr('stranger'); const plain = addr('plain');
    expect((await invite(stranger, 'tr')).status).toBe(201);
    expect((await invite(U.de.email, 'tr')).status).toBe(201);
    expect((await invite(plain)).status).toBe(201);
    const [tr] = to(stranger); const [de] = to(U.de.email); const [fr] = to(plain);
    expect(tr.subject).toBe(subjectOf('delegation_invitation', 'tr'));
    expect(tr.text).toMatch(/vous propose de consulter une partie de son espace AccesDirectAide, en lecture seule, pendant 30 jours/);
    expect(tr.html).toContain('lang="tr"'); expect(tr.html).toContain('/compte/delegations?invitation=');
    expect(de.subject).toBe(subjectOf('delegation_invitation', 'de'));
    expect(fr.subject).toBe('Invitation : personne de confiance sur AccesDirectAide');
    expect(fr.text).toMatch(new RegExp(`^${U.fr.email.replace(/[.]/g, '\\.')} vous propose`));
    expect(fr).not.toHaveProperty('html');
  });

  it('e-mail change: the confirmation (new address) and the notice (current address) in the stored language; French unchanged', async () => {
    const { requestEmailChange } = await import('../../api/_services/email-change.js');
    const moved = `a15n-uk-${TS}-moved@example.test`;
    expect((await requestEmailChange(U.uk.id, { newEmail: moved, password: PASSWORD }, { send: sendMail })).ok).toBe(true);
    const [confirm] = to(moved); const [notice] = to(U.uk.email);
    expect(confirm.subject).toBe(subjectOf('email_change_confirm', 'uk'));
    expect(confirm.html).toContain('lang="uk"'); expect(confirm.html).toContain('Confirmer cette adresse');
    expect(confirm.text).toMatch(/Confirmez votre nouvelle adresse : http/);
    expect(notice.subject).toBe(subjectOf('email_change_notice', 'uk'));
    expect(notice.text.startsWith(cat.mailText('email_change_notice', 'uk').heading)).toBe(true);
    sent = [];
    const movedFr = `a15n-fr-${TS}-moved@example.test`;
    await requestEmailChange(U.fr.id, { newEmail: movedFr, password: PASSWORD }, { send: sendMail });
    expect(to(movedFr)[0].subject).toBe('Confirmez votre nouvelle adresse — Accès Direct Aide');
    expect(to(movedFr)[0].text).toMatch(/^Confirmez votre nouvelle adresse : http/);
    expect(to(U.fr.email)[0].subject).toBe('Demande de changement d’adresse — Accès Direct Aide');
    expect(to(U.fr.email)[0].text).toMatch(/^Une demande de changement de l’adresse e-mail/);
  });

  it('restriction lift (administrator): the notice in English for the account that stores English, the French reason kept; French account unchanged', async () => {
    const r = await import('../../api/_services/processing-restriction.js');
    for (const u of [U.en, U.fr]) expect((await r.requestRestriction(u.id, { ground: 'ACCURACY_CONTESTED' })).ok).not.toBe(false);
    const ids = async (u) => (await db.execute(sql`SELECT id FROM "DSRRequest" WHERE "subjectId" = ${u.id} AND "requestType" = ${r.REQUEST_TYPE} AND status = 'ACTIVE'`)).rows[0].id;
    const reason = 'Exactitude vérifiée avec la personne.';
    expect((await r.liftByController(await ids(U.en), { reason }, 'admin-a15', db, { sendMail })).ok).not.toBe(false);
    expect((await r.liftByController(await ids(U.fr), { reason }, 'admin-a15', db, { sendMail })).ok).not.toBe(false);
    const [en] = to(U.en.email); const [fr] = to(U.fr.email);
    expect(en.subject).toBe(subjectOf('restriction_lift', 'en'));
    expect(en.text).toMatch(/^End of the restriction of processing\n/); expect(en.text).toContain(`Raison : ${reason}`);
    expect(en.html).toContain('lang="en"');
    expect(fr.subject).toBe('Fin de la limitation du traitement de vos données');
    expect(fr.text).toMatch(/^L’équipe AccèsDirectAide va lever la limitation/);
    expect(fr).not.toHaveProperty('html');
  });

  it('ownership recovery (two administrators): the link to the new address and the notice to the former one in the stored language (German)', async () => {
    const pc = await import('../../api/_services/privacy-console.js');
    const next = `a15n-de-${TS}-moved@example.test`;
    const p = await pc.proposeRecovery({ currentEmail: U.de.email, newEmail: next, evidenceNote: 'Identité vérifiée au guichet avec une pièce présentée.' }, 'admin-a');
    expect(p.ok).toBe(true);
    const d = await pc.decideRecovery(p.id, { decision: 'APPROVE', note: 'Vérification conforme.' }, 'admin-b', db, { sendMail });
    expect(d.ok).toBe(true);
    const [link] = to(next); const [notice] = to(U.de.email);
    expect(link.subject).toBe(subjectOf('account_recovery', 'de'));
    expect(link.text).toMatch(/Notre équipe a rattaché votre compte à cette adresse/);
    expect(link.html).toContain('lang="de"'); expect(link.html).toContain('/api/auth/verify-email?token=');
    expect(notice.subject).toBe(subjectOf('account_recovery_notice', 'de'));
    expect(notice.text).toMatch(/L’adresse e-mail de votre compte Accès Direct Aide a été remplacée/);
  });

  it('ownership recovery for an account with no stored language: French exactly as before', async () => {
    const pc = await import('../../api/_services/privacy-console.js');
    const next = `a15n-fr-${TS}-moved2@example.test`;
    await db.execute(sql`UPDATE "CitizenUser" SET email = ${addr('fr2')} WHERE id = ${U.fr.id}`);
    const p = await pc.proposeRecovery({ currentEmail: addr('fr2'), newEmail: next, evidenceNote: 'Identité vérifiée au guichet avec une pièce présentée.' }, 'admin-a');
    await pc.decideRecovery(p.id, { decision: 'APPROVE', note: 'Vérification conforme.' }, 'admin-b', db, { sendMail });
    expect(to(next)[0].subject).toBe('Récupération de votre compte Accès Direct Aide');
    expect(to(next)[0].text).toMatch(/^Notre équipe a rattaché votre compte/);
    expect(to(next)[0]).not.toHaveProperty('html');
    expect(to(addr('fr2'))[0].subject).toBe('L’adresse de votre compte a été changée');
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U.fr.id}`);
  });
});
