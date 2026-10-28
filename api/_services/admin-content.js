// @ts-nocheck
/**
 * PKG-11 / A02 — administration of the catalogue (aides, démarches, structures, dispositifs, guides). Before: the admin screens wrote to the PUBLIC read-only endpoints
 * (/api/aides answered 405, /api/demarches 501, /api/structures 405) — no record could be created, edited, (un)published or removed — and they listed through
 * the public API, so a draft or an unverified record was invisible to the administrators themselves.
 *  - editorial fields only, per kind (allow-list, types from the table definition); never the D-5 verification projection, which only the ContentVerification
 *    ledger writes (/api/admin/content-verification), nor the FALC texts, which only their review workflow writes (/admin/falc);
 *  - a new record is always a draft, never verified; status changes are limited to draft ↔ published (publication still needs the D-5 verification);
 *  - every change keeps the exact prior row (EntityVersion, A07) in the same transaction; changing the content of a VERIFIED record puts it on hold through the
 *    ledger (« contenu modifié : à revérifier ») until a reviewer verifies it again;
 *  - removal is an archive (statut), never a physical delete; every write is journalised (fields named, no content).
 * Dispositifs follow the same D-5 rules as aides. Guides are ADA's own editorial content (no verification projection: a published guide is public); their steps
 * (contenu_json) and a dispositif's links (liens) are validated structures, never free JSON. The first publication dates the record (published_at).
 */
import crypto from 'node:crypto';
import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { db as defaultDb } from '../../src/db/index.js';
import { Aide, AuditLog, Demarche, Dispositif, Guide, Structure } from '../../src/db/schema.js';
import { ensureSlugOrNull } from '../_utils/slug.js';
import { isEditHold, snapshotRow } from './content-versions.js';
import { holdForReverification } from './content-verification.js';

export const KINDS = {
  aide: { table: Aide, label: 'titre', published: 'publie', fields: ['titre', 'categorie', 'cest_quoi', 'pour_qui', 'ce_que_ca_aide', 'delai_indicatif', 'documents_necessaires', 'ou_demander', 'lien_demande', 'source_url', 'mots_cles', 'est_urgent', 'territoires', 'departements'] },
  demarche: { table: Demarche, label: 'titre', published: 'publie', fields: ['titre', 'categorie', 'description_courte', 'contenu_detaille', 'pour_qui', 'ou_faire', 'lien_officiel', 'documents_necessaires', 'delai', 'cout', 'mots_cles', 'departements'] },
  structure: { table: Structure, label: 'nom', published: 'actif', fields: ['nom', 'type_structure', 'description_courte', 'adresse', 'code_postal', 'ville', 'departement', 'telephone', 'email', 'site_web', 'horaires', 'services', 'publics_accueillis', 'categories_aidees', 'accessibilite_pmr', 'source_url'] },
  dispositif: { table: Dispositif, label: 'titre', published: 'publie', fields: ['titre', 'description_falc', 'summary_falc', 'public', 'departement', 'montant', 'liens', 'related_aide_ids', 'related_structure_ids', 'source_url'], base: { public: [] },
    refs: { related_aide_ids: Aide, related_structure_ids: Structure } },
  guide: { table: Guide, label: 'titre', published: 'publie', fields: ['titre', 'resume_falc', 'contenu_json', 'categorie', 'publics', 'contexte', 'mots_cles', 'sources_urls'], base: { publics: [], contexte: [], mots_cles: [], sources_urls: [] } },
};
export const KIND_NAMES = Object.keys(KINDS);
const UNKNOWN = () => bad(400, 'UNKNOWN_KIND', `kind must be ${KIND_NAMES.join(', ')}.`);
/** FALC texts are written only through their review workflow (/admin/falc, PKG-6 D19): origin, reviewer and date stay true. Dispositifs and guides have no such
 *  workflow (no review columns): their easy-to-read texts are ordinary editorial fields. */
const FALC_FIELDS = { aide: ['summary_falc', 'conditions_falc', 'montant_falc'], demarche: ['summary_falc'], structure: ['summary_falc'] };
const httpsUrl = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
/** Structured JSON columns: validated shapes, never free JSON. Returns undefined when the value has another shape. */
const JSON_FIELDS = {
  // a guide's steps as GuideDetail renders them: { titre, texte, image? } (an existing image path is kept, never invented)
  contenu_json: (v) => (Array.isArray(v) && v.length <= 50 && v.every((x) => x && typeof x === 'object' && typeof x.titre === 'string' && typeof x.texte === 'string' && (x.image === undefined || typeof x.image === 'string'))
    ? v.map((x) => ({ titre: x.titre.trim().slice(0, 300), texte: x.texte.trim().slice(0, 8000), ...(x.image ? { image: x.image.slice(0, 500) } : {}) })).filter((x) => x.titre || x.texte) : undefined),
  // a dispositif's links as DispositifDetail renders them: { nom, url } with an https address
  liens: (v) => (Array.isArray(v) && v.length <= 30 && v.every((x) => x && typeof x === 'object' && typeof x.nom === 'string' && typeof x.url === 'string' && httpsUrl(x.url.trim()))
    ? v.map((x) => ({ nom: x.nom.trim().slice(0, 200), url: x.url.trim().slice(0, 2000) })) : undefined),
};
const DRAFT = 'brouillon'; const ARCHIVED = 'archive';
const MAX_TEXT = 20000;
const bad = (status, code, message) => ({ ok: false, status, code, message });

const columnsOf = (table) => Object.fromEntries(getTableConfig(table).columns.map((c) => [c.name, c]));
/** Coerce one editorial value to its column type; returns undefined when the value cannot be stored as such. */
function coerce(col, value) {
  if (value === null || value === '') return col.notNull ? undefined : null;
  if (col.columnType === 'PgJsonb') return JSON_FIELDS[col.name] ? JSON_FIELDS[col.name](value) : undefined;
  if (col.columnType === 'PgBoolean') return typeof value === 'boolean' ? value : undefined;
  // R24: a record's département codes are real INSEE codes (an Aide drafted as « Grand Est » listed 01..57); a change is held for re-verification like any content
  if (col.columnType === 'PgArray' && col.name === 'departements') return Array.isArray(value) && value.length <= 101 && value.every((x) => typeof x === 'string' && /^(0[1-9]|[1-8]\d|9[0-5]|2A|2B|97[1-6])$/.test(x.trim())) ? [...new Set(value.map((x) => x.trim()))] : undefined;
  if (col.columnType === 'PgArray') return Array.isArray(value) && value.every((x) => typeof x === 'string') ? value.map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 2000)) : undefined;
  if (col.columnType === 'PgText' || col.columnType === 'PgVarchar') return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : undefined;
  return undefined;
}

/** @returns {{ ok: true, values: Record<string, any> } | ReturnType<typeof bad>} */
export function editorialValues(kind, input, { creating = false } = {}) {
  const k = KINDS[kind]; if (!k) return UNKNOWN();
  const cols = columnsOf(k.table); const values = {}; const rejected = [];
  for (const [field, value] of Object.entries(input || {})) {
    if (field === 'statut') continue;
    if ((FALC_FIELDS[kind] || []).includes(field)) return bad(400, 'FALC_FIELD', 'Les textes faciles à lire (FALC) se modifient dans « Textes faciles à lire » : ils y sont relus et signés.');
    if (!k.fields.includes(field)) { if (!['id', 'slug', 'updatedAt', 'createdAt'].includes(field)) rejected.push(field); continue; }
    const v = coerce(cols[field], value);
    if (v === undefined) return bad(400, 'INVALID_VALUE', `Valeur invalide pour « ${field} ».`);
    values[field] = v;
  }
  if (rejected.length) return bad(400, 'FIELD_NOT_EDITABLE', `Champs non modifiables ici : ${rejected.join(', ')} (la vérification passe par le registre de vérification).`);
  if ('statut' in (input || {})) {
    if (![DRAFT, k.published].includes(input.statut)) return bad(400, 'INVALID_STATUS', `Statut possible : « ${DRAFT} » ou « ${k.published} » (l’archivage a sa propre action).`);
    values.statut = input.statut;
  }
  if (creating && !String(values[k.label] || '').trim()) return bad(400, 'LABEL_REQUIRED', k.label === 'nom' ? 'Le nom est obligatoire.' : 'Le titre est obligatoire.');
  if (creating && kind === 'structure') for (const f of ['adresse', 'code_postal', 'ville']) if (!String(values[f] || '').trim()) return bad(400, 'FIELD_REQUIRED', `« ${f} » est obligatoire pour une structure.`);
  return { ok: true, values };
}

/** PKG-11 / P09: linked records are given by identifier or by slug; each must exist (stored as identifiers). Their publication is decided on the public side. */
async function resolveRefs(kind, values, db) {
  const refs = KINDS[kind].refs || {};
  for (const [field, table] of Object.entries(refs)) {
    if (!(field in values)) continue;
    const wanted = [...new Set(values[field])].slice(0, 50); const ids = [];
    for (const w of wanted) {
      const [row] = await db.select({ id: table.id }).from(table).where(or(eq(table.id, w), eq(table.slug, w))).limit(1);
      if (!row) return bad(400, 'INVALID_REFERENCE', `Fiche liée introuvable : « ${w} ».`);
      if (!ids.includes(row.id)) ids.push(row.id);
    }
    values[field] = ids;
  }
  return null;
}

const audit = (tx, action, actor, kind, id, details) => tx.insert(AuditLog).values({ action, actor, actor_id: actor, entity: kind, entity_id: id, details, ip_hash: 'ADMIN_MFA' });

export async function listContent(kind, { q = '' } = {}, db = defaultDb) {
  const k = KINDS[kind]; if (!k) return UNKNOWN();
  const t = k.table; const label = t[k.label];
  const where = q ? or(ilike(label, `%${String(q).slice(0, 100)}%`), eq(t.id, String(q))) : undefined;
  const rows = await db.select({ id: t.id, slug: t.slug, label, statut: t.statut, updatedAt: t.updatedAt,
    ...(t.verification_status ? { verification_status: t.verification_status, publication_hold: t.publication_hold } : {}),
    ...(kind === 'structure' ? { ville: t.ville } : kind === 'dispositif' ? { departement: t.departement } : { categorie: t.categorie }) }).from(t).where(where).orderBy(desc(t.updatedAt)).limit(500);
  // owner LAB audit (2026-10-25): the list told every hold « en attente de revérification » — a reviewer's own HOLD decision on a never-verified record
  // included. The kind of hold is now explicit: EDIT (the record changed after a verification) or DECISION (a person put it on hold, with a reason).
  return { ok: true, items: rows.map((r) => (r.publication_hold ? { ...r, holdKind: isEditHold(r.publication_hold) ? 'EDIT' : 'DECISION' } : r)) };
}

/** Owner LAB audit — the version of what the editor loaded (its editable fields and statut): a save sent with it is refused if the record changed in between
 *  (two administrators editing the same record: the second save used to overwrite the first one's change without a word). */
export function editVersion(kind, row) {
  const k = KINDS[kind]; if (!k || !row) return null;
  return crypto.createHash('sha256').update(JSON.stringify([...k.fields, 'statut'].map((f) => [f, row[f] ?? null]))).digest('hex');
}

export async function readContent(kind, id, db = defaultDb) {
  const k = KINDS[kind]; if (!k) return UNKNOWN();
  const [row] = await db.select().from(k.table).where(eq(k.table.id, String(id || ''))).limit(1);
  if (!row) return bad(404, 'not_found', 'Fiche introuvable.');
  const { embedding: _e, ...rest } = row;
  return { ok: true, item: rest, editable: k.fields, published: k.published, verified: Boolean(k.table.verification_status), version: editVersion(kind, row) };
}

export async function createContent(kind, input, actor, db = defaultDb) {
  const v = editorialValues(kind, input, { creating: true }); if (!v.ok) return v;
  const k = KINDS[kind];
  const refErr = await resolveRefs(kind, v.values, db); if (refErr) return refErr;
  const slug = ensureSlugOrNull(`${v.values[k.label]}-${crypto.randomBytes(3).toString('hex')}`);
  return db.transaction(async (tx) => {
    const base = kind === 'structure' ? { services: [], publics_accueillis: [], categories_aidees: [], accessibilite_pmr: false } : (k.base || {});
    const [row] = await tx.insert(k.table).values({ ...base, ...v.values, slug, statut: DRAFT, ...(k.table.data_origin ? { data_origin: 'admin_entry' } : {}) }).returning({ id: k.table.id, slug: k.table.slug });
    await audit(tx, 'ADMIN_CONTENT_CREATED', actor, kind, row.id, { fields: Object.keys(v.values) });
    return { ok: true, status: 201, item: { id: row.id, slug: row.slug, statut: DRAFT } };
  });
}

export async function updateContent(kind, id, input, actor, db = defaultDb) {
  const { expectedVersion, ...fieldsIn } = input || {};
  const v = editorialValues(kind, fieldsIn); if (!v.ok) return v;
  const k = KINDS[kind];
  if (!Object.keys(v.values).length) return bad(400, 'NOTHING_TO_CHANGE', 'Aucun champ modifiable.');
  const refErr = await resolveRefs(kind, v.values, db); if (refErr) return refErr;
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(k.table).where(eq(k.table.id, String(id || ''))).for('update');
    if (!row) return bad(404, 'not_found', 'Fiche introuvable.');
    if (typeof expectedVersion === 'string' && expectedVersion && expectedVersion !== editVersion(kind, row)) return bad(409, 'EDIT_CONFLICT', 'La fiche a été modifiée depuis que vous l’avez ouverte : rechargez-la (vos changements ne sont pas enregistrés).');
    if (row.statut === ARCHIVED || row.status_code === 'ARCHIVED') return bad(409, 'ARCHIVED', 'Fiche archivée : restaurez une version avant de la modifier.');
    const changed = Object.keys(v.values).filter((f) => JSON.stringify(row[f] ?? null) !== JSON.stringify(v.values[f] ?? null));
    if (!changed.length) return { ok: true, status: 200, item: { id: row.id, statut: row.statut }, changed: [] };
    // PKG-11 audit: a structure's statut also carries the ORGANIZATION's activity (suspended, closed; dossier access needs 'actif'). The catalogue only moves a
    // directory entry between draft and published: a suspended organization is never reactivated here, and an organization with active members is never cut off
    // here — both go through the organization lifecycle (reason, audit, notices).
    if (kind === 'structure' && changed.includes('statut')) {
      if (![DRAFT, k.published].includes(row.statut)) return bad(409, 'ORGANIZATION_LIFECYCLE', 'Cette organisation est suspendue ou fermée : son activité se gère dans « Organisations », pas dans le catalogue.');
      if (row.statut === k.published && v.values.statut === DRAFT) {
        const [m] = (await tx.execute(sql`SELECT count(*)::int AS n FROM "ProUser" WHERE "structureId" = ${row.id} AND status = 'active'`)).rows;
        if (m?.n > 0) return bad(409, 'ORGANIZATION_LIFECYCLE', 'Cette organisation a des membres actifs : la retirer se fait par une suspension motivée dans « Organisations ».');
      }
    }
    await snapshotRow(tx, kind, row.id, `before admin edit (${changed.join(', ')})`, actor);
    const firstPublication = changed.includes('statut') && v.values.statut === k.published && k.table.published_at && !row.published_at;
    await tx.update(k.table).set({ ...Object.fromEntries(changed.map((f) => [f, v.values[f]])), ...(firstPublication ? { published_at: new Date() } : {}) }).where(eq(k.table.id, row.id));
    const contentChanged = changed.filter((f) => f !== 'statut');
    // PKG-11 audit pass 2: the edit hold is placed whatever hold already exists (a manual hold « montant à confirmer » used to stay a plain hold, so a RELEASE
    // republished text no reviewer saw under the old verification); the manual reason is kept after the marker. An existing edit hold is left as it is.
    const held = await holdForReverification(tx, kind, row, contentChanged, actor);
    await audit(tx, 'ADMIN_CONTENT_UPDATED', actor, kind, row.id, { fields: changed, heldForReverification: held });
    return { ok: true, status: 200, item: { id: row.id, statut: v.values.statut || row.statut }, changed, heldForReverification: held };
  });
}

export async function archiveContent(kind, id, actor, db = defaultDb) {
  const k = KINDS[kind]; if (!k) return UNKNOWN();
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: k.table.id, statut: k.table.statut }).from(k.table).where(eq(k.table.id, String(id || ''))).for('update');
    if (!row) return bad(404, 'not_found', 'Fiche introuvable.');
    if (row.statut === ARCHIVED) return { ok: true, status: 200, item: { id: row.id, statut: ARCHIVED } };
    // PKG-11 audit pass 2: a structure's statut is also its ORGANIZATION's activity — archiving here cut every member's dossier access without reason or notice,
    // and nothing could undo it. Same rule as an edit: only a draft or published directory entry without active members; the rest is the organization lifecycle.
    if (kind === 'structure') {
      if (![DRAFT, k.published].includes(row.statut)) return bad(409, 'ORGANIZATION_LIFECYCLE', 'Cette organisation est suspendue ou fermée : son activité se gère dans « Organisations », pas dans le catalogue.');
      const [m] = (await tx.execute(sql`SELECT count(*)::int AS n FROM "ProUser" WHERE "structureId" = ${row.id} AND status = 'active'`)).rows;
      if (m?.n > 0) return bad(409, 'ORGANIZATION_LIFECYCLE', 'Cette organisation a des membres actifs : la retirer se fait par une suspension ou une fermeture motivée dans « Organisations ».');
    }
    await snapshotRow(tx, kind, row.id, 'before archive', actor);
    await tx.update(k.table).set({ statut: ARCHIVED, ...(kind === 'aide' ? { status_code: 'ARCHIVED' } : {}) }).where(eq(k.table.id, row.id));   // an aide archive decision always wins (D-5)
    await audit(tx, 'ADMIN_CONTENT_ARCHIVED', actor, kind, row.id, { previousStatut: row.statut });
    return { ok: true, status: 200, item: { id: row.id, statut: ARCHIVED } };
  });
}

