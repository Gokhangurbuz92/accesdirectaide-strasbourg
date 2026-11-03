/**
 * R41-E / G5 — cron/parcours-reminder reliability on a REAL PostgreSQL, on a database migrated to 0042 (Production level) and to 0044:
 *   stale CLAIMED rows are taken over, missed runs are caught up (never after the due date, never a J-7 inside the J-1 window), retryable failures are
 *   retried with a backoff and a bound, permanent refusals are final, nothing is ever sent twice (two concurrent runs, stable idempotency key), a step closed /
 *   moved / a consent withdrawn before delivery sends nothing, expired deadlines are ignored, no provider is NOT_DELIVERED, each run has a CronRun row, and no
 *   log line carries an address, a number, the message or a token.
 * The mail / push / SMS senders are injected (no network); the no-provider case uses the real mailer with MAILER_PROVIDER unset.
 * Run: DBN=ada_r41_jobs_42_test bash $S/r41/jobs/int.sh tests/integration/r41-parcours-reminder-db.test.js   (and DBN=ada_r41_jobs_44_test)
 */
import { vi, afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('@sentry/node', () => ({ captureException: vi.fn(), default: { captureException: vi.fn() } }));

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const H = 3600000; const DAY = 24 * H;
const SRC = 'https://www.service-public.fr/particuliers/vosdroits/F1';
const PHONE = '+33612345678';
const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } });
let n = 0;

describe.skipIf(!hasDatabase)('R41-E G5 — parcours reminders (real DB)', () => {
  let db, cron, level;
  const users = [];
  const sent = [];
  const okMail = async (p) => { sent.push(p); return { accepted: true, delivered: true, provider: 'resend', outcome: 'PROVIDER_ACCEPTED' }; };
  const retryMail = async (p) => { sent.push({ ...p, failed: true }); return { accepted: true, delivered: false, provider: 'resend', outcome: 'NOT_DELIVERED', failure: 'retryable', errorCode: 'service_unavailable' }; };
  const refusedMail = async (p) => { sent.push({ ...p, failed: true }); return { accepted: true, delivered: false, provider: 'resend', outcome: 'NOT_DELIVERED', failure: 'permanent', errorCode: 'validation_error' }; };
  const emailOnly = async (_u, ch) => ch === 'email';
  const noPush = async () => ({ status: 'NO_SUBSCRIPTION', accepted: 0, failed: 0, expired: 0 });
  const deps = (o = {}) => ({ sendMail: okMail, canNotify: emailOnly, sendToUser: noPush, ...o });
  const mine = (email) => sent.filter((p) => p.to === email && !p.failed);
  const status = async (id, threshold, channel = 'email') => (await db.execute(sql`SELECT status FROM "ParcoursReminder" WHERE "itemId" = ${id} AND threshold = ${threshold} AND channel = ${channel}`)).rows[0]?.status;
  /** a verified account and one sourced, open step due at `due` */
  const seed = async (due, { phone = false } = {}) => {
    n += 1; const uid = `r41p-u-${TS}-${n}`; const email = `r41p${n}-${TS}@example.test`; const id = `r41p-i-${TS}-${n}`;
    await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", phone, "phoneVerifiedAt", "updatedAt") VALUES (${uid}, ${email}, 'x', NOW(), ${phone ? PHONE : null}, ${phone ? new Date() : null}, NOW())`);
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "dueDate", "dueSourceUrl", "updatedAt") VALUES (${id}, ${uid}, 'MANUAL', 'custom', 'Dossier RSA de Jeanne Martin', ${due}, ${SRC}, NOW())`);
    users.push(uid);
    return { uid, email, id };
  };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    cron = await import('../../api/_handlers/cron/parcours-reminder.js');
    level = Number((await db.execute(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'ProAppointment' AND column_name = 'guestReminderConsentAt'`)).rows[0].n) === 1 ? '0044' : '0042';
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => {
    if (!db) return;
    for (const uid of users) await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${uid}`);   // ParcoursItem / ParcoursReminder cascade
    await db.execute(sql`DELETE FROM "CronRun" WHERE job = 'parcours-reminder' AND "startedAt" >= ${new Date(TS - 60000)}`);
  });

  it(`runs on this database level (${'0042 / 0044'})`, () => { expect(['0042', '0044']).toContain(level); });

  it('a row left CLAIMED by a run that died is taken over after 15 minutes; a fresh claim (a run in progress) is not', async () => {
    const now = new Date();
    const dead = await seed(new Date(now.getTime() + 12 * H)); const busy = await seed(new Date(now.getTime() + 12 * H));
    await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status, "createdAt") VALUES (${dead.id}, 'J1', 'email', 'CLAIMED', ${new Date(now.getTime() - H)})`);
    await db.execute(sql`INSERT INTO "ParcoursReminder" ("itemId", threshold, channel, status, "createdAt") VALUES (${busy.id}, 'J1', 'email', 'CLAIMED', ${new Date(now.getTime() - 60000)})`);
    const s = await cron.runParcoursReminders({ now, deps: deps() });
    expect(mine(dead.email)).toHaveLength(1);
    expect(await status(dead.id, 'J1')).toBe('PROVIDER_ACCEPTED');
    expect(mine(busy.email)).toHaveLength(0);
    expect(await status(busy.id, 'J1')).toBe('CLAIMED');
    expect(s.takenOver).toBeGreaterThanOrEqual(1);
  });

  it('catch-up: a J-7 missed by up to two daily runs is still sent; older ones are not; a step inside the J-1 window gets only the J-1; an expired one nothing', async () => {
    const now = new Date();
    const missed2 = await seed(new Date(now.getTime() + 5 * DAY + 2 * H));   // J-7 crossed ~2 days ago
    const tooOld = await seed(new Date(now.getTime() + 3 * DAY + 2 * H));    // J-7 crossed ~4 days ago: beyond the catch-up
    const j1 = await seed(new Date(now.getTime() + 20 * H));
    const expired = await seed(new Date(now.getTime() - 2 * H));
    await cron.runParcoursReminders({ now, deps: deps() });
    expect(await status(missed2.id, 'J7')).toBe('PROVIDER_ACCEPTED');
    expect(await status(tooOld.id, 'J7')).toBeUndefined();
    expect([await status(j1.id, 'J1'), await status(j1.id, 'J7')]).toEqual(['PROVIDER_ACCEPTED', undefined]);
    expect([await status(expired.id, 'J1'), await status(expired.id, 'J7')]).toEqual([undefined, undefined]);
    // the catch-up never repeats: the next daily run sees the claimed row
    await cron.runParcoursReminders({ now: new Date(now.getTime() + DAY), deps: deps() });
    expect(mine(missed2.email)).toHaveLength(1);
  });

  it('an SMS deferred by the quiet hours is sent by the next daily run (no second run the same day needed)', async () => {
    const night = new Date(); night.setUTCHours(21, 0, 0, 0);   // 22:00 or 23:00 Paris
    const due = new Date(night.getTime() + 4 * DAY + 20 * H);       // J-7 window at night, still inside the catch-up the next morning
    const p = await seed(due, { phone: true });
    const sms = []; const sendSms = async (to, body) => { sms.push({ to, body }); return 'PROVIDER_ACCEPTED'; };
    const d = deps({ canNotify: async () => true, sendSms });
    const first = await cron.runParcoursReminders({ now: night, deps: d });
    expect(first.deferredQuietHours).toBeGreaterThanOrEqual(1);
    expect(await status(p.id, 'J7', 'sms')).toBeUndefined();
    await cron.runParcoursReminders({ now: new Date(night.getTime() + 11 * H), deps: d });   // 08:00 UTC = 09:00 / 10:00 Paris
    expect(await status(p.id, 'J7', 'sms')).toBe('PROVIDER_ACCEPTED');
    expect(sms.filter((m) => m.to === PHONE)).toHaveLength(1);
  });

  it('retryable failure: FAILED, not retried before the backoff, retried by a later run, then sent exactly once', async () => {
    const now = new Date();
    const p = await seed(new Date(now.getTime() + 6 * DAY + 12 * H));
    await cron.runParcoursReminders({ now, deps: deps({ sendMail: retryMail }) });
    expect(await status(p.id, 'J7')).toBe('FAILED');
    await cron.runParcoursReminders({ now: new Date(now.getTime() + H), deps: deps() });   // inside the backoff: untouched
    expect(mine(p.email)).toHaveLength(0);
    expect(await status(p.id, 'J7')).toBe('FAILED');
    await cron.runParcoursReminders({ now: new Date(now.getTime() + 21 * H), deps: deps() });
    expect(await status(p.id, 'J7')).toBe('PROVIDER_ACCEPTED');
    await cron.runParcoursReminders({ now: new Date(now.getTime() + 42 * H), deps: deps() });
    expect(mine(p.email)).toHaveLength(1);
  });

  it('bounded: a provider that keeps failing is tried at most 1 + CATCHUP_DAYS times for one threshold (daily runs)', async () => {
    const now = new Date();
    const p = await seed(new Date(now.getTime() + 6 * DAY + 12 * H));
    for (let i = 0; i < 6; i += 1) await cron.runParcoursReminders({ now: new Date(now.getTime() + i * 21 * H), deps: deps({ sendMail: retryMail }) });
    const attempts = sent.filter((x) => x.to === p.email && x.subject && x.failed).length;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(1 + cron.CATCHUP_DAYS);
  });

  it('a permanent refusal is NOT_DELIVERED and never retried', async () => {
    const now = new Date();
    const p = await seed(new Date(now.getTime() + 6 * DAY + 12 * H));
    await cron.runParcoursReminders({ now, deps: deps({ sendMail: refusedMail }) });
    expect(await status(p.id, 'J7')).toBe('NOT_DELIVERED');
    await cron.runParcoursReminders({ now: new Date(now.getTime() + 21 * H), deps: deps() });
    expect(mine(p.email)).toHaveLength(0);
    expect(await status(p.id, 'J7')).toBe('NOT_DELIVERED');
  });

  it('two concurrent runs send one e-mail; the idempotency key is stable for the step, threshold and due date', async () => {
    const now = new Date();
    const p = await seed(new Date(now.getTime() + 10 * H));
    await Promise.all([cron.runParcoursReminders({ now, deps: deps() }), cron.runParcoursReminders({ now, deps: deps() })]);
    expect(mine(p.email)).toHaveLength(1);
    expect(mine(p.email)[0].idempotencyKey).toBe(`parcours-reminder/${p.id}/J1/${new Date(now.getTime() + 10 * H).getTime()}/email`);
    expect(mine(p.email)[0].idempotencyKey).not.toMatch(/@/);
  });

  it('consent withdrawn before delivery: NO_CONSENT, nothing sent; a step closed or moved between the selection and the claim: nothing sent, no row', async () => {
    const now = new Date();
    const withdrawn = await seed(new Date(now.getTime() + 10 * H));
    const closed = await seed(new Date(now.getTime() + 10 * H)); const moved = await seed(new Date(now.getTime() + 10 * H));
    const canNotify = async (uid, ch) => {
      if (uid === closed.uid && ch === 'email') await db.execute(sql`UPDATE "ParcoursItem" SET status = 'CLOSED' WHERE id = ${closed.id}`);
      if (uid === moved.uid && ch === 'email') await db.execute(sql`UPDATE "ParcoursItem" SET "dueDate" = ${new Date(now.getTime() + 30 * DAY)} WHERE id = ${moved.id}`);
      return ch === 'email' && uid !== withdrawn.uid;
    };
    const s = await cron.runParcoursReminders({ now, deps: deps({ canNotify }) });
    expect(await status(withdrawn.id, 'J1')).toBe('NO_CONSENT');
    for (const x of [withdrawn, closed, moved]) expect(mine(x.email), x.id).toHaveLength(0);
    expect([await status(closed.id, 'J1'), await status(moved.id, 'J1')]).toEqual([undefined, undefined]);
    expect(s.cancelled).toBeGreaterThanOrEqual(2);
  });

  it('no provider configured (MAILER_PROVIDER unset): NOT_DELIVERED, no exception, nothing retried', async () => {
    vi.stubEnv('MAILER_PROVIDER', ''); vi.stubEnv('MAILER_FROM', '');
    const now = new Date();
    const p = await seed(new Date(now.getTime() + 10 * H));
    const { sendMail } = await import('../../api/_utils/mailer.js');
    await cron.runParcoursReminders({ now, deps: { sendMail, canNotify: emailOnly, sendToUser: noPush } });
    expect(await status(p.id, 'J1')).toBe('NOT_DELIVERED');
  });

  it('the handler writes a CronRun row (job parcours-reminder) with the summary', async () => {
    const before = new Date(Date.now() - 1000);
    const r = mk();
    await cron.default({ method: 'GET', url: '/api/cron/parcours-reminder', query: {}, headers: { host: 'x', 'x-cron-secret': process.env.CRON_SECRET } }, r);
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200);
    const row = (await db.execute(sql`SELECT status, metrics, "finishedAt" FROM "CronRun" WHERE job = 'parcours-reminder' AND "startedAt" >= ${before} ORDER BY "startedAt" DESC LIMIT 1`)).rows[0];
    expect(row).toBeTruthy();
    expect(['success', 'partial']).toContain(row.status);
    expect(row.finishedAt).not.toBeNull();
    expect(row.metrics).toHaveProperty('considered');
  });

  it('logs never carry an address, a number, the message, a step title or a key — even when a sender throws with them', async () => {
    const logger = (await import('../../api/_utils/logger.js')).default;
    const raw = []; const out = [];
    for (const level of ['error', 'warn', 'info', 'debug']) { const orig = logger[level].bind(logger); vi.spyOn(logger, level).mockImplementation((...a) => { raw.push(a); return orig(...a); }); }
    for (const level of ['log', 'error', 'warn', 'info']) vi.spyOn(console, level).mockImplementation((...a) => { out.push(a); });
    const write = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...rest) => { out.push(String(chunk)); return write(chunk, ...rest); });
    const now = new Date();
    const p = await seed(new Date(now.getTime() + 10 * H), { phone: true });
    const boom = async (m) => { throw new Error(`provider said: ${m.to} ${PHONE} ${m.text} re_live_secret_key`); };
    await cron.runParcoursReminders({ now, deps: deps({ sendMail: boom, canNotify: async () => true, sendSms: async (to) => { throw new Error(`refused ${to}`); }, sendToUser: async () => { throw new Error(`push ${p.email}`); } }) });
    expect(await status(p.id, 'J1')).toBe('FAILED');
    const all = JSON.stringify(raw.map((a) => a.map((x) => (x instanceof Error ? { name: x.name, message: x.message, stack: x.stack } : x)))) + JSON.stringify(out);
    for (const secret of [p.email, PHONE, '612345678', 'Jeanne', 'RSA', 'arrive à échéance', 're_live_secret_key', `parcours-reminder/${p.id}`]) expect(all, secret).not.toContain(secret);
  });
});
