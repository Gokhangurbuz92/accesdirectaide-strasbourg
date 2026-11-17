// @ts-nocheck
/**
 * C12 (owner decision b, 17/11/2026) — the ONLY writer of the documents of /ressources ("ResourceAccessibility") and of their publication ledger
 * ("ResourcePublicationEvent", migration 0050). A static test asserts that no other file writes them.
 *
 * Life of a document: draft → published → withdrawn (a withdrawn or a draft document can be edited again, which makes it a draft). Every step is the
 * explicit action of a NAMED administrator with MFA (api/_handlers/admin/resources.js, adminGate write), recorded in the append-only ledger and in the
 * administration journal in the SAME transaction. Nothing is ever published automatically: there is no import, schedule or model path to publish().
 *
 * What a publication requires (checked here, never trusted from the form):
 *  - a title (5–200 characters), a type (guide, tool, document, link) and a description (20–5 000), plain text only: anything that looks like HTML is
 *    REFUSED (not silently stripped) and the public pages render text, never markup;
 *  - an official source: an https address whose host is on the official-source allow-list (the same rule as D-5 human verification,
 *    evidenceUrlAllowed: product list, ADA_VERIFICATION_EXTRA_DOMAINS, the seed and the attested sites of the source registry) and the name of its
 *    publisher;
 *  - a verification « vérifié le »: a named administrator confirms, with a note of what was checked, the exact content version they read
 *    (expectedVersion); the date is the server's clock at that action, never a client value and never an import time. Any later edit clears it;
 *  - a current verification: no older than the catalogue's limit (maxAgeDays, 180 days by default; beyond 90 days the public page says an update is
 *    due) — beyond it the document leaves the public list on its own until it is verified again (same rule as api/lib/publicVisibility.js).
 * Rows created before 0050 have no publisher, no verification and no reviewer: they are never public (whatever their old status) until a human
 * completes and verifies them. No source or date is ever invented for them.
 */
import crypto from 'node:crypto';
import { evidenceUrlAllowed } from './content-verification.js';
import { CURRENT_DAYS, maxAgeDays } from '../lib/publicVisibility.js';

export const TYPES = Object.freeze(['guide', 'tool', 'document', 'link']);
export const STATUSES = Object.freeze(['draft', 'published', 'withdrawn']);
export const ACTOR_TYPE = 'admin';
const DAY = 86400000;

/** control characters out, trimmed, length-capped; markup is NOT removed here (it is refused by problems()) */
// eslint-disable-next-line no-control-regex
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
/** text that a browser could read as markup or an entity */
export const looksLikeMarkup = (s) => /<\s*[a-z!/?]|&[a-z]+;|&#\d+;/i.test(String(s || ''));

/** normalises what the editor sent; never trusts types @param {any} input */
export function normalise(input) {
  const type = String(input?.type || '').trim();
  return {
    title: clean(input?.title, 200),
    type: TYPES.includes(type) ? type : '',
    content: clean(input?.content, 5000),
    source_url: clean(input?.source_url, 500),
    source_publisher: clean(input?.source_publisher, 160),
    territory_scope: clean(input?.territory_scope, 80) || null,
  };
}

/** the https address as the server will store it, or '' (no credentials, no fragment trickery, https only) @param {string} raw */
export function httpsUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return '';
    return u.toString();
  } catch { return ''; }
}

/**
 * What prevents a verification or a publication. A draft may be saved with problems (they are shown to the editor), except UNSAFE_* ones.
 * @param {ReturnType<typeof normalise>} d @param {{ env?: Record<string, string | undefined>, trustedDomains?: string[] }} [o] @returns {string[]}
 */
export function problems(d, { env = process.env, trustedDomains = [] } = {}) {
  const p = [];
  if (d.title.length < 5) p.push('TITLE_TOO_SHORT');
  if (!d.type) p.push('TYPE_REQUIRED');
  if (d.content.length < 20) p.push('DESCRIPTION_TOO_SHORT');
  for (const [k, v] of [['TITLE', d.title], ['DESCRIPTION', d.content], ['PUBLISHER', d.source_publisher], ['TERRITORY', d.territory_scope]]) if (looksLikeMarkup(v)) p.push(`UNSAFE_MARKUP_${k}`);
  if (!d.source_url) p.push('SOURCE_URL_REQUIRED');
  else if (!httpsUrl(d.source_url)) p.push('UNSAFE_SOURCE_URL_NOT_HTTPS');
  else if (!evidenceUrlAllowed(httpsUrl(d.source_url), env, trustedDomains)) p.push('SOURCE_DOMAIN_NOT_OFFICIAL');
  if (d.source_publisher.length < 2) p.push('SOURCE_PUBLISHER_REQUIRED');
  return p;
}

/** sha-256 of the public content of a document (what a reviewer confirms) @param {Record<string, any>} r */
export function contentVersion(r) {
  return crypto.createHash('sha256').update(JSON.stringify(['title', 'type', 'content', 'source_url', 'source_publisher', 'territory_scope'].map((k) => [k, r?.[k] ?? null]))).digest('hex');
}

/**
 * May this document be shown to the public, and how fresh is its verification. The same rule as the public handler's SQL filter, plus the content check.
 * @param {Record<string, any> | null | undefined} r @param {{ now?: Date, maxAge?: number }} [o]
 * @returns {{ visible: boolean, freshness: 'current' | 'update_needed' | null, reasons: string[] }}
 */
export function decideResource(r, { now = new Date(), maxAge = maxAgeDays() } = {}) {
  const reasons = [];
  if (!r) return { visible: false, freshness: null, reasons: ['NOT_FOUND'] };
  if (r.status !== 'published') reasons.push(r.status === 'withdrawn' ? 'WITHDRAWN' : 'NOT_PUBLISHED');
  if (!httpsUrl(r.source_url)) reasons.push('NO_OFFICIAL_SOURCE');
  if (!String(r.source_publisher || '').trim()) reasons.push('NO_SOURCE_PUBLISHER');
  if (!r.reviewer_id || !r.reviewer_type) reasons.push('NO_REVIEWER');
  if (!r.verified_version || r.verified_version !== contentVersion(r)) reasons.push(r.verified_version ? 'CHANGED_SINCE_VERIFICATION' : 'NOT_VERIFIED');
  let freshness = null;
  const t = r.verified_at ? new Date(r.verified_at).getTime() : NaN;
  if (!Number.isFinite(t)) reasons.push('NO_VERIFICATION_DATE');
  else if (t > now.getTime() + DAY) reasons.push('VERIFICATION_IN_FUTURE');
  else {
    const age = (now.getTime() - t) / DAY;
    if (age > maxAge) reasons.push('VERIFICATION_STALE');
    else freshness = age <= CURRENT_DAYS ? 'current' : 'update_needed';
  }
  return reasons.length ? { visible: false, freshness: null, reasons } : { visible: true, freshness, reasons };
}

/** the public view of a visible document: never the reviewer's identity, never internal notes @param {Record<string, any>} r @param {'current' | 'update_needed' | null} freshness */
export function publicView(r, freshness) {
  return { id: r.id, slug: r.slug, title: r.title, type: r.type, content: r.content, territory_scope: r.territory_scope || null, source_url: r.source_url,
    source_publisher: r.source_publisher, verified_at: r.verified_at, published_at: r.published_at || null, freshness };
}

const slugify = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const err = (code, status = 400, extra = {}) => Object.assign(new Error(code), { code, status, ...extra });

/**
 * The workflow against the database (passed in for tests). Every write needs 0050 (has0050) — without it: 503 MIGRATION_0050_REQUIRED.
 * @param {{ db: any, schema: any, ops: any, has0050: boolean, now?: () => Date, env?: any, trustedDomains?: string[] }} deps
 */
export function resourcePublication({ db, schema, ops, has0050, now = () => new Date(), env = process.env, trustedDomains = [] }) {
  const { ResourceAccessibility: R, ResourcePublicationEvent: E, AuditLog } = schema; const { eq, desc } = ops;
  const need = () => { if (!has0050) throw err('MIGRATION_0050_REQUIRED', 503); };
  const check = (d) => problems(d, { env, trustedDomains });
  const ledger = (tx, row, actor, action, toStatus, extra = {}) => Promise.all([
    tx.insert(E).values({ resourceId: row.id, action, fromStatus: row.status ?? null, toStatus, actorType: ACTOR_TYPE, actorId: actor, sourceUrl: extra.sourceUrl ?? row.source_url ?? null,
      sourcePublisher: extra.sourcePublisher ?? row.source_publisher ?? null, contentVersion: extra.version ?? null, note: extra.note ?? null }),
    tx.insert(AuditLog).values({ action: `RESOURCE_${action}`, actor, actor_id: actor, entity: 'ResourceAccessibility', entity_id: row.id,
      details: { from: row.status ?? null, to: toStatus, contentVersion: extra.version ?? null }, ip_hash: 'ADMIN_MFA' }),
  ]);
  const locked = async (tx, id) => {
    const [row] = await tx.select().from(R).where(eq(R.id, id)).for('update');
    if (!row) throw err('NOT_FOUND', 404);
    return row;
  };
  /** a document whose verification is in force (published or ready to publish): edits must not silently change what was confirmed */
  const verifiedPublished = (row) => row.status === 'published' && !!row.verified_at;
  const view = (row) => ({ ...row, version: contentVersion(row), problems: check(normalise(row)), publicDecision: decideResource(row, { now: now(), maxAge: maxAgeDays(env) }),
    legacy: !row.reviewer_id && !row.verified_at && !row.source_publisher });

  return {
    async list() {
      need();
      const rows = await db.select().from(R).orderBy(desc(R.updatedAt)).limit(500);
      return rows.map(view);
    },
    async get(id) {
      need();
      const [row] = await db.select().from(R).where(eq(R.id, id)).limit(1);
      if (!row) return null;
      const events = await db.select().from(E).where(eq(E.resourceId, id)).orderBy(desc(E.createdAt)).limit(100);
      return { ...view(row), events };
    },
    /** a new draft; markup and a non-https source are refused at once, other gaps are listed for the editor */
    async create(actor, input) {
      need();
      const d = normalise(input);
      const p = check(d);
      if (d.title.length < 5 || !d.type || p.some((x) => x.startsWith('UNSAFE_'))) throw err('DRAFT_REFUSED', 422, { problems: p });
      const id = crypto.randomUUID();
      let slug = `${slugify(d.title) || 'document'}-${id.slice(0, 6)}`;
      return db.transaction(async (tx) => {
        const clash = await tx.select({ id: R.id }).from(R).where(eq(R.slug, slug)).limit(1);
        if (clash[0]) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
        const row = { id, slug, ...d, source_url: httpsUrl(d.source_url) || null, source_publisher: d.source_publisher || null, status: 'draft' };
        await tx.insert(R).values(row);
        await ledger(tx, { ...row, status: null }, actor, 'CREATE', 'draft', { version: contentVersion(row) });
        return { id, slug, status: 'draft', problems: p };
      });
    },
    /** edit a draft, a withdrawn document or a legacy row (before 0050, never verified): it becomes a draft and any verification is cleared */
    async edit(actor, id, input) {
      need();
      const d = normalise(input);
      const p = check(d);
      if (d.title.length < 5 || !d.type || p.some((x) => x.startsWith('UNSAFE_'))) throw err('DRAFT_REFUSED', 422, { problems: p });
      return db.transaction(async (tx) => {
        const row = await locked(tx, id);
        if (verifiedPublished(row)) throw err('WITHDRAW_BEFORE_EDITING', 409);
        const patch = { ...d, source_url: httpsUrl(d.source_url) || null, source_publisher: d.source_publisher || null, status: 'draft',
          verified_at: null, reviewer_type: null, reviewer_id: null, verified_version: null };
        await tx.update(R).set(patch).where(eq(R.id, id));
        await ledger(tx, row, actor, 'EDIT', 'draft', { version: contentVersion({ ...row, ...patch }), sourceUrl: patch.source_url, sourcePublisher: patch.source_publisher });
        return { id, status: 'draft', problems: p };
      });
    },
    /**
     * « vérifié le »: the administrator confirms, against the official source, the exact version they read. Allowed on a draft (before publication) and
     * on a published document (renewing a verification that is getting old, the content unchanged). The date is the server's clock.
     */
    async verify(actor, id, { expectedVersion, note } = {}) {
      need();
      const n = clean(note, 1000);
      if (n.length < 10) throw err('VERIFICATION_NOTE_REQUIRED');
      if (looksLikeMarkup(n)) throw err('VERIFICATION_REFUSED', 422, { problems: ['UNSAFE_MARKUP_NOTE'] });
      return db.transaction(async (tx) => {
        const row = await locked(tx, id);
        if (!['draft', 'published'].includes(row.status)) throw err('NOT_VERIFIABLE_IN_THIS_STATUS', 409);
        // a row « published » before 0050 was never verified: verifying it here would publish it without the explicit publication step — edit it first
        if (row.status === 'published' && !row.verified_at) throw err('LEGACY_ROW_EDIT_FIRST', 409);
        const version = contentVersion(row);
        if (!/^[0-9a-f]{64}$/.test(String(expectedVersion || '')) || expectedVersion !== version) throw err('STALE_REVIEW', 409);
        const p = check(normalise(row));
        if (p.length) throw err('VERIFICATION_REFUSED', 422, { problems: p });
        const at = now();
        await tx.update(R).set({ verified_at: at, reviewer_type: ACTOR_TYPE, reviewer_id: actor, verified_version: version }).where(eq(R.id, id));
        await ledger(tx, row, actor, 'VERIFY', row.status, { version, note: n });
        return { id, status: row.status, verified_at: at.toISOString() };
      });
    },
    /** the explicit publication of a verified draft (never automatic) */
    async publish(actor, id) {
      need();
      return db.transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status !== 'draft') throw err('NOT_A_DRAFT', 409);
        const p = check(normalise(row));
        const decision = decideResource({ ...row, status: 'published' }, { now: now(), maxAge: maxAgeDays(env) });
        const all = [...p, ...decision.reasons];
        if (all.length) throw err('PUBLICATION_REFUSED', 422, { problems: [...new Set(all)] });
        const at = now();
        await tx.update(R).set({ status: 'published', published_at: at, withdrawn_at: null, withdrawal_reason: null }).where(eq(R.id, id));
        await ledger(tx, row, actor, 'PUBLISH', 'published', { version: contentVersion(row) });
        return { id, status: 'published', slug: row.slug };
      });
    },
    /** off the public list at once; the reason stays in the ledger and the administration (never shown to the public) */
    async withdraw(actor, id, reason) {
      need();
      const r = clean(reason, 500);
      if (r.length < 10) throw err('WITHDRAWAL_REASON_REQUIRED');
      return db.transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status !== 'published') throw err('NOT_PUBLISHED', 409);
        await tx.update(R).set({ status: 'withdrawn', withdrawn_at: now(), withdrawal_reason: r }).where(eq(R.id, id));
        await ledger(tx, row, actor, 'WITHDRAW', 'withdrawn', { version: contentVersion(row), note: r });
        return { id, status: 'withdrawn' };
      });
    },
  };
}
