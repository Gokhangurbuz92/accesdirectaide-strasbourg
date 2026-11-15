// @ts-check
/**
 * M1 (C07 / C08) — the durable plan data of a Mon Parcours step ("ParcoursItem"."planStep", migration 0046): constants and PURE helpers shared by the
 * server (api/lib/parcours-plan-step.js validates what is stored) and the screen (src/pages/CompteParcours.jsx). No I/O, no clock.
 * A step's status stays the person's own tracking; nothing here decides or states a right.
 */

export const PLAN_STEP_VERSION = 1;
/** who acts next: the person, a NAMED organisation, a professional (no person's name is kept) */
export const PLAN_ACTOR_KINDS = Object.freeze(['citizen', 'organisation', 'professional']);
/** the next actions a step can carry; each is a text key translated on screen (compte:parcours.action.<key>), never free text */
export const PLAN_NEXT_ACTIONS = Object.freeze(['read_record', 'complete_information', 'gather_documents', 'contact_organisation', 'submit_request', 'wait_answer',
  'answer_organisation', 'ask_professional', 'share_dossier', 'emergency_resources']);
/**
 * Honest ways a step ends besides the ten self-declared states: the person gave it up, or never learnt the outcome. Stored as status CLOSED plus this
 * reason in planStep.closure (the status CHECK and the append-only history of 0016 are unchanged).
 */
export const PLAN_CLOSURES = Object.freeze(['ABANDONED', 'OUTCOME_UNKNOWN']);
/** the states after which a step is no longer « en cours » (same list as src/lib/monEspace.js PARCOURS_DONE) */
export const PLAN_DONE_STATUSES = Object.freeze(['DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED']);
/** next actions the screen derives from where the person says they are — never stored */
export const PLAN_DERIVED_ACTIONS = Object.freeze(['after_refusal', 'resume_or_search', 'ask_outcome']);

/** @type {Readonly<Record<string, string>>} */
const STATUS_ACTION = Object.freeze({ DOCUMENTS_REQUIRED: 'gather_documents', READY: 'submit_request', SUBMITTED: 'wait_answer', WAITING_ORGANIZATION: 'wait_answer',
  ADDITIONAL_INFORMATION: 'answer_organisation', DECISION_NEGATIVE: 'after_refusal' });

/** the closing reason of a stored planStep, only while the step is CLOSED @param {{ status?: string, planStep?: any }} row @returns {string | null} */
export function closureOf(row) {
  const c = row && row.status === 'CLOSED' && row.planStep && typeof row.planStep === 'object' ? row.planStep.closure : null;
  return PLAN_CLOSURES.includes(c) ? c : null;
}

/**
 * The next action to show for a step, as a text key: what follows from the state the person indicated (papers to gather → gather them; an unfavourable
 * answer, a step given up or an unknown outcome → what can be done next), otherwise the action planned for the step. null = nothing to propose (a
 * favourable answer, a finished step, a step without plan data that is not started).
 * @param {{ status: string, closure?: string | null, step?: { nextActionKey?: string | null } | null }} item @returns {string | null}
 */
export function nextActionOf(item) {
  if (!item) return null;
  if (item.status === 'CLOSED') return item.closure === 'ABANDONED' ? 'resume_or_search' : item.closure === 'OUTCOME_UNKNOWN' ? 'ask_outcome' : null;
  if (STATUS_ACTION[item.status]) return STATUS_ACTION[item.status];
  if (item.status === 'DECISION_POSITIVE') return null;
  const key = item.step ? item.step.nextActionKey : null;
  return key && PLAN_NEXT_ACTIONS.includes(key) ? key : null;
}

/** does the step call for the « Que faire ensuite ? » block: an unfavourable answer the person indicated, a step given up, an outcome never learnt */
export const needsRecovery = (/** @type {{ status: string, closure?: string | null }} */ item) => Boolean(item) && (item.status === 'DECISION_NEGATIVE' || (item.status === 'CLOSED' && PLAN_CLOSURES.includes(String(item.closure))));

/**
 * Steps grouped by need, in the order the needs first appear; the steps without a need come last, in one group with `need: null`.
 * @template {{ step?: { need?: { id: string, label: string } | null } | null }} T
 * @param {T[]} items @returns {{ need: { id: string, label: string } | null, items: T[] }[]}
 */
export function groupByNeed(items) {
  /** @type {Map<string, { need: { id: string, label: string } | null, items: T[] }>} */ const groups = new Map();
  /** @type {T[]} */ const rest = [];
  for (const i of items || []) {
    const need = i && i.step && i.step.need && i.step.need.id ? i.step.need : null;
    if (!need) { rest.push(i); continue; }
    if (!groups.has(need.id)) groups.set(need.id, { need, items: [] });
    /** @type {{ items: T[] }} */ (groups.get(need.id)).items.push(i);
  }
  return [...groups.values(), ...(rest.length ? [{ need: null, items: rest }] : [])];
}

/**
 * Would making `itemId` depend on `dependsOnId` close a loop? `edges` = the current dependency of each of the SAME person's steps (id → id | null).
 * A step depending on itself is a loop. Bounded: at most as many hops as there are steps.
 * @param {string} itemId @param {string} dependsOnId @param {Map<string, string | null> | Record<string, string | null>} edges @returns {boolean}
 */
export function dependencyCycle(itemId, dependsOnId, edges) {
  const next = (/** @type {string} */ id) => (edges instanceof Map ? edges.get(id) : edges[id]) || null;
  const size = edges instanceof Map ? edges.size : Object.keys(edges).length;
  /** @type {string | null} */ let at = dependsOnId;
  for (let hop = 0; at && hop <= size + 1; hop += 1) {
    if (at === itemId) return true;
    at = next(at);
  }
  return Boolean(at);   // still walking after more hops than steps: a loop that already exists in the data — refuse to extend it
}
