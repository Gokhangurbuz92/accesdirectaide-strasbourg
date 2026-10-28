/**
 * PKG-2 / C13 on REAL PostgreSQL — the Mon Espace summary now carries the account's MESSAGE state (before: the dashboard tile was a static link): number of
 * conversations, date of the latest message and whether the structure wrote last. No unread count is invented (no read markers exist), no message body is read,
 * and only the person's own conversations count (another citizen's never leak in). Synthetic data only; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now().toString(36);
const ID = (k) => `c13-${k}-${TS}`;

describe.skipIf(!hasDatabase)('C13 Mon Espace message state (real DB)', () => {
  let db, espaceSummary;
  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js')); ({ espaceSummary } = await import('../../api/_services/mon-espace.js'));
    await db.execute(sql`INSERT INTO "Structure" (id, nom, slug, type_structure, adresse, ville, code_postal, accessibilite_pmr, services, publics_accueillis, categories_aidees, statut, verification_status, "updatedAt", "createdAt")
      VALUES (${ID('s')}, 'Org C13', ${ID('s')}, 'association', '1 rue', 'Strasbourg', '67000', false, ARRAY['x'], ARRAY['tout_public'], ARRAY['social'], 'actif', 'VERIFIED', NOW(), NOW())`);
    await db.execute(sql`INSERT INTO "ProRdvService" (id, "structureId", name, "durationMinutes", "updatedAt") VALUES (${ID('svc')}, ${ID('s')}, 'Accueil', 30, NOW())`);
    for (const u of ['me', 'other', 'empty']) await db.execute(sql`INSERT INTO "CitizenUser" (id, email, "passwordHash", "emailVerifiedAt", "updatedAt") VALUES (${ID(u)}, ${ID(u) + '@example.test'}, 'x', NOW(), NOW())`);
    for (const u of ['me', 'other']) {
      await db.execute(sql`INSERT INTO "ProAppointment" (id, "structureId", "serviceId", "startAt", "endAt", "beneficiaryName", "citizenUserId", "updatedAt") VALUES (${ID('ap-' + u)}, ${ID('s')}, ${ID('svc')}, NOW() + interval '2 days', NOW() + interval '2 days 30 minutes', 'Personne', ${ID(u)}, NOW())`);
      await db.execute(sql`INSERT INTO "RdvConversation" (id, "appointmentId", "structureId", "citizenUserId", "updatedAt") VALUES (${ID('conv-' + u)}, ${ID('ap-' + u)}, ${ID('s')}, ${ID(u)}, NOW())`);
    }
    await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", "senderCitizenUserId", body, "createdAt") VALUES (${ID('m1')}, ${ID('conv-me')}, 'USER', ${ID('me')}, 'BODY_SENTINEL_C13_1', NOW() - interval '2 hours')`);
    await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", body, "createdAt") VALUES (${ID('m2')}, ${ID('conv-me')}, 'PRO', 'BODY_SENTINEL_C13_2', NOW() - interval '1 hour')`);
    await db.execute(sql`INSERT INTO "RdvConversationMessage" (id, "conversationId", "senderType", "senderCitizenUserId", body, "createdAt") VALUES (${ID('m3')}, ${ID('conv-other')}, 'USER', ${ID('other')}, 'BODY_SENTINEL_C13_3', NOW())`);
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "CitizenUser" WHERE id LIKE ${'c13-%-' + TS}`);
    await db.execute(sql`DELETE FROM "Structure" WHERE id = ${ID('s')}`);
  });

  it('counts only the person\'s conversations, dates the latest message and says the structure wrote last; no body leaves', async () => {
    const r = await espaceSummary(ID('me'));
    expect(r.summary.messages).toMatchObject({ conversations: 1, lastFromStructure: true });
    expect(new Date(r.summary.messages.lastMessageAt).getTime()).toBeGreaterThan(Date.now() - 2 * 3600 * 1000);
    expect(JSON.stringify(r)).not.toMatch(/BODY_SENTINEL/);
  });
  it('when the person wrote last it is not flagged; with no conversation the state is empty', async () => {
    expect((await espaceSummary(ID('other'))).summary.messages).toMatchObject({ conversations: 1, lastFromStructure: false });
    expect((await espaceSummary(ID('empty'))).summary.messages).toEqual({ conversations: 0, lastMessageAt: null, lastFromStructure: false });
  });
});
