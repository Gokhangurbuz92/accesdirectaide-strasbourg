/**
 * X04 (expansion) — academy pages and events on REAL PostgreSQL (migration 0053), through the real API entry (api/index.js: CSRF, routing, beta and
 * capability gates) with signed sessions:
 *   - CLOSED in the current Production configuration (restricted beta, surfaces admin + accounts) and in Production without the beta: every route of the
 *     « events » surface answers 503 before its handler, whoever asks; opening needs the « events » surface AND « community.events » listed;
 *   - editorial: no session 401, a write without MFA 403; draft → review → published (problems listed, entitlement wording refused), reject, cancel,
 *     withdraw (410); the public answer never names an editor;
 *   - registration: anonymous 401, adult accounts only, the accessibility need only with its explicit agreement, capacity (also under two concurrent
 *     requests for the last place), cancellation (the need erased), registering again;
 *   - organizer side: counts only, never a person; cross-account isolation;
 *   - reminder and cancellation in the notification centre (kind, time, link — no title, no place, no need);
 *   - DSR: export section, erasure (approved DSR) and purge step 6c delete the registrations.
 * Synthetic data only; skipped without DATABASE_URL.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429), rateLimitMiddleware: vi.fn() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: { incr: async () => 1, expire: async () => 1, get: async () => null, set: async () => 'OK', del: async () => 0 } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const u = (k) => ({ id: `x04-${k}-${TS}`, email: `x04-${k}-${TS}@example.test` });
const A = u('a'); const B = u('b'); const D = u('d'); const E = u('e'); const NODECL = u('nodecl'); const MINOR = u('minor');
const ADMIN = `x04-admin-${TS}@example.test`; const ADMIN2 = `x04-admin2-${TS}@example.test`;
const DAY = 86400e3;

function mkRes() {
  const headers = {}; const fin = [];
  return { statusCode: 200, body: null, headersSent: false, headers, on(e, l) { if (e === 'finish') fin.push(l); return this; },
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, writeHead(c, h) { this.statusCode = c; if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
    json(p) { this.body = p; fin.forEach((l) => l()); return this; }, send(p) { this.body = p; fin.forEach((l) => l()); return this; }, end(p) { if (p !== undefined) this.body = p; fin.forEach((l) => l()); return this; } };
}

const eventDraft = (over = {}) => ({ kind: 'EVENT', title: `Atelier accès aux droits ${TS}`, summary: 'Un atelier collectif pour comprendre les démarches en ligne et poser ses questions.',
  body: 'Atelier gratuit animé par une association du quartier.', organizerName: 'Association synthétique X04', startsAt: new Date(Date.now() + 10 * DAY).toISOString(),
  endsAt: new Date(Date.now() + 10 * DAY + 2 * 3600e3).toISOString(), venueName: 'Médiathèque synthétique', venueAddress: '1 rue de l’Exemple', venueCommune: 'Strasbourg',
  capacity: 2, accessibilityFeatures: ['STEP_FREE_ACCESS', 'LSF_INTERPRETATION'], accessibilityNote: 'Entrée de plain-pied côté parc.',
  translations: { en: { title: 'Rights access workshop', summary: 'A group workshop to understand online procedures and ask questions.', body: 'Free workshop.' } }, ...over });
const lessonDraft = () => ({ kind: 'LESSON', title: `Comprendre un courrier de la Caf ${TS}`, summary: 'Les rubriques d’un courrier et où trouver la date de réponse attendue.',
  body: 'Un courrier administratif contient en général une référence, une date, l’objet de la demande et ce qui est attendu de vous. '.repeat(4) });

describe.skipIf(!hasDatabase)('X04 academy and events (real DB, real API entry)', () => {
  let db; let api; let userAuth; let auth; let schema;
  const CSRF = 'x04csrftoken0123456789abcdef';
  const sessionOf = (x) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: x.id, email: x.email })).split(';')[0];
  const adminBearer = (email = ADMIN, mfa = true) => auth.signAdminSessionToken({ email, role: 'admin', mfa_verified: mfa });
  const call = async (method, url, { as, body, bearer } = {}) => {
    const cookies = [as ? sessionOf(as) : '', `__csrf=${CSRF}`].filter(Boolean).join('; ');
    const req = { method, url, query: Object.fromEntries(new URL(url, 'http://localhost').searchParams), body: body ?? null, cookies: {},
      headers: { host: 'localhost:5183', 'x-forwarded-proto': 'http', cookie: cookies, 'x-csrf-token': CSRF, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } };
    const res = mkRes(); await api(req, res); return res;
  };
  const admin = (method, body, opts = {}) => call(method, method === 'GET' ? `/api/admin/events${body || ''}` : '/api/admin/events', { bearer: opts.bearer ?? adminBearer(opts.email), body: method === 'GET' ? undefined : body });
  /** create → submit → approve; returns { id, slug } */
  const publish = async (draft) => {
    const c = await admin('POST', { action: 'save', draft }); expect(c.statusCode).toBe(201);
    expect((await admin('POST', { action: 'submit', id: c.body.id })).statusCode).toBe(200);
    const a = await admin('POST', { action: 'approve', id: c.body.id }, { email: ADMIN2 }); expect(a.statusCode, JSON.stringify(a.body)).toBe(200);
    return { id: c.body.id, slug: a.body.slug };
  };
  const withEnv = async (vars, fn) => {
    const keep = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    schema = await import('../../src/db/schema.js');
    api = (await import('../../api/index.js')).default;
    userAuth = await import('../../api/_utils/user-auth.js');
    auth = await import('../../api/_utils/auth.js');
    const { recordAgeDeclaration } = await import('../../api/_utils/age-policy.js');
    for (const x of [A, B, D, E, NODECL, MINOR]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${x.id}, ${x.email}, 'x', NOW(), NOW())`);
    for (const x of [A, B, D, E, MINOR]) await recordAgeDeclaration(x.id, { adult: true, channel: 'signup' }, db);
    await db.execute(sql`INSERT INTO "CitizenProfile" ("userId", "ageBand", "updatedAt") VALUES (${MINOR.id}, 'moins-de-18', NOW())`);
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    const ids = [A, B, D, E, NODECL, MINOR].map((x) => x.id);
    await db.execute(sql`DELETE FROM "AcademyItem" WHERE "createdBy" = ${ADMIN}`);
    await db.execute(sql`DELETE FROM "DSRRequest" WHERE "subjectId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).catch(() => {});
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  });

  describe('closed by default (fail-closed)', () => {
    const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts', ADA_CAPABILITIES_OPEN: '' };
    const probes = async () => [await call('GET', '/api/events?kind=EVENT'), await call('GET', '/api/events/un-evenement'), await call('GET', '/api/citizen/events', { as: A }),
      await call('POST', '/api/citizen/events', { as: A, body: { action: 'register', itemId: '00000000-0000-4000-8000-000000000000' } }),
      await call('GET', '/api/admin/events', { bearer: adminBearer() }), await call('POST', '/api/admin/events', { bearer: adminBearer(), body: { action: 'save', draft: eventDraft() } })];
    it('the current Production configuration (beta, admin + accounts open) refuses every events route 503 — admin and citizen sessions included', async () => {
      await withEnv(PROD_NOW, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body.error).toBe('PUBLIC_BETA_RESTRICTED'); } });
    });
    it('Production without the beta, or with the surface opened but the capability not listed: 503 CAPABILITY_NOT_OPEN, nothing read or written', async () => {
      for (const env of [{ VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '', ADA_CAPABILITIES_OPEN: 'citizen.household' },
        { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,events' }]) {
        await withEnv(env, async () => { for (const r of await probes()) { expect(r.statusCode).toBe(503); expect(r.body).toMatchObject({ error: 'CAPABILITY_NOT_OPEN', capability: 'community.events' }); } });
      }
      expect((await db.execute(sql`SELECT count(*)::int n FROM "AcademyItem" WHERE "createdBy" = ${ADMIN}`)).rows[0].n).toBe(0);
    });
    it('the deliberate opening (surface « events » AND « community.events » listed) serves the routes', async () => {
      await withEnv({ ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,events', ADA_CAPABILITIES_OPEN: 'community.events' }, async () => {
        const r = await call('GET', '/api/events?kind=EVENT'); expect(r.statusCode).toBe(200); expect(Array.isArray(r.body.items)).toBe(true);
      });
    });
  });

  describe('editorial', () => {
    it('no session 401; a write without MFA 403; a citizen session is not an administrator', async () => {
      expect((await call('GET', '/api/admin/events')).statusCode).toBe(401);
      expect((await call('GET', '/api/admin/events', { as: A })).statusCode).toBe(401);
      const r = await admin('POST', { action: 'save', draft: eventDraft() }, { bearer: adminBearer(ADMIN, false) });
      expect(r.statusCode).toBe(403); expect(r.body.error).toBe('HUMAN_MFA_SESSION_REQUIRED');
    });
    it('draft → review → approval refused with the missing items (accessibility, venue, entitlement wording); reject; complete → published', async () => {
      const bad = await admin('POST', { action: 'save', draft: eventDraft({ venueName: '', accessibilityFeatures: [], accessibilityNote: '', summary: 'Vous avez droit à une aide : venez nombreux à cet atelier.' }) });
      expect(bad.statusCode).toBe(201);
      expect(bad.body.problems).toEqual(expect.arrayContaining(['VENUE_REQUIRED', 'ACCESSIBILITY_INFORMATION_REQUIRED', 'ENTITLEMENT_WORDING']));
      expect((await admin('POST', { action: 'approve', id: bad.body.id })).body.error).toBe('NOT_IN_REVIEW');
      await admin('POST', { action: 'submit', id: bad.body.id });
      const refused = await admin('POST', { action: 'approve', id: bad.body.id });
      expect(refused.statusCode).toBe(422); expect(refused.body.problems).toContain('ACCESSIBILITY_INFORMATION_REQUIRED');
      expect((await admin('POST', { action: 'reject', id: bad.body.id, note: 'Compléter le lieu' })).body.status).toBe('draft');
      // never public while not approved
      expect((await call('GET', '/api/events?kind=EVENT')).body.items.map((i) => i.title)).not.toContain(eventDraft().title);
      const fixed = await admin('POST', { action: 'save', id: bad.body.id, draft: eventDraft() });
      expect(fixed.body.problems).toEqual([]);
      await admin('POST', { action: 'submit', id: bad.body.id });
      const ok = await admin('POST', { action: 'approve', id: bad.body.id });
      expect(ok.statusCode).toBe(200); expect(ok.body.slug).toMatch(/^atelier-acces-aux-droits-/);
      expect((await admin('POST', { action: 'save', id: bad.body.id, draft: eventDraft() })).body.error).toBe('PUBLISHED_ITEM_NOT_EDITABLE');
      const audit = await db.execute(sql`SELECT action FROM "AuditLog" WHERE entity = 'AcademyItem' AND entity_id = ${bad.body.id} ORDER BY timestamp`);
      expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['ACADEMY_CREATE', 'ACADEMY_SUBMIT', 'ACADEMY_REJECT', 'ACADEMY_APPROVE']));
    });
    it('the public list and page show the event, its accessibility information and places left — never who wrote or approved it', async () => {
      const list = (await call('GET', '/api/events?kind=EVENT')).body.items;
      const ev = list.find((i) => i.title === eventDraft().title);
      expect(ev).toMatchObject({ kind: 'EVENT', status: 'published', capacity: 2, remaining: 2, registrationOpen: true, venueCommune: 'Strasbourg' });
      expect(ev.accessibilityFeatures).toEqual(['STEP_FREE_ACCESS', 'LSF_INTERPRETATION']);
      const page = await call('GET', `/api/events/${ev.slug}`);
      expect(page.statusCode).toBe(200); expect(page.body.item.translations.en.title).toBe('Rights access workshop');
      const raw = JSON.stringify([list, page.body]);
      for (const secret of [ADMIN, ADMIN2, 'createdBy', 'approvedBy', 'reviewNote', '"id"']) expect(raw).not.toContain(secret);
      expect((await call('GET', '/api/events/inconnu-123')).statusCode).toBe(404);
    });
    it('a lesson: published, then withdrawn with a note → 410; the four-eyes rule refuses the author as approver when switched on', async () => {
      const { id, slug } = await publish(lessonDraft());
      expect((await call('GET', `/api/events/${slug}`)).body.item.kind).toBe('LESSON');
      expect((await call('GET', '/api/events?kind=LESSON')).body.items.map((i) => i.slug)).toContain(slug);
      expect((await admin('POST', { action: 'withdraw', id, note: 'court' })).body.error).toBe('WITHDRAWAL_NOTE_REQUIRED');
      expect((await admin('POST', { action: 'withdraw', id, note: 'Contenu remplacé par une page plus récente.' })).statusCode).toBe(200);
      expect((await call('GET', `/api/events/${slug}`)).statusCode).toBe(410);
      await withEnv({ ACADEMY_EDITORIAL_FOUR_EYES: 'on' }, async () => {
        const c = await admin('POST', { action: 'save', draft: lessonDraft() });
        await admin('POST', { action: 'submit', id: c.body.id });
        const r = await admin('POST', { action: 'approve', id: c.body.id });
        expect(r.statusCode).toBe(422); expect(r.body.problems).toContain('FOUR_EYES_APPROVER_IS_AUTHOR');
      });
    });
  });

  describe('registration, capacity, cancellation, isolation', () => {
    let ev;
    beforeAll(async () => { ev = await publish(eventDraft({ title: `Atelier capacité ${TS}` })); });
    const reg = (as, extra = {}) => call('POST', '/api/citizen/events', { as, body: { action: 'register', itemId: ev.id, ...extra } });
    it('anonymous 401; no adult declaration or the minor band 403; an unknown or consent-less need 400 — nothing stored', async () => {
      expect((await call('POST', '/api/citizen/events', { body: { action: 'register', itemId: ev.id } })).statusCode).toBe(401);
      for (const x of [NODECL, MINOR]) { const r = await reg(x); expect(r.statusCode).toBe(403); expect(r.body.error).toBe('ADULT_ACCOUNT_REQUIRED'); }
      expect((await reg(A, { accessibilityNeed: 'TEXTE LIBRE' })).body.error).toBe('UNKNOWN_ACCESSIBILITY_NEED');
      const noConsent = await reg(A, { accessibilityNeed: 'LSF_INTERPRETATION', accessibilityNeedConsent: 'true' });
      expect(noConsent.statusCode).toBe(400); expect(noConsent.body.error).toBe('NEED_CONSENT_REQUIRED');
      expect((await db.execute(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "itemId" = ${ev.id}`)).rows[0].n).toBe(0);
    });
    it('A registers with a need (explicit agreement), B without; a second registration 409; the event is then full', async () => {
      const a = await reg(A, { accessibilityNeed: 'LSF_INTERPRETATION', accessibilityNeedConsent: true });
      expect(a.statusCode).toBe(201); expect(a.body.accessibilityNeed).toBe('LSF_INTERPRETATION');
      expect((await reg(A)).body.error).toBe('ALREADY_REGISTERED');
      // the public page knows the event by its address: B registers by slug
      expect((await call('POST', '/api/citizen/events', { as: B, body: { action: 'register', slug: ev.slug } })).statusCode).toBe(201);
      const full = await reg(D); expect(full.statusCode).toBe(409); expect(full.body.error).toBe('EVENT_FULL');
      expect((await call('GET', `/api/events/${ev.slug}`)).body.item.remaining).toBe(0);
    });
    it('the organizer sees counts only: registered, remaining, one LSF need — no account, no e-mail', async () => {
      const r = await admin('GET', `?id=${ev.id}`);
      expect(r.body.attendance).toEqual({ capacity: 2, registered: 2, remaining: 0, needs: { LSF_INTERPRETATION: 1 } });
      const raw = JSON.stringify([r.body, (await admin('GET', '')).body]);
      for (const x of [A, B]) { expect(raw).not.toContain(x.id); expect(raw).not.toContain(x.email); }
    });
    it('each account sees only its own registrations and can only change its own', async () => {
      const mineA = (await call('GET', '/api/citizen/events', { as: A })).body.registrations;
      const mineB = (await call('GET', '/api/citizen/events', { as: B })).body.registrations;
      expect(mineA.find((r) => r.itemId === ev.id).accessibilityNeed).toBe('LSF_INTERPRETATION');
      expect(mineB.find((r) => r.itemId === ev.id).accessibilityNeed).toBeNull();
      expect(JSON.stringify(mineB)).not.toContain('LSF');
      expect((await call('GET', '/api/citizen/events', { as: D })).body.registrations).toEqual([]);
      expect((await call('POST', '/api/citizen/events', { as: D, body: { action: 'cancel', itemId: ev.id } })).statusCode).toBe(404);
      expect((await call('POST', '/api/citizen/events', { as: D, body: { action: 'need', itemId: ev.id, accessibilityNeed: null } })).statusCode).toBe(404);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "itemId" = ${ev.id} AND status = 'REGISTERED'`)).rows[0].n).toBe(2);
    });
    it('cancellation frees the place and erases the need; two concurrent requests for the last place: exactly one wins; registering again works', async () => {
      expect((await call('POST', '/api/citizen/events', { as: A, body: { action: 'cancel', itemId: ev.id } })).statusCode).toBe(200);
      const row = (await db.execute(sql`SELECT status, "accessibilityNeed", "accessibilityNeedAt", "cancelledAt" FROM "EventRegistration" WHERE "itemId" = ${ev.id} AND "citizenUserId" = ${A.id}`)).rows[0];
      expect(row).toMatchObject({ status: 'CANCELLED', accessibilityNeed: null, accessibilityNeedAt: null }); expect(row.cancelledAt).toBeTruthy();
      const both = await Promise.all([reg(D), reg(E)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "itemId" = ${ev.id} AND status = 'REGISTERED'`)).rows[0].n).toBe(2);
      const loser = both[0].statusCode === 409 ? D : E;
      expect((await call('POST', '/api/citizen/events', { as: B, body: { action: 'cancel', itemId: ev.id } })).statusCode).toBe(200);
      expect((await reg(loser)).statusCode).toBe(201);
      expect((await reg(B)).statusCode).toBe(409);   // full again
      // the need can be added later with its agreement, and removed
      expect((await call('POST', '/api/citizen/events', { as: loser, body: { action: 'need', itemId: ev.id, accessibilityNeed: 'QUIET_SPACE' } })).body.error).toBe('NEED_CONSENT_REQUIRED');
      expect((await call('POST', '/api/citizen/events', { as: loser, body: { action: 'need', itemId: ev.id, accessibilityNeed: 'QUIET_SPACE', accessibilityNeedConsent: true } })).statusCode).toBe(200);
      expect((await call('POST', '/api/citizen/events', { as: loser, body: { action: 'need', itemId: ev.id, accessibilityNeed: null } })).body.accessibilityNeed).toBeNull();
    });
    it('the database itself refuses a need outside the closed list and a need on a cancelled registration', async () => {
      const bad = (q) => q.then(() => 'ACCEPTED', (e) => `${e?.message} ${e?.cause?.message || ''}`);
      expect(await bad(db.execute(sql`UPDATE "EventRegistration" SET "accessibilityNeed" = 'diabète', "accessibilityNeedAt" = NOW() WHERE "itemId" = ${ev.id}`))).toMatch(/EventRegistration_need_check/);
      expect(await bad(db.execute(sql`UPDATE "EventRegistration" SET "accessibilityNeed" = 'QUIET_SPACE', "accessibilityNeedAt" = NOW() WHERE "itemId" = ${ev.id} AND status = 'CANCELLED'`))).toMatch(/EventRegistration_need_state_check/);
    });
  });

  describe('reminder and cancellation in the notification centre', () => {
    let soon;
    beforeAll(async () => {
      soon = await publish(eventDraft({ title: `Atelier demain ${TS}`, capacity: 10, startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + DAY + 3600e3).toISOString() }));
      expect((await call('POST', '/api/citizen/events', { as: A, body: { action: 'register', itemId: soon.id, accessibilityNeed: 'HEARING_LOOP', accessibilityNeedConsent: true } })).statusCode).toBe(201);
    });
    it('EVENT_REMINDER for the registered person only — kind, time, link; no title, place or need', async () => {
      const r = await call('GET', '/api/citizen/notifications', { as: A });
      const n = r.body.notifications.filter((x) => x.kind === 'EVENT_REMINDER');
      expect(n).toHaveLength(1); expect(n[0].link).toBe('/compte/evenements'); expect(Object.keys(n[0]).sort()).toEqual(['at', 'id', 'kind', 'link', 'unread']);
      const raw = JSON.stringify(r.body);
      for (const s of ['Atelier', 'Médiathèque', 'HEARING_LOOP', soon.id, soon.slug]) expect(raw).not.toContain(s);
      expect((await call('GET', '/api/citizen/notifications', { as: B })).body.notifications.filter((x) => x.kind.startsWith('EVENT_'))).toEqual([]);
    });
    it('the organizer cancels: EVENT_CANCELLED replaces the reminder; registration is closed; the public list marks it cancelled', async () => {
      expect((await admin('POST', { action: 'cancel', id: soon.id, note: 'Salle indisponible, atelier reporté.' })).statusCode).toBe(200);
      const kinds = (await call('GET', '/api/citizen/notifications', { as: A })).body.notifications.map((x) => x.kind);
      expect(kinds).toContain('EVENT_CANCELLED'); expect(kinds).not.toContain('EVENT_REMINDER');
      const r = await call('POST', '/api/citizen/events', { as: B, body: { action: 'register', itemId: soon.id } });
      expect(r.statusCode).toBe(409); expect(r.body.error).toBe('REGISTRATION_CLOSED');
      expect((await call('GET', '/api/events?kind=EVENT')).body.items.find((i) => i.slug === soon.slug)).toMatchObject({ status: 'cancelled', registrationOpen: false, remaining: 0 });
    });
  });

  describe('DSR export, erasure and purge step 6c', () => {
    it('the export of A lists A’s registrations with the chosen need, never another account’s', async () => {
      const r = await call('GET', '/api/auth/export-data', { as: A });
      expect(r.statusCode).toBe(200);
      const body = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
      expect(body.eventRegistrations.length).toBeGreaterThanOrEqual(2);
      expect(body.eventRegistrations.map((x) => x.accessibilityNeed)).toContain('HEARING_LOOP');
      const other = await call('GET', '/api/auth/export-data', { as: NODECL });
      expect((typeof other.body === 'string' ? JSON.parse(other.body) : other.body).eventRegistrations).toEqual([]);
    });
    it('an approved erasure deletes the person’s registrations (cascade), other accounts keep theirs', async () => {
      const before = (await db.execute(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "citizenUserId" <> ${A.id}`)).rows[0].n;
      const privacy = await import('../../api/_services/privacy.js');
      const svc = privacy.createPrivacyRightsService({ db, cryptoLib: await import('node:crypto') });
      const req = await svc.requestDeletion(A.id);
      await svc.updateDsrRequestStatus(req.id, 'APPROVED');
      await svc.executeApprovedDeletion(req.id);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "citizenUserId" = ${A.id}`)).rows[0].n).toBe(0);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE "citizenUserId" <> ${A.id}`)).rows[0].n).toBe(before);
    });
    it('purge step 6c (unverified accounts after 7 days) takes any registration row of such an account with it', async () => {
      const { PURGE_STEPS } = await import('../../api/_handlers/cron/gdpr-purge.js');
      const step = PURGE_STEPS.find((s) => s.id === 'unverifiedAccountsDeleted');
      const U = u('unverified');
      await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "createdAt", "updatedAt") VALUES (${U.id}, ${U.email}, 'x', NOW() - interval '9 days', NOW())`);
      const [ev] = (await db.execute(sql`SELECT id FROM "AcademyItem" WHERE status = 'published' AND kind = 'EVENT' AND "createdBy" = ${ADMIN} LIMIT 1`)).rows;
      await db.insert(schema.EventRegistration).values({ id: `x04-reg-${TS}`, itemId: ev.id, citizenUserId: U.id, status: 'REGISTERED', updatedAt: new Date() });
      const out = await step.run(db, { cutoff: () => new Date(Date.now() - 7 * DAY) }, { failures: [] });
      expect(out.count).toBeGreaterThanOrEqual(1);
      expect((await db.execute(sql`SELECT count(*)::int n FROM "EventRegistration" WHERE id = ${`x04-reg-${TS}`}`)).rows[0].n).toBe(0);
    });
  });
});
