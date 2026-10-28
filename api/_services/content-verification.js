// @ts-nocheck
/**
 * PKG-1 / D-5 — the ONLY writer of the verification columns (launch_eligible, verification_status, verified_by, territory_verified, publication_hold, date_verification).
 *
 * Authority (owner decision D-5 v2, 2026-10-25): a named HUMAN reviewer (admin JWT with MFA; the handler enforces it) or the automatic verification chain
 * (api/_services/verification/chain.js, reviewer « ada-veille-automatique », role « system »), which decides only from official sources and records its evidence. A language
 * model never decides: it may draft texts, which the chain checks against the source before anything is published. The time is the server's clock, never a client value
 * (a static test asserts that no other file writes these columns). Every action appends a row to the append-only ContentVerification ledger in the SAME transaction as the
 * projection update, so the entity columns can never claim something the ledger does not contain.
 */
import crypto from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { EDIT_HOLD_PREFIX, isEditHold, snapshotRow } from './content-versions.js';
import { Aide, Demarche, Structure, Dispositif, ContentVerification, AuditLog } from '../../src/db/schema.js';
import { ALLOWED_DOMAINS, isAllowedSource } from '../lib/services/official-sources.js';
import { decide } from '../lib/publicVisibility.js';

export const ENTITY_TABLES = { aide: Aide, demarche: Demarche, structure: Structure, dispositif: Dispositif };
export const ACTIONS = ['VERIFY', 'REJECT', 'HOLD', 'RELEASE_HOLD'];
const OUTCOME = { VERIFY: 'VERIFIED', REJECT: 'REJECTED', HOLD: 'HOLD', RELEASE_HOLD: 'RELEASE_HOLD' };

/**
 * Evidence must be an https URL on the product's official-source allow-list (host match), on the owner-extended list ADA_VERIFICATION_EXTRA_DOMAINS (comma-separated
 * hosts), or on a domain of the registry of official sources (trustedDomains: the starting list and the sites the Annuaire de l'administration attests, see
 * api/_services/verification/sources.js).
 */
export function evidenceUrlAllowed(url, env = process.env, trustedDomains = []) {
  let host = '';
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (isAllowedSource(String(url))) return true;
  const extra = [...String(env.ADA_VERIFICATION_EXTRA_DOMAINS || '').split(','), ...(Array.isArray(trustedDomains) ? trustedDomains : [])].map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  return extra.some((d) => host === d || host.endsWith('.' + d));
}
export { ALLOWED_DOMAINS };

const fail = (status, code, message) => ({ ok: false, status, code, message });

/**
 * Owner LAB audit — what a reviewer compares with the official source: every PUBLIC field of an aide, a démarche, a structure or a dispositif (texts, amounts,
 * conditions, steps, links, contact, address, the service area insee_codes, provenance). Not the verification projection, the workflow, sync or search columns.
 */
export const REVIEW_FIELDS = ['titre', 'nom', 'title', 'categorie', 'type_structure', 'theme', 'sub_theme', 'summary_falc', 'description_falc', 'description_courte', 'description',
  'content', 'cest_quoi', 'ce_que_ca_aide', 'pour_qui', 'public', 'public_cible', 'audiences', 'situations_vie', 'est_urgent', 'eligibility', 'conditions_falc', 'montant',
  'montant_falc', 'montant_max', 'financials', 'cout', 'delai', 'delai_indicatif', 'documents_necessaires', 'etapes', 'contenu_detaille', 'ou_demander', 'ou_faire', 'lien_demande',
  'lien_demarche', 'lien_officiel', 'lien_teleservice', 'apply_url', 'liens', 'sources', 'adresse', 'code_postal', 'ville', 'departement', 'telephone', 'email', 'site_web',
  'horaires', 'services', 'publics_accueillis', 'categories_aidees', 'accessibilite_pmr', 'siret', 'rna_id', 'numero_finess', 'territoires', 'departements', 'territory_scope',
  'geo_scope', 'echelon_territorial', 'code_insee_territoire', 'region_codes', 'department_codes', 'insee_codes', 'related_aide_ids', 'related_structure_ids', 'source_url',
  'source_url_exact', 'source_name', 'source_org', 'providerName', 'services_externes'];
const shown = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
/** The fields to show, in full (no truncation): [{ field, value }]. @param {Record<string, any> | null} j the row as to_jsonb */
export function reviewContent(j) {
  return REVIEW_FIELDS.filter((k) => j && Object.prototype.hasOwnProperty.call(j, k) && !shown(j[k]))
    .map((k) => ({ field: k, value: Array.isArray(j[k]) ? j[k].map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : typeof j[k] === 'object' ? JSON.stringify(j[k], null, 1) : String(j[k]) }));
}
/** sha-256 of the public content exactly as the reviewer saw it (absent fields included). @param {Record<string, any> | null} j the row as to_jsonb */
export function contentVersion(j) {
  return crypto.createHash('sha256').update(JSON.stringify(REVIEW_FIELDS.map((k) => [k, j && Object.prototype.hasOwnProperty.call(j, k) ? j[k] : null]))).digest('hex');
}
/** The row as to_jsonb (the representation both the review views and the decision check hash). @param {any} db @param {string} entityType @param {string} id */
export async function rowJson(db, entityType, id) {
  const table = { aide: 'Aide', demarche: 'Demarche', structure: 'Structure', dispositif: 'Dispositif' }[entityType];
  if (!table) return null;
  // an isolated unit-test double of src/db (no raw SQL): the drizzle row stands in (same field names; the real database always takes the to_jsonb path)
  if (typeof db.execute !== 'function') { const [row] = await db.select().from(ENTITY_TABLES[entityType]).where(eq(ENTITY_TABLES[entityType].id, String(id))); return row ? JSON.parse(JSON.stringify(row)) : null; }
  const [r] = (await db.execute(sql`SELECT to_jsonb(t) AS j FROM ${sql.raw(`"${table}"`)} t WHERE id = ${String(id)} LIMIT 1`)).rows;
  return r ? r.j : null;
}

/**
 * Owner LAB audit — a VERIFIED record whose public content another path changed (catalogue edit, accepted proposal, approved FALC text…) is put on the edit hold
 * that only a new VERIFY lifts (it was done by the catalogue editor alone: an accepted proposal or an approved FALC text republished unreviewed content).
 * @param {any} tx @param {string} entityType @param {Record<string, any>} row the row BEFORE the change @param {string[]} fields @param {string} actor
 * @param {{ role?: string, prefix?: string }} [opts] an import passes role « system » and its own prefix (api/_services/source-updates.js)
 */
export async function holdForReverification(tx, entityType, row, fields, actor, opts = {}) {
  if (row.verification_status !== 'VERIFIED' || !fields.length || isEditHold(row.publication_hold)) return false;
  const reason = `${opts.prefix || EDIT_HOLD_PREFIX} (${fields.join(', ')}) : à revérifier${row.publication_hold ? ` · ${row.publication_hold}` : ''}`.slice(0, 500);
  const r = await recordVerification({ entityType, entityId: row.id, action: 'HOLD', holdReason: reason, reviewer: { id: actor, role: opts.role || 'admin' } }, { db: tx });
  if (!r.ok) throw Object.assign(new Error('hold failed'), { code: r.code });
  return true;
}

/**
 * @param {{ entityType: string, entityId: string, action: string, reviewer: { id: string, role: string }, sourceUrl?: string, evidenceNote?: string, territoryConfirmed?: boolean, holdReason?: string, expectedVersion?: string }} input
 *   expectedVersion: the contentVersion the reviewer saw; when given, the decision is refused (409 STALE_REVIEW) if the record changed since (the HTTP handler requires
 *   it for VERIFY and RELEASE_HOLD). The ledger keeps the version decided on.
 * @param {{ db?: any, now?: Date, env?: Record<string, string | undefined>, trustedDomains?: string[] }} [deps]
 */
export async function recordVerification(input, deps = {}) {
  const db = deps.db || defaultDb; const now = deps.now || new Date(); const env = deps.env || process.env;
  const table = ENTITY_TABLES[input.entityType];
  if (!table) return fail(400, 'UNKNOWN_ENTITY_TYPE', 'entityType must be one of aide, demarche, structure, dispositif.');
  if (!ACTIONS.includes(input.action)) return fail(400, 'UNKNOWN_ACTION', 'action must be VERIFY, REJECT, HOLD or RELEASE_HOLD.');
  if (!input.entityId || typeof input.entityId !== 'string') return fail(400, 'ENTITY_ID_REQUIRED', 'entityId is required.');
  if (!input.reviewer?.id) return fail(403, 'NO_HUMAN_REVIEWER', 'A verification needs an identified human reviewer.');
  const note = String(input.evidenceNote || '').trim();
  const sourceUrl = String(input.sourceUrl || '').trim();

  if (input.action === 'VERIFY') {
    if (note.length < 20) return fail(400, 'EVIDENCE_NOTE_REQUIRED', 'Describe the evidence (at least 20 characters): what was checked, where, and what it shows.');
    if (input.territoryConfirmed !== true) return fail(400, 'TERRITORY_CONFIRMATION_REQUIRED', 'territoryConfirmed must be true: the reviewer confirms the territorial applicability.');
    if (!sourceUrl || !evidenceUrlAllowed(sourceUrl, env, deps.trustedDomains)) return fail(400, 'EVIDENCE_URL_NOT_ALLOWED', 'sourceUrl must be an https URL of an allowed official domain (or of ADA_VERIFICATION_EXTRA_DOMAINS).');
  }
  if (input.action === 'HOLD' && String(input.holdReason || '').trim().length < 5) return fail(400, 'HOLD_REASON_REQUIRED', 'holdReason is required (at least 5 characters).');
  if (input.action === 'REJECT' && note.length < 5) return fail(400, 'EVIDENCE_NOTE_REQUIRED', 'Say why the record is rejected (at least 5 characters).');

  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(table).where(eq(table.id, input.entityId)).for('update');
    if (!row) return fail(404, 'ENTITY_NOT_FOUND', 'No such record.');
    const version = contentVersion(await rowJson(tx, input.entityType, input.entityId));
    if (input.expectedVersion !== undefined && input.expectedVersion !== version) return fail(409, 'STALE_REVIEW', 'Le contenu de la fiche a changé depuis votre lecture : rechargez-la et relisez-la avant de décider.');
    /** @type {Record<string, any>} */ let patch;
    if (input.action === 'VERIFY') {
      // PKG-11 audit: a hold put by a content change is lifted BY the re-verification itself (atomically); any other hold must be released first
      if (row.publication_hold && !isEditHold(row.publication_hold)) return fail(409, 'PUBLICATION_HOLD_ACTIVE', 'Release the publication hold first.');
      if (row.data_origin === 'synthetic_fixture') return fail(409, 'SYNTHETIC_CANNOT_BE_VERIFIED', 'A synthetic fixture can never be verified.');
      patch = {
        verification_status: 'VERIFIED', verified_by: input.reviewer.id, date_verification: now, territory_verified: true, launch_eligible: true, data_origin: 'official',
        ...(String(row.source_url || '').trim() || String(row.source_url_exact || '').trim() ? {} : { source_url: sourceUrl }),
        ...(isEditHold(row.publication_hold) ? { publication_hold: null } : {}),
      };
    } else if (input.action === 'REJECT') {
      patch = { verification_status: 'REJECTED', launch_eligible: false, territory_verified: false };
    } else if (input.action === 'HOLD') {
      // PKG-11 audit pass 2: a new hold on a record held for re-verification keeps the marker (it used to overwrite it, and a RELEASE then republished unreviewed text)
      const reason = String(input.holdReason).trim();
      patch = { publication_hold: (isEditHold(row.publication_hold) && !isEditHold(reason) ? `${row.publication_hold} · ${reason}` : reason).slice(0, 500) };
    } else {
      // PKG-11 audit: releasing an edit hold would republish text no reviewer saw under the OLD verification: a fresh VERIFY is required instead
      if (isEditHold(row.publication_hold) && row.verification_status === 'VERIFIED') return fail(409, 'REVERIFICATION_REQUIRED', 'This record changed after its verification: verify it again (VERIFY) to publish it.');
      patch = { publication_hold: null };
    }
    await snapshotRow(tx, input.entityType, input.entityId, `before ${input.action}`, input.reviewer.id);   // PKG-5 / A07: exact prior version kept
    await tx.update(table).set(patch).where(eq(table.id, input.entityId));
    await tx.insert(ContentVerification).values({
      entityType: input.entityType, entityId: input.entityId, outcome: OUTCOME[input.action], reviewerId: input.reviewer.id, reviewerRole: input.reviewer.role,
      sourceUrl: sourceUrl || null, evidenceNote: note || input.holdReason || null, territoryConfirmed: input.action === 'VERIFY' ? true : false, verifiedAt: now, contentVersion: version,
    });
    // the decision is also in the administration journal (/admin/audit), with the version decided on; the ledger stays the authority (same transaction)
    await tx.insert(AuditLog).values({ action: `CONTENT_${OUTCOME[input.action]}`, actor: input.reviewer.id, actor_id: input.reviewer.id, entity: input.entityType, entity_id: input.entityId,
      details: { contentVersion: version, sourceUrl: sourceUrl || null }, ip_hash: input.reviewer.role === 'system' ? (input.reviewer.id === 'ada-veille-automatique' ? 'SYSTEM_VEILLE' : 'SYSTEM_IMPORT') : 'ADMIN_MFA' });
    const [after] = await tx.select().from(table).where(eq(table.id, input.entityId));
    return { ok: true, status: 200, decision: decide(after, input.entityType) };
  });
}

/** @param {string} entityType @param {string} entityId @param {{ db?: any }} [deps] */
export async function describeVerification(entityType, entityId, deps = {}) {
  const db = deps.db || defaultDb;
  const table = ENTITY_TABLES[entityType];
  if (!table) return fail(400, 'UNKNOWN_ENTITY_TYPE', 'entityType must be one of aide, demarche, structure, dispositif.');
  const [row] = await db.select().from(table).where(eq(table.id, entityId)).limit(1);
  if (!row) return fail(404, 'ENTITY_NOT_FOUND', 'No such record.');
  const history = await db.select().from(ContentVerification).where(and(eq(ContentVerification.entityType, entityType), eq(ContentVerification.entityId, entityId))).orderBy(desc(ContentVerification.createdAt)).limit(50);
  const j = await rowJson(db, entityType, entityId);
  return { ok: true, status: 200, decision: decide(row, entityType), history, content: reviewContent(j), version: contentVersion(j),
    hold: row.publication_hold || null, editHold: isEditHold(row.publication_hold), verificationStatus: row.verification_status || null };
}
