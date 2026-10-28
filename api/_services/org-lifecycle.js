// @ts-nocheck
/**
 * PKG-5 / E01 — organization lifecycle seen by ADA administrators, with the THREE checks kept apart (none stands in for another):
 *   identity  — `verification_status` written only by the MFA content-verification flow (VERIFY with an official source / REJECT): may the organization RECEIVE a
 *               person's dossier or NEW bookings (E01, api/_utils/org-eligibility.js)
 *   activity  — `statut`: actif | suspendu (written here, MFA, written reason, audited) | brouillon (self-signup, not yet activated)
 *   public    — D-5 publication decision derived by api/lib/publicVisibility.js (verification + currency + territory + hold + launch eligibility + provenance)
 * plus the organization's capacity (active members). Suspension blocks new access AND the members' dossier access (share-access requires statut = 'actif'); nothing
 * the person granted is deleted — they keep control — and no appointment is cancelled automatically.
 */
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { snapshotRow } from './content-versions.js';
import { AuditLog } from '../../src/db/schema.js';
import { decide as publicDecision } from '../lib/publicVisibility.js';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });

export async function listOrganizations({ q = '' } = {}, db = defaultDb) {
  const like = `%${String(q).trim().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = (await db.execute(sql`SELECT s.*, (SELECT count(*)::int FROM "ProUser" u WHERE u."structureId" = s.id AND u.status = 'active' AND upper(u.role) IN ('PRO', 'STRUCTURE_ADMIN')) AS "activeMembers"
    FROM "Structure" s WHERE (${String(q).trim() === ''} OR s.nom ILIKE ${like} OR s.ville ILIKE ${like}) ORDER BY s.nom LIMIT 200`)).rows;
  return { ok: true, organizations: rows.map((s) => {
    const pub = publicDecision(s, 'structure');
    return { id: s.id, nom: s.nom, ville: s.ville, statut: s.statut,
      identity: s.verification_status, identityVerifiedBy: s.verified_by ? 'ADA' : null, identityVerifiedAt: s.date_verification,
      canReceiveNew: s.statut === 'actif' && s.verification_status === 'VERIFIED' && s.activeMembers > 0,
      public: { visible: pub.visible, reasons: pub.reasons }, activeMembers: s.activeMembers, publicationHold: s.publication_hold || null };
  }) };
}

/** SUSPEND / REACTIVATE (an MFA administrator; the reason is mandatory and audited). Reactivation does not touch verification: a REJECTED organization stays unable to receive. */
export async function setActivity(id, input, reviewer, db = defaultDb) {
  const action = String(input?.action || '').toUpperCase();
  const reason = String(input?.reason || '').trim().slice(0, 1000);
  if (!['SUSPEND', 'REACTIVATE'].includes(action)) return bad('invalid_action', 'Action invalide.');
  if (reason.length < 5) return bad('reason_required', 'Indiquez le motif (il est conservé dans le journal).');
  const to = action === 'SUSPEND' ? 'suspendu' : 'actif';
  const from = action === 'SUSPEND' ? ['actif'] : ['suspendu', 'brouillon'];
  // owner LAB audit: snapshot, change and journal in ONE transaction (the journal write used to be best-effort: a suspension could happen unjournalised)
  return db.transaction(async (tx) => {
    await snapshotRow(tx, 'structure', String(id || ''), `before ${action}`, reviewer);   // PKG-5 / A07 (no row = no snapshot)
    const rows = (await tx.execute(sql`UPDATE "Structure" SET statut = ${to}, "updatedAt" = NOW(), "updatedBy" = ${reviewer}, commentaire_statut = ${reason}
      WHERE id = ${String(id || '')} AND statut IN (${sql.join(from.map((f) => sql`${f}`), sql`, `)}) RETURNING id`)).rows;
    if (!rows.length) return bad('not_found', 'Organisation introuvable ou déjà dans cet état.', 404);
    await tx.insert(AuditLog).values({ action: action === 'SUSPEND' ? 'ORGANIZATION_SUSPENDED' : 'ORGANIZATION_REACTIVATED', entity: 'STRUCTURE', entity_id: rows[0].id, actor_id: reviewer,
      details: { from: from.join('|'), to, reason }, ip_hash: 'ADMIN_MFA' });
    return { ok: true, organization: { id: rows[0].id, statut: to } };
  });
}
