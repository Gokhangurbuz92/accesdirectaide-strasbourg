/**
 * R41-B — account-free booking privacy: the « already booked » answer (a decoy hold) must be indistinguishable from a real hold for whoever sends the
 * request, on a REAL PostgreSQL (all migrations applied), through the real handlers (api/_handlers/rdv.js -> rdv-guest.js, cron/gdpr-purge,
 * pro/appointments, pro/reports, pro/timeoff, org-stats). R40 finding: the decoy inserted nothing, so the requested slot stayed listed and a second hold on
 * it succeeded (a real hold makes it disappear and answers 409 SLOT_TAKEN), and the decoy's confirm state lived in KV (missing KV -> 404 instead of 400).
 * Threat: someone types the victim's address in a hold request, then reads the slot list — « still listed » used to mean « this person already has an active
 * booking with this structure » (e.g. a social service).
 * Replaced: the rate limiter (records its calls), the KV store (switchable to « throws » / « another instance »), and the mailer is the built-in `test`
 * outbox wrapped so one subject can be made to fail.
 * Run: DBN=ada_r41_decoy_test bash $S/r41/decoy/int.sh tests/integration/r41-guest-decoy-parity-db.test.js
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'test');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true');
const state = vi.hoisted(() => ({ store: new Map(), kvMode: 'ok', calls: [], failSubject: null }));
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn(async (action, key) => { state.calls.push([action, key]); return { allowed: true }; }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getRateLimitStatus: vi.fn().mockReturnValue(429),
}));
vi.mock('../../api/_utils/kv.js', () => {
  const guard = () => { if (state.kvMode === 'throw') throw new Error('KV unavailable'); };
  return { kv: {
    incr: async () => { guard(); return 1; }, expire: async () => { guard(); return 1; },
    get: async (k) => { guard(); return state.kvMode === 'empty' ? null : (state.store.get(k) ?? null); },
    set: async (k, v, o) => { guard(); if (o?.nx && state.store.has(k)) return null; state.store.set(k, v); return 'OK'; },
    del: async (k) => { guard(); return state.store.delete(k) ? 1 : 0; },
  } };
});
vi.mock('../../api/_utils/mailer.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, sendMail: async (payload) => (state.failSubject && state.failSubject.test(String(payload?.subject || ''))
    ? { accepted: false, delivered: false, outcome: 'NOT_DELIVERED' } : real.sendMail(payload)) };
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const S1 = `r41-s1-${TS}`; const SVC = `r41-svc-${TS}`;
const ADMIN = { id: `r41-pa-${TS}`, email: `r41-pa-${TS}@example.test`, sid: S1, role: 'STRUCTURE_ADMIN' };
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, send(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end(d) { if (d !== undefined) this.body = d; return this; } });
let n = 0;
const guest = (extra = {}) => { n += 1; return { name: 'C. D.', email: `r41g${n}-${TS}@example.test`, consent: true, idempotencyKey: `r41k-${TS}-${n}`, ...extra }; };
const again = (g) => { n += 1; return { ...g, idempotencyKey: `r41k-${TS}-${n}` }; };   // the same address, a NEW request
/** the type skeleton of a JSON body (keys at every level, value types) */
const shape = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
/** a hold answer without the values that differ between ANY two holds (id, times, masked address) */
const fixed = (b) => {
  const h = b?.hold || {};
  return { status: h.status, awaitingCode: h.awaitingCode, mode: h.mode, location: h.location, structure: h.structure, service: h.service, cancelledAt: h.cancelledAt,
    canCancel: h.canCancel, canReschedule: h.canReschedule, rescheduleBlocked: h.rescheduleBlocked, reminderConsent: h.reminderConsent, reminderChangeable: h.reminderChangeable,
    reschedule: h.reschedule ? { count: h.reschedule.count, max: h.reschedule.max } : null, keys: Object.keys(h), top: Object.keys(b || {}) };
};
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

describe.skipIf(!hasDatabase)('R41-B account-free booking: the « already booked » decoy behaves like a real hold (real DB)', () => {
  let rdv, db, mailer, auth, purge, proList, proReports, proTimeoff, orgStats, core;
  let slots = []; let next = 0;
  const take = () => { const s = slots[next]; next += 1; if (!s) throw new Error('out of test slots'); return s; };
  const call = async (method, path, { body, query = {} } = {}) => {
    const res = mk();
    await rdv({ method, url: `/api/rdv/${path}`, query, body, headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } }, res);
    return res;
  };
  const invoke = async (handler, { method = 'GET', url, body, headers = {}, query = {} }) => { const r = mk(); await handler({ method, url, query, body, headers: { host: 'x', ...headers } }, r); return r; };
  const pro = (u) => ({ authorization: `Bearer ${auth.signProToken({ id: u.id, email: u.email, structureId: u.sid, role: u.role })}` });
  const outbox = (to, re) => mailer.__getTestOutbox().filter((m) => m.to === to && re.test(m.subject));
  const codeFor = (email) => { const m = outbox(email, /code de confirmation/).pop(); return m ? /(\d{6})/.exec(m.text)[1] : null; };
  const hold = (slot, g) => call('POST', 'guest/hold', { body: { structureSlug: S1, serviceId: SVC, startAt: slot.startAt, ...g } });
  const confirm = (id, code) => call('POST', 'guest/confirm', { body: { holdId: id, code } });
  const row = async (id) => (await db.execute(sql`SELECT * FROM "ProAppointment" WHERE id = ${id}`)).rows[0];
  const listed = async (slot) => {
    const d = slot.startAt.slice(0, 10);
    const r = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from: d, to: d } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    return r.body.slots.map((s) => s.startAt).includes(slot.startAt);
  };
  /** an address with a confirmed account-free booking at S1 (through the real hold + confirm) */
  const victim = async () => {
    const V = guest(); const h = await hold(take(), V); expect(h.statusCode, JSON.stringify(h.body)).toBe(202);
    const c = await confirm(h.body.hold.id, codeFor(V.email)); expect(c.statusCode, JSON.stringify(c.body)).toBe(200);
    return { ...V, bookingId: h.body.hold.id, token: c.body.manage.token };
  };
  /** one decoy (the victim's address, a new request) and one real first hold (a fresh address), each on its own free slot */
  const pair = async (V) => {
    const sd = take(); const sr = take();
    const decoy = await hold(sd, again(V)); const real = await hold(sr, guest());
    expect([decoy.statusCode, real.statusCode], JSON.stringify([decoy.body, real.body])).toEqual([202, 202]);
    return { decoy, real, sd, sr };
  };
  const confirmSeq = async (id) => { const out = []; for (let i = 0; i < 6; i += 1) { const r = await confirm(id, '000001'); out.push([r.statusCode, r.body]); } return out; };

  beforeAll(async () => {
    ({ default: rdv } = await import('../../api/_handlers/rdv.js'));
    ({ db } = await import('../../src/db/index.js'));
    mailer = await import('../../api/_utils/mailer.js');
    auth = await import('../../api/_utils/auth.js');
    purge = (await import('../../api/_handlers/cron/gdpr-purge.js')).default;
    proList = (await import('../../api/_handlers/pro/appointments/index.js')).default;
    proReports = (await import('../../api/_handlers/pro/reports.js')).default;
    proTimeoff = (await import('../../api/_handlers/pro/timeoff.js')).default;
    orgStats = await import('../../api/_services/org-stats.js');
    core = await import('../../api/_utils/rdv-guest-core.js');
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${S1}, ${'R41 ' + S1}, ${S1}, 'association', '1 rue QA', 'Strasbourg', '67000', false, '{}', '{}', '{}', 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "StructureRdvSettings" (id, "structureId", "isPublished", "bookingMode", "allowGuestBooking", "updatedAt") VALUES (${'set-' + S1}, ${S1}, true, 'IN_PERSON', true, NOW())`);
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await db.execute(sql`INSERT INTO "ProAvailabilityRule" (id, "structureId", weekday, "startTime", "endTime", timezone, "isActive", "updatedAt") VALUES (${`r-${S1}-${weekday}`}, ${S1}, ${weekday}, '08:00', '18:00', 'Europe/Paris', true, NOW())`);
    }
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "isActive", "guestBookable", "updatedAt") VALUES (${SVC}, ${S1}, 'Accueil R41', 30, 0, 0, true, true, NOW())`);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, "structureId", role, status, "updatedAt", "createdAt") VALUES (${ADMIN.id}, ${ADMIN.email}, 'x', ${S1}, ${ADMIN.role}, 'active', NOW(), NOW())`);
    const from = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10); const to = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
    const r = await call('GET', `guest/structures/${S1}/slots`, { query: { serviceId: SVC, from, to } });
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    slots = r.body.slots;
    expect(slots.length).toBeGreaterThan(100);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE entity = 'ProAppointment' AND entity_id IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${S1})`);
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" IN (SELECT id FROM "ProAppointment" WHERE "structureId" = ${S1})`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "ProAvailabilityRule" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "StructureRdvSettings" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${S1}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAuditLog" WHERE "structureId" = ${S1}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${S1}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${S1}`);
  });

  it('the hold answer itself: same status, headers, body shape and fixed values for a decoy and a real hold', async () => {
    const V = await victim();
    const { decoy, real, sd, sr } = await pair(V);
    expect(decoy.headers).toEqual(real.headers);
    expect(shape(decoy.body)).toEqual(shape(real.body));
    expect(fixed(decoy.body)).toEqual(fixed(real.body));
    expect([decoy.body.hold.startsAt, real.body.hold.startsAt]).toEqual([sd.startAt, sr.startAt]);
    expect(decoy.body.hold.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(decoy.body.hold.id).not.toBe(V.bookingId);
    expect(new Date(decoy.body.hold.expiresAt).getTime() - Date.now()).toBeGreaterThan(19 * 60_000);
  });

  it('slot-list parity: after a decoy hold its slot disappears from the public list exactly like after a real hold (the R40 leak)', async () => {
    const V = await victim();
    const { sd, sr } = await pair(V);
    expect([await listed(sd), await listed(sr)]).toEqual([false, false]);
  });

  it('second-hold parity: another hold on the slot answers 409 SLOT_TAKEN after a decoy exactly as after a real hold', async () => {
    const V = await victim();
    const { sd, sr } = await pair(V);
    const onDecoy = await hold(sd, guest()); const onReal = await hold(sr, guest());
    expect([onDecoy.statusCode, onDecoy.body]).toEqual([409, onReal.body]);
    expect(onReal.statusCode).toBe(409);
    expect(onReal.body.code).toBe('SLOT_TAKEN');
    // the professional's own booking is refused on both slots too (a hold is a hold)
    const proBook = (slot) => invoke(proList, { method: 'POST', url: '/api/pro/appointments', headers: pro(ADMIN),
      body: { serviceId: SVC, startAt: slot.startAt, beneficiaryName: 'Test Pro', personConsent: true } });
    const [pd, pr] = [await proBook(sd), await proBook(sr)];
    expect([pd.statusCode, pd.body]).toEqual([pr.statusCode, pr.body]);
    expect(pr.statusCode).toBe(409);
  });

  it('repeated identical requests (same address + same key): both replay the same hold with 200 and send nothing more', async () => {
    const V = await victim();
    const sd = take(); const sr = take(); const D = again(V); const R = guest();
    mailer.__clearTestOutbox();
    const d1 = await hold(sd, D); const r1 = await hold(sr, R);
    const d2 = await hold(sd, D); const r2 = await hold(sr, R);
    const d3 = await hold(take(), D); const r3 = await hold(take(), R);   // same key, another slot: still the first hold
    expect([d1.statusCode, d2.statusCode, d3.statusCode]).toEqual([r1.statusCode, r2.statusCode, r3.statusCode]);
    expect([d1.statusCode, d2.statusCode, d3.statusCode]).toEqual([202, 200, 200]);
    expect([d2.body.hold.id, d3.body.hold.id]).toEqual([d1.body.hold.id, d1.body.hold.id]);
    expect([r2.body.hold.id, r3.body.hold.id]).toEqual([r1.body.hold.id, r1.body.hold.id]);
    expect(fixed(d2.body)).toEqual(fixed(r2.body));
    expect(d3.body.hold.startsAt).toBe(sd.startAt);
    expect(outbox(V.email, /./).length).toBe(1);   // one « already » e-mail, not one per retry
    expect(outbox(R.email, /./).length).toBe(1);   // one code e-mail
  });

  it('confirm: wrong codes, lockout and the error shape are the same for a decoy and a real hold, with KV working, failing, or on another instance', async () => {
    const V = await victim();
    for (const mode of ['ok', 'throw', 'empty']) {
      const { decoy, real } = await pair(V);
      state.kvMode = mode;
      let d; let r;
      try { d = await confirmSeq(decoy.body.hold.id); r = await confirmSeq(real.body.hold.id); } finally { state.kvMode = 'ok'; }
      expect(d, `KV ${mode}`).toEqual(r);
      expect(d.map(([st, b]) => `${st} ${b.code} ${b.attemptsLeft ?? '-'}`)).toEqual(['400 CODE_INVALID 4', '400 CODE_INVALID 3', '400 CODE_INVALID 2', '400 CODE_INVALID 1', '409 HOLD_LOCKED 0', '409 HOLD_NOT_ACTIVE -']);
    }
    // malformed code, unknown id: unchanged answers
    const { decoy, real } = await pair(V);
    const bad = [await confirm(decoy.body.hold.id, '12345'), await confirm(real.body.hold.id, '12345')];
    expect(bad.map((x) => [x.statusCode, x.body])).toEqual([[400, { error: 'CODE_INVALID', code: 'CODE_INVALID' }], [400, { error: 'CODE_INVALID', code: 'CODE_INVALID' }]]);
    const unknown = await confirm(crypto.randomUUID(), '123456');
    expect([unknown.statusCode, unknown.body.code]).toEqual([404, 'APPOINTMENT_NOT_FOUND']);
  });

  it('a decoy is never confirmable: no 6-digit code matches its stored hash, and it carries no personal data', async () => {
    const V = await victim();
    const { decoy } = await pair(V);
    const r = await row(decoy.body.hold.id);
    expect(r).toBeTruthy();
    let matches = 0;
    for (let c = 0; c < 1_000_000; c += 1) if (core.checkGuestCode(r.id, String(c).padStart(6, '0'), r.guestCodeHash)) matches += 1;
    expect(matches).toBe(0);
    expect({ status: r.status, guestEmail: r.guestEmail, guestPhone: r.guestPhone, beneficiaryPhone: r.beneficiaryPhone, notes: r.notes, citizenUserId: r.citizenUserId,
      citizenEmailSnapshot: r.citizenEmailSnapshot, guestMailConsentAt: r.guestMailConsentAt, guestConfirmedAt: r.guestConfirmedAt, guestManageTokenHash: r.guestManageTokenHash,
      createdByProUserId: r.createdByProUserId })
      .toEqual({ status: 'requested', guestEmail: null, guestPhone: null, beneficiaryPhone: null, notes: null, citizenUserId: null, citizenEmailSnapshot: null,
        guestMailConsentAt: null, guestConfirmedAt: null, guestManageTokenHash: null, createdByProUserId: null });
    expect(r.beneficiaryName).not.toMatch(/C\. D\./);
    expect(r.guestEmailHash).not.toBe(core.guestEmailHash(V.email));   // not the address's blind index: no per-address lookup can find it
    expect(r.guestHoldExpiresAt).toBeTruthy();
  }, 60000);

  it('expiry parity: an expired decoy and an expired real hold answer HOLD_EXPIRED, free their slot, and are both gone for confirm after the purge', async () => {
    const V = await victim();
    const { decoy, real, sd, sr } = await pair(V);
    const ids = [decoy.body.hold.id, real.body.hold.id];
    await db.execute(sql`UPDATE "ProAppointment" SET "guestHoldExpiresAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 minute' WHERE id IN (${ids[0]}, ${ids[1]})`);
    const [d, r] = [await confirm(ids[0], '000001'), await confirm(ids[1], '000001')];
    expect([d.statusCode, d.body]).toEqual([r.statusCode, r.body]);
    expect(r.body.code).toBe('HOLD_EXPIRED');
    expect([await listed(sd), await listed(sr)]).toEqual([true, true]);
    // the purge one day after the expiry: both answer exactly like an id that never existed
    await db.execute(sql`UPDATE "ProAppointment" SET "guestHoldExpiresAt" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '2 days' WHERE id IN (${ids[0]}, ${ids[1]})`);
    vi.stubEnv('GDPR_PURGE_ENABLED', 'true');
    let p;
    try { p = await invoke(purge, { url: '/api/cron/gdpr-purge', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }); }
    finally { vi.unstubAllEnvs(); vi.stubEnv('MAILER_PROVIDER', 'test'); vi.stubEnv('MAILER_FROM', 'noreply@example.test'); vi.stubEnv('ADA_GUEST_BOOKING_ENABLED', 'true'); }
    expect(p.body.failed_steps || []).toEqual([]);
    const [d2, r2, u2] = [await confirm(ids[0], '000001'), await confirm(ids[1], '000001'), await confirm(crypto.randomUUID(), '000001')];
    expect([d2.statusCode, d2.body]).toEqual([r2.statusCode, r2.body]);
    expect([r2.statusCode, r2.body]).toEqual([u2.statusCode, u2.body]);
    expect(await row(ids[0])).toBeUndefined();   // the decoy is deleted (nothing to keep)
    const kept = await row(ids[1]);   // the real hold keeps R38's anonymised, cancelled row
    expect([kept.status, kept.guestEmail, kept.guestEmailHash, kept.beneficiaryName]).toEqual(['cancelled', null, null, '[anonymisé]']);
  });

  it('lockout parity: the maximum of wrong codes frees the slot of a decoy as of a real hold', async () => {
    const V = await victim();
    const { decoy, real, sd, sr } = await pair(V);
    await confirmSeq(decoy.body.hold.id); await confirmSeq(real.body.hold.id);
    expect([await listed(sd), await listed(sr)]).toEqual([true, true]);
    expect([(await hold(sd, guest())).statusCode, (await hold(sr, guest())).statusCode]).toEqual([202, 202]);
  });

  it('manage, cancel, reschedule and the reminder switch with a hold id: the same 404 for a decoy and a real unconfirmed hold', async () => {
    const V = await victim();
    const { decoy, real } = await pair(V);
    const token = crypto.randomBytes(32).toString('base64url');
    for (const path of ['guest/manage', 'guest/manage/cancel', 'guest/manage/reschedule', 'guest/manage/reminder']) {
      const extra = path.endsWith('reschedule') ? { startAt: take().startAt } : path.endsWith('reminder') ? { consent: false } : {};
      const d = await call('POST', path, { body: { appointmentId: decoy.body.hold.id, token, ...extra } });
      const r = await call('POST', path, { body: { appointmentId: real.body.hold.id, token, ...extra } });
      expect([d.statusCode, d.body, d.headers], path).toEqual([r.statusCode, r.body, r.headers]);
      expect(d.statusCode).toBe(404);
    }
  });

  it('concurrency: two holds on one slot at the same time — exactly one wins, whichever of them is a decoy', async () => {
    const V = await victim();
    const cases = [['decoy', 'real'], ['real', 'decoy'], ['decoy', 'decoy'], ['real', 'real']];
    for (const kinds of cases) {
      const slot = take();
      const res = await Promise.all(kinds.map((k) => hold(slot, k === 'decoy' ? again(V) : guest())));
      expect(res.map((x) => x.statusCode).sort(), kinds.join('/')).toEqual([202, 409]);
      const active = await db.execute(sql`SELECT count(*)::int n FROM "ProAppointment" WHERE "structureId" = ${S1} AND "startAt" = ${new Date(slot.startAt)} AND status = 'requested'`);
      expect(Number(active.rows[0].n), kinds.join('/')).toBe(1);
      expect(await listed(slot)).toBe(false);
    }
  });

  it('mail not really sent: both answer 503, both free the slot, and a retry of the same request answers the same', async () => {
    const V = await victim();
    const sd = take(); const sr = take(); const D = again(V); const R = guest();
    state.failSubject = /déjà en cours|code de confirmation/;
    let d; let r; let d2; let r2;
    try { d = await hold(sd, D); r = await hold(sr, R); d2 = await hold(sd, D); r2 = await hold(sr, R); } finally { state.failSubject = null; }
    expect([d.statusCode, d.body]).toEqual([r.statusCode, r.body]);
    expect([d.statusCode, d.body.code]).toEqual([503, 'GUEST_BOOKING_MAIL_UNAVAILABLE']);
    expect([await listed(sd), await listed(sr)]).toEqual([true, true]);
    const released = (x) => ({ ...fixed(x.body), cancelledAt: typeof x.body.hold.cancelledAt });   // both cancelled at their own instant
    expect([d2.statusCode, released(d2)]).toEqual([r2.statusCode, released(r2)]);
    expect([d2.statusCode, d2.body.hold.status, typeof d2.body.hold.cancelledAt]).toEqual([200, 'CANCELLED', 'string']);
  });

  it('rate limits: the same limiter actions with the same kinds of key, in the same order, for a decoy and a real hold and their confirm', async () => {
    const V = await victim();
    const sd = take(); const sr = take(); const D = again(V); const R = guest();
    const trace = async (fn) => { state.calls = []; await fn(); return state.calls.map(([a, k]) => [a, /^[0-9a-f]{64}$/.test(k) ? 'hash' : k]); };
    let dh; let rh;
    const td = await trace(async () => { dh = await hold(sd, D); });
    const tr = await trace(async () => { rh = await hold(sr, R); });
    expect(td).toEqual(tr);
    expect(td).toEqual([['RDV_GUEST_WRITE', '127.0.0.1'], ['RDV_GUEST_EMAIL', 'hash']]);
    expect(await trace(() => confirm(dh.body.hold.id, '000001'))).toEqual(await trace(() => confirm(rh.body.hold.id, '000001')));
  });

  it('the decoy is invisible to the structure and counts for nobody: agenda, reports, statistics, absences, notices, audit; the victim can still book', async () => {
    const V = await victim();
    const ctx = { userId: ADMIN.id, structureId: S1 };
    const counts = async () => {
      const team = await orgStats.teamStats(ctx); const csv = await orgStats.reportCsv(ctx, 'month');
      const rep = await invoke(proReports, { url: '/api/pro/reports?period=month', headers: pro(ADMIN) });
      expect([team.ok, csv.ok, rep.statusCode]).toEqual([true, true, 200]);
      return { upcoming: team.global.appointmentsUpcoming, today: team.global.appointmentsToday, csv: csv.csv.split('\r\n').filter((l) => !l.startsWith('genere_le,')), total: rep.body.kpis.totalAppointments };
    };
    const before = await counts();
    const sd = take();
    const decoy = await hold(sd, again(V)); expect(decoy.statusCode).toBe(202);
    const id = decoy.body.hold.id;
    expect(await counts()).toEqual(before);
    const list = await invoke(proList, { url: '/api/pro/appointments?pageSize=100', query: { pageSize: '100' }, headers: pro(ADMIN) });
    expect(list.statusCode).toBe(200);
    expect(list.body.items.map((x) => x.id)).not.toContain(id);
    const byId = await invoke(proList, { url: `/api/pro/appointments?id=${id}`, query: { id }, headers: pro(ADMIN) });
    expect(byId.body.items).toEqual([]);
    // an absence over the decoy's slot does not list it as an appointment to move
    const off = await invoke(proTimeoff, { method: 'POST', url: '/api/pro/timeoff', headers: pro(ADMIN),
      body: { startAt: sd.startAt, endAt: sd.endAt, scope: 'structure', reason: 'R41' } });
    expect(off.statusCode, JSON.stringify(off.body)).toBe(201);
    expect(off.body.overlappingAppointments.map((x) => x.id)).not.toContain(id);
    await db.execute(sql`DELETE FROM "ProTimeOff" WHERE id = ${off.body.item.id}`);
    // no notice, no professional notification, no audit entry for it
    const ledger = await db.execute(sql`SELECT count(*)::int n FROM "AppointmentNotice" WHERE "appointmentId" = ${id}`);
    const audit = await db.execute(sql`SELECT count(*)::int n FROM "AuditLog" WHERE entity_id = ${id}`);
    expect([Number(ledger.rows[0].n), Number(audit.rows[0].n)]).toEqual([0, 0]);
    // the victim cancels their real booking and books again at once: the decoy is not « their » active booking
    expect((await call('POST', 'guest/manage/cancel', { body: { appointmentId: V.bookingId, token: V.token } })).statusCode).toBe(200);
    mailer.__clearTestOutbox();
    const mine = await hold(take(), again(V));
    expect(mine.statusCode).toBe(202);
    expect(outbox(V.email, /code de confirmation/).length).toBe(1);
    expect((await row(mine.body.hold.id)).guestEmailHash).toBe(core.guestEmailHash(V.email));
  });

  it('timing: a decoy hold costs about what a real hold costs (no shortcut path)', async () => {
    const V = await victim();
    const td = []; const tr = [];
    for (let i = 0; i < 7; i += 1) {
      const a = take(); const b = take();
      let t = performance.now(); const d = await hold(a, again(V)); td.push(performance.now() - t);
      t = performance.now(); const r = await hold(b, guest()); tr.push(performance.now() - t);
      expect([d.statusCode, r.statusCode]).toEqual([202, 202]);
    }
    const [md, mr] = [median(td), median(tr)];
    console.info(`[r41] hold median: decoy ${md.toFixed(1)} ms, real ${mr.toFixed(1)} ms`);
    expect(Math.abs(md - mr), `decoy ${md.toFixed(1)} ms, real ${mr.toFixed(1)} ms`).toBeLessThan(Math.max(15, 0.5 * mr));
  }, 60000);
});
