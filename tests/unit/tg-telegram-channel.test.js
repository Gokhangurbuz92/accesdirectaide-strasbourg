/**
 * TG (owner decision 24/11/2026: notifications = Web Push → e-mail → OPTIONAL Telegram, 0 €) — the Telegram channel without network and without a database:
 * configuration and gating (closed by default), the single-use link code (random, hashed, 10 minutes), the webhook secret check (constant time) and the
 * webhook replies, the sealed chat id, the generic message texts (no sensitive field), the send adapter (no real Telegram call: a stand-in fetch), the
 * fallback (a Telegram failure never stops the e-mail), the reminder channels and the preflight check. Synthetic values only — the token below is fake.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { telegramConfig } from '../../api/lib/telegram-config.js';
import * as tg from '../../api/_services/telegram.js';
import { appointmentReminderTelegram } from '../../api/lib/reminder-channels.js';
import { capabilityState, capabilitiesOfRoute } from '../../api/_utils/capabilities.js';
import { ACCOUNTS_EXTRAS, isAllowedInPublicBeta, isTelegramWebhookRequest } from '../../api/_utils/public-beta.js';
import { openText } from '../../api/lib/data-keys.js';

const FAKE = Object.freeze({ TELEGRAM_BOT_TOKEN: `123456789:${'x'.repeat(35)}`, TELEGRAM_BOT_USERNAME: 'AccesDirectAideBot', TELEGRAM_WEBHOOK_SECRET: 'S'.repeat(48) });
const SENSITIVE = /sant[ée]|handicap|MDPH|famil|enfant|grossesse|psych|m[ée]dical|maladie|dossier|document|coffre|structure|CAF|RSA|violence|addiction/i;

afterEach(() => { for (const k of Object.keys(FAKE)) delete process.env[k]; vi.restoreAllMocks(); });

describe('configuration and gating (closed by default)', () => {
  it('missing or malformed variables → not configured, never the token or the secret in the answer', () => {
    expect(telegramConfig({})).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    expect(telegramConfig({ ...FAKE, TELEGRAM_BOT_TOKEN: 'abc' })).toEqual({ ok: false, reason: 'INVALID_TOKEN' });
    expect(telegramConfig({ ...FAKE, TELEGRAM_BOT_USERNAME: 'AccesDirectAide' })).toEqual({ ok: false, reason: 'INVALID_USERNAME' });
    expect(telegramConfig({ ...FAKE, TELEGRAM_WEBHOOK_SECRET: 'short' })).toEqual({ ok: false, reason: 'INVALID_WEBHOOK_SECRET' });
    const ok = telegramConfig({ ...FAKE, TELEGRAM_BOT_USERNAME: '@AccesDirectAideBot' });
    expect(ok).toEqual({ ok: true, username: 'AccesDirectAideBot' });
    expect(JSON.stringify(ok)).not.toContain(FAKE.TELEGRAM_BOT_TOKEN.split(':')[1]);
  });

  it('citizen.telegram is outside the AIPD: closed in Production / beta unless named — and the option needs the bot variables too', () => {
    const prod = { VERCEL_ENV: 'production', ...FAKE };
    expect(capabilityState('citizen.telegram', prod)).toMatchObject({ open: false, reason: 'NOT_LISTED_IN_ADA_CAPABILITIES_OPEN' });
    expect(tg.telegramOptionOpen(prod)).toBe(false);
    const beta = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: '1', ADA_BETA_OPEN_SURFACES: 'accounts', ADA_CAPABILITIES_OPEN: 'citizen.telegram', ...FAKE };
    expect(capabilityState('citizen.telegram', beta)).toMatchObject({ open: false, reason: 'SURFACE_CLOSED' });   // narrow scope without the named addition
    expect(tg.telegramOptionOpen({ ...beta, ADA_BETA_ACCOUNTS_EXTRA: 'telegram' })).toBe(true);
    expect(tg.telegramOptionOpen({ ...beta, ADA_BETA_ACCOUNTS_EXTRA: 'telegram', TELEGRAM_BOT_TOKEN: '' })).toBe(false);   // env missing → not offered
    expect(ACCOUNTS_EXTRAS.telegram.routes).toEqual(['citizen/telegram']);
    expect(capabilitiesOfRoute('citizen/telegram')).toEqual(['citizen.telegram']);
  });

  it('the webhook passes the beta gate only once the bot is configured (POST, exact path); the citizen route follows the accounts addition', () => {
    const beta = { ADA_PUBLIC_BETA_RESTRICTED: '1' };
    expect(isTelegramWebhookRequest('POST', 'monitor/telegram/webhook', beta)).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'monitor/telegram/webhook', beta)).toBe(false);
    expect(isAllowedInPublicBeta('POST', 'monitor/telegram/webhook', { ...beta, ...FAKE })).toBe(true);
    expect(isAllowedInPublicBeta('GET', 'monitor/telegram/webhook', { ...beta, ...FAKE })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'citizen/telegram', { ...beta, ADA_BETA_OPEN_SURFACES: 'accounts' })).toBe(false);
    expect(isAllowedInPublicBeta('GET', 'citizen/telegram', { ...beta, ADA_BETA_OPEN_SURFACES: 'accounts', ADA_BETA_ACCOUNTS_EXTRA: 'telegram' })).toBe(true);
  });

  it('the preflight check names variables only and fails only when the capability is open without the bot', async () => {
    const { telegramCheck } = await import('../../scripts/release-preflight.mjs');
    const get = (env) => (k) => String(env[k] ?? '');
    expect(telegramCheck({}, { get: get({}) })[0]).toBe('PASS');
    const open = { ADA_CAPABILITIES_OPEN: 'citizen.telegram' };
    expect(telegramCheck(open, { get: get(open) })[0]).toBe('FAIL');
    const full = { ...open, ...FAKE };
    const [st, detail] = telegramCheck(full, { get: get(full) });
    expect(st).toBe('PASS');
    for (const v of Object.values(FAKE)) expect(detail).not.toContain(v);
    expect(telegramCheck({ TELEGRAM_BOT_TOKEN: 'x' }, { get: get({ TELEGRAM_BOT_TOKEN: 'x' }) })[0]).toBe('WARN');
  });
});

describe('link code: random, single-use, short-lived, stored hashed', () => {
  it('a code is 32 base64url characters (valid « start » parameter), never twice the same; only its SHA-256 is stored', () => {
    const codes = new Set(Array.from({ length: 200 }, () => tg.newLinkCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const c = tg.newLinkCode();
    expect(tg.hashLinkCode(c)).toBe(crypto.createHash('sha256').update(c).digest('hex'));
    expect(tg.hashLinkCode(c)).not.toContain(c);
    expect(tg.LINK_CODE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('createLinkCode stores the hash and a 10-minute expiry, and returns the deep link once', async () => {
    const writes = [];
    const db = { insert: () => ({ values: (v) => ({ onConflictDoUpdate: ({ set }) => { writes.push({ v, set }); return Promise.resolve(); } }) }) };
    const now = new Date('2026-11-25T10:00:00Z');
    const out = await tg.createLinkCode('u1', { db, env: FAKE, now });
    const code = new URL(out.deepLink).searchParams.get('start');
    expect(out.deepLink).toBe(`https://t.me/AccesDirectAideBot?start=${code}`);
    expect(out.expiresAt).toBe('2026-11-25T10:10:00.000Z');
    expect(writes[0].v).toEqual({ userId: 'u1', linkCodeHash: tg.hashLinkCode(code), linkCodeExpiresAt: new Date('2026-11-25T10:10:00Z') });
    expect(JSON.stringify(writes)).not.toContain(code);
    expect(await tg.createLinkCode('u1', { db, env: {}, now })).toMatchObject({ ok: false, code: 'CHANNEL_UNAVAILABLE' });
  });

  it('consumeLinkCode clears the code in the same statement that finds it (single use) and only while unexpired', async () => {
    const statements = [];
    const tx = {
      update: () => ({ set: (v) => ({ where: (w) => { statements.push({ v, w }); const r = { returning: async () => (statements.length === 1 ? found : []) }; return Object.assign(Promise.resolve(), r); } }) }),
    };
    let found = [{ userId: 'u1' }];
    const db = { transaction: (fn) => fn(tx) };
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const out = await tg.consumeLinkCode(tg.newLinkCode(), 987654321, { db, now: new Date('2026-11-25T10:00:00Z') });
    expect(out).toEqual({ ok: true, userId: 'u1' });
    expect(statements[0].v).toEqual({ linkCodeHash: null, linkCodeExpiresAt: null });
    const where = new PgDialect().sqlToQuery(statements[0].w);
    expect(where.sql).toMatch(/"linkCodeHash" = \$1 and "TelegramLink"\."linkCodeExpiresAt" > \$2/);
    // the bound row: the chat id is sealed, indexed by HMAC, never in clear
    const bound = statements[2].v;
    expect(bound.chatIdEncrypted).toMatch(/^v2:/);
    expect(bound.chatIdEncrypted).not.toContain('987654321');
    expect(openText(bound.chatIdEncrypted, { purpose: 'telegram-chat', context: 'telegram:u1' })).toBe('987654321');
    expect(() => openText(bound.chatIdEncrypted, { purpose: 'telegram-chat', context: 'telegram:u2' })).toThrow();
    expect(bound.chatIdHmac).toBe(tg.chatIdHmac(987654321));
    expect(bound.chatIdHmac).not.toBe(crypto.createHash('sha256').update('987654321').digest('hex'));
    // already used / expired: the claim finds nothing
    found = []; statements.length = 0;
    expect(await tg.consumeLinkCode(tg.newLinkCode(), 987654321, { db })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
    expect(statements).toHaveLength(1);
    // malformed code or a non-private chat id: refused before any statement
    statements.length = 0;
    expect(await tg.consumeLinkCode('short', 1, { db })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
    expect(await tg.consumeLinkCode(tg.newLinkCode(), -100123, { db })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
    expect(statements).toHaveLength(0);
  });
});

describe('webhook: secret header (constant time), private chats, /start and /stop', () => {
  const res = () => { const r = { statusCode: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const update = (text, type = 'private') => ({ update_id: 1, message: { message_id: 1, chat: { id: 4242, type }, from: { id: 4242, first_name: 'Test' }, text } });
  const call = async (body, headers, deps = {}) => {
    const { handleTelegramUpdate } = await import('../../api/_handlers/monitor/telegram-webhook.js');
    const r = res();
    await handleTelegramUpdate({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': FAKE.TELEGRAM_WEBHOOK_SECRET, ...headers }, body }, r,
      { installed: async () => true, rateLimit: async () => ({ allowed: true }), ...deps });
    return r;
  };

  it('webhookSecretOk compares in constant time (timingSafeEqual over digests) and refuses empty or wrong values', () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    expect(tg.webhookSecretOk(FAKE.TELEGRAM_WEBHOOK_SECRET, FAKE)).toBe(true);
    expect(spy).toHaveBeenCalled();
    expect(tg.webhookSecretOk(`${FAKE.TELEGRAM_WEBHOOK_SECRET}x`, FAKE)).toBe(false);
    expect(tg.webhookSecretOk('', FAKE)).toBe(false);
    expect(tg.webhookSecretOk(undefined, FAKE)).toBe(false);
    expect(tg.webhookSecretOk(FAKE.TELEGRAM_WEBHOOK_SECRET, {})).toBe(false);
  });

  it('closed (no bot configured) → 404; wrong or missing secret → 401 and nothing is read', async () => {
    const consume = vi.fn();
    expect((await call(update(`/start ${tg.newLinkCode()}`), {}, { consume })).statusCode).toBe(404);
    Object.assign(process.env, FAKE);
    expect((await call(update(`/start ${tg.newLinkCode()}`), { 'x-telegram-bot-api-secret-token': 'wrong' }, { consume })).statusCode).toBe(401);
    expect((await call(update(`/start ${tg.newLinkCode()}`), { 'x-telegram-bot-api-secret-token': undefined }, { consume })).statusCode).toBe(401);
    expect(consume).not.toHaveBeenCalled();
    expect((await call(update('/start'), {}, { installed: async () => false })).statusCode).toBe(404);   // migration 0065 absent
  });

  it('/start <code> links and confirms in the webhook answer; an invalid code says so; groups are ignored', async () => {
    Object.assign(process.env, FAKE);
    const code = tg.newLinkCode();
    const consume = vi.fn(async () => ({ ok: true, userId: 'u1' }));
    const r = await call(update(`/start ${code}`), {}, { consume });
    expect(consume).toHaveBeenCalledWith(code, 4242);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ method: 'sendMessage', chat_id: 4242, text: tg.BOT_TEXT.linked });
    expect((await call(update(`/start ${code}`), {}, { consume: async () => ({ ok: false }) })).body.text).toBe(tg.BOT_TEXT.invalid);
    const g = await call(update(`/start ${code}`, 'group'), {}, { consume });
    expect(g.body).toEqual({ ok: true }); expect(consume).toHaveBeenCalledTimes(1);
  });

  it('/stop switches the preference off with the withdrawal recorded as collected in Telegram', async () => {
    Object.assign(process.env, FAKE);
    const setPreference = vi.fn(async () => ({ ok: true }));
    const r = await call(update('/stop'), {}, { accountOfChat: async () => 'u1', setPreference });
    expect(setPreference).toHaveBeenCalledWith('u1', { channel: 'telegram', category: 'reminder', enabled: false, collection: { channel: 'telegram_stop' } });
    expect(r.body.text).toBe(tg.BOT_TEXT.stopped);
    expect((await call(update('/stop'), {}, { accountOfChat: async () => null, setPreference })).body.text).toBe(tg.BOT_TEXT.notLinked);
  });
});

describe('messages: generic, never a sensitive field', () => {
  it('the J-1 texts: reduced = the hour and the appointments link; minimal (default) = « new information » in the person\'s language', () => {
    const urls = { rdv: 'https://www.accesdirectaide.fr/compte/rendez-vous', account: 'https://www.accesdirectaide.fr/compte' };
    expect(appointmentReminderTelegram('reduced', '2026-11-26T09:00:00Z', 'fr', urls))
      .toBe('Rappel AccesDirectAide : vous avez un rendez-vous demain à 10 h. Détails : https://www.accesdirectaide.fr/compte/rendez-vous');
    expect(appointmentReminderTelegram('minimal', '2026-11-26T09:00:00Z', 'fr', urls))
      .toBe('Accès Direct Aide : vous avez une nouvelle information dans votre espace. Détails : https://www.accesdirectaide.fr/compte');
    expect(appointmentReminderTelegram('minimal', '2026-11-26T09:00:00Z', 'tr', urls)).toMatch(/^Accès Direct Aide: hesabınızda yeni bir bilgi var\./);
    expect(appointmentReminderTelegram('minimal', '2026-11-26T09:00:00Z', 'fr', urls)).not.toMatch(/10 h|rendez-vous/);
  });

  it('no builder can carry a health, disability, family or document detail (they take no such input)', () => {
    const texts = [tg.parcoursReminderText('3 décembre 2026', 'https://www.accesdirectaide.fr/compte/parcours'), ...Object.values(tg.BOT_TEXT),
      ...['fr', 'en', 'de', 'tr', 'ar', 'uk'].flatMap((l) => ['minimal', 'reduced'].map((lv) => appointmentReminderTelegram(lv, '2026-11-26T09:00:00Z', l, { rdv: 'https://x.example/compte/rendez-vous', account: 'https://x.example/compte' })))];
    for (const t of texts) { expect(t, t).not.toMatch(SENSITIVE); expect(t.length).toBeLessThanOrEqual(300); }
    expect(tg.parcoursReminderText('3 décembre 2026', null)).toBe('Rappel AccesDirectAide : une étape de votre parcours arrive à échéance le 3 décembre 2026.');
  });
});

describe('send adapter (stand-in fetch, no network) and ledger status', () => {
  const sealedFor = async (userId, chatId) => (await import('../../api/lib/data-keys.js')).sealText(String(chatId), { purpose: 'telegram-chat', context: `telegram:${userId}` });
  const fakeDb = (row) => {
    const log = { updates: [], deletes: 0 };
    return { log, select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
      update: () => ({ set: (v) => ({ where: async () => { log.updates.push(v); } }) }),
      delete: () => ({ where: () => ({ returning: async () => { log.deletes += 1; return [{ userId: 'u1' }]; } }) }) };
  };
  it('not configured / no link / rate limited: nothing is sent', async () => {
    const fetchImpl = vi.fn();
    expect(await tg.sendTelegram('u1', 'x', { env: {}, fetchImpl, db: fakeDb(null) })).toEqual({ status: 'NOT_CONFIGURED' });
    expect(await tg.sendTelegram('u1', 'x', { env: FAKE, fetchImpl, db: fakeDb(null) })).toEqual({ status: 'NO_LINK' });
    const row = { userId: 'u1', chatIdEncrypted: await sealedFor('u1', 4242), failureCount: 0 };
    expect(await tg.sendTelegram('u1', 'x', { env: FAKE, fetchImpl, db: fakeDb(row), rateLimit: async () => ({ allowed: false }) })).toEqual({ status: 'RATE_LIMITED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('sendMessage to the Bot API with the opened chat id, no link preview; 200 = ACCEPTED, 403 = link removed, 5xx = FAILED', async () => {
    const row = { userId: 'u1', chatIdEncrypted: await sealedFor('u1', 4242), failureCount: 0 };
    const calls = [];
    const answer = (status, body = {}) => async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
    let db = fakeDb(row);
    expect(await tg.sendTelegram('u1', 'Rappel', { env: FAKE, fetchImpl: answer(200, { ok: true }), db, rateLimit: null })).toEqual({ status: 'ACCEPTED' });
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${FAKE.TELEGRAM_BOT_TOKEN}/sendMessage`);
    expect(JSON.parse(calls[0].init.body)).toEqual({ chat_id: 4242, text: 'Rappel', link_preview_options: { is_disabled: true } });
    expect(calls[0].init.redirect).toBe('error');
    db = fakeDb(row);
    expect(await tg.sendTelegram('u1', 'Rappel', { env: FAKE, fetchImpl: answer(403, { ok: false, description: 'Forbidden: bot was blocked by the user' }), db, rateLimit: null })).toEqual({ status: 'EXPIRED' });
    expect(db.log.deletes).toBe(1);
    db = fakeDb(row);
    expect((await tg.sendTelegram('u1', 'Rappel', { env: FAKE, fetchImpl: answer(502), db, rateLimit: null })).status).toBe('FAILED');
    expect(db.log.updates[0]).toMatchObject({ failureCount: 1 });
    expect((await tg.sendTelegram('u1', 'Rappel', { env: FAKE, fetchImpl: async () => { throw new TypeError('network'); }, db: fakeDb(row), rateLimit: null })).status).toBe('FAILED');
    expect(['ACCEPTED', 'FAILED', 'EXPIRED', 'NO_LINK', 'NOT_CONFIGURED', 'RATE_LIMITED'].map((s) => tg.telegramLedgerStatus({ status: s })))
      .toEqual(['PROVIDER_ACCEPTED', 'FAILED', 'NOT_DELIVERED', 'NOT_DELIVERED', 'NOT_DELIVERED', 'NOT_DELIVERED']);
  });
});

describe('reminder dispatch: same jobs as push / e-mail, person\'s choice, silent fallback', () => {
  it('Mon Parcours adds the telegram channel only on a database with migration 0065', async () => {
    const { reminderChannels } = await import('../../api/_handlers/cron/parcours-reminder.js');
    expect(reminderChannels(false)).toEqual(['email', 'sms', 'push']);
    expect(reminderChannels(true)).toEqual(['email', 'sms', 'push', 'telegram']);
  });

  it('the telegram preference needs a recorded consent, is off by default and unavailable without the bot', async () => {
    const acc = await import('../../api/_services/citizen-account.js');
    expect(acc.CHANNELS).toContain('telegram');
    expect(acc.DEFAULT_PREFS['telegram.reminder']).toBe(false);
    expect(acc.purposeOf('telegram', 'reminder')).toBe('NOTIF_TELEGRAM_REMINDER');
    expect(acc.unavailableChannels({})).toContain('telegram');
    expect(acc.notificationOptionOpen('telegram', 'reminder', { VERCEL_ENV: 'production', ...FAKE })).toBe(false);
    expect(await acc.setPreference('u1', { channel: 'telegram', category: 'reminder', enabled: true }, {})).toMatchObject({ ok: false });
  });

  it('the jobs wire Telegram next to push: a failure only counts (the e-mail stays the record), the ledger is the same scale', () => {
    const parcours = fs.readFileSync('api/_handlers/cron/parcours-reminder.js', 'utf8');
    expect(parcours).toMatch(/channel === 'telegram'[\s\S]*telegramLedgerStatus\(await sendTg\(r\.userId, parcoursReminderText\(dateStr, parcoursUrl\(\)\)\)\)/);
    expect(parcours).toMatch(/canNotify\(r\.userId, channel, 'reminder'\)/);   // the person's channel choice and consent, per channel
    const rdv = fs.readFileSync('api/_handlers/cron/rdv-reminder.js', 'utf8');
    expect(rdv).toMatch(/canNotify\(rdv\.citizenUserId, 'telegram', 'reminder'\)/);
    expect(rdv).toMatch(/catch \(tgErr\) \{\s*telegram\.failed\+\+/);
    expect(rdv).toMatch(/resolveNotificationPrivacy\(rdv\)\)\.level;\s*const text = appointmentReminderTelegram/);
  });

  it('a Telegram send that throws does not stop the e-mail of the same Parcours run (fallback)', async () => {
    vi.resetModules();
    const sent = [];
    const rows = [{ id: 'i1', userId: 'u1', dueDate: new Date('2026-12-02T10:00:00Z'), email: 'p@example.test', phone: null }];
    vi.doMock('../../src/db/index.js', () => ({ db: { execute: async (q) => {
      const { PgDialect } = await import('drizzle-orm/pg-core'); const text = new PgDialect().sqlToQuery(q).sql;
      if (/FROM "ParcoursItem" i JOIN "CitizenUser"/.test(text)) return { rows: q.queryChunks ? rows.splice(0, rows.length) : [] };
      if (/INSERT INTO "ParcoursReminder"/.test(text)) return { rows: [{ itemId: 'i1', retaken: false }] };
      return { rows: [] };
    } } }));
    const { runParcoursReminders } = await import('../../api/_handlers/cron/parcours-reminder.js');
    const summary = await runParcoursReminders({ now: new Date('2026-11-25T10:00:00Z'), deps: {
      telegramInstalled: async () => true, canNotify: async (_u, ch) => ch === 'email' || ch === 'telegram', mailLanguage: async () => 'fr',
      sendMail: async (m) => { sent.push(m); return { ok: true, status: 'PROVIDER_ACCEPTED', provider: 'test' }; },
      sendTelegram: async () => { throw new Error('telegram down'); }, sendToUser: async () => ({ status: 'NO_SUBSCRIPTION' }) } });
    expect(sent).toHaveLength(1);
    expect(summary.failed).toBeGreaterThanOrEqual(1);   // the telegram attempt, recorded FAILED (retryable), nothing else changed
    vi.doUnmock('../../src/db/index.js'); vi.resetModules();
  });
});
