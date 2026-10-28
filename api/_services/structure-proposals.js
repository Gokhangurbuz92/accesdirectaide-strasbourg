// @ts-nocheck
/**
 * PKG-4 / E02 E05 E08 — Espace Structure profile. A structure's administrators PROPOSE changes to their public record (address, hours, contact, accessibility, FALC summary,
 * service area); nothing they type is published by itself (D-5): an ADA reviewer with an MFA admin session accepts or rejects each proposal, and only an accepted proposal
 * writes the Structure row. One pending proposal per field (a newer one withdraws the older). Provenance: author, time, previous value, reviewer, decision note.
 * The organization export (E08) contains the organization's own records only — never a citizen's dossier content. Closing the organization's space and erasing its
 * own data is requested here and decided by two ADA reviewers (api/_services/org-closure.js).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { snapshotRow } from './content-versions.js';
import { AuditLog, ProUser, Structure, StructureProposal } from '../../src/db/schema.js';
import { evidenceUrlAllowed } from './content-verification.js';
import { closureState, requestClosure } from './org-closure.js';

/** D-5: fields whose change moves WHERE the organization serves — accepting one without confirming the territory withdraws territory_verified (fail-closed). */
export const GEOGRAPHY_FIELDS = ['adresse', 'code_postal', 'ville', 'service_area'];

const text = (max) => (v) => { const s = String(v ?? '').trim(); return s.length >= 1 && s.length <= max ? s : null; };
const INSEE = /^(\d{5}|2[AB]\d{3})$/;
export const FIELDS = {
  adresse: text(300),
  code_postal: (v) => (/^\d{5}$/.test(String(v ?? '').trim()) ? String(v).trim() : null),
  ville: text(120),
  horaires: text(1000),
  telephone: (v) => { const s = String(v ?? '').trim(); return /^[0-9 +().-]{6,25}$/.test(s) ? s : null; },
  email: (v) => { const s = String(v ?? '').trim().toLowerCase(); return s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null; },
  site_web: (v) => { try { const u = new URL(String(v ?? '').trim()); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null; } catch { return null; } },
  accessibilite_pmr: (v) => (['true', 'false'].includes(String(v)) ? String(v) : null),
  summary_falc: text(2000),
  service_area: (v) => {
    const codes = [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
    return codes.length >= 1 && codes.length <= 300 && codes.every((c) => INSEE.test(c)) ? codes.sort().join(',') : null;
  },
};
const COLUMN = { service_area: 'insee_codes' };
const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
export const isStructureAdmin = (ctx) => ['structure_admin', 'STRUCTURE_ADMIN'].includes(String(ctx.role || ''));

const currentValue = (s, field) => {
  const v = s[field === 'service_area' ? 'insee_codes' : field];
  if (Array.isArray(v)) return [...v].sort().join(',') || null;
  if (typeof v === 'boolean') return String(v);
  return v ?? null;
};
const PUBLIC_COLUMNS = ['nom', 'adresse', 'code_postal', 'ville', 'horaires', 'telephone', 'email', 'site_web', 'accessibilite_pmr', 'summary_falc', 'insee_codes', 'verification_status', 'statut', 'date_verification'];
const pick = (s) => Object.fromEntries(PUBLIC_COLUMNS.map((k) => [k, s[k] ?? null]));
const viewProposal = (p) => ({ id: p.id, field: p.field, proposedValue: p.proposedValue, previousValue: p.previousValue, status: p.status, createdAt: p.createdAt, reviewedAt: p.reviewedAt, reviewNote: p.reviewNote });

/**
 * R18: the organization's OWN space (its record, its proposals, its data export, its closure request) is open to its active members while ADA has not activated it yet
 * ('brouillon': a self-registered organization must be able to send the information ADA needs to verify it) or has suspended it (export and closure stay rights of the
 * organization). Citizen dossiers, the case queue and referrals keep requiring an ACTIVE organization (activeMemberSql). A closed (archived) organization has no space.
 */
async function member(ctx, db) {
  const [row] = (await db.execute(sql`SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM "ProUser" u JOIN "Structure" s ON s.id = u."structureId" WHERE u.id = ${ctx.userId}
    AND u."structureId" = ${ctx.structureId} AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN') AND s.statut IN ('actif', 'brouillon', 'suspendu'))`)).rows;
  return Boolean(row);
}

/** GET profile: the organization's current record + its proposals. Any active member. */
export async function getProfile(ctx, db = defaultDb) {
  if (!(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const s = await db.query.Structure.findFirst({ where: eq(Structure.id, ctx.structureId) });
  if (!s) return bad('not_found', 'Structure introuvable.', 404);
  const proposals = await db.select().from(StructureProposal).where(eq(StructureProposal.structureId, ctx.structureId)).orderBy(desc(StructureProposal.createdAt)).limit(100);
  const closure = isStructureAdmin(ctx) ? (await closureState(ctx.structureId, db)).request : undefined;
  return { ok: true, structure: pick(s), proposals: proposals.map(viewProposal), canPropose: isStructureAdmin(ctx), fields: Object.keys(FIELDS), ...(closure !== undefined ? { closure } : {}) };
}

/** PKG-11 / E08 — the organization's administrator asks ADA to close the space and erase the organization's own data (two ADA reviewers decide). */
export async function requestOrganizationClosure(input, ctx, db = defaultDb) {
  if (!isStructureAdmin(ctx) || !(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  return requestClosure(ctx.structureId, input, { proUserId: ctx.userId }, db);
}

/** POST proposal (administrators of the organization). Replaces the field's pending proposal. */
export async function propose(input, ctx, db = defaultDb) {
  if (!isStructureAdmin(ctx) || !(await member(ctx, db))) return bad('forbidden', 'Seul·e un·e administrateur·rice de la structure peut proposer une modification.', 403);
  const field = String(input?.field || '');
  if (!FIELDS[field]) return bad('invalid_field', 'Champ non modifiable.');
  const value = FIELDS[field](input?.value);
  if (value === null) return bad('invalid_value', 'Valeur invalide pour ce champ.');
  const s = await db.query.Structure.findFirst({ where: eq(Structure.id, ctx.structureId) });
  if (!s) return bad('not_found', 'Structure introuvable.', 404);
  const previous = currentValue(s, field);
  if (previous === value) return bad('unchanged', 'Cette valeur est déjà celle de la fiche.');
  try {
    const created = await db.transaction(async (tx) => {
      await tx.update(StructureProposal).set({ status: 'WITHDRAWN' }).where(and(eq(StructureProposal.structureId, ctx.structureId), eq(StructureProposal.field, field), eq(StructureProposal.status, 'PENDING')));
      const [p] = await tx.insert(StructureProposal).values({ structureId: ctx.structureId, proposedByProUserId: ctx.userId, field, proposedValue: value, previousValue: previous }).returning();
      return p;
    });
    return { ok: true, status: 201, proposal: viewProposal(created) };
  } catch (err) {
    if (String(err?.code || err?.cause?.code) === '23505') return bad('conflict', 'Une autre proposition vient d’être enregistrée pour ce champ.', 409);
    throw err;
  }
}

export async function withdraw(id, ctx, db = defaultDb) {
  if (!isStructureAdmin(ctx) || !(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const rows = await db.update(StructureProposal).set({ status: 'WITHDRAWN' })
    .where(and(eq(StructureProposal.id, String(id || '')), eq(StructureProposal.structureId, ctx.structureId), eq(StructureProposal.status, 'PENDING'))).returning({ id: StructureProposal.id });
  return rows.length ? { ok: true } : bad('not_found', 'Proposition introuvable.', 404);
}

/** E08 — the organization's own data (administrators). No citizen dossier content, no secrets, no tokens. */
export async function exportOrganization(ctx, db = defaultDb) {
  if (!isStructureAdmin(ctx) || !(await member(ctx, db))) return bad('forbidden', 'Accès refusé.', 403);
  const s = await db.query.Structure.findFirst({ where: eq(Structure.id, ctx.structureId) });
  if (!s) return bad('not_found', 'Structure introuvable.', 404);
  const team = await db.select({ email: ProUser.email, role: ProUser.role, status: ProUser.status, createdAt: ProUser.createdAt }).from(ProUser).where(eq(ProUser.structureId, ctx.structureId));
  const proposals = await db.select().from(StructureProposal).where(eq(StructureProposal.structureId, ctx.structureId)).orderBy(desc(StructureProposal.createdAt));
  const counts = (await db.execute(sql`SELECT
      (SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${ctx.structureId}) AS cases,
      (SELECT count(*)::int FROM "ProCase" WHERE "structureId" = ${ctx.structureId} AND status = 'CLOSED') AS "casesClosed",
      (SELECT count(*)::int FROM "Referral" WHERE "fromStructureId" = ${ctx.structureId}) AS "referralsSent",
      (SELECT count(*)::int FROM "Referral" WHERE "toStructureId" = ${ctx.structureId}) AS "referralsReceived"`)).rows[0] || {};
  return { ok: true, export: { generatedAt: new Date().toISOString(), structure: pick(s), team, proposals: proposals.map(viewProposal), activity: counts,
    note: 'Export des données de la structure. Les dossiers des personnes accompagnées n’y figurent pas (ils appartiennent aux personnes). Fermeture de l’espace et effacement des données de la structure : demande depuis « Ma structure », examinée par deux personnes d’ADA.' } };
}

/** ADA review queue (any admin may read; deciding requires the MFA admin session — checked by the handler). */
export async function reviewQueue(db = defaultDb, { status = 'PENDING' } = {}) {
  const rows = await db.select({ p: StructureProposal, nom: Structure.nom }).from(StructureProposal).innerJoin(Structure, eq(Structure.id, StructureProposal.structureId))
    .where(eq(StructureProposal.status, ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'].includes(status) ? status : 'PENDING')).orderBy(StructureProposal.createdAt).limit(200);
  return { ok: true, proposals: rows.map(({ p, nom }) => ({ ...viewProposal(p), structureId: p.structureId, structureNom: nom })) };
}

/**
 * D-5 is never bypassed by a review: accepting needs an https source on the official allow-list (the value is checked against it), it never touches
 * verification_status / launch_eligible / publication_hold / date_verification (a corrected fact is not a renewed verification), and a geography change withdraws
 * territory_verified unless the reviewer confirms the territory explicitly — publication stays derived by api/lib/publicVisibility.js.
 */
export async function decide(id, decision, note, reviewer, db = defaultDb, evidence = {}) {
  try { return await decideOnce(id, decision, note, reviewer, db, evidence); }
  catch (e) { if (e?.stale) return bad('changed_since_proposal', 'La fiche a changé depuis cette proposition : la valeur « actuelle » affichée n’est plus celle de la fiche. Refusez la proposition (la structure pourra la refaire).', 409); throw e; }
}

async function decideOnce(id, decision, note, reviewer, db, evidence) {
  const d = String(decision || '').toUpperCase();
  if (!['ACCEPT', 'REJECT'].includes(d)) return bad('invalid_decision', 'Décision invalide.');
  const reviewNote = String(note || '').trim().slice(0, 1000) || null;
  if (d === 'REJECT' && !reviewNote) return bad('note_required', 'Indiquez le motif du refus (il sera visible par la structure).');
  const sourceUrl = String(evidence?.sourceUrl || '').trim();
  if (d === 'ACCEPT' && !evidenceUrlAllowed(sourceUrl)) return bad('source_required', 'Indiquez la source officielle (https, domaine autorisé) qui confirme cette information.');
  return db.transaction(async (tx) => {
    const [p] = await tx.update(StructureProposal).set({ status: d === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', reviewedBy: reviewer, reviewedAt: new Date(), reviewNote, reviewSourceUrl: d === 'ACCEPT' ? sourceUrl : null })
      .where(and(eq(StructureProposal.id, String(id || '')), eq(StructureProposal.status, 'PENDING'))).returning();
    if (!p) return bad('not_found', 'Proposition introuvable ou déjà traitée.', 404);
    if (d === 'ACCEPT') {
      // owner LAB audit: the reviewer compared the proposal with the value captured when it was made; if the record changed since (another accepted proposal,
      // a catalogue edit, an ingestion), accepting would overwrite a value nobody compared: refused (the transaction rolls the decision back)
      const [live] = await tx.select().from(Structure).where(eq(Structure.id, p.structureId)).for('update');
      if (!live || currentValue(live, p.field) !== p.previousValue) {
        throw Object.assign(new Error('stale proposal'), { stale: true });
      }
      const column = COLUMN[p.field] || p.field;
      const value = p.field === 'service_area' ? p.proposedValue.split(',') : p.field === 'accessibilite_pmr' ? p.proposedValue === 'true' : p.proposedValue;
      const territory = GEOGRAPHY_FIELDS.includes(p.field) && evidence?.territoryConfirmed !== true ? { territory_verified: false } : {};
      await snapshotRow(tx, 'structure', p.structureId, `before accepted proposal ${p.id}`, reviewer);   // PKG-5 / A07
      await tx.update(Structure).set({ [column]: value, updatedBy: reviewer, ...territory }).where(eq(Structure.id, p.structureId));
    }
    // PKG-11 audit: every decision is in the audit log (search and export), not only in the proposal row
    await tx.insert(AuditLog).values({ action: d === 'ACCEPT' ? 'STRUCTURE_PROPOSAL_ACCEPTED' : 'STRUCTURE_PROPOSAL_REJECTED', actor: reviewer, actor_id: reviewer, entity: 'Structure', entity_id: p.structureId,
      details: { proposalId: p.id, field: p.field, sourceUrl: d === 'ACCEPT' ? sourceUrl : null } });
    return { ok: true, proposal: viewProposal(p) };
  });
}
