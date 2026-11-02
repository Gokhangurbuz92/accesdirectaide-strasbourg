/**
 * PKG-11 / P10 — actualités moderation on REAL PostgreSQL (no network: feed items are passed in, no RSS fetch).
 *  - an item from a non-official source is a draft, invisible to the public; a named MFA administrator publishes it and the public feed shows it
 *    (before: PUBLISH wrote 'actif', which no public read ever showed);
 *  - a refresh keeps the row's identity (id, slug — before: a new id at every change) and never overrides a human decision (a rejected item stays
 *    rejected); a changed item returns to review — R34: published ones too, so the automatic verification (R29) reads the new words;
 *  - only an item linking to its source over https can be published; the audit row names the administrator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

const hasDatabase = !!process.env.DATABASE_URL;
const TS = Date.now();
const ADMIN = `p10-admin-${TS}@example.test`;
const URLS = { draft: `https://example.org/p10/${TS}/draft`, rejected: `https://example.org/p10/${TS}/rejected`, official: `https://example.org/p10/${TS}/official`, plain: `http://example.org/p10/${TS}/plain` };
const resOf = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader() { return undefined; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });

describe.skipIf(!hasDatabase)('PKG-11 / P10 actualités moderation (real DB)', () => {
  let db, ingest, actions, publicFeed, auth;
  const item = (url, text) => ({ title: `Actualité P10 ${url.split('/').pop()} ${TS}`, link: url, guid: url, contentSnippet: text, content: text, isoDate: '2026-10-20T10:00:00.000Z' });
  const upsert = (url, text, isOfficial = false) => ingest.upsertActualiteFromFeedItem({ db, source: { id: `p10-src-${TS}`, name: 'P10 Source' }, feedUrl: 'https://example.org/rss.xml', category: 'general', territory: 'FRANCE', item: item(url, text), runId: `p10-${TS}-${Math.random()}`, isOfficial });
  const row = async (url) => (await db.execute(sql`SELECT id, slug, statut, published_at FROM "Actualite" WHERE canonical_url = ${url}`)).rows[0];
  // launch-readiness item 65: a publication / rejection carries its reason
  const act = async (action, ids, token, reason = 'Source officielle consultée : information exacte.') => { const r = resOf(); await actions({ method: 'POST', url: '/api/admin/actions', query: {}, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: { action, ids, ...(reason ? { reason } : {}) } }, r); return r; };
  const publicList = async () => { const r = resOf(); await publicFeed({ method: 'GET', url: '/api/actualites', query: { q: `P10`, pageSize: '50' }, headers: { host: 'localhost' } }, r); return (r.body?.items || []).map((i) => i.canonical_url || i.lien_url || i.url); };

  beforeAll(async () => {
    ({ db } = await import('../../src/db/index.js'));
    ingest = await import('../../api/_handlers/cron/ingest-actualites-rss.js');
    actions = (await import('../../api/_handlers/admin/actions.js')).default;
    publicFeed = (await import('../../api/_handlers/actualites.js')).default;
    auth = await import('../../api/_utils/auth.js');
  }, 60000);
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`DELETE FROM "AuditLog" WHERE actor = ${ADMIN}`).catch(() => {});
    await db.execute(sql`DELETE FROM "Actualite" WHERE canonical_url LIKE ${`%/p10/${TS}/%`}`).catch(() => {});
    await db.execute(sql`DELETE FROM "SourceDocument" WHERE source_url LIKE ${`%/p10/${TS}/%`}`).catch(() => {});
  });

  it('a non-official item is a draft; a named MFA administrator publishes it and the public feed shows it; the audit row names the administrator', async () => {
    expect((await upsert(URLS.draft, 'Texte initial.')).action).toBe('created');
    const draft = await row(URLS.draft);
    expect(draft.statut).toBe('brouillon');
    expect(await publicList()).not.toContain(URLS.draft);
    expect((await act('PUBLISH', [draft.id], auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: false }))).statusCode).toBe(401);   // a write needs the session's MFA
    const noReason = await act('PUBLISH', [draft.id], auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true }), '');   // launch-readiness item 65
    expect([noReason.statusCode, noReason.body.error]).toEqual([400, 'REASON_REQUIRED']);
    expect((await row(URLS.draft)).statut).toBe('brouillon');
    const r = await act('PUBLISH', [draft.id], auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true }));
    expect([r.statusCode, r.body.count]).toEqual([200, 1]);
    expect((await row(URLS.draft)).statut).toBe('publie');
    expect(await publicList()).toContain(URLS.draft);
    const audit = (await db.execute(sql`SELECT action, entity FROM "AuditLog" WHERE actor = ${ADMIN} ORDER BY timestamp DESC LIMIT 1`)).rows[0];
    expect(audit).toEqual({ action: 'ADMIN_BULK_PUBLISH', entity: 'Actualite' });
    expect((await db.execute(sql`SELECT details->>'reason' AS r FROM "AuditLog" WHERE actor = ${ADMIN} AND action = 'ADMIN_BULK_PUBLISH' ORDER BY timestamp DESC LIMIT 1`)).rows[0].r)
      .toBe('Source officielle consultée : information exacte.');
  });

  it('a refresh keeps id and slug; a changed item returns to review, a published one included, so the verification reads the new words', async () => {
    const before = await row(URLS.draft);
    expect((await upsert(URLS.draft, 'Texte modifié par la source.')).action).toBe('updated');
    const after = await row(URLS.draft);
    expect([after.id, after.slug]).toEqual([before.id, before.slug]);
    expect([after.statut, after.published_at]).toEqual(['brouillon', null]);
    // R29 (owner decision 31/10/2026): the ingestion never publishes, even an official item — the automatic verification does (api/_services/news-verification.js).
    // R34: a published item whose source text changes goes back to a draft, so the verification reads the new words; its id and slug stay.
    await upsert(URLS.official, 'Officiel v1.', true);
    const o1 = await row(URLS.official);
    expect(o1.statut).toBe('brouillon');
    await db.execute(sql`UPDATE "Actualite" SET statut = 'publie', published_at = NOW() WHERE id = ${o1.id}`);   // as the verification does when every check passes
    await upsert(URLS.official, 'Officiel v2.', true);
    const o2 = await row(URLS.official);
    expect([o2.id, o2.slug, o2.statut, o2.published_at]).toEqual([o1.id, o1.slug, 'brouillon', null]);
  });

  it('a rejected item stays rejected after a refresh; an item without an https source link cannot be published', async () => {
    const token = auth.signAdminSessionToken({ email: ADMIN, role: 'admin', mfa_verified: true });
    await upsert(URLS.rejected, 'À rejeter.');
    const r0 = await row(URLS.rejected);
    expect((await act('REJECT', [r0.id], token)).body.count).toBe(1);
    await upsert(URLS.rejected, 'À rejeter, texte modifié.');
    const r1 = await row(URLS.rejected);
    expect([r1.id, r1.statut]).toEqual([r0.id, 'rejected']);
    // R12 (P10): a plain-http item is no longer kept as a draft — it is refused at ingestion and nothing is stored
    await expect(upsert(URLS.plain, 'Lien non sécurisé.')).rejects.toThrow(/https/);
    expect(await row(URLS.plain)).toBeFalsy();
  });
});
