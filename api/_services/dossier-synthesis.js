// @ts-nocheck
/**
 * PKG-6 / R17 — synthesis of a shared dossier for the organization that holds access, by the LOCAL model only (Ollama on loopback; no Gemini, no other external
 * model, no fallback), stored as a DRAFT in the D22 review queue (AiOutputReview kind DOSSIER_SYNTHESIS) until a member of that organization reviews it.
 *   - Access, every time (draft, list, review): an active grant of THIS organization on an unexpired dossier (resolveDossierForStructure) AND the citizen's
 *     purpose-specific consent PURP-05 for THIS organization. Refused before any model call and before any write.
 *   - Minimal input: the assessment items of the dossier only (label, state, facts still missing, who to ask). Never the person's situation, notes (any
 *     organization), files, signatures, consent records or follow-ups.
 *   - Output validation: 1–3 short points; no URL; no figure that is not in the input; no eligibility promise; otherwise refused (nothing stored).
 *   - Review is bound to the draft AND to the dossier version it was made from (sourceTextHash): a changed dossier never inherits an approval.
 *   - Forgetting: drafts are deleted with the dossier (FK ON DELETE CASCADE: erasure, expiry purge) and when the citizen revokes the organization, withdraws
 *     PURP-05 or stops sharing (forgetSyntheses, called by public/dossier-grants).
 *   - Nothing here changes the dossier, publishes, or sends anything to another organization.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { AuditLog } from '../../src/db/schema.js';
import { resolveDossierForStructure, grantHasPurpose, PURPOSE_AI } from '../_utils/share-access.js';
import { presentResults } from '../lib/shareResults.js';
import { generateStructuredContent } from '../lib/ai-foundation.js';
import { AUDIENCE } from '../lib/ai-policy.js';

export const MODEL = 'qwen3:8b';
export const TIMEOUT_MS = 30000;
const bad = (status, code, message) => ({ ok: false, status, code, message });
const PointsSchema = z.object({ points: z.array(z.string().min(5).max(300)).min(1).max(3) });
const ELIGIBILITY = /(vous\s+(êtes|etes|serez)\s+[ée]ligible|vous\s+avez\s+droit|droit\s+acquis|vous\s+toucherez|vous\s+recevrez\s+\d|est\s+[ée]ligible\s+[àa])/i;
export const SYSTEM = 'Tu aides un professionnel d’une structure sociale à préparer un entretien. Tu reçois UNIQUEMENT la liste des pistes d’orientation du dossier '
  + '(intitulé, état, informations manquantes, organisme à contacter). Écris 1 à 3 points courts et factuels pour l’entretien. Interdit : inventer un fait, une date, '
  + 'un montant, une personne ou une relation ; affirmer un droit ou une éligibilité ; présenter ton texte comme une décision officielle ou un avis professionnel ; '
  + 'donner une URL. Si les données ne suffisent pas, dis-le. Réponds en JSON {"points": ["..."]}.';

/** The only data the model ever sees (and the version the review is bound to). */
export function minimalInput(results) {
  const items = (presentResults(results || {})?.assessment?.items || []).slice(0, 20).map((i) => ({
    aide: String(i.label || '').slice(0, 80), etat: String(i.state || ''), manque: (i.missingFacts || []).slice(0, 10).map(String), aDemanderA: i.whoToAsk ? String(i.whoToAsk).slice(0, 120) : null,
  }));
  return { pistes: items };
}
export const versionOf = (input) => crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** Refuses an output that invents a figure, carries a URL or promises eligibility. @returns {string|null} reason */
export function rejectReason(points, input) {
  const src = JSON.stringify(input);
  for (const p of points) {
    if (/https?:\/\/|www\./i.test(p)) return 'url';
    if (ELIGIBILITY.test(p)) return 'eligibility_claim';
    for (const n of String(p).match(/\d+(?:[.,]\d+)?/g) || []) if (!src.includes(n)) return 'invented_figure';
  }
  return null;
}

async function access(shareId, proCtx, db) {
  const found = await resolveDossierForStructure(shareId, proCtx);
  if (found.status === 'not_found') return { err: bad(404, 'not_found', 'Dossier introuvable.') };
  if (found.status === 'expired') return { err: bad(410, 'expired', 'Ce dossier a expiré.') };
  if (!grantHasPurpose(found.grant, PURPOSE_AI)) return { err: bad(403, 'AI_CONSENT_REQUIRED', 'La personne n’a pas autorisé l’analyse par IA (PURP-05) pour votre structure. L’accord de partage (PURP-06) ne suffit pas.') };
  return { shared: found.shared };
}

// owner LAB audit: never swallowed — inside the review transaction a swallowed failure left PostgreSQL's transaction aborted, so the decision was rolled back at
// COMMIT while the answer said « approved »
const audit = (db, action, proCtx, id, details) => db.insert(AuditLog).values({ action, actor: proCtx.email || proCtx.userId || null, actor_id: proCtx.userId || null, entity: 'AiOutputReview', entity_id: id, details });

/**
 * Draft from results ALREADY authorized and minimised by the handler (api/_handlers/pro/dossier-synthesis.js: grant + PURP-05 + presentResults + deletions).
 * @param {string} shareId @param {any} proCtx @param {object} safeResults
 */
export async function createDraft(shareId, proCtx, safeResults, { db = defaultDb, generate = generateStructuredContent } = {}) {
  const input = minimalInput(safeResults);
  if (!input.pistes.length) return bad(409, 'NOTHING_TO_SUMMARIZE', 'Ce dossier ne contient pas encore de pistes d’orientation à résumer.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error('LOCAL_MODEL_TIMEOUT')), TIMEOUT_MS); timer.unref?.();
  let out = null;
  try {
    out = await generate({ prompt: JSON.stringify(input), systemInstruction: SYSTEM, zodSchema: PointsSchema, tools: [], primaryProvider: 'ollama', fallbackProvider: null,
      allowFallback: false, model: MODEL, audience: AUDIENCE.PROFESSIONAL, signal: controller.signal });
  } catch { out = null; } finally { clearTimeout(timer); }
  if (!out || out.safeErrorState || !out.content) return bad(503, 'AI_LOCAL_UNAVAILABLE', 'Le modèle local n’a pas répondu (indisponible ou délai de 30 s dépassé). Aucun brouillon n’a été créé.');
  const parsed = PointsSchema.safeParse(out.content);
  if (!parsed.success) return bad(502, 'AI_OUTPUT_INVALID', 'La réponse du modèle local est inutilisable. Aucun brouillon n’a été créé.');
  const points = parsed.data.points.map((p) => p.trim());
  const why = rejectReason(points, input);
  if (why) return bad(422, 'AI_OUTPUT_REJECTED', `La réponse du modèle local a été écartée (${why}). Aucun brouillon n’a été créé.`);
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO "AiOutputReview" (id, kind, "entityType", "entityId", field, origin, model, "sourceTextHash", "outputText", status, "createdBy", "createdAt", "sharedDiagnosticId", "scopeStructureId")
    VALUES (${id}, 'DOSSIER_SYNTHESIS', 'shared_diagnostic', ${String(shareId)}, 'synthesis', 'AI_LOCAL', ${out.model || MODEL}, ${versionOf(input)}, ${JSON.stringify(points)}, 'PENDING',
      ${proCtx.email || proCtx.userId}, NOW(), ${String(shareId)}, ${String(proCtx.structureId)})`);
  await audit(db, 'DOSSIER_SYNTHESIS_DRAFTED', proCtx, id, { shareId, structureId: proCtx.structureId, model: out.model || MODEL });
  return { ok: true, draft: { id, status: 'PENDING', aiGenerated: true, model: out.model || MODEL, points, label: 'Brouillon produit par IA (modèle local) — non relu' } };
}

export async function listDrafts(shareId, proCtx, { db = defaultDb } = {}) {
  const a = await access(shareId, proCtx, db); if (a.err) return a.err;
  const current = versionOf(minimalInput(a.shared.results));
  const rows = (await db.execute(sql`SELECT id, status, model, "outputText", "sourceTextHash", "createdBy", "createdAt", "reviewedBy", "reviewedAt", "reviewNote" FROM "AiOutputReview"
    WHERE kind = 'DOSSIER_SYNTHESIS' AND "sharedDiagnosticId" = ${String(shareId)} AND "scopeStructureId" = ${String(proCtx.structureId)} ORDER BY "createdAt" DESC LIMIT 20`)).rows;
  return { ok: true, drafts: rows.map((r) => ({ id: r.id, status: r.status, model: r.model, points: JSON.parse(r.outputText), createdBy: r.createdBy, createdAt: r.createdAt,
    reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, sourceChanged: r.sourceTextHash !== current, aiGenerated: true })) };
}

/** A member of the organization reviews one draft. Approval is refused when the dossier changed since the draft. */
export async function review(shareId, draftId, decision, note, proCtx, { db = defaultDb } = {}) {
  if (!['approve', 'reject'].includes(decision)) return bad(400, 'INVALID_DECISION', 'Décision attendue : approuver ou rejeter.');
  const text = String(note || '').trim(); if (text.length < 5) return bad(400, 'NOTE_REQUIRED', 'Indiquez ce que vous avez vérifié (au moins 5 caractères).');
  const a = await access(shareId, proCtx, db); if (a.err) return a.err;
  const current = versionOf(minimalInput(a.shared.results));
  return db.transaction(async (tx) => {
    const [r] = (await tx.execute(sql`SELECT id, "sourceTextHash" AS h FROM "AiOutputReview" WHERE id = ${String(draftId || '')} AND kind = 'DOSSIER_SYNTHESIS' AND status = 'PENDING'
      AND "sharedDiagnosticId" = ${String(shareId)} AND "scopeStructureId" = ${String(proCtx.structureId)} FOR UPDATE`)).rows;
    if (!r) return bad(404, 'not_found', 'Brouillon introuvable ou déjà relu.');
    if (decision === 'approve' && r.h !== current) return bad(409, 'SOURCE_CHANGED', 'Le dossier a changé depuis ce brouillon : rejetez-le et demandez un nouveau brouillon.');
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    await tx.execute(sql`UPDATE "AiOutputReview" SET status = ${status}, "reviewedBy" = ${proCtx.email || proCtx.userId}, "reviewedAt" = NOW(), "reviewNote" = ${text.slice(0, 500)} WHERE id = ${r.id}`);
    await audit(tx, decision === 'approve' ? 'DOSSIER_SYNTHESIS_APPROVED' : 'DOSSIER_SYNTHESIS_REJECTED', proCtx, r.id, { shareId, structureId: proCtx.structureId });
    return { ok: true, id: r.id, status };
  });
}

/**
 * Called when the citizen revokes an organization (structureId), withdraws PURP-05 for it (structureId) or stops sharing (structureId null).
 * @param {any} db @param {string} shareId @param {string | null} [structureId]
 */
export async function forgetSyntheses(db, shareId, structureId = null) {
  if (structureId) return db.execute(sql`DELETE FROM "AiOutputReview" WHERE kind = 'DOSSIER_SYNTHESIS' AND "sharedDiagnosticId" = ${String(shareId)} AND "scopeStructureId" = ${String(structureId)}`);
  return db.execute(sql`DELETE FROM "AiOutputReview" WHERE kind = 'DOSSIER_SYNTHESIS' AND "sharedDiagnosticId" = ${String(shareId)}`);
}
