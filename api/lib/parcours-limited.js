// @ts-check
/**
 * G14 (22/11/2026) — the request contract of the LIMITED Mon Parcours (api/_handlers/citizen/parcours.js), enforced by the server before any database
 * access. Owner requirements (CONTROL/master/completion/G14_MON_PARCOURS_*):
 *   1. free-text notes: closed unless ADA_PARCOURS_NOTES=on (default OFF) — when closed a note can only be cleared (note: null);
 *   2. no free step title, no free organisation name: a step is a code of the reviewed list (api/lib/parcours-step-types.js), the organisation an optional
 *      published Structure id; EVERY other field is refused (400 FIELD_NOT_ALLOWED, the names of the refused fields only — never their values);
 *   3. kept OFF: the sensitive-step consent mode (`sensitiveConsent` is a refused field), the import of a shared dossier's plan (`import` refused), the
 *      free plan data (`plan` refused: need, organisation name, links), the catalogue-record steps (`records` refused), delegated read
 *      (ADA_PARCOURS_DELEGATE_READ=on only, api/_services/delegation.js) and external reminders (ADA_PARCOURS_EXTERNAL_REMINDERS=on only,
 *      api/_handlers/cron/parcours-reminder.js).
 * The former (« legacy ») contract stays reachable ONLY inside the automated test suites (NODE_ENV=test, never on Vercel Production) so that the earlier
 * integration proofs of the service layer keep running: `legacyContractAllowed`.
 */

import { parcoursNotesOpen } from './parcours-sensitivity.js';

/** @typedef {Record<string, string | undefined>} Env */

/** G14 owner requirement 1: notes are OFF by default; exactly ADA_PARCOURS_NOTES=on opens them (api/lib/parcours-sensitivity.js). */
export const parcoursNotesFlagOn = parcoursNotesOpen;
/** G14: the delegate's read of Mon Parcours (scope PARCOURS_READ) is OFF unless exactly « on » (counsel Q6: closed in the first phase). @param {Env} [env] */
export const parcoursDelegateReadOpen = (env = process.env) => String(env.ADA_PARCOURS_DELEGATE_READ || '').trim() === 'on';
/** G14: e-mail / SMS / push deadline reminders (cron parcours-reminder) are OFF unless exactly « on »; in-app notices are not concerned. @param {Env} [env] */
export const parcoursExternalRemindersOpen = (env = process.env) => String(env.ADA_PARCOURS_EXTERNAL_REMINDERS || '').trim() === 'on';
/**
 * The former contract (free title, records, plan data, consent, import) — test suites only. Never where Vercel says production, never outside NODE_ENV=test.
 * @param {Env} [env]
 */
export const legacyContractAllowed = (env = process.env) => env.NODE_ENV === 'test' && env.VERCEL_ENV !== 'production'
  && String(env.ADA_PARCOURS_LEGACY_CONTRACT || '').trim() === 'test-only';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/;
/** the fields each action accepts (action itself included) */
export const LIMITED_POST_FIELDS = Object.freeze({
  add: ['action', 'stepType', 'structureId'],
  status: ['action', 'id', 'status'],
  deadline: ['action', 'id', 'dueDate', 'dueSourceUrl'],
  note: ['action', 'id', 'note'],
});
export const LIMITED_REFUSED_ACTIONS = Object.freeze(['import', 'plan']);
export const LIMITED_GET_QUERY = Object.freeze(['path', 'history', 'structuresFor', 'q']);

const bad = (/** @type {string} */ code, /** @type {string} */ message, status = 400, extra = {}) => ({ ok: false, status, code, message, ...extra });
const notAllowed = (/** @type {string[]} */ fields) => bad('FIELD_NOT_ALLOWED', `Champ non accepté par Mon Parcours : ${fields.join(', ')}.`, 400);
const plain = (/** @type {unknown} */ v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * The shape check of one request of the limited contract. Returns null when the request may go on, else the refusal. Values are checked for TYPE and
 * FORMAT here; meaning (is the code on the list, is the structure published and of an allowed kind, is the source one of the type's) is checked by the
 * service. @param {{ method: string, body?: unknown, query?: Record<string, unknown> }} req @param {Env} [env]
 */
export function limitedRequestRefusal({ method, body, query }, env = process.env) {
  if (method === 'GET') {
    const extra = Object.keys(query || {}).filter((k) => !LIMITED_GET_QUERY.includes(k));
    if (extra.length) return notAllowed(extra);
    const q = query || {};
    if (q.history !== undefined && (typeof q.history !== 'string' || !ID_RE.test(q.history))) return bad('INVALID_ID', 'Identifiant invalide.');
    if (q.structuresFor !== undefined && (typeof q.structuresFor !== 'string' || !/^[A-Z][A-Z0-9_]{2,59}$/.test(q.structuresFor))) return bad('INVALID_STEP_TYPE', 'Type d’étape inconnu.');
    if (q.q !== undefined && (typeof q.q !== 'string' || q.q.trim().length < 2 || q.q.length > 60)) return bad('INVALID_QUERY', 'Tapez de 2 à 60 caractères.');
    return null;
  }
  if (!plain(body)) return bad('INVALID_BODY', 'Requête invalide.');
  const b = /** @type {Record<string, unknown>} */ (body);
  if (method === 'DELETE') {
    const extra = Object.keys(b).filter((k) => k !== 'id');
    if (extra.length) return notAllowed(extra);
    return typeof b.id === 'string' && ID_RE.test(b.id) ? null : bad('INVALID_ID', 'Identifiant invalide.');
  }
  const action = typeof b.action === 'string' ? b.action : '';
  if (LIMITED_REFUSED_ACTIONS.includes(action)) return bad('ACTION_NOT_ALLOWED', 'Cette action n’est pas proposée par Mon Parcours.', 400);
  const allowed = /** @type {Record<string, readonly string[]>} */ (LIMITED_POST_FIELDS)[action];
  if (!allowed) return bad('INVALID_ACTION', 'Action inconnue.');
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (extra.length) return notAllowed(extra);
  if (action === 'add') {
    if (typeof b.stepType !== 'string' || !/^[A-Z][A-Z0-9_]{2,59}$/.test(b.stepType)) return bad('INVALID_STEP_TYPE', 'Choisissez une étape dans la liste.');
    if (b.structureId !== undefined && b.structureId !== null && (typeof b.structureId !== 'string' || !ID_RE.test(b.structureId))) return bad('STRUCTURE_NOT_ALLOWED', 'Cet organisme ne peut pas être choisi pour cette étape.', 422);
    return null;
  }
  if (typeof b.id !== 'string' || !ID_RE.test(b.id)) return bad('INVALID_ID', 'Identifiant invalide.');
  if (action === 'status') return typeof b.status === 'string' && b.status.length <= 40 ? null : bad('INVALID_STATUS', 'État inconnu.');
  if (action === 'deadline') {
    if (b.dueDate === null) return b.dueSourceUrl === undefined || b.dueSourceUrl === null ? null : notAllowed(['dueSourceUrl']);
    if (typeof b.dueDate !== 'string' || !ISO_DAY_RE.test(b.dueDate)) return bad('INVALID_DATE', 'Date invalide.');
    if (b.dueSourceUrl !== undefined && b.dueSourceUrl !== null && typeof b.dueSourceUrl !== 'string') return bad('DEADLINE_SOURCE_NOT_ALLOWED', 'La source doit être l’une des fiches officielles de cette étape.', 422);
    return null;
  }
  // note: while notes are closed only clearing is accepted (the person can always remove what exists); open: a string, the server cuts it to 500
  if (b.note === null || b.note === '') return null;
  if (!parcoursNotesFlagOn(env)) return bad('NOTES_CLOSED', 'Les notes personnelles ne sont pas proposées sur ce service. Vous pouvez effacer une note existante.', 409);
  return typeof b.note === 'string' ? null : bad('INVALID_NOTE', 'Note invalide.');
}
