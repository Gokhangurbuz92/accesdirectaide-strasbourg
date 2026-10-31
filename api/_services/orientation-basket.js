// @ts-nocheck
/**
 * R18 (R31) — ADA Pro « Sélections d'orientation »: a professional's working basket of VERIFIED public records (aides, démarches, lieux d'accueil) organized around
 * a person's needs, with why each item is suggested, its official source and verification date, a follow-up mark and a printable summary.
 *
 * What it is not:
 *   - an eligibility decision: every summary says that only the organization in charge decides;
 *   - a copy of a dossier: a basket holds references and codes; the label and the professional's reasons (which may describe a situation) are sealed
 *     (purpose orientation-basket, context basket:<id>);
 *   - a new sharing channel: a summary reaches the person only as a citizen-visible note on a case the organization holds under the person's grant
 *     (pro-cases.addNote: same consent, same access rule, same closed-case rule). P16 (public guided orientation) and R09 (referral to another organization)
 *     stay where they are: a basket can be the starting point of a referral, it never replaces one.
 * Access: the author and the organization's administrators (as for cases), active members only. Each read re-reads the public catalogue with the D-5 rule
 * (publicVisibility.visibleSql): an item that is no longer public is shown as such and left out of any summary.
 */
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { ProOrientationBasket } from '../../src/db/schema.js';
import { FOLLOW_UPS, ITEM_KINDS, ORIENTATION_NEEDS, needLabel, needsOfCategories } from '../../src/config/orientationNeeds.js';
import { visibleSql } from '../lib/publicVisibility.js';
import { activeMemberSql } from '../_utils/share-access.js';
import { openText, sealText } from '../lib/data-keys.js';
import { addNote, isAdmin } from './pro-cases.js';

export const MAX_ITEMS = 30;
export const MAX_ACTIVE_BASKETS = 50;
const NEED_CODES = ORIENTATION_NEEDS.map((n) => n.code);
const KINDS = Object.keys(ITEM_KINDS);
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const notFound = () => bad('not_found', 'Sélection introuvable.', 404);
const seal = (id, data) => sealText(JSON.stringify(data), { purpose: 'orientation-basket', context: `basket:${id}` });
const open = (row) => { try { return JSON.parse(openText(row.privateEncrypted, { purpose: 'orientation-basket', context: `basket:${row.id}` }) || '{}'); } catch { return {}; } };
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const codes = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((c) => NEED_CODES.includes(c)))];

/** the public catalogue, one query per kind (D-5 rule; lab mode shows the labelled fixtures, never in production) */
const CATALOGUE = {
  aide: { table: 'Aide', alias: 'a', title: sql`COALESCE(a.title, a.titre)`, summary: sql`COALESCE(a.description, a.cest_quoi)`, cats: sql`ARRAY[a.categorie]`, path: '/aides/' },
  demarche: { table: 'Demarche', alias: 'd', title: sql`d.titre`, summary: sql`d.description_courte`, cats: sql`ARRAY[d.categorie]`, path: '/demarches/' },
  structure: { table: 'Structure', alias: 's', title: sql`s.nom`, summary: sql`s.description_courte`, cats: sql`s.categories_aidees`, path: '/structures/', place: sql`s.ville` },
};
function selectFrom(kind, where, limit) {
  const k = CATALOGUE[kind];
  return sql`SELECT ${sql.raw(`'${kind}'`)} AS kind, ${sql.raw(k.alias)}.id, ${sql.raw(k.alias)}.slug, ${k.title} AS title, ${k.summary} AS summary, ${k.cats} AS categories,
      ${k.place ?? sql`NULL::text`} AS place, COALESCE(NULLIF(btrim(${sql.raw(k.alias)}.source_url_exact), ''), ${sql.raw(k.alias)}.source_url) AS "sourceUrl", ${sql.raw(k.alias)}.date_verification AS "verifiedAt"
    FROM ${sql.raw(`"${k.table}" ${k.alias}`)} WHERE ${visibleSql(kind, { alias: k.alias })} AND ${where} LIMIT ${limit}`;
}
const publicItem = (r) => ({ kind: r.kind, refId: r.id, title: r.title, summary: r.summary ? clean(r.summary, 220) : null, place: r.place || null, path: `${CATALOGUE[r.kind].path}${r.slug || r.id}`,
  sourceUrl: r.sourceUrl || null, verifiedAt: r.verifiedAt, needs: needsOfCategories((r.categories || []).filter(Boolean)), categories: (r.categories || []).filter(Boolean) });

async function member(ctx, db) {
  return (await db.execute(sql`SELECT 1 AS ok WHERE ${activeMemberSql(ctx)}`)).rows.length > 0;
}
async function load(id, ctx, db) {
  const [row] = (await db.execute(sql`SELECT *, "updatedAt"::text AS stamp FROM "ProOrientationBasket" WHERE id = ${String(id || '')} AND "structureId" = ${ctx.structureId}
    AND (${isAdmin(ctx)} OR "ownerProUserId" = ${ctx.userId}) AND ${activeMemberSql(ctx)}`)).rows;
  return row || null;
}

/** Search the verified catalogue (titles and summaries, accents ignored), optionally narrowed to the needs' categories. */
export async function searchCatalogue(ctx, { q = '', kinds = KINDS, needCodes = [] } = {}, db = defaultDb) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const term = clean(q, 80);
  if (term.length < 2) return { ok: true, status: 200, results: [] };
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const wanted = (Array.isArray(kinds) ? kinds : [kinds]).filter((k) => KINDS.includes(k));
  const results = [];
  for (const kind of wanted.length ? wanted : KINDS) {
    const k = CATALOGUE[kind];
    const match = sql`(unaccent(lower(${k.title})) LIKE unaccent(lower(${like})) OR unaccent(lower(COALESCE(${k.summary}, ''))) LIKE unaccent(lower(${like})))`;
    for (const r of (await db.execute(selectFrom(kind, match, 12))).rows) results.push(publicItem(r));
  }
  const needs = codes(needCodes);
  // items matching a chosen need come first; the search never hides a verified record because its category is missing
  results.sort((a, b) => Number(b.needs.some((n) => needs.includes(n))) - Number(a.needs.some((n) => needs.includes(n))) || String(a.title).localeCompare(String(b.title), 'fr'));
  return { ok: true, status: 200, results };
}

/** why an item is in the basket, from the needs chosen and the item's own categories (never an eligibility statement) */
export function whyText(item, needCodes, reason) {
  const matched = (item.needs || []).filter((n) => needCodes.includes(n));
  const cats = (item.categories || []).join(', ');
  const base = matched.length
    ? `Correspond au besoin ${matched.map((n) => `« ${needLabel(n)} »`).join(' et ')}${cats ? ` (catégorie de la fiche : ${cats})` : ''}.`
    : `Ajouté par la ou le professionnel ; la catégorie de la fiche${cats ? ` (${cats})` : ''} ne correspond à aucun des besoins choisis.`;
  return reason ? `${base} Motif indiqué : ${reason}` : base;
}

async function resolveItems(items, db) {
  const found = new Map();
  for (const kind of KINDS) {
    const ids = items.filter((i) => i.kind === kind).map((i) => i.refId);
    if (!ids.length) continue;
    const alias = CATALOGUE[kind].alias;
    for (const r of (await db.execute(selectFrom(kind, sql`${sql.raw(alias)}.id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`, MAX_ITEMS))).rows) found.set(`${kind}:${r.id}`, publicItem(r));
  }
  return found;
}

async function view(row, db, ctx) {
  const priv = open(row);
  const items = Array.isArray(row.items) ? row.items : [];
  const found = await resolveItems(items, db);
  const needCodes = row.needCodes || [];
  return {
    id: row.id, label: priv.label || 'Sélection', needCodes, needs: needCodes.map((c) => ({ code: c, label: needLabel(c) })), caseId: row.caseId, status: row.status,
    sharedAt: row.sharedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, mine: row.ownerProUserId === ctx?.userId,
    items: items.map((i) => {
      const pub = found.get(`${i.kind}:${i.refId}`);
      const reason = priv.reasons?.[i.key] || '';
      return pub
        ? { key: i.key, ...pub, kindLabel: ITEM_KINDS[i.kind], followUp: i.followUp, followUpLabel: FOLLOW_UPS[i.followUp], reason, why: whyText(pub, needCodes, reason), stillPublic: true, addedAt: i.addedAt }
        : { key: i.key, kind: i.kind, refId: i.refId, kindLabel: ITEM_KINDS[i.kind], followUp: i.followUp, followUpLabel: FOLLOW_UPS[i.followUp], reason, stillPublic: false, addedAt: i.addedAt,
          why: 'Cette fiche n’est plus publiée (retirée ou plus vérifiée) : elle ne figure plus dans le récapitulatif.' };
    }),
  };
}

export async function listBaskets(ctx, { status = 'ACTIVE' } = {}, db = defaultDb) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const rows = (await db.execute(sql`SELECT * FROM "ProOrientationBasket" WHERE "structureId" = ${ctx.structureId} AND status = ${status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'}
    AND (${isAdmin(ctx)} OR "ownerProUserId" = ${ctx.userId}) ORDER BY "updatedAt" DESC LIMIT 100`)).rows;
  return { ok: true, status: 200, baskets: rows.map((r) => ({ id: r.id, label: open(r).label || 'Sélection', needCodes: r.needCodes || [], itemCount: (r.items || []).length, caseId: r.caseId,
    sharedAt: r.sharedAt, updatedAt: r.updatedAt, mine: r.ownerProUserId === ctx.userId })), needs: ORIENTATION_NEEDS.map(({ code, label }) => ({ code, label })), followUps: FOLLOW_UPS };
}

export async function getBasket(id, ctx, db = defaultDb) {
  const row = await load(id, ctx, db);
  if (!row) return notFound();
  return { ok: true, status: 200, basket: await view(row, db, ctx) };
}

export async function createBasket(ctx, input, db = defaultDb) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const label = clean(input?.label, 80);
  if (label.length < 2) return bad('INVALID_LABEL', 'Donnez un nom à la sélection (2 à 80 caractères), sans nom de personne.');
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "ProOrientationBasket" WHERE "structureId" = ${ctx.structureId} AND "ownerProUserId" = ${ctx.userId} AND status = 'ACTIVE'`)).rows;
  if (n >= MAX_ACTIVE_BASKETS) return bad('TOO_MANY', `Vous avez déjà ${MAX_ACTIVE_BASKETS} sélections en cours : archivez-en une d’abord.`, 409);
  const id = crypto.randomUUID();
  await db.insert(ProOrientationBasket).values({ id, structureId: ctx.structureId, ownerProUserId: ctx.userId, needCodes: codes(input?.needCodes), items: [], privateEncrypted: seal(id, { label, reasons: {} }) });
  return { ok: true, status: 201, basket: await view(await load(id, ctx, db), db, ctx) };
}

/** every write is a compare-and-set on updatedAt: two tabs cannot silently overwrite each other */
async function write(row, patch, ctx, db) {
  const rows = (await db.execute(sql`UPDATE "ProOrientationBasket" SET ${sql.join(Object.entries(patch).map(([k, v]) => sql`${sql.raw(`"${k}"`)} = ${v}`), sql`, `)}, "updatedAt" = now()
    WHERE id = ${row.id} AND "updatedAt"::text = ${row.stamp} RETURNING id`)).rows;
  if (!rows.length) return bad('CONFLICT', 'La sélection a changé entre-temps (autre onglet ?). Rechargez la page.', 409);
  return { ok: true, status: 200, basket: await view(await load(row.id, ctx, db), db, ctx) };
}
const itemsJson = (items) => sql`${JSON.stringify(items)}::jsonb`;
const needsArray = (list) => sql`${`{${list.join(',')}}`}::text[]`;

export async function updateBasket(id, ctx, input, db = defaultDb) {
  const row = await load(id, ctx, db);
  if (!row) return notFound();
  const priv = open(row);
  const patch = {};
  if (input?.label !== undefined) {
    const label = clean(input.label, 80);
    if (label.length < 2) return bad('INVALID_LABEL', 'Donnez un nom à la sélection (2 à 80 caractères), sans nom de personne.');
    patch.privateEncrypted = seal(row.id, { ...priv, label });
  }
  if (input?.needCodes !== undefined) patch.needCodes = needsArray(codes(input.needCodes));
  if (input?.status !== undefined) {
    if (!['ACTIVE', 'ARCHIVED'].includes(input.status)) return bad('INVALID_STATUS', 'État inconnu.');
    patch.status = input.status;
  }
  if (!Object.keys(patch).length) return { ok: true, status: 200, basket: await view(row, db, ctx) };
  return write(row, patch, ctx, db);
}

export async function addItem(id, ctx, input, db = defaultDb) {
  const row = await load(id, ctx, db);
  if (!row) return notFound();
  if (row.status !== 'ACTIVE') return bad('ARCHIVED', 'Cette sélection est archivée : rouvrez-la d’abord.', 409);
  const kind = String(input?.kind || ''); const refId = String(input?.refId || '');
  if (!KINDS.includes(kind) || !refId) return bad('INVALID_ITEM', 'Élément inconnu.');
  const items = Array.isArray(row.items) ? row.items : [];
  if (items.some((i) => i.kind === kind && i.refId === refId)) return bad('ALREADY_IN', 'Cet élément est déjà dans la sélection.', 409);
  if (items.length >= MAX_ITEMS) return bad('TOO_MANY_ITEMS', `Une sélection compte au plus ${MAX_ITEMS} éléments.`, 409);
  // only a record the public can see right now (same D-5 rule as the public pages) can be recommended
  if (!(await resolveItems([{ kind, refId }], db)).size) return bad('NOT_PUBLIC', 'Cette fiche n’est pas publiée ou n’est plus vérifiée : elle ne peut pas être recommandée.', 409);
  const key = crypto.randomUUID().slice(0, 8);
  const reason = clean(input?.reason, 280);
  const priv = open(row);
  return write(row, { items: itemsJson([...items, { key, kind, refId, followUp: 'A_PROPOSER', addedAt: new Date().toISOString() }]),
    ...(reason ? { privateEncrypted: seal(row.id, { ...priv, reasons: { ...(priv.reasons || {}), [key]: reason } }) } : {}) }, ctx, db);
}

export async function updateItem(id, ctx, input, db = defaultDb) {
  const row = await load(id, ctx, db);
  if (!row) return notFound();
  const items = Array.isArray(row.items) ? row.items : [];
  const it = items.find((i) => i.key === String(input?.key || ''));
  if (!it) return bad('ITEM_NOT_FOUND', 'Élément introuvable dans la sélection.', 404);
  const patch = {};
  if (input?.followUp !== undefined) {
    if (!FOLLOW_UPS[input.followUp]) return bad('INVALID_FOLLOW_UP', 'Suivi inconnu.');
    patch.items = itemsJson(items.map((i) => (i.key === it.key ? { ...i, followUp: input.followUp } : i)));
  }
  if (input?.reason !== undefined) {
    const priv = open(row);
    patch.privateEncrypted = seal(row.id, { ...priv, reasons: { ...(priv.reasons || {}), [it.key]: clean(input.reason, 280) } });
  }
  return Object.keys(patch).length ? write(row, patch, ctx, db) : { ok: true, status: 200, basket: await view(row, db, ctx) };
}

export async function removeItem(id, ctx, key, db = defaultDb) {
  const row = await load(id, ctx, db);
  if (!row) return notFound();
  const items = Array.isArray(row.items) ? row.items : [];
  if (!items.some((i) => i.key === key)) return bad('ITEM_NOT_FOUND', 'Élément introuvable dans la sélection.', 404);
  const priv = open(row); const { [key]: _gone, ...reasons } = priv.reasons || {};
  return write(row, { items: itemsJson(items.filter((i) => i.key !== key)), privateEncrypted: seal(row.id, { ...priv, reasons }) }, ctx, db);
}

/** Link the basket to a case the caller may open RIGHT NOW (the case's grant, membership and assignment rule: pro-cases / share-access). */
export async function linkCase(id, ctx, caseId, db = defaultDb) {
  const row = await load(id, ctx, db);
  if (!row) return notFound();
  if (!caseId) return write(row, { caseId: null }, ctx, db);
  const [ok] = (await db.execute(sql`SELECT 1 AS ok FROM "ProCase" c WHERE c.id = ${String(caseId)} AND c."structureId" = ${ctx.structureId} AND EXISTS (SELECT 1 FROM "SharedDossierGrant" g
    WHERE g."sharedDiagnosticId" = c."sharedDiagnosticId" AND g."structureId" = c."structureId" AND g."revokedAt" IS NULL)
    AND (${isAdmin(ctx)} OR c."assigneeProUserId" IS NULL OR c."assigneeProUserId" = ${ctx.userId})`)).rows;
  if (!ok) return bad('CASE_NOT_AVAILABLE', 'Ce dossier n’est pas ouvert pour vous (partage retiré, ou dossier attribué à quelqu’un d’autre).', 404);
  return write(row, { caseId: String(caseId) }, ctx, db);
}

/** why, as the PERSON reads it: the need it answers, from the catalogue only (the professional's working label and reasons stay with the professional) */
export function personWhy(item, needCodes) {
  const matched = (item.needs || []).filter((n) => needCodes.includes(n));
  return matched.length ? `En lien avec votre besoin ${matched.map((n) => `« ${needLabel(n)} »`).join(' et ')}.` : 'Proposé par la personne qui vous accompagne.';
}

/** The text the person receives (and the printout): public items only, each with why, official source and verification date, and the orientation-not-decision notice. */
export function summaryText(basket, { structureName = '', origin = '' } = {}) {
  const day = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : 'date inconnue');
  const shown = basket.items.filter((i) => i.stillPublic && i.followUp !== 'SANS_SUITE');
  const lines = [`Pistes d’orientation préparées pour vous${structureName ? ` par ${structureName}` : ''} le ${day(new Date())}.`];
  if (basket.needs.length) lines.push(`Besoins pris en compte : ${basket.needs.map((n) => n.label).join(', ')}.`);
  lines.push('Ces pistes sont une orientation, pas une décision : seul l’organisme concerné décide de vos droits, après examen de votre situation.', '');
  shown.forEach((i, n) => {
    lines.push(`${n + 1}. ${i.title} (${i.kindLabel}${i.place ? `, ${i.place}` : ''})`, `   Pourquoi : ${personWhy(i, basket.needCodes || [])}`);
    if (i.sourceUrl) lines.push(`   Source officielle : ${i.sourceUrl} (vérifiée le ${day(i.verifiedAt)})`);
    lines.push(`   Fiche : ${origin}${i.path}`);
  });
  if (!shown.length) lines.push('Aucune piste à transmettre pour le moment.');
  return lines.join('\n');
}

/** Post the summary as a CITIZEN-visible note on the linked case (pro-cases.addNote re-checks the grant and the access rule; closed case = refused). */
export async function shareToCase(id, ctx, { structureName = '', origin = '' } = {}, db = defaultDb) {
  const row = await load(id, ctx, db);
  if (!row) return notFound();
  if (!row.caseId) return bad('NO_CASE', 'Reliez d’abord la sélection à un dossier suivi : la personne la verra dans son espace, au titre du partage qu’elle vous a accordé.', 409);
  const basket = await view(row, db, ctx);
  if (!basket.items.some((i) => i.stillPublic && i.followUp !== 'SANS_SUITE')) return bad('EMPTY', 'Aucune piste publiée à transmettre.', 409);
  const out = await addNote(row.caseId, { visibility: 'CITIZEN', body: summaryText(basket, { structureName, origin }).slice(0, 4000) }, ctx, db);
  if (out.ok === false) return out;
  await db.execute(sql`UPDATE "ProOrientationBasket" SET "sharedAt" = now(), items = ${itemsJson(row.items.map((i) => (i.followUp === 'A_PROPOSER' ? { ...i, followUp: 'PROPOSE' } : i)))}, "updatedAt" = now() WHERE id = ${row.id}`);
  return { ok: true, status: 200, shared: true, noteId: out.note.id, basket: await view(await load(row.id, ctx, db), db, ctx) };
}
