/**
 * R41-E / G6 — cron/rdv-reminder counts the reach PER RECIPIENT, on a REAL PostgreSQL migrated to 0042 (Production level) and to 0044:
 *   the agent's e-mail / in-app notice no longer closes the claim when the PERSON's e-mail failed for a retryable reason; a later run of the same J-1 day
 *   retries the person only (the agent is never written to twice), with the same idempotency key; a permanent refusal is final; retries stay bounded;
 *   a cancellation or a consent withdrawal before the retry is honoured; no log line carries an address, a number or the API key.
 * The mail provider is Resend behind a stubbed fetch (no network, simulated key): the person's address answers 503 or 422 as the test decides.
 * Rows are written with raw SQL so the seed does not depend on the migration level.
 * Run: DBN=ada_r41_jobs_42_test bash $S/r41/jobs/int.sh tests/integration/r41-rdv-reminder-db.test.js   (and DBN=ada_r41_jobs_44_test)
 */
import { vi } from 'vitest';
vi.stubEnv('MAILER_PROVIDER', 'resend');
vi.stubEnv('MAILER_API_KEY', 're_simulated_not_a_key');
vi.stubEnv('MAILER_FROM', 'noreply@example.test');
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));
const kvState = vi.hoisted(() => ({ store: new Map() }));
vi.mock('../../api/_utils/kv.js', () => ({ kv: {
  incr: async () => 1, expire: async () => 1,
  get: async (k) => kvState.store.get(k) ?? null,
  set: async (k, v, o) => { if (o?.nx && kvState.store.has(k)) return null; kvState.store.set(k, v); return 'OK'; },
  del: async (k) => (kvState.store.delete(k) ? 1 : 0),
} }));

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const PHONE = '0611223344';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
const STR = `r41r-str-${TS}`; const SVC = `r41r-svc-${TS}`;
let n = 0;

describe.skipIf(!hasDatabase)('R41-E G6 — rdv reminder reach per recipient (real DB)', () => {
  let db, cron, notices, core;
  const wire = [];   // every message that reached the (simulated) provider: { to, key, status }
  const refuse = new Map();   // address -> HTTP status answered by the simulated provider
  const fakeFetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname !== 'api.resend.com') throw new Error('unexpected outbound host in test: ' + u.hostname);
    const body = JSON.parse(String(init.body)); const status = refuse.get(body.to) || 200;
    wire.push({ to: body.to, key: init.headers['Idempotency-Key'], status });
    const payload = status === 200 ? { id: `sim-${wire.length}` } : { statusCode: status, name: status === 422 ? 'validation_error' : 'service_unavailable', message: `Invalid to: ${body.to}` };
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
  };
  const accepted = (to) => wire.filter((w) => w.to === to && w.status === 200);
  const run = async () => { const r = mk(); await cron({ method: 'GET', url: '/api/cron/rdv-reminder', query: {}, headers: { host: 'x', 'x-cron-secret': process.env.CRON_SECRET } }, r); expect(r.statusCode, JSON.stringify(r.body)).toBe(200); return r.body; };
  const row = async (id) => (await db.execute(sql`SELECT reminder_sent_at, reminder_locked_at, status FROM "ProAppointment" WHERE id = ${id}`)).rows[0];
  const ledger = async (id, recipient = 'citizen', channel = 'email') => (await db.execute(sql`SELECT status FROM "AppointmentNotice" WHERE "appointmentId" = ${id} AND kind = 'REMINDER_J1' AND recipient = ${recipient} AND channel = ${channel} ORDER BY "createdAt", id`)).rows.map((x) => x.status);
  const inApp = async (agent, id) => Number((await db.execute(sql`SELECT count(*)::int AS n FROM "ProNotification" WHERE "userId" = ${agent} AND metadata->>'appointmentId' = ${id}`)).rows[0].n);
  /** one agent (e-mail notifications on), one verified citizen account, one confirmed appointment tomorrow noon (Paris) */
  const seed = async () => {
    n += 1;
    const ids = { agent: `r41r-pro-${TS}-${n}`, citizen: `r41r-cit-${TS}-${n}`, apt: `r41r-apt-${TS}-${n}`, agentEmail: `r41r-pro${n}-${TS}@example.test`, citizenEmail: `r41r-cit${n}-${TS}@example.test` };
    const start = new Date(notices.parisDayWindow(new Date(), 1).start.getTime() + 12 * 3_600_000);
    await db.execute(sql`INSERT INTO "ProUser" (id, email, password_hash, role, status, "structureId", "notificationEmailEnabled", "updatedAt") VALUES (${ids.agent}, ${ids.agentEmail}, 'x', 'AGENT', 'active', ${STR}, true, NOW())`);
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ids.citizen}, ${ids.citizenEmail}, 'x', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", status, "beneficiaryName", "beneficiaryPhone", notes, "createdByProUserId", "citizenUserId", "createdAt", "updatedAt")
      VALUES (${ids.apt}, ${STR}, ${SVC}, ${start}, ${new Date(start.getTime() + 1_800_000)}, 'confirmed', 'Jeanne Martin', ${PHONE}, 'note', ${ids.agent}, ${ids.citizen}, NOW(), NOW())`);
    return ids;
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ({ default: cron } = await import('../../api/_handlers/cron/rdv-reminder.js'));
    notices = await import('../../api/_services/appointment-notices.js');
    core = await import('../../api/_utils/rdv-guest-core.js');
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, "updatedAt", "createdAt")
      VALUES (${STR}, 'R41 S', ${'r41r-slug-' + TS}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${SVC}, ${STR}, 'S', 30, NOW())`);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); refuse.clear(); kvState.store.clear(); });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AppointmentNotice" WHERE "appointmentId" LIKE ${'r41r-apt-' + TS + '-%'}`);
    await db.execute(sql`DELETE FROM "ProNotification" WHERE "structureId" = ${STR}`).catch(() => {});
    await db.execute(sql`DELETE FROM "ProAppointment" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "ProRdvService" WHERE id = ${SVC}`);
    await db.execute(sql`DELETE FROM "ProUser" WHERE "structureId" = ${STR}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'r41r-cit-' + TS + '-%'}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${STR}`);
  });

  it('the person\'s e-mail failed (503) while the agent was reached: the claim is released; the next run reaches the person only, with the same key', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const a = await seed();
    refuse.set(a.citizenEmail, 503);
    await run();
    expect(accepted(a.agentEmail)).toHaveLength(1);
    expect(await inApp(a.agent, a.apt)).toBe(1);
    expect(await ledger(a.apt)).toEqual(['NOT_DELIVERED']);
    expect(await row(a.apt)).toMatchObject({ reminder_sent_at: null, reminder_locked_at: null });   // G6: not closed by the agent's reach
    refuse.delete(a.citizenEmail);
    await run();
    expect(accepted(a.citizenEmail)).toHaveLength(1);
    expect(accepted(a.agentEmail), 'the agent is not written to twice').toHaveLength(1);
    expect(await inApp(a.agent, a.apt), 'nor notified twice in the app').toBe(1);
    expect(await ledger(a.apt)).toEqual(['NOT_DELIVERED', 'PROVIDER_ACCEPTED']);
    expect((await row(a.apt)).reminder_sent_at).not.toBeNull();
    const keys = wire.filter((w) => w.to === a.citizenEmail).map((w) => w.key);
    expect(new Set(keys).size, 'one idempotency key for the person\'s J-1 e-mail of this appointment').toBe(1);
    expect(keys[0]).not.toMatch(/@/);
    await run();
    expect(accepted(a.citizenEmail)).toHaveLength(1);
  });

  it('a permanent refusal of the person\'s address (422) is final: closed, never retried', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const a = await seed();
    refuse.set(a.citizenEmail, 422);
    await run();
    expect(await ledger(a.apt)).toEqual(['NOT_DELIVERED']);
    expect((await row(a.apt)).reminder_sent_at).not.toBeNull();
    refuse.delete(a.citizenEmail);
    await run();
    expect(accepted(a.citizenEmail)).toHaveLength(0);
    expect(accepted(a.agentEmail)).toHaveLength(1);
  });

  it(`bounded: after ${'REMINDER_MAX_ATTEMPTS_PER_DAY'} failed attempts the same day the claim is closed; the agent was written to once`, async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const a = await seed();
    refuse.set(a.citizenEmail, 503);
    for (let i = 0; i < core.REMINDER_MAX_ATTEMPTS_PER_DAY + 2; i += 1) await run();
    expect(await ledger(a.apt)).toEqual(Array(core.REMINDER_MAX_ATTEMPTS_PER_DAY).fill('NOT_DELIVERED'));
    expect((await row(a.apt)).reminder_sent_at).not.toBeNull();
    expect(accepted(a.agentEmail)).toHaveLength(1);
    expect(await inApp(a.agent, a.apt)).toBe(1);
  });

  it('cancelled before the retry: nothing more is sent; consent withdrawn before the retry: NO_CONSENT and closed', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const c = await seed(); const w = await seed();
    refuse.set(c.citizenEmail, 503); refuse.set(w.citizenEmail, 503);
    await run();
    refuse.clear();
    await db.execute(sql`UPDATE "ProAppointment" SET status = 'cancelled' WHERE id = ${c.apt}`);
    const { setPreference } = await import('../../api/_services/citizen-account.js');
    expect((await setPreference(w.citizen, { channel: 'email', category: 'reminder', enabled: false })).ok).toBe(true);
    await run();
    expect(accepted(c.citizenEmail)).toHaveLength(0);
    expect((await row(c.apt)).reminder_sent_at).toBeNull();
    expect(accepted(w.citizenEmail)).toHaveLength(0);
    expect(await ledger(w.apt)).toEqual(['NOT_DELIVERED', 'NO_CONSENT']);
    expect((await row(w.apt)).reminder_sent_at).not.toBeNull();
  });

  it('logs carry no address, no phone number, no API key and no provider message', async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const logger = (await import('../../api/_utils/logger.js')).default;
    const raw = []; const out = [];
    for (const level of ['error', 'warn', 'info', 'debug']) { const orig = logger[level].bind(logger); vi.spyOn(logger, level).mockImplementation((...x) => { raw.push(x); return orig(...x); }); }
    for (const level of ['log', 'error', 'warn', 'info']) vi.spyOn(console, level).mockImplementation((...x) => { out.push(x); });
    const write = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => { out.push(String(chunk)); return write(chunk, ...rest); });
    const a = await seed();
    refuse.set(a.citizenEmail, 422); refuse.set(a.agentEmail, 503);
    const body = await run();
    const all = JSON.stringify(raw.map((x) => x.map((y) => (y instanceof Error ? { name: y.name, message: y.message } : y)))) + JSON.stringify(out) + JSON.stringify(body);
    for (const secret of [a.citizenEmail, a.agentEmail, PHONE, '611223344', 're_simulated_not_a_key', 'Invalid to', 'Jeanne']) expect(all, secret).not.toContain(secret);
  });
});
