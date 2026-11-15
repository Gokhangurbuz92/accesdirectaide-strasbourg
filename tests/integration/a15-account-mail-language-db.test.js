/**
 * A-15 — the account e-mails that have a translated template (verification link, password reset) are written in the person's language (REAL PostgreSQL, real
 * handlers, the in-memory « test » mail provider, synthetic accounts): the stored account language first; when none was ever chosen, the interface language of
 * the form the request came from; French otherwise. The French source text stays in the message (below the translated opening).
 */
import { vi, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const mail = (k) => `a15-${k}-${TS}@example.test`;
const AR = { id: `a15-ar-${TS}`, email: mail('ar') }, NONE = { id: `a15-none-${TS}`, email: mail('none') }, UNV = { id: `a15-unv-${TS}`, email: mail('unv') };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const SUBJECT = {
  reset: { fr: /^Réinitialisation de votre mot de passe/, ar: /^إعادة تعيين كلمة المرور/, en: /^Reset your password/ },
  verify: { fr: /^Bienvenue sur Accès Direct Aide/, tr: /hoş geldiniz/, de: /Willkommen/ },
};

describe.skipIf(!hasDatabase)('A-15 account e-mails in the person’s language (real DB)', () => {
  let db, mailer, after, forgot, resend, signup, service; const saved = {};
  let n = 0;
  const post = async (h, body) => { const r = mk(); await h({ method: 'POST', url: '/api/auth/x', headers: { host: 'localhost', 'x-forwarded-for': `10.15.${++n}.1` }, body }, r); await after.settleAfterResponse(); return r; };
  const sentTo = (to) => mailer.__getTestOutbox().filter((m) => m.to === to);

  beforeAll(async () => {
    for (const k of ['MAILER_PROVIDER', 'MAILER_FROM']) saved[k] = process.env[k];
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
    ({ db } = await import('../../src/db/index.js')); mailer = await import('../../api/_utils/mailer.js'); after = await import('../../api/_utils/after-response.js');
    forgot = (await import('../../api/_handlers/auth/forgot-password.js')).default; resend = (await import('../../api/_handlers/auth/resend-verification.js')).default;
    signup = (await import('../../api/_handlers/auth/signup.js')).default; service = await import('../../api/_services/mail-language.js');
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${AR.id}, ${AR.email}, 'x', NOW(), NOW()), (${NONE.id}, ${NONE.email}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "updatedAt") VALUES (${UNV.id}, ${UNV.email}, 'x', NOW())`);
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "preferredLanguage", "updatedAt") VALUES (${AR.id}, 'ar', NOW())`);
  });
  beforeEach(() => mailer.__clearTestOutbox());
  afterAll(async () => {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if (db) await db.execute(sql`DELETE FROM "CitizenUser" WHERE email LIKE ${`a15-%-${TS}@example.test`}`);
  });

  it('rule: stored language first; none stored → the request language; unknown or absent → French', async () => {
    expect(await service.accountMailLanguage(AR.id, 'en')).toBe('ar');
    expect(await service.accountMailLanguage(NONE.id, 'uk')).toBe('uk');
    expect(await service.accountMailLanguage(NONE.id, 'xx')).toBe('fr');
    expect(await service.accountMailLanguage(NONE.id, undefined)).toBe('fr');
    expect(await service.accountMailLanguage('no-such-account', 'de-AT')).toBe('de');
  });

  it('password reset: Arabic for the account that stores Arabic (whatever the page), with the French source text kept', async () => {
    expect((await post(forgot, { email: AR.email, language: 'en' })).statusCode).toBe(200);
    const [m] = sentTo(AR.email);
    expect(m.subject).toMatch(SUBJECT.reset.ar);
    expect(m.html).toMatch(/dir="rtl" lang="ar"/); expect(m.html).toMatch(/lang="fr"/);
    expect(m.text).toMatch(/Lien de reinitialisation: http/);
    expect(m.text.split('\n')[0]).not.toMatch(/[A-Za-z]{6,}/);   // the plain text opens in Arabic
  });

  it('password reset: no stored language → the language of the form; no language at all → French exactly as before', async () => {
    await post(forgot, { email: NONE.email, language: 'en' });
    expect(sentTo(NONE.email)[0].subject).toMatch(SUBJECT.reset.en);
    mailer.__clearTestOutbox();
    await post(forgot, { email: NONE.email });
    const [fr] = sentTo(NONE.email);
    expect(fr.subject).toMatch(SUBJECT.reset.fr);
    expect(fr.text).toMatch(/^Lien de reinitialisation: http/);
  });

  it('verification link: sign-up in Turkish → Turkish e-mail; « resend » from a German page → German; without a language → French', async () => {
    const fresh = mail('new');
    const r = await post(signup, { email: fresh, password: 'Synthetic-QA-Pass-01', next: '/', adultDeclaration: true, termsAccepted: true, language: 'tr' });
    expect(r.statusCode).toBeLessThan(300);
    expect(sentTo(fresh)[0].subject).toMatch(SUBJECT.verify.tr);
    expect(sentTo(fresh)[0].text).toMatch(/Lien de verification: http/);
    await post(resend, { email: UNV.email, next: '/', language: 'de' });
    expect(sentTo(UNV.email)[0].subject).toMatch(SUBJECT.verify.de);
    mailer.__clearTestOutbox();
    await post(resend, { email: UNV.email, next: '/' });
    expect(sentTo(UNV.email)[0].subject).toMatch(SUBJECT.verify.fr);
  });

  it('the language of a request never changes who receives the message or what the answer says', async () => {
    const a = await post(forgot, { email: `a15-nobody-${TS}@example.test`, language: 'ar' });
    const b = await post(forgot, { email: `a15-nobody-${TS}@example.test` });
    expect(a.body).toEqual(b.body);
    expect(mailer.__getTestOutbox()).toHaveLength(0);
  });
});
