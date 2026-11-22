// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { addManualItem, addStepType, importPlan, itemHistory, listParcours, planImportOpen, removeItem, sensitiveStepsMode, setDeadline, setNote, setPlanStep, setStatus,
  setStepTypeDeadline, structuresForStepType } from '../../_services/mon-espace.js';
import { isPublicBetaRestricted, openJobs } from '../../_utils/public-beta.js';
import { parcoursNotesOpen } from '../../lib/parcours-sensitivity.js';
import { legacyContractAllowed, limitedRequestRefusal, parcoursExternalRemindersOpen } from '../../lib/parcours-limited.js';
import { stepCatalogueView } from '../../lib/parcours-step-types.js';

/**
 * PKG-2 / C07 Mon Parcours.  GET -> { items } (each with its records, `available` and, for a plan step, `plan`: who / detail / links)   GET ?history=<id> -> { events }
 * POST { action: 'import', shareId } | { action: 'add', title } | { action: 'add', records: [{ type, id }], title? } (a public record becomes a step; idempotent) | { action: 'status', id, status } | { action: 'deadline', id, dueDate|null, dueSourceUrl } | { action: 'note', id, note }
 * DELETE { id }
 * M1 (migration 0046, "ParcoursItem"."planStep"): GET also gives per step `closure`, `step` (need, who acts, links, next action), `dependsOn`, `waiting`, and `planSteps` (does this
 * database store plan data). POST { action: 'add', …, planStep? } | { action: 'plan', id, planStep: { need?, actor?, links?, dependsOnItemId?, nextActionKey? } } (a key set to null is
 * cleared) | { action: 'status', id, status } where status may also be ABANDONED or OUTCOME_UNKNOWN (stored as CLOSED with that reason).
 * G4: GET also says what this deployment really offers around the steps — `planImport` (the import of a shared dossier's plan: only with the HDS-bound
 * citizen.shared_dossier capability) and `emailReminders` (the deadline e-mails of the « parcours-reminder » job: during the beta only when that job is
 * opened and approved) — so the screen never offers an import that would be refused nor promises an e-mail that no job sends.
 * G8: GET also says `sensitiveSteps` — « excluded » (default: a step, need, organisation name or note revealing health, disability, addiction, right of
 * residence, justice, legal protection, sex life or violence is refused, 422 SENSITIVE_STEP_EXCLUDED) or « consent » (ADA_PARCOURS_SENSITIVE_STEPS=consent:
 * kept only when the request says `sensitiveConsent: true` for that step, else 409 SENSITIVE_STEP_CONSENT_REQUIRED). See api/lib/parcours-sensitivity.js.
 * G8: `notes` — false with ADA_PARCOURS_NOTES=off: no new note (409 NOTES_CLOSED); an existing one can still be cleared.
 *
 * G14 (22/11/2026) — THE LIMITED CONTRACT (the only one outside the automated test suites, api/lib/parcours-limited.js):
 *   GET → { items (each with `stepType`), contract: 'limited', stepTypes (the reviewed list), notes, sensitiveSteps: 'excluded', planImport: false, emailReminders }
 *   GET ?history=<id> → { events }      GET ?structuresFor=<code>&q=<2–60 chars> → { structures: [{ id, name, town }] } (published, allowed kinds only)
 *   POST { action: 'add', stepType, structureId? } | { action: 'status', id, status } | { action: 'deadline', id, dueDate|null, dueSourceUrl? (one of the
 *   type's official fiches) } | { action: 'note', id, note } (ADA_PARCOURS_NOTES=on only; otherwise note: null clears)      DELETE { id }
 *   Every other action (import, plan) or field (title, records, planStep, sensitiveConsent…) → 400, before any database access.
 */
/** @param {Record<string, string | undefined>} [env] */
export const parcoursEmailRemindersOpen = (env = process.env) => parcoursExternalRemindersOpen(env) && (!isPublicBetaRestricted(env) || openJobs(env).has('parcours-reminder'));

/** G14 — the limited contract (see above) */
async function limited(citizen, req) {
  const refusal = limitedRequestRefusal({ method: req.method, body: req.body, query: req.query || {} });
  if (refusal) return refusal;
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q.history) return itemHistory(citizen.id, q.history);
    if (q.structuresFor) return structuresForStepType(q.structuresFor, q.q || '');
    const list = await listParcours(citizen.id);
    return { ...list, contract: 'limited', stepTypes: stepCatalogueView(), planImport: false, emailReminders: parcoursEmailRemindersOpen(), sensitiveSteps: 'excluded', notes: parcoursNotesOpen() };
  }
  if (req.method === 'DELETE') return removeItem(citizen.id, req.body.id);
  const b = req.body;
  switch (b.action) {
    case 'add': return addStepType(citizen.id, b);
    case 'status': return setStatus(citizen.id, b.id, b.status);
    case 'deadline': return setStepTypeDeadline(citizen.id, b.id, b);
    default: return setNote(citizen.id, b.id, b.note === '' ? null : b.note);   // 'note' (the only other action the contract lets through)
  }
}

export default citizenHandler('parcours', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  if (!legacyContractAllowed()) return limited(citizen, req);
  // ── the former contract: automated test suites only (NODE_ENV=test + ADA_PARCOURS_LEGACY_CONTRACT=test-only, never on Vercel Production)
  if (req.method === 'GET') {
    const hid = req.query?.history;
    if (hid) return itemHistory(citizen.id, hid);
    const list = await listParcours(citizen.id);
    return { ...list, planImport: planImportOpen(), emailReminders: parcoursEmailRemindersOpen(), sensitiveSteps: sensitiveStepsMode(list.planSteps === true), notes: parcoursNotesOpen() };
  }
  if (req.method === 'DELETE') return removeItem(citizen.id, req.body?.id);
  const b = req.body || {};
  switch (b.action) {
    case 'import': return importPlan(citizen.id, b.shareId);
    case 'add': return addManualItem(citizen.id, b);
    case 'status': return setStatus(citizen.id, b.id, b.status);
    case 'deadline': return setDeadline(citizen.id, b.id, b);
    case 'note': return setNote(citizen.id, b.id, b.note, undefined, { sensitiveConsent: b.sensitiveConsent });
    case 'plan': return setPlanStep(citizen.id, b.id, b.planStep, undefined, { sensitiveConsent: b.sensitiveConsent });
    default: return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
  }
});
