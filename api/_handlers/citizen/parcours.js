// @ts-nocheck
import { citizenHandler } from '../../_utils/citizen-handler.js';
import { addManualItem, importPlan, itemHistory, listParcours, planImportOpen, removeItem, setDeadline, setNote, setPlanStep, setStatus } from '../../_services/mon-espace.js';
import { isPublicBetaRestricted, openJobs } from '../../_utils/public-beta.js';

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
 */
/** @param {Record<string, string | undefined>} [env] */
export const parcoursEmailRemindersOpen = (env = process.env) => !isPublicBetaRestricted(env) || openJobs(env).has('parcours-reminder');

export default citizenHandler('parcours', ['GET', 'POST', 'DELETE'], async (citizen, req) => {
  if (req.method === 'GET') {
    const hid = req.query?.history;
    return hid ? itemHistory(citizen.id, hid) : { ...(await listParcours(citizen.id)), planImport: planImportOpen(), emailReminders: parcoursEmailRemindersOpen() };
  }
  if (req.method === 'DELETE') return removeItem(citizen.id, req.body?.id);
  const b = req.body || {};
  switch (b.action) {
    case 'import': return importPlan(citizen.id, b.shareId);
    case 'add': return addManualItem(citizen.id, b);
    case 'status': return setStatus(citizen.id, b.id, b.status);
    case 'deadline': return setDeadline(citizen.id, b.id, b);
    case 'note': return setNote(citizen.id, b.id, b.note);
    case 'plan': return setPlanStep(citizen.id, b.id, b.planStep);
    default: return { ok: false, status: 400, code: 'INVALID_ACTION', message: 'Action inconnue.' };
  }
});
