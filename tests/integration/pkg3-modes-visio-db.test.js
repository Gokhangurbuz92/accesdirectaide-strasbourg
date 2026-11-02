/**
 * PKG-3 batch 2 on REAL PostgreSQL (migrations 0020 + 0021), through the real handlers:
 *  modalities  IN_PERSON / VIDEO offered per structure x service x video activation; slots per modality from the opening periods that serve it; video is never offered
 *              while the provider is off; a VIDEO booking needs the person's explicit agreement; the modality persists, is kept on a move and changes only on request
 *  video       join only for the person of the appointment or a member of its structure, after the structure's approval and with the person's agreement, inside the time
 *              window, while the provider is activated (never in production without approval); room-bound, time-bound HS256 token without personal data, recording off;
 *              a withdrawn approval invalidates the room; the database refuses video state on an in-person appointment
 *  notices     cancellations, moves, structure-created bookings and J-1 reminders are recorded honestly per recipient / channel; reminders reach citizen-booked
 *              appointments and respect the e-mail reminder preference; no meeting link is ever sent
 *  B08 / B03   a structure-created appointment needs the recorded agreement of the person, honours time off and takes the booking lock
 *  B10         Outlook OFF by default; signed state bound to the initiating professional; one strict token format; a legacy row means "reconnect"; agenda .ics export
 * Synthetic data only; the mailer is the in-memory 'test' provider; Microsoft is an in-process fake (no network). Skipped without DATABASE_URL.
 */
import crypto from 'node:crypto';
import { vi, afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../api/_utils/pipelineLock.js', () => ({ withLock: async (_name, fn) => fn() }));   // the cron's distributed lock is infrastructure (KV), not under test here
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: vi.fn().mockReturnValue('127.0.0.1'), getRateLimitStatus: vi.fn().mockReturnValue(429) }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ST = `p3m-st-${TS}`; const ST2 = `p3m-st2-${TS}`; const SLUG = `p3m-${TS}`;
const SV_IP = `p3m-ip-${TS}`; const SV_BOTH = `p3m-both-${TS}`;
const C = { id: `p3m-c-${TS}`, email: `p3m-c-${TS}@example.test` }; const C2 = { id: `p3m-c2-${TS}`, email: `p3m-c2-${TS}@example.test` };
const PRO = { id: `p3m-pro-${TS}`, email: `p3m-pro-${TS}@example.test` }; const PRO_B = { id: `p3m-prob-${TS}`, email: `p3m-prob-${TS}@example.test` }; const PRO2 = { id: `p3m-pro2-${TS}`, email: `p3m-pro2-${TS}@example.test` };
const SECRET = 'v'.repeat(40);
const VIDEO_ON = { VIDEO_PROVIDER: 'jitsi-jwt', VIDEO_JITSI_DOMAIN: 'video.lab.invalid', VIDEO_JITSI_APP_ID: 'ada-lab', VIDEO_JITSI_SECRET: SECRET, VIDEO_SANDBOX: 'true' };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end() { return this; } });
const setEnv = (o) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const VIDEO_KEYS = Object.keys(VIDEO_ON).concat(['VIDEO_PRODUCTION_APPROVED']);

describe.skipIf(!hasDatabase)('PKG-3 batch 2 — modalities, video, notices, Outlook (real DB)', () => {
  let db, rdv, proAppts, proVisio, proCancel, proIcs, outlook, callback, cron, userAuth, auth, mailer, citizen;
  const cookie = (u) => userAuth.buildUserSessionCookie(userAuth.signUserSessionToken({ userId: u.id, email: u.email })).split(';')[0];
  const bearer = (p, structureId = ST, role = 'STRUCTURE_ADMIN', mfa = false) => `Bearer ${auth.signProToken({ id: p.id, email: p.email, structureId, role }, { mfa })}`;
  const callRdv = async ({ method = 'GET', path, query = {}, body, as }) => { const r = mk(); await rdv({ method, url: `/api/rdv/${path}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http', ...(as ? { cookie: cookie(as) } : {}) } }, r); return r; };
  const callPro = async (h, { method = 'GET', url = '/api/pro/x', query = {}, body, as = PRO, structureId = ST, mfa = false }) => { const r = mk(); await h({ method, url, query, body, headers: { host: 'localhost', authorization: bearer(as, structureId, 'STRUCTURE_ADMIN', mfa) } }, r); return r; };
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const slots = async (serviceId, mode, as = C) => callRdv({ path: `structures/${SLUG}/slots`, query: { serviceId, from: day(3), to: day(6), ...(mode ? { mode } : {}) }, as });
  const book = (serviceId, startAt, extra = {}, as = C) => callRdv({ method: 'POST', path: 'appointments', as, body: { structureSlug: SLUG, serviceId, startAt, idempotencyKey: crypto.randomUUID(), ...extra } });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "ProAppointment" WHERE id = ${id}`)).rows[0];
  const notices = async (id) => (await db.execute(sql`SELECT kind, recipient, channel, status FROM "AppointmentNotice" WHERE "appointmentId" = ${id} ORDER BY "createdAt", kind, recipient, channel`)).rows;
  const hours = (d) => new Date(d).getUTCHours();

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    userAuth = await import('../../api/_utils/user-auth.js'); auth = await import('../../api/_utils/auth.js'); mailer = await import('../../api/_utils/mailer.js');
    citizen = await import('../../api/_services/citizen-account.js');
    rdv = (await import('../../api/_handlers/rdv.js')).default;
    proAppts = (await import('../../api/_handlers/pro/appointments.js')).default; proVisio = (await import('../../api/_handlers/pro/appointments/visio.js')).default;
    proCancel = (await import('../../api/_handlers/pro/appointments/cancel.js')).default; proIcs = (await import('../../api/_handlers/pro/appointments/ics.js')).default;
    outlook = (await import('../../api/_handlers/pro/outlook.js')).default; callback = (await import('../../api/_handlers/auth/outlook-callback.js')).default;
    cron = (await import('../../api/_handlers/cron/rdv-reminder.js')).default;
    for (const [id, slug, nom] of [[ST, SLUG, 'Accueil Modalités'], [ST2, `${SLUG}-b`, 'Autre structure']]) {
      await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
        VALUES (${id}, ${nom}, ${slug}, 'association', '12 rue de la Mésange', 'Strasbourg', '67000', true, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    }
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "updatedAt") VALUES (${'set-' + TS}, ${ST}, true, 'BOTH', NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", modes, "updatedAt") VALUES (${SV_IP}, ${ST}, 'Accueil sur place', 30, ARRAY['IN_PERSON'], NOW()), (${SV_BOTH}, ${ST}, 'Entretien', 30, ARRAY['IN_PERSON','VIDEO'], NOW())`);
    for (let wd = 0; wd <= 6; wd += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, modes, "updatedAt") VALUES (${`am-${wd}-${TS}`}, ${ST}, ${wd}, '09:00', '11:00', 'Europe/Paris', ARRAY['IN_PERSON'], NOW()), (${`pm-${wd}-${TS}`}, ${ST}, ${wd}, '14:00', '16:00', 'Europe/Paris', ARRAY['VIDEO'], NOW())`);
    }
    for (const u of [C, C2]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${u.id}, ${u.email}, 'x', NOW(), NOW())`);
    for (const [p, st, mail] of [[PRO, ST, true], [PRO_B, ST, false], [PRO2, ST2, false]]) {
      await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${p.id}, ${p.email}, 'x', 'STRUCTURE_ADMIN', 'active', ${st}, ${mail}, NOW())`);
    }
    process.env.MAILER_PROVIDER = 'test'; process.env.MAILER_FROM = 'qa@example.test';
  }, 60000);
  afterEach(() => setEnv(Object.fromEntries(VIDEO_KEYS.map((k) => [k, undefined]))));
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" IN (${ST}, ${ST2})`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${ST}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${ST}`);
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${ST}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" IN (${ST}, ${ST2})`);
    await db.execute(sql`DELETE FROM "ProOutlookToken" WHERE "userId" IN (${PRO.id}, ${PRO_B.id}, ${PRO2.id})`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE id IN (${PRO.id}, ${PRO_B.id}, ${PRO2.id})`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id IN (${ST}, ${ST2})`);
    await db.execute(sql`DELETE FROM "ConsentLog" WHERE subject_id IN (${C.id}, ${C2.id})`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${C.id}, ${C2.id})`);
  });

  it('video OFF (default): no service, slot or booking is offered in VIDEO; the screen is told why', async () => {
    const s = await callRdv({ path: `structures/${SLUG}/services`, as: C });
    expect(s.statusCode).toBe(200);
    expect(s.body.structure.modes).toEqual(['IN_PERSON']); expect(s.body.video).toEqual({ available: false, sandbox: false, reason: 'NOT_CONFIGURED' });
    expect(s.body.items.every((i) => !i.modes.includes('VIDEO'))).toBe(true);
    expect((await slots(SV_BOTH, 'VIDEO')).body.code).toBe('MODE_UNAVAILABLE');
    const ip = (await slots(SV_BOTH)).body.slots; expect(ip.length).toBeGreaterThan(0);
    expect((await book(SV_BOTH, ip[0].startAt, { mode: 'VIDEO', videoConsent: true })).body.code).toBe('MODE_UNAVAILABLE');
  });

  it('video ON (LAB sandbox): modalities per service, slots only from the periods that serve the modality, explicit agreement for video, modality and verified address persisted', async () => {
    setEnv(VIDEO_ON);
    const s = await callRdv({ path: `structures/${SLUG}/services`, query: { mode: 'VIDEO' }, as: C });
    expect(s.body.structure.modes).toEqual(['IN_PERSON', 'VIDEO']); expect(s.body.video).toMatchObject({ available: true, sandbox: true });
    expect(s.body.items.map((i) => i.id)).toEqual([SV_BOTH]);   // the in-person-only service is not offered in video
    expect(s.body.structure.location).toEqual({ address: '12 rue de la Mésange, 67000 Strasbourg', verified: true, stepFreeAccess: true });
    expect((await slots(SV_IP, 'VIDEO')).body.code).toBe('MODE_UNAVAILABLE');
    const ip = (await slots(SV_BOTH, 'IN_PERSON')).body.slots; const vid = (await slots(SV_BOTH, 'VIDEO')).body.slots;
    const paris = (iso) => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Paris' }).format(new Date(iso)));
    expect(ip.every((x) => paris(x.startAt) < 12)).toBe(true); expect(vid.every((x) => paris(x.startAt) >= 14)).toBe(true);
    expect((await book(SV_BOTH, vid[0].startAt, { mode: 'VIDEO' })).body.code).toBe('VIDEO_CONSENT_REQUIRED');
    expect((await book(SV_BOTH, ip[0].startAt, { mode: 'VIDEO', videoConsent: true })).statusCode, 'a morning (in-person) slot is not a video slot').toBe(409);
    const v = await book(SV_BOTH, vid[0].startAt, { mode: 'VIDEO', videoConsent: true });
    expect(v.statusCode, JSON.stringify(v.body)).toBe(201); expect(v.body).toMatchObject({ mode: 'VIDEO', location: null, video: { approved: false, consent: true } });
    expect(v.body.calendar.content).toContain('LOCATION:À distance (visio)'); expect(v.body.calendar.content).not.toMatch(/https?:\/\/video\.lab\.invalid|[?&#;]jwt=/i); expect(v.body.calendar.content, 'no JWT (header.payload.) in the calendar').not.toMatch(/eyJ[\w-]+\.eyJ[\w-]+\./);   // a bare /jwt/i also matched the random base64url confirmation token in the manage link (~0.5 % of runs)
    const p = await book(SV_IP, ip[0].startAt);   // no mode = in person (historical behaviour)
    expect(p.statusCode).toBe(201); expect(p.body.mode).toBe('IN_PERSON'); expect(p.body.location.address).toBe('12 rue de la Mésange, 67000 Strasbourg');
    expect(p.body.calendar.content).toContain('LOCATION:12 rue de la Mésange\\, 67000 Strasbourg');
    expect((await row(v.body.id)).mode).toBe('VIDEO'); expect((await row(p.body.id)).mode).toBe('IN_PERSON');
    const mail = mailer.__getTestOutbox().filter((m) => m.to === C.email && /Confirmation/.test(m.subject));
    expect(mail.some((m) => m.text.includes('À distance (visio)') && !/https?:\/\/video/.test(m.text))).toBe(true);
    expect(mail.some((m) => m.text.includes('En présentiel') && m.text.includes('12 rue de la Mésange'))).toBe(true);
  });

  it('video join: approval, agreement, participants, time window, activation; the token is room- and time-bound, without personal data, recording off', async () => {
    setEnv(VIDEO_ON);
    const vid = (await slots(SV_BOTH, 'VIDEO')).body.slots;
    const a = (await book(SV_BOTH, vid[vid.length - 1].startAt, { mode: 'VIDEO', videoConsent: true })).body;
    const joinC = (as = C) => callRdv({ method: 'POST', path: `appointments/${a.id}/visio`, as, body: { action: 'join' } });
    const proV = (action, as = PRO, structureId = ST) => callPro(proVisio, { method: 'POST', body: { appointmentId: a.id, action }, as, structureId });
    expect((await joinC()).body.code).toBe('VIDEO_NOT_APPROVED');
    expect((await proV('approve', PRO2, ST2)).statusCode, 'another structure').toBe(404);
    expect((await proV('approve')).statusCode).toBe(200);
    const room1 = (await row(a.id)).visioRoomId; expect(room1).toBeTruthy();
    expect((await joinC()).body.code).toBe('VIDEO_NOT_OPEN_YET');
    await db.execute(sql`UPDATE "ProAppointment" SET "startAt" = NOW() + interval '5 minutes', "endAt" = NOW() + interval '35 minutes' WHERE id = ${a.id}`);
    expect((await joinC(C2)).statusCode, 'another person').toBe(404);
    const ok = await joinC(); expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200); expect(ok.headers['cache-control']).toBe('no-store');
    const { jwt, roomName, domain, sandbox } = ok.body.join;
    expect(domain).toBe('video.lab.invalid'); expect(sandbox).toBe(true); expect(roomName).toMatch(/^ada[0-9a-f]{40}$/);
    const [h, b, sig] = jwt.split('.');
    expect(crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')).toBe(sig);
    const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
    expect(claims).toMatchObject({ aud: 'jitsi', iss: 'ada-lab', sub: 'video.lab.invalid', room: roomName, context: { user: { moderator: false }, features: { recording: false, livestreaming: false, transcription: false } } });
    expect(claims.exp * 1000).toBeLessThanOrEqual(new Date((await row(a.id)).endAt).getTime() + 15 * 60000 + 1000);
    expect(JSON.stringify(claims)).not.toMatch(new RegExp(`${C.email}|${C.id}|Mésange|Entretien|${a.id}`));
    expect((await proV('join')).body.join.jwt).toBeTruthy();
    expect((await proV('join', PRO2, ST2)).statusCode).toBe(404);
    expect((await proV('revoke')).statusCode).toBe(200); expect((await joinC()).body.code).toBe('VIDEO_NOT_APPROVED');
    await proV('approve'); expect((await row(a.id)).visioRoomId, 'a new approval draws a new room').not.toBe(room1);
    await callRdv({ method: 'POST', path: `appointments/${a.id}/visio`, as: C, body: { action: 'withdraw' } }); expect((await joinC()).body.code).toBe('VIDEO_NO_CONSENT');
    await callRdv({ method: 'POST', path: `appointments/${a.id}/visio`, as: C, body: { action: 'consent' } }); expect((await joinC()).statusCode).toBe(200);
    setEnv({ VERCEL_ENV: 'production', VIDEO_SANDBOX: undefined }); expect((await joinC()).body.code, 'production without approval').toBe('VIDEO_DISABLED'); setEnv({ VERCEL_ENV: 'development' });
    setEnv({ VIDEO_PROVIDER: 'off' }); expect((await joinC()).body.code).toBe('VIDEO_DISABLED'); setEnv(VIDEO_ON);
    const n = await notices(a.id); expect(n.filter((x) => x.kind === 'VISIO_APPROVED' && x.recipient === 'citizen').length).toBeGreaterThanOrEqual(1);
    expect(mailer.__getTestOutbox().filter((m) => m.to === C.email && /visio/i.test(m.subject)).every((m) => !/https?:\/\/video|jwt|ada[0-9a-f]{40}/.test(m.text))).toBe(true);
    let code = null; try { await db.execute(sql`UPDATE "ProAppointment" SET mode = 'IN_PERSON' WHERE id = ${a.id}`); } catch (e) { code = e.cause?.code || e.code; }
    expect(code, 'video state on an in-person appointment is refused by the database').toBe('23514');
    await callRdv({ method: 'POST', path: `appointments/${a.id}/cancel`, as: C, body: {} }); expect((await joinC()).body.code).toBe('APPOINTMENT_NOT_ACTIVE');
  });

  it('a move keeps the modality; another modality only on request, if offered, with agreement for video; changing it withdraws the video approval', async () => {
    setEnv(VIDEO_ON);
    const ip = (await slots(SV_BOTH, 'IN_PERSON')).body.slots; const vid = (await slots(SV_BOTH, 'VIDEO')).body.slots;
    const a = (await book(SV_BOTH, ip[1].startAt, {}, C2)).body;
    const kept = await callRdv({ method: 'POST', path: `appointments/${a.id}/reschedule`, as: C2, body: { startAt: ip[2].startAt } });
    expect(kept.statusCode).toBe(200); expect(kept.body.mode).toBe('IN_PERSON');
    expect((await callRdv({ method: 'POST', path: `appointments/${a.id}/reschedule`, as: C2, body: { startAt: ip[3].startAt, mode: 'VIDEO' } })).body.code).toBe('VIDEO_CONSENT_REQUIRED');
    expect((await callRdv({ method: 'POST', path: `appointments/${a.id}/reschedule`, as: C2, body: { startAt: ip[3].startAt, mode: 'VIDEO', videoConsent: true } })).statusCode, 'an in-person slot is not a video slot').toBe(409);
    const v = await callRdv({ method: 'POST', path: `appointments/${a.id}/reschedule`, as: C2, body: { startAt: vid[1].startAt, mode: 'VIDEO', videoConsent: true } });
    expect(v.statusCode, JSON.stringify(v.body)).toBe(200); expect(v.body.mode).toBe('VIDEO'); expect(v.body.video).toMatchObject({ approved: false, consent: true });
    expect((await row(a.id)).rescheduleCount).toBe(2);
    // R13 (N05): the move e-mail's calendar file updates the SAME event: same UID, SEQUENCE = number of moves, iTIP PUBLISH from the sending address
    const moves = mailer.__getTestOutbox().filter((x) => x.to === C2.email && /déplacé/.test(x.subject)).map((x) => x.attachments[0]);
    expect(moves.map((x) => x.content.match(/\r\nSEQUENCE:(\d+)\r\n/)[1])).toEqual(['1', '2']);
    expect(new Set(moves.map((x) => x.content.match(/\r\nUID:([^\r]+)\r\n/)[1]))).toEqual(new Set([`${a.id}@accesdirectaide.fr`]));
    expect(moves.every((x) => x.contentType === 'text/calendar; method=PUBLISH; charset=utf-8' && x.content.includes('\r\nMETHOD:PUBLISH\r\n'))).toBe(true);
    const o = await book(SV_IP, ip[4].startAt, {}, C2);
    expect((await callRdv({ method: 'POST', path: `appointments/${o.body.id}/reschedule`, as: C2, body: { startAt: vid[2].startAt, mode: 'VIDEO', videoConsent: true } })).body.code, 'service offers no video').toBe('MODE_UNAVAILABLE');
    const n = await notices(a.id); expect(n.filter((x) => x.kind === 'RESCHEDULED').map((x) => `${x.recipient}/${x.channel}`)).toEqual(expect.arrayContaining(['citizen/email', 'structure/in_app', 'structure/email']));
  });

  it('notices: cancellation by the person tells the structure; cancellation by the structure tells the person with a calendar CANCEL; outcomes are recorded honestly', async () => {
    const ip = (await slots(SV_IP)).body.slots;
    const a = (await book(SV_IP, ip[5].startAt)).body;
    mailer.__clearTestOutbox();
    await callRdv({ method: 'POST', path: `appointments/${a.id}/cancel`, as: C, body: {} });
    expect(await notices(a.id)).toEqual(expect.arrayContaining([
      { kind: 'CANCELLED_BY_CITIZEN', recipient: 'structure', channel: 'in_app', status: 'DELIVERED' },
      { kind: 'CANCELLED_BY_CITIZEN', recipient: 'structure', channel: 'email', status: 'TEST_RECORDED' },   // PKG-4: the in-memory test outbox is TEST_RECORDED, never DELIVERED (nothing reached a real mailbox)
      { kind: 'CANCELLED_BY_CITIZEN', recipient: 'citizen', channel: 'email', status: 'TEST_RECORDED' }]));
    const proMail = mailer.__getTestOutbox().filter((m) => m.to === PRO.email); expect(proMail.length).toBe(1); expect(proMail[0].text).not.toContain(C.email);
    expect(mailer.__getTestOutbox().filter((m) => m.to === PRO_B.email), 'e-mail notifications off for this member').toEqual([]);
    expect((await db.execute(sql`SELECT count(*)::int n FROM "ProNotification" WHERE "userId" = ${PRO_B.id} AND type = 'rdv_cancelled_by_citizen'`)).rows[0].n).toBeGreaterThan(0);
    const again = await callRdv({ method: 'POST', path: `appointments/${a.id}/cancel`, as: C, body: {} });
    expect(again.statusCode).toBe(200); expect((await notices(a.id)).length, 'cancelling twice notifies once').toBe(3);
    const b = (await book(SV_IP, ip[6].startAt)).body;
    await citizen.setPreference(C.id, { channel: 'email', category: 'service', enabled: false });
    await callPro(proCancel, { method: 'POST', body: { id: b.id } });
    expect(await notices(b.id)).toEqual([{ kind: 'CANCELLED_BY_STRUCTURE', recipient: 'citizen', channel: 'email', status: 'NO_CONSENT' }]);
    await citizen.setPreference(C.id, { channel: 'email', category: 'service', enabled: true });
    const c = (await book(SV_IP, ip[7].startAt)).body; mailer.__clearTestOutbox();
    await callPro(proCancel, { method: 'POST', body: { id: c.id } });
    const m = mailer.__getTestOutbox().find((x) => x.to === C.email); expect(m.attachments[0].content).toContain('STATUS:CANCELLED');
    // R13 (N05): sent from a real address, the file is an iTIP CANCEL from it (ORGANIZER) to this person (ATTENDEE), with the same method in its Content-Type
    const unfolded = m.attachments[0].content.replace(/\r\n[ \t]/g, '');
    expect(unfolded).toContain('\r\nMETHOD:CANCEL\r\n'); expect(unfolded).toContain(`:mailto:${process.env.MAILER_FROM}\r\n`); expect(unfolded).toContain(`\r\nATTENDEE:mailto:${C.email}\r\n`);
    expect(m.attachments[0].contentType).toBe('text/calendar; method=CANCEL; charset=utf-8');
    // without a sending address: never half an iTIP message — a snapshot (no METHOD, no ORGANIZER), still STATUS:CANCELLED
    const saved = process.env.MAILER_FROM; delete process.env.MAILER_FROM;
    try {
      const c2 = (await book(SV_IP, ip[7].startAt)).body; mailer.__clearTestOutbox();   // the slot cancelled just above is free again
      await callPro(proCancel, { method: 'POST', body: { id: c2.id } });
      const m2 = mailer.__getTestOutbox().find((x) => x.to === C.email);
      expect(m2.attachments[0].content).toContain('STATUS:CANCELLED'); expect(m2.attachments[0].content).not.toContain('METHOD:'); expect(m2.attachments[0].content).not.toContain('ORGANIZER');
      expect(m2.attachments[0].contentType).toBe('text/calendar; charset=utf-8');
    } finally { process.env.MAILER_FROM = saved; }
  });

  it('B08 / B03: a structure-created appointment needs the recorded agreement of the person, honours time off, is notified, and the professional sees modality and moves', async () => {
    const ip = (await slots(SV_IP)).body.slots;
    const body = { serviceId: SV_IP, startAt: ip[8].startAt, beneficiaryName: 'Personne QA', beneficiaryPhone: '0600000000' };
    expect((await callPro(proAppts, { method: 'POST', body })).body.error).toBe('PERSON_CONSENT_REQUIRED');
    await db.execute(sql`INSERT INTO "ProTimeOff" (id, "structureId", "startAt", "endAt", reason, "updatedAt") VALUES (${'off-' + TS}, ${ST}, ${new Date(ip[9].startAt)}, ${new Date(new Date(ip[9].startAt).getTime() + 1800000)}, 'QA', NOW())`);
    expect((await callPro(proAppts, { method: 'POST', body: { ...body, startAt: ip[9].startAt, personConsent: true } })).statusCode, 'time off').toBe(409);
    const ok = await callPro(proAppts, { method: 'POST', body: { ...body, personConsent: true } });
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(201); expect(ok.body.item).toMatchObject({ mode: 'IN_PERSON', origin: 'STRUCTURE' }); expect(ok.body.item.beneficiaryConsentAt).toBeTruthy();
    expect((await book(SV_IP, ip[8].startAt)).statusCode, 'the slot is taken for citizens too').toBe(409);
    expect(await notices(ok.body.item.id)).toEqual(expect.arrayContaining([{ kind: 'BOOKED_BY_STRUCTURE', recipient: 'citizen', channel: 'email', status: 'NO_RECIPIENT' }]));
    const moved = (await book(SV_IP, ip[10].startAt)).body;
    await callRdv({ method: 'POST', path: `appointments/${moved.id}/reschedule`, as: C, body: { startAt: ip[11].startAt } });
    const list = await callPro(proAppts, { query: { id: moved.id } });
    expect(list.body.items[0]).toMatchObject({ id: moved.id, mode: 'IN_PERSON', modeLabel: 'En présentiel', origin: 'CITIZEN', rescheduleCount: 1 });
    expect(list.body.items[0].notices.some((n) => n.kind === 'RESCHEDULED')).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/visioRoomId|idempotencyKey|citizenEmailSnapshot/);
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE id = ${'off-' + TS}`);
  });

  it('B06: the J-1 reminder reaches citizen-booked appointments with the modality, respects the e-mail reminder preference and sends no link', async () => {
    // « demain » of the Paris calendar, like the reminder (servers run in UTC: between 23:00 and 24:00 UTC the UTC « tomorrow » is the Paris « today »)
    const tomorrow = new Date((await import('../../api/_services/appointment-notices.js')).parisDayWindow(new Date(), 1).start.getTime() + 12 * 3600000);
    const id1 = `p3m-r1-${TS}`; const id2 = `p3m-r2-${TS}`;
    for (const [id, who] of [[id1, C], [id2, C2]]) {
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "citizenUserId", mode, "updatedAt") VALUES (${id}, ${ST}, ${SV_IP}, ${tomorrow}, ${new Date(tomorrow.getTime() + 1800000)}, 'confirmed', 'Particulier', ${who.id}, 'IN_PERSON', NOW())`);
    }
    await citizen.setPreference(C2.id, { channel: 'email', category: 'reminder', enabled: false });
    mailer.__clearTestOutbox();
    const r = mk(); await cron({ method: 'GET', url: '/api/cron/rdv-reminder', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    const m = mailer.__getTestOutbox().filter((x) => x.to === C.email && /Rappel/.test(x.subject)); expect(m.length).toBe(1);
    expect(m[0].text).toContain('En présentiel'); expect(m[0].text).toContain('12 rue de la Mésange'); expect(m[0].text).not.toMatch(/token|jwt/i);
    expect(mailer.__getTestOutbox().filter((x) => x.to === C2.email)).toEqual([]);
    expect(await notices(id1)).toEqual([{ kind: 'REMINDER_J1', recipient: 'citizen', channel: 'email', status: 'TEST_RECORDED' }]);   // PKG-4: the in-memory test outbox is TEST_RECORDED, never DELIVERED (nothing reached a real mailbox)
    expect(await notices(id2)).toEqual([{ kind: 'REMINDER_J1', recipient: 'citizen', channel: 'email', status: 'NO_CONSENT' }]);
    const r2 = mk(); await cron({ method: 'GET', url: '/api/cron/rdv-reminder', query: {}, headers: { 'x-cron-secret': process.env.CRON_SECRET } }, r2);
    expect(mailer.__getTestOutbox().filter((x) => x.to === C.email && /Rappel/.test(x.subject)).length, 'once').toBe(1);
  });

  it('B10: Outlook OFF by default; signed state bound to the initiating professional; one strict token format; tampering refused without any exchange; agenda .ics export', async () => {
    const off = await callPro(outlook, { query: { action: 'status' }, url: '/api/pro/outlook?action=status' });
    expect(off.body).toMatchObject({ ok: false, status: 'not_configured' });
    const saved = { ...process.env };
    setEnv({ OUTLOOK_ENABLED: 'true', OUTLOOK_CLIENT_ID: 'qa-client', OUTLOOK_CLIENT_SECRET: 'qa-secret', OUTLOOK_REDIRECT_URI: 'http://localhost:3000/api/auth/callback/outlook', OUTLOOK_TOKEN_ENCRYPTION_KEY: 'o'.repeat(40), OUTLOOK_AUTHORITY_URL: 'https://login.lab.invalid/oauth2/v2.0' });
    const calls = []; const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://login.lab.invalid/')) { calls.push(String(new URLSearchParams(init.body).get('code'))); return new Response(JSON.stringify({ access_token: 'AT-qa', refresh_token: 'RT-qa', expires_in: 3600, scope: 'Calendars.ReadWrite' }), { status: 200 }); } return realFetch(url, init); };
    try {
      const a = await callPro(outlook, { as: PRO_B, url: '/api/pro/outlook?action=authorize' });
      expect(a.body.authUrl, JSON.stringify(a.body)).toBeTruthy();
      const authUrl = new URL(a.body.authUrl); expect(authUrl.origin).toBe('https://login.lab.invalid');
      const state = authUrl.searchParams.get('state');
      const setCookie = String(a.headers['set-cookie'] || a.headers['Set-Cookie'] || '');
      expect(setCookie, 'R12: the state is bound to the browser that asked for it').toMatch(/^__ada_outlook_state=[\w-]+; Path=\/api\/auth\/callback;.*HttpOnly; Secure; SameSite=Lax/);
      const browserCookie = setCookie.split(';')[0];
      const cb = async (q, cookie = browserCookie) => { const r = mk(); await callback({ method: 'GET', url: `/api/auth/callback/outlook?${new URLSearchParams(q)}`, query: q, headers: { host: 'localhost', ...(cookie ? { cookie } : {}) } }, r); return r; };
      expect((await cb({ code: 'c0', state }, null)).statusCode, 'R12: the right state opened in ANOTHER browser (no cookie) links nothing').toBe(400);
      expect((await cb({ code: 'c0', state }, '__ada_outlook_state=someone-else')).statusCode, 'another browser\'s cookie').toBe(400);
      const [body, sig] = state.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: PRO.id })).toString('base64url');
      expect((await cb({ code: 'c1', state: `${forged}.${sig}` })).statusCode).toBe(400);
      expect((await cb({ code: 'c1', state: ST })).statusCode, 'the old unsigned structure-id state').toBe(400);
      expect(calls, 'no code is exchanged for a refused state').toEqual([]);
      const ok = await cb({ code: 'good-code', state }); expect(ok.statusCode).toBe(302); expect(calls).toEqual(['good-code']);
      const rows = (await db.execute(sql`SELECT "userId", "accessTokenEnc" a, "refreshTokenEnc" r FROM "ProOutlookToken" WHERE "userId" IN (${PRO.id}, ${PRO_B.id})`)).rows;
      expect(rows.map((x) => x.userId)).toEqual([PRO_B.id]);   // the professional who started it, never "the first of the structure"
      expect(rows[0].a).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/); expect(rows[0].a).not.toContain('AT-qa');
      expect((await callPro(outlook, { as: PRO_B, url: '/api/pro/outlook?action=status' })).body.status).toBe('connected');
      await db.execute(sql`UPDATE "ProOutlookToken" SET "accessTokenEnc" = 'legacy-plain' WHERE "userId" = ${PRO_B.id}`);
      expect((await callPro(outlook, { as: PRO_B, url: '/api/pro/outlook?action=status' })).body.status, 'a legacy-format row is not trusted').toBe('reconnect_required');
      expect((await callPro(outlook, { method: 'POST', as: PRO_B, url: '/api/pro/outlook?action=disconnect' })).body.status).toBe('disconnected');
      setEnv({ VERCEL_ENV: 'production' });
      // R34: in production an ADA Pro session needs its second factor first (password-only refused), then Outlook still says it is not activated there
      const noFactor = await callPro(outlook, { as: PRO_B, url: '/api/pro/outlook?action=status' });
      expect([noFactor.statusCode, noFactor.body.code]).toEqual([403, 'PRO_MFA_REQUIRED']);
      expect((await callPro(outlook, { as: PRO_B, url: '/api/pro/outlook?action=status', mfa: true })).body.reason).toBe('PRODUCTION_ACTIVATION_PENDING');
    } finally {
      globalThis.fetch = realFetch;
      for (const k of ['OUTLOOK_ENABLED', 'OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_REDIRECT_URI', 'OUTLOOK_TOKEN_ENCRYPTION_KEY', 'OUTLOOK_AUTHORITY_URL', 'VERCEL_ENV']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
    const ics = await callPro(proIcs, { query: { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 30 * 86400000).toISOString() } });
    expect(ics.statusCode).toBe(200); expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.body).toContain('BEGIN:VCALENDAR'); expect(ics.body).toContain('LOCATION:12 rue de la Mésange'); expect(ics.body).toContain('STATUS:CANCELLED');
    // R12 (B10): the cancelled event in the feed carries a sequence above the event's moves (the same as the cancellation e-mail), so calendars apply it
    expect(ics.body.split('BEGIN:VEVENT').find((e) => e.includes('STATUS:CANCELLED'))).toMatch(/SEQUENCE:[1-9]/);
    expect(ics.body).not.toMatch(/Personne QA|Particulier|0600000000|@example\.test/);
    expect((await callPro(proIcs, { query: { from: '2026-01-01', to: '2027-01-01' } })).statusCode, 'at most 92 days').toBe(400);
  });
});
