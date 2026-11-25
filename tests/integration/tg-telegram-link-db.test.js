/**
 * TG — the optional Telegram link on REAL PostgreSQL (migration 0065), with a stand-in for the Bot API (no network, no real Telegram call): consent first,
 * a single-use code stored hashed and valid 10 minutes, the chat id sealed at rest and indexed by HMAC, one chat = one account, « /stop » / the unlink button /
 * switching the preference off delete the link (withdrawal recorded), a Parcours reminder goes out as a generic text on the telegram ledger channel, 403
 * ends the link, deleting the account removes it. Synthetic data only; the token is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const U = `tg-${Date.now().toString(36)}`; const U2 = `${U}-b`;
const FAKE = { TELEGRAM_BOT_TOKEN: `123456789:${'y'.repeat(35)}`, TELEGRAM_BOT_USERNAME: 'AccesDirectAideTestBot', TELEGRAM_WEBHOOK_SECRET: 'W'.repeat(40) };
const codeOf = (deepLink) => new URL(deepLink).searchParams.get('start');

describe.skipIf(!hasDatabase)('Telegram link (real DB, Bot API stand-in)', () => {
  let db; let tg; let svc; let parcours; const saved = {};
  beforeAll(async () => {
    for (const k of [...Object.keys(FAKE), 'ADA_PARCOURS_EXTERNAL_REMINDERS']) saved[k] = process.env[k];
    Object.assign(process.env, FAKE, { ADA_PARCOURS_EXTERNAL_REMINDERS: 'on' });
    ({ db } = await import('../../src/db/index.js'));
    tg = await import('../../api/_services/telegram.js');
    svc = await import('../../api/_services/citizen-account.js');
    parcours = await import('../../api/_handlers/cron/parcours-reminder.js');
    for (const id of [U, U2]) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${id}, ${`${id}@example.test`}, 'x', NOW(), NOW())`);
  }, 60000);
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (db) { await db.execute(sql`DELETE FROM "ParcoursItem" WHERE "userId" IN (${U}, ${U2})`).catch(() => {}); await db.execute(sql`DELETE FROM "CitizenUser" WHERE id IN (${U}, ${U2})`).catch(() => {}); }
  });

  it('migration 0065: the table exists and the ParcoursReminder CHECK accepts the telegram channel', async () => {
    expect(await tg.telegramInstalled(db)).toBe(true);
    const def = (await db.execute(sql`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'ParcoursReminder_channel_check'`)).rows[0].d;
    expect(def).toMatch(/'telegram'/);
  });

  it('consent first, then a single-use code stored hashed; a second /start with it and an expired code are refused', async () => {
    expect(await svc.setPreference(U, { channel: 'telegram', category: 'reminder', enabled: true })).toMatchObject({ ok: false, code: 'CONSENT_REQUIRED' });
    expect(await svc.setPreference(U, { channel: 'telegram', category: 'reminder', enabled: true, consentGiven: true })).toMatchObject({ ok: true });
    expect((await db.execute(sql`SELECT decision FROM "ConsentLog" WHERE subject_id = ${U} AND purpose = 'NOTIF_TELEGRAM_REMINDER'`)).rows.map((r) => r.decision)).toEqual([true]);
    const link = await tg.createLinkCode(U, { db });
    const code = codeOf(link.deepLink);
    const stored = (await db.execute(sql`SELECT "linkCodeHash" AS h FROM "TelegramLink" WHERE "userId" = ${U}`)).rows[0].h;
    expect(stored).toBe(tg.hashLinkCode(code)); expect(stored).not.toContain(code);
    expect(await tg.consumeLinkCode(code, 555000111, { db })).toEqual({ ok: true, userId: U });
    expect(await tg.consumeLinkCode(code, 555000111, { db })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
    const late = await tg.createLinkCode(U2, { db, now: new Date(Date.now() - 11 * 60000) });
    expect(await tg.consumeLinkCode(codeOf(late.deepLink), 555000222, { db })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
    const row = (await db.execute(sql`SELECT * FROM "TelegramLink" WHERE "userId" = ${U}`)).rows[0];
    expect(row.chatIdEncrypted).toMatch(/^v2:/); expect(row.chatIdEncrypted).not.toContain('555000111');
    expect(row.chatIdHmac).toBe(tg.chatIdHmac(555000111)); expect(row.linkCodeHash).toBeNull();
    expect(await tg.accountOfChat(555000111, { db })).toBe(U);
  });

  it('a Parcours reminder goes out as a generic text on the telegram channel of the ledger (Bot API stand-in)', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{"ok":true}', { status: 200 }); };
    const due = new Date(Date.now() + 1 * 86400000 - 3600000);
    await db.execute(sql`INSERT INTO "ParcoursItem" (id, "userId", origin, "stepKind", title, "dueDate", "dueSourceUrl", "updatedAt") VALUES (${`${U}-i`}, ${U}, 'MANUAL', 'custom', 'Étape', ${due}, 'https://www.service-public.fr/x', NOW())`);
    await parcours.runParcoursReminders({ deps: { sendMail: async () => ({ ok: true, status: 'TEST_RECORDED', provider: 'test' }), sendToUser: async () => ({ status: 'NO_SUBSCRIPTION' }),
      sendTelegram: (userId, text) => tg.sendTelegram(userId, text, { db, fetchImpl, rateLimit: null }) } });
    const ledger = (await db.execute(sql`SELECT channel, status FROM "ParcoursReminder" WHERE "itemId" = ${`${U}-i`} AND channel = 'telegram'`)).rows;
    expect(ledger).toEqual([{ channel: 'telegram', status: 'PROVIDER_ACCEPTED' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.chat_id).toBe(555000111);
    expect(calls[0].body.text).toMatch(/^Rappel AccesDirectAide : une étape de votre parcours arrive à échéance le /);
    expect(calls[0].body.text).not.toMatch(/Étape|service-public/);
  });

  it('one chat = one account: the same chat linked by another account moves; 403 ends the link; /stop-like withdrawal deletes it', async () => {
    await svc.setPreference(U2, { channel: 'telegram', category: 'reminder', enabled: true, consentGiven: true });
    const code = codeOf((await tg.createLinkCode(U2, { db })).deepLink);
    expect(await tg.consumeLinkCode(code, 555000111, { db })).toEqual({ ok: true, userId: U2 });
    expect(await tg.accountOfChat(555000111, { db })).toBe(U2);
    expect((await tg.linkStatus(U, { db })).linked).toBe(false);
    const blocked = async () => new Response('{"ok":false,"description":"Forbidden: bot was blocked by the user"}', { status: 403 });
    expect(await tg.sendTelegram(U2, 'x', { db, fetchImpl: blocked, rateLimit: null })).toEqual({ status: 'EXPIRED' });
    expect((await db.execute(sql`SELECT 1 FROM "TelegramLink" WHERE "userId" = ${U2}`)).rows).toHaveLength(0);
    const code2 = codeOf((await tg.createLinkCode(U2, { db })).deepLink);
    await tg.consumeLinkCode(code2, 555000333, { db });
    expect(await svc.setPreference(U2, { channel: 'telegram', category: 'reminder', enabled: false, collection: { channel: 'telegram_stop' } })).toMatchObject({ ok: true, telegramLinkRemoved: 1 });
    const consents = (await db.execute(sql`SELECT decision, collection_channel AS c FROM "ConsentLog" WHERE subject_id = ${U2} AND purpose = 'NOTIF_TELEGRAM_REMINDER' ORDER BY created_at`)).rows;
    expect(consents.at(-1)).toEqual({ decision: false, c: 'telegram_stop' });
  });

  it('deleting the account removes its link (ON DELETE CASCADE)', async () => {
    expect((await db.execute(sql`SELECT 1 FROM "TelegramLink" WHERE "userId" = ${U}`)).rows.length).toBe(1);
    await db.execute(sql`DELETE FROM "ParcoursItem" WHERE "userId" = ${U}`);
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id = ${U}`);
    expect((await db.execute(sql`SELECT 1 FROM "TelegramLink" WHERE "userId" = ${U}`)).rows).toHaveLength(0);
  });
});
