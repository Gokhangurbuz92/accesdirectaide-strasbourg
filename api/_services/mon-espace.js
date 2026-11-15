// @ts-nocheck
/**
 * PKG-2 / K2 — Mon Espace: Mon Parcours (C07/C12), favourites (C10), opt-in history (C11), Mon Coffre (C09) and the dashboard summary (C13).
 * Principles (same as K0): everything is scoped to the verified session's account and enforced HERE (a UI control alone never counts); ADA never decides a right
 * (a Parcours status is the person's own tracking); a deadline exists only with its official source; history is opt-in and never feeds analytics;
 * Coffre bytes and file names are envelope-encrypted before storage, the type is checked from the content, and "not scanned" is said, never hidden.
 */
import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { CitizenDocument, CitizenFavorite, CitizenHistoryEntry, CitizenProfile, Guide, ParcoursEvent, ParcoursItem, ProAppointment, SharedDiagnostic } from '../../src/db/schema.js';
import { buildActionPlan } from '../../src/lib/actionPlan.js';
import { decide } from '../lib/publicVisibility.js';
import { ENTITY_TABLES, evidenceUrlAllowed } from './content-verification.js';
import { protectedStore as defaultStorage } from '../lib/protected-store/index.js';   // R46: HDS-ready storage boundary (Coffre + dossier files)
import { openBuffer, openText, sealBuffer, sealText } from '../lib/data-keys.js';
import { isRestricted } from './processing-restriction.js';
import { ageGate, ageRefusal } from './citizen-account.js';
import { capabilityOpen } from '../_utils/capabilities.js';
import { parcoursItemTable, parcoursPlanStepSchema } from '../_utils/schema-features.js';
import { mergePlanStep, planNeeds, planStepFits, planStepFromPlan, readPlanStep, validatePlanStepInput } from '../lib/parcours-plan-step.js';
import { PLAN_CLOSURES, PLAN_DONE_STATUSES, closureOf, dependencyCycle } from '../../src/lib/parcoursPlan.js';

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const notFound = () => bad('NOT_FOUND', 'Élément introuvable.', 404);

// ───────────── Mon Parcours
export const PARCOURS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'READY', 'SUBMITTED', 'WAITING_ORGANIZATION', 'ADDITIONAL_INFORMATION', 'DECISION_POSITIVE', 'DECISION_NEGATIVE', 'CLOSED'];
export const MAX_PARCOURS_ITEMS = 100;
const planKeyOf = (shareId, step) => crypto.createHash('sha256').update(JSON.stringify([shareId, step.kind, step.who || '', [...(step.itemCodes || [])].sort()])).digest('hex').slice(0, 40);
// M1: `status` stays one of the ten self-declared states; `closure` says why a CLOSED step ended when the person said so (ABANDONED | OUTCOME_UNKNOWN), else null
const itemView = (r) => ({ id: r.id, origin: r.origin, sourceShareId: r.sourceShareId, stepKind: r.stepKind, itemCodes: r.itemCodes, title: r.title, status: r.status, closure: closureOf(r),
  dueDate: r.dueDate, dueSourceUrl: r.dueSourceUrl, note: r.note, createdAt: r.createdAt, updatedAt: r.updatedAt });

/**
 * M1 — ParcoursItem as THIS database has it. "planStep" comes with migration 0046, which Production receives separately from the code: without the
 * column Mon Parcours behaves as before M1 (no plan data is read or written, nothing fails), see api/_utils/schema-features.js.
 * @returns {Promise<{ has: boolean, T: typeof ParcoursItem }>}
 */
async function parcoursSchema(db) {
  const has = await parcoursPlanStepSchema(db);
  return { has, T: parcoursItemTable(has) };
}
const PLAN_UNAVAILABLE = () => bad('PLAN_STEP_UNAVAILABLE', 'Cette fonction n’est pas encore disponible.', 409);

async function event(db, item, kind, fromStatus = null, toStatus = null) {
  await db.insert(ParcoursEvent).values({ itemId: item.id, userId: item.userId, kind, fromStatus, toStatus });
}

// VIS-R: a tracked step can point at catalogue records. `itemCodes` holds « <type>:<id> » for a step the person added from a record page or an orientation
// (origin MANUAL, the database accepts only PLAN | MANUAL), and the bare assessment codes of a plan step (an aide slug, see src/lib/actionPlan.js).
export const PARCOURS_RECORD_TYPES = ['aide', 'demarche', 'dispositif', 'guide'];
export const MAX_PARCOURS_RECORDS = 5;
const RECORD_PATHS = { aide: '/aides', demarche: '/demarches', dispositif: '/dispositifs', guide: '/bonnes-pratiques' };
const RECORD_TABLES = { aide: ENTITY_TABLES.aide, demarche: ENTITY_TABLES.demarche, dispositif: ENTITY_TABLES.dispositif, guide: Guide };
const RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const RECORD_CODE = /^(aide|demarche|dispositif|guide):([A-Za-z0-9][A-Za-z0-9._-]{0,119})$/;
/** the ONE visibility decision (D-5, api/lib/publicVisibility.js) — the same as favourites; a guide is not a D-5 record: public when published (api/_handlers/guides.js) */
const recordVisible = (type, r) => Boolean(r && (type === 'guide' ? r.statut === 'publie' : decide(r, type).visible));
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
/** where the record says whom to contact (« Où demander » / « Où faire »), when it has it */
const recordContact = (type, r) => (type === 'aide' ? hasText(r.ou_demander) : type === 'demarche' ? hasText(r.ou_faire) : false);
const recordView = (code, type, r) => {
  const visible = recordVisible(type, r);   // a record that is no longer public gives neither its title nor its address
  return { code, type, available: visible, title: visible ? r.titre : null, href: visible ? `${RECORD_PATHS[type]}/${encodeURIComponent(r.slug || r.id)}` : null, contact: visible && recordContact(type, r) };
};
const recordKeyOf = (codes) => crypto.createHash('sha256').update(JSON.stringify(['record', codes])).digest('hex').slice(0, 40);

/** the records the items point at, by code. A typed code that no longer resolves is « no longer available »; a bare plan code ADA holds no record for is not listed at all. */
async function recordsOf(rows, db) {
  const typed = { aide: new Set(), demarche: new Set(), dispositif: new Set(), guide: new Set() }; const bare = new Set();
  for (const code of rows.flatMap((r) => r.itemCodes || [])) {
    const m = RECORD_CODE.exec(String(code));
    if (m) typed[m[1]].add(m[2]); else if (RECORD_KEY.test(String(code))) bare.add(String(code));
  }
  const out = new Map();
  for (const type of PARCOURS_RECORD_TYPES) {
    const T = RECORD_TABLES[type]; const ids = [...typed[type]]; const keys = type === 'aide' ? [...bare] : [];
    if (!ids.length && !keys.length) continue;
    const found = await db.select().from(T).where(keys.length ? or(inArray(T.id, [...ids, ...keys]), inArray(T.slug, keys)) : inArray(T.id, ids));
    for (const id of ids) out.set(`${type}:${id}`, recordView(`${type}:${id}`, type, found.find((x) => x.id === id) || null));
    for (const k of keys) { const r = found.find((x) => x.slug === k) || found.find((x) => x.id === k); if (r) out.set(k, recordView(k, 'aide', r)); }
  }
  return out;
}

/**
 * « Who does what next » of a plan step (who, detail, internal links) READ BACK from the dossier the step came from, while the account still owns it (same
 * planKey as at import). Since M1 (migration 0046) an imported step carries its own durable copy (planStep, see listParcours); this read-back remains for
 * the steps imported before, and on a database without the column: for those, once the dossier is gone the step keeps its title only.
 */
async function planStepsOf(userId, rows, db) {
  const shareIds = [...new Set(rows.filter((r) => r.origin === 'PLAN' && r.sourceShareId && r.planKey).map((r) => r.sourceShareId))];
  const out = new Map(); if (!shareIds.length) return out;
  const shares = await db.select({ id: SharedDiagnostic.id, results: SharedDiagnostic.results }).from(SharedDiagnostic)
    .where(and(inArray(SharedDiagnostic.id, shareIds), eq(SharedDiagnostic.ownerCitizenId, userId)));
  for (const sh of shares) {
    let steps = []; try { steps = buildActionPlan(sh.results).steps; } catch { steps = []; }
    for (const step of steps) {
      out.set(`${sh.id}:${planKeyOf(sh.id, step)}`, { who: step.who ? String(step.who).slice(0, 200) : null, detail: step.detail ? String(step.detail).slice(0, 1000) : null,
        links: (step.links || []).filter((l) => l && typeof l.to === 'string' && /^\/(?!\/)/.test(l.to) && l.label).slice(0, 10).map((l) => ({ to: l.to, label: String(l.label).slice(0, 200) })) });
    }
  }
  return out;
}

/** the plan data of a step as the screen gets it: the need with its French label, who acts, the links, the next action key, the plan's explanation */
const stepView = (ps) => {
  if (!ps) return null;
  const out = { need: ps.need ? { id: ps.need, label: planNeeds().get(ps.need) } : null, actor: ps.actor, links: ps.links, nextActionKey: ps.nextActionKey, detail: ps.detail };
  return out.need || out.actor || out.links.length || out.nextActionKey || out.detail ? out : null;
};
/** VIS-R shape of « who does what next », now from the step's own durable copy: the organisation, the explanation, the internal links */
const planOfStep = (ps) => {
  if (!ps) return null;
  const out = { who: ps.actor && ps.actor.kind === 'organisation' ? ps.actor.name : null, detail: ps.detail, links: ps.links.filter((l) => l.to) };
  return out.who || out.detail || out.links.length ? out : null;
};

/**
 * M1: each step also gives `closure`, `step` (its durable plan data, null for a step without it — every step created before migration 0046),
 * `dependsOn` (the person's OTHER step it depends on: id, title, status, closure, done) and `waiting` (that step is not finished yet — shown as waiting,
 * never a lock: the person changes any status at any time). `planSteps` says whether this database stores plan data at all.
 */
export async function listParcours(userId, db = defaultDb) {
  const { has, T } = await parcoursSchema(db);
  const rows = await db.select().from(T).where(eq(ParcoursItem.userId, userId)).orderBy(asc(ParcoursItem.createdAt));
  const [records, plans] = [await recordsOf(rows, db), await planStepsOf(userId, rows, db)];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { ok: true, status: 200, planSteps: has, items: rows.map((r) => {
    const recs = [...new Set(r.itemCodes || [])].map((c) => records.get(c)).filter(Boolean);
    const ps = has ? readPlanStep(r.planStep) : null;
    // a dependency is another step of the SAME account, still there (a removed one simply no longer holds anything back)
    const dep = ps && ps.dependsOnItemId && ps.dependsOnItemId !== r.id ? byId.get(ps.dependsOnItemId) : null;
    const dependsOn = dep ? { id: dep.id, title: dep.title, status: dep.status, closure: closureOf(dep), done: PLAN_DONE_STATUSES.includes(dep.status) } : null;
    // `available: false` = at least one record of the step is withdrawn or no longer visible (same decision as a favourite)
    return { ...itemView(r), records: recs, available: recs.every((x) => x.available),
      // the step's own copy first (it outlives the dossier); a step imported before 0046 is still read back from the dossier the account owns
      plan: (r.origin === 'PLAN' ? planOfStep(ps) : null) || plans.get(`${r.sourceShareId}:${r.planKey}`) || null,
      step: stepView(ps), dependsOn, waiting: Boolean(dependsOn && !dependsOn.done && !PLAN_DONE_STATUSES.includes(r.status)) };
  }) };
}

/**
 * M1: may `itemId` (null = a step being created) depend on `dependsOnId`? Only the account's OWN steps are ever read: an id that is unknown and an id
 * of another person's step take the same path and get the same refusal (no existence oracle). A loop — the step itself included — is refused.
 */
async function dependencyRefusal(userId, itemId, dependsOnId, db, T) {
  const own = await db.select({ id: ParcoursItem.id, planStep: T.planStep }).from(T).where(eq(ParcoursItem.userId, userId));
  if (itemId !== dependsOnId && !own.some((r) => r.id === dependsOnId)) return bad('INVALID_DEPENDENCY', 'Cette étape ne peut pas dépendre de cet élément.');
  if (!itemId) return null;
  const edges = new Map(own.map((r) => [r.id, readPlanStep(r.planStep)?.dependsOnItemId || null]));
  return dependencyCycle(itemId, dependsOnId, edges) ? bad('DEPENDENCY_CYCLE', 'Ces étapes dépendraient l’une de l’autre : choisissez une autre étape.', 409) : null;
}

/** the plan data sent with « add », checked before any database access; `none` when nothing was sent */
function planInput(input) {
  if (!input || input.planStep === undefined || input.planStep === null) return { none: true };
  const v = validatePlanStepInput(input.planStep);
  return v.ok ? { change: v } : { refusal: bad('INVALID_PLAN_STEP', 'Les informations de l’étape ne sont pas valides.') };
}
/** the value to store with a NEW step ({} = nothing), or a refusal. On a database without the column the step is still created, without plan data (`planSaved: false`). */
async function newPlanStep(userId, plan, db, has, T) {
  if (plan.none || !has) return { values: {}, saved: plan.none ? undefined : false };
  if (plan.change.set.dependsOnItemId) { const no = await dependencyRefusal(userId, null, plan.change.set.dependsOnItemId, db, T); if (no) return { refusal: no }; }
  const value = mergePlanStep(null, plan.change);
  return { values: value ? { planStep: value } : {}, saved: true };
}

/** The steps of the account-free plan of a dossier the ACCOUNT owns become tracked items; re-importing the same plan adds nothing twice (planKey). */
export async function importPlan(userId, shareId, db = defaultDb) {
  const [shared] = await db.select({ id: SharedDiagnostic.id, results: SharedDiagnostic.results, ownerCitizenId: SharedDiagnostic.ownerCitizenId, expiresAt: SharedDiagnostic.expiresAt })
    .from(SharedDiagnostic).where(eq(SharedDiagnostic.id, String(shareId || ''))).limit(1);
  if (!shared || shared.ownerCitizenId !== userId) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  const plan = buildActionPlan(shared.results);
  if (!plan.steps.length) return bad('NO_PLAN', 'Ce dossier ne contient pas encore de plan d’action à suivre.', 409);
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM "ParcoursItem" WHERE "userId" = ${userId}`)).rows;
  if (n + plan.steps.length > MAX_PARCOURS_ITEMS) return bad('PARCOURS_FULL', `Mon Parcours compte au plus ${MAX_PARCOURS_ITEMS} étapes.`, 409);
  const { has, T } = await parcoursSchema(db);
  let added = 0;
  for (const step of plan.steps) {
    // M1: who acts, the explanation, the internal links and the next action are COPIED into the step (planStep): they no longer depend on the dossier
    const copy = has ? planStepFromPlan(step) : null;
    const rows = await db.insert(T).values({ userId, origin: 'PLAN', sourceShareId: shared.id, planKey: planKeyOf(shared.id, step), stepKind: step.kind,
      itemCodes: step.itemCodes || [], title: String(step.title).slice(0, 300), ...(copy && planStepFits(copy) ? { planStep: copy } : {}) })
      .onConflictDoNothing({ target: [ParcoursItem.userId, ParcoursItem.planKey] }).returning();
    if (rows.length) { added += 1; await event(db, rows[0], 'CREATED', null, 'NOT_STARTED'); }
  }
  return { ok: true, status: 200, added, ...(await listParcours(userId, db)) };
}

const parcoursCount = async (userId, db) => (await db.execute(sql`SELECT count(*)::int AS n FROM "ParcoursItem" WHERE "userId" = ${userId}`)).rows[0].n;

/**
 * « Ajouter à mon parcours » from a record page or an orientation: `records` = 1 to 5 { type, id } (id or slug), every one of them PUBLIC now (a hidden or
 * unknown record is the same 404: no existence oracle). The title is the person's (3–200) or the first record's. Idempotent: the same set of records gives
 * the step that already exists (`added: false`), never a second one; the cap of 100 steps applies.
 */
async function addRecordItem(userId, input, db) {
  const list = input.records;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_PARCOURS_RECORDS) return bad('INVALID_RECORDS', `Indiquez de 1 à ${MAX_PARCOURS_RECORDS} fiches.`);
  for (const x of list) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || typeof x.type !== 'string' || typeof x.id !== 'string' || !PARCOURS_RECORD_TYPES.includes(x.type) || !RECORD_KEY.test(x.id)) return bad('INVALID_RECORDS', 'Fiche invalide.');
  }
  let title = null;
  if (input.title != null) {
    if (typeof input.title !== 'string') return bad('INVALID_TITLE', 'Décrivez l’étape en 3 à 200 caractères.');
    title = input.title.trim();
    if (title.length < 3 || title.length > 200) return bad('INVALID_TITLE', 'Décrivez l’étape en 3 à 200 caractères.');
  }
  const plan = planInput(input); if (plan.refusal) return plan.refusal;
  const found = [];
  for (const x of list) {
    const T = RECORD_TABLES[x.type];
    const [r] = await db.select().from(T).where(or(eq(T.id, x.id), eq(T.slug, x.id))).limit(1);
    if (!recordVisible(x.type, r) || !RECORD_KEY.test(String(r.id))) return bad('NOT_FOUND', 'Cette fiche n’est pas publiée.', 404);
    found.push({ type: x.type, r });
  }
  const codes = [...new Set(found.map((f) => `${f.type}:${f.r.id}`))].sort();
  const planKey = recordKeyOf(codes);
  const { has, T } = await parcoursSchema(db);
  const existing = async () => (await db.select().from(T).where(and(eq(ParcoursItem.userId, userId), eq(ParcoursItem.planKey, planKey))).limit(1))[0];
  const already = await existing();
  if (already) return { ok: true, status: 200, added: false, item: itemView(already) };   // the step that exists keeps its own plan data
  if ((await parcoursCount(userId, db)) >= MAX_PARCOURS_ITEMS) return bad('PARCOURS_FULL', `Mon Parcours compte au plus ${MAX_PARCOURS_ITEMS} étapes.`, 409);
  const ps = await newPlanStep(userId, plan, db, has, T); if (ps.refusal) return ps.refusal;
  const [row] = await db.insert(T).values({ userId, origin: 'MANUAL', planKey, stepKind: 'custom', itemCodes: codes, title: title || String(found[0].r.titre).trim().slice(0, 200), ...ps.values })
    .onConflictDoNothing({ target: [ParcoursItem.userId, ParcoursItem.planKey] }).returning();
  if (!row) return { ok: true, status: 200, added: false, item: itemView(await existing()) };   // two clicks at once: the other request created it
  await event(db, row, 'CREATED', null, 'NOT_STARTED');
  return { ok: true, status: 201, added: true, item: itemView(row), ...(ps.saved === undefined ? {} : { planSaved: ps.saved }) };
}

export async function addManualItem(userId, input, db = defaultDb) {
  if (input && input.records !== undefined) return addRecordItem(userId, input, db);
  const title = String(input?.title || '').trim();
  if (title.length < 3 || title.length > 200) return bad('INVALID_TITLE', 'Décrivez l’étape en 3 à 200 caractères.');
  const plan = planInput(input); if (plan.refusal) return plan.refusal;
  if ((await parcoursCount(userId, db)) >= MAX_PARCOURS_ITEMS) return bad('PARCOURS_FULL', `Mon Parcours compte au plus ${MAX_PARCOURS_ITEMS} étapes.`, 409);
  const { has, T } = await parcoursSchema(db);
  const ps = await newPlanStep(userId, plan, db, has, T); if (ps.refusal) return ps.refusal;
  const [row] = await db.insert(T).values({ userId, origin: 'MANUAL', stepKind: 'custom', title, ...ps.values }).returning();
  await event(db, row, 'CREATED', null, 'NOT_STARTED');
  return { ok: true, status: 201, item: itemView(row), ...(ps.saved === undefined ? {} : { planSaved: ps.saved }) };
}

async function ownedItem(userId, id, db, T = ParcoursItem) {
  const [row] = await db.select().from(T).where(and(eq(ParcoursItem.id, String(id || '')), eq(ParcoursItem.userId, userId))).limit(1);
  return row || null;
}

/**
 * M1 — the person changes the plan data of ONE of their steps: `planStep` = the keys to set (need, actor, links, dependsOnItemId, nextActionKey), a key
 * set to null is cleared, a key left out is untouched; the plan's own explanation and a closing reason stay. Strictly validated
 * (api/lib/parcours-plan-step.js); the dependency must be another step of the same account and must not close a loop. It changes no status and writes
 * no history line (the history records statuses, deadlines and notes: its kinds are fixed by the database).
 */
export async function setPlanStep(userId, id, input, db = defaultDb) {
  const v = validatePlanStepInput(input);
  if (!v.ok) return bad('INVALID_PLAN_STEP', 'Les informations de l’étape ne sont pas valides.');
  const { has, T } = await parcoursSchema(db);
  const row = await ownedItem(userId, id, db, T); if (!row) return notFound();
  if (!has) return PLAN_UNAVAILABLE();
  if (v.set.dependsOnItemId) { const no = await dependencyRefusal(userId, row.id, v.set.dependsOnItemId, db, T); if (no) return no; }
  const value = mergePlanStep(row.planStep, v);
  if (!planStepFits(value)) return bad('INVALID_PLAN_STEP', 'Les informations de l’étape ne sont pas valides.');
  const [up] = await db.update(T).set({ planStep: value }).where(and(eq(ParcoursItem.id, row.id), eq(ParcoursItem.userId, userId))).returning();
  return { ok: true, status: 200, item: itemView(up) };
}

/** The person records where they are. Any status can follow any other (real procedures go back and forth); every change is kept in the append-only history. */
/**
 * M1: `status` may also be ABANDONED (the person gave the step up) or OUTCOME_UNKNOWN (they never learnt the outcome). Both are honest ways a step ends
 * without an answer: the step becomes CLOSED — one of the ten states, so the status CHECK and the history are unchanged — and the reason is kept in
 * planStep.closure; choosing any of the ten states afterwards removes the reason. A dependency never blocks a change of status.
 */
export async function setStatus(userId, id, status, db = defaultDb) {
  const closure = PLAN_CLOSURES.includes(status) ? status : null;
  if (!closure && !PARCOURS_STATUSES.includes(status)) return bad('INVALID_STATUS', 'État inconnu.');
  const next = closure ? 'CLOSED' : status;
  const { has, T } = await parcoursSchema(db);
  const row = await ownedItem(userId, id, db, T); if (!row) return notFound();
  if (closure && !has) return PLAN_UNAVAILABLE();
  const was = has ? closureOf(row) : null;
  if (row.status === next && was === closure) return { ok: true, status: 200, item: itemView(row) };
  const planStep = has && was !== closure ? mergePlanStep(row.planStep, {}, closure) : undefined;
  const [up] = await db.update(T).set({ status: next, ...(planStep !== undefined ? { planStep } : {}) }).where(and(eq(ParcoursItem.id, row.id), eq(ParcoursItem.userId, userId))).returning();
  await event(db, row, 'STATUS', row.status, next);
  return { ok: true, status: 200, item: itemView(up) };
}

/** A deadline only with its OFFICIAL source (the same allow-list as human verification); clearing it is always allowed. */
export async function setDeadline(userId, id, input, db = defaultDb) {
  const { T } = await parcoursSchema(db);
  const row = await ownedItem(userId, id, db, T); if (!row) return notFound();
  let dueDate = null; let dueSourceUrl = null;
  if (input?.dueDate != null) {
    dueDate = new Date(String(input.dueDate));
    if (Number.isNaN(dueDate.getTime())) return bad('INVALID_DATE', 'Date invalide.');
    dueSourceUrl = String(input.dueSourceUrl || '').trim();
    if (!evidenceUrlAllowed(dueSourceUrl)) return bad('DEADLINE_SOURCE_REQUIRED', 'Une échéance doit citer sa source officielle (adresse https d’un site public reconnu).');
  }
  const [up] = await db.update(T).set({ dueDate, dueSourceUrl }).where(and(eq(ParcoursItem.id, row.id), eq(ParcoursItem.userId, userId))).returning();
  // R12 (C08): a MOVED deadline is reminded again at its new J-7 / J-1 (the reminders already sent were for the former date and kept it from ever being re-sent)
  const moved = (row.dueDate ? new Date(row.dueDate).getTime() : null) !== (dueDate ? dueDate.getTime() : null);
  if (up && moved) await db.execute(sql`DELETE FROM "ParcoursReminder" WHERE "itemId" = ${row.id}`);
  await event(db, row, 'DEADLINE');
  return { ok: true, status: 200, item: itemView(up) };
}

export async function setNote(userId, id, note, db = defaultDb) {
  const { T } = await parcoursSchema(db);
  const row = await ownedItem(userId, id, db, T); if (!row) return notFound();
  const v = note == null ? null : String(note).trim().slice(0, 500) || null;
  const [up] = await db.update(T).set({ note: v }).where(and(eq(ParcoursItem.id, row.id), eq(ParcoursItem.userId, userId))).returning();
  await event(db, row, 'NOTE');
  return { ok: true, status: 200, item: itemView(up) };
}

export async function removeItem(userId, id, db = defaultDb) {
  const rows = await db.delete(ParcoursItem).where(and(eq(ParcoursItem.id, String(id || '')), eq(ParcoursItem.userId, userId))).returning({ id: ParcoursItem.id });
  return rows.length ? { ok: true, status: 200 } : notFound();
}

export async function itemHistory(userId, id, db = defaultDb) {
  const row = await ownedItem(userId, id, db, (await parcoursSchema(db)).T); if (!row) return notFound();
  const events = await db.select({ kind: ParcoursEvent.kind, fromStatus: ParcoursEvent.fromStatus, toStatus: ParcoursEvent.toStatus, createdAt: ParcoursEvent.createdAt })
    .from(ParcoursEvent).where(eq(ParcoursEvent.itemId, row.id)).orderBy(asc(ParcoursEvent.createdAt));
  return { ok: true, status: 200, events };
}

// ───────────── favourites (published records only)
export const FAVORITE_TYPES = ['aide', 'demarche', 'structure'];
const titleOf = (type, r) => (type === 'structure' ? r.nom : r.titre) || null;

async function loadEntity(type, idOrSlug, db) {
  const T = ENTITY_TABLES[type]; if (!T) return null;
  const key = String(idOrSlug || '');
  const [r] = await db.select().from(T).where(T.slug ? or(eq(T.id, key), eq(T.slug, key)) : eq(T.id, key)).limit(1);
  return r || null;
}

export async function addFavorite(userId, input, db = defaultDb) {
  const type = String(input?.entityType || '');
  if (!FAVORITE_TYPES.includes(type)) return bad('INVALID_TYPE', 'Type inconnu.');
  const r = await loadEntity(type, input?.entityId, db);
  if (!r || !decide(r, type).visible) return bad('NOT_FOUND', 'Cette fiche n’est pas publiée.', 404);   // D-5: nothing hidden can be bookmarked (no existence oracle either)
  await db.insert(CitizenFavorite).values({ userId, entityType: type, entityId: r.id }).onConflictDoNothing();
  return { ok: true, status: 200 };
}

export async function removeFavorite(userId, input, db = defaultDb) {
  const type = String(input?.entityType || ''); const id = String(input?.entityId || '');
  await db.delete(CitizenFavorite).where(and(eq(CitizenFavorite.userId, userId), eq(CitizenFavorite.entityType, type), eq(CitizenFavorite.entityId, id)));
  return { ok: true, status: 200 };
}

/** A favourite whose record is no longer public stays listed WITHOUT its content ("n'est plus publiée"), so the person understands why it disappeared. */
export async function listFavorites(userId, db = defaultDb) {
  const favs = await db.select().from(CitizenFavorite).where(eq(CitizenFavorite.userId, userId)).orderBy(desc(CitizenFavorite.createdAt));
  const out = [];
  for (const type of FAVORITE_TYPES) {
    const ids = favs.filter((f) => f.entityType === type).map((f) => f.entityId); if (!ids.length) continue;
    const T = ENTITY_TABLES[type];
    const rows = await db.select().from(T).where(inArray(T.id, ids));
    for (const f of favs.filter((x) => x.entityType === type)) {
      const r = rows.find((x) => x.id === f.entityId);
      const visible = Boolean(r && decide(r, type).visible);
      out.push({ entityType: type, entityId: f.entityId, createdAt: f.createdAt, available: visible, title: visible ? titleOf(type, r) : null, slug: visible ? (r.slug || r.id) : null });
    }
  }
  out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { ok: true, status: 200, favorites: out };
}

// ───────────── opt-in history
export const HISTORY_KINDS = ['search', 'aide', 'demarche', 'structure', 'diagnostic', 'plan'];
export const MAX_HISTORY = 200;

async function historyEnabled(userId, db) {
  const [p] = await db.select({ h: CitizenProfile.historyEnabled }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  return Boolean(p && p.h);
}

/** Switching history OFF erases every entry at once (not only hides them). */
export async function setHistoryEnabled(userId, enabled, db = defaultDb) {
  if (typeof enabled !== 'boolean') return bad('INVALID_INPUT', 'enabled doit être vrai ou faux.');
  const [existing] = await db.select({ userId: CitizenProfile.userId }).from(CitizenProfile).where(eq(CitizenProfile.userId, userId)).limit(1);
  if (existing) await db.update(CitizenProfile).set({ historyEnabled: enabled }).where(eq(CitizenProfile.userId, userId));
  else await db.insert(CitizenProfile).values({ userId, historyEnabled: enabled });
  let erased = 0;
  if (!enabled) erased = (await db.delete(CitizenHistoryEntry).where(eq(CitizenHistoryEntry.userId, userId)).returning({ id: CitizenHistoryEntry.id })).length;
  return { ok: true, status: 200, enabled, erased };
}

export async function addHistory(userId, input, db = defaultDb) {
  if (!(await historyEnabled(userId, db))) return { ok: true, status: 202, recorded: false };   // not an error: the person did not opt in, nothing is kept
  const kind = String(input?.kind || ''); const label = String(input?.label || '').trim().slice(0, 120); const ref = input?.ref == null ? null : String(input.ref).slice(0, 200);
  if (!HISTORY_KINDS.includes(kind) || !label) return bad('INVALID_INPUT', 'Entrée d’historique invalide.');
  await db.insert(CitizenHistoryEntry).values({ userId, kind, label, ref });
  await db.execute(sql`DELETE FROM "CitizenHistoryEntry" WHERE "userId" = ${userId} AND id NOT IN (SELECT id FROM "CitizenHistoryEntry" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT ${MAX_HISTORY})`);
  return { ok: true, status: 201, recorded: true };
}

export async function listHistory(userId, db = defaultDb) {
  const enabled = await historyEnabled(userId, db);
  const entries = enabled ? await db.select({ id: CitizenHistoryEntry.id, kind: CitizenHistoryEntry.kind, label: CitizenHistoryEntry.label, ref: CitizenHistoryEntry.ref, createdAt: CitizenHistoryEntry.createdAt })
    .from(CitizenHistoryEntry).where(eq(CitizenHistoryEntry.userId, userId)).orderBy(desc(CitizenHistoryEntry.createdAt)).limit(MAX_HISTORY) : [];
  return { ok: true, status: 200, enabled, entries };
}

export async function removeHistory(userId, id, db = defaultDb) {
  const q = id ? and(eq(CitizenHistoryEntry.userId, userId), eq(CitizenHistoryEntry.id, String(id))) : eq(CitizenHistoryEntry.userId, userId);
  const n = (await db.delete(CitizenHistoryEntry).where(q).returning({ id: CitizenHistoryEntry.id })).length;
  return { ok: true, status: 200, erased: n };
}

// ───────────── Mon Coffre
export const COFFRE_CATEGORIES = ['identite', 'revenus', 'logement', 'famille', 'sante', 'emploi', 'autre'];
// R15 (HDS, dossier 27/10 ASSO-056 / ASSO-066): no qualified health-data hosting exists and ADA's own HDS role is not qualified, so the vault refuses the
// « Santé » category (fail-closed). Documents already filed under it stay listed, downloadable and erasable. Only an HDS decision changes this, in a versioned change.
export const COFFRE_HEALTH_DOCUMENTS_ACCEPTED = false;
export const COFFRE_UPLOAD_CATEGORIES = COFFRE_CATEGORIES.filter((c) => COFFRE_HEALTH_DOCUMENTS_ACCEPTED || c !== 'sante');
export const COFFRE_MAX_FILE = 3 * 1024 * 1024;   // PKG-11 audit: what a JSON upload can really carry (src/lib/fileVaultLimits.js)
export const COFFRE_MAX_FILES = 20;
export const COFFRE_MAX_TOTAL = 50 * 1024 * 1024;
const coffreCtx = (userId, docId) => `coffre:${userId}:${docId}`;

/** The type comes from the CONTENT (magic bytes), never from the declared name or MIME alone. */
export function sniffType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

function decodeBase64(value) {
  if (typeof value !== 'string') return null;
  let raw = value.trim(); const comma = raw.indexOf(',');
  if (/^data:/i.test(raw) && comma >= 0) raw = raw.slice(comma + 1);
  raw = raw.replace(/\s+/g, '');
  if (!raw || raw.length > Math.ceil(COFFRE_MAX_FILE * 4 / 3) + 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 === 1) return null;
  try { return Buffer.from(raw, 'base64'); } catch { return null; }
}

const docView = (r) => {
  const name = openText(r.filenameEncrypted, { purpose: 'coffre-filename', context: coffreCtx(r.userId, r.id) });
  return { id: r.id, category: r.category, name: name || 'Document', mimeType: r.mimeType, byteLength: r.byteLength, scanStatus: r.scanStatus, expiresAt: r.expiresAt, createdAt: r.createdAt,
    expired: Boolean(r.expiresAt && new Date(r.expiresAt).getTime() <= Date.now()) };
};

export async function listCoffre(userId, db = defaultDb) {
  const rows = await db.select().from(CitizenDocument).where(eq(CitizenDocument.userId, userId)).orderBy(desc(CitizenDocument.createdAt));
  const used = rows.reduce((s, r) => s + r.byteLength, 0);
  return { ok: true, status: 200, documents: rows.map(docView), quota: { files: rows.length, maxFiles: COFFRE_MAX_FILES, bytes: used, maxBytes: COFFRE_MAX_TOTAL } };
}

export async function uploadCoffre(userId, input, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const category = String(input?.category || '');
  if (!COFFRE_CATEGORIES.includes(category)) return bad('INVALID_CATEGORY', 'Catégorie inconnue.');
  if (!COFFRE_UPLOAD_CATEGORIES.includes(category)) return bad('HEALTH_DOCUMENTS_NOT_ACCEPTED', 'Mon Coffre n’accepte pas les documents de santé : leur hébergement demande un hébergeur agréé (HDS), qui n’est pas encore en place.', 422);
  // C05 (R28), after the pure checks (R15: a health document is refused before the database is read): storing documents is a sensitive account feature — closed to a declared minor until a legally validated age policy says otherwise
  const gate = await ageGate(userId, db); if (!gate.allowed) return ageRefusal(gate);
  const originalName = [...String(input?.originalName || '')].filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join('').trim().slice(0, 200);
  if (!originalName) return bad('INVALID_NAME', 'Nom de fichier manquant.');
  const buf = decodeBase64(input?.fileBase64);
  if (!buf || !buf.length) return bad('INVALID_FILE', 'Fichier illisible ou vide.');
  if (buf.length > COFFRE_MAX_FILE) return bad('FILE_TOO_LARGE', 'Fichier trop volumineux (3 Mo au plus).', 413);
  const sniffed = sniffType(buf);
  if (!sniffed) return bad('UNSUPPORTED_TYPE', 'Seuls les fichiers PDF, PNG et JPEG sont acceptés.', 415);
  if (input?.mimeType && String(input.mimeType) !== sniffed) return bad('TYPE_MISMATCH', 'Le contenu du fichier ne correspond pas à son type déclaré.', 415);
  let expiresAt = null;
  if (input?.expiresAt) { expiresAt = new Date(String(input.expiresAt)); if (Number.isNaN(expiresAt.getTime())) return bad('INVALID_DATE', 'Date d’expiration invalide.'); }
  const q = (await listCoffre(userId, db)).quota;
  if (q.files >= COFFRE_MAX_FILES) return bad('QUOTA_FILES', `Mon Coffre contient au plus ${COFFRE_MAX_FILES} documents.`, 409);
  if (q.bytes + buf.length > COFFRE_MAX_TOTAL) return bad('QUOTA_BYTES', 'Espace de Mon Coffre insuffisant (50 Mo au total).', 409);
  const id = crypto.randomUUID(); const ctx = coffreCtx(userId, id);
  const key = await storage.upload(sealBuffer(buf, { purpose: 'coffre-file', context: ctx }), 'application/octet-stream');
  try {
    const [row] = await db.insert(CitizenDocument).values({ id, userId, category, filenameEncrypted: sealText(originalName, { purpose: 'coffre-filename', context: ctx }), mimeType: sniffed,
      byteLength: buf.length, checksumSha256: crypto.createHash('sha256').update(buf).digest('hex'), storageKey: key, expiresAt }).returning();
    return { ok: true, status: 201, document: docView(row) };
  } catch (e) {
    await storage.delete(key).catch(() => {});   // never leave an orphan encrypted blob
    throw e;
  }
}

export async function downloadCoffre(userId, id, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const [row] = await db.select().from(CitizenDocument).where(and(eq(CitizenDocument.id, String(id || '')), eq(CitizenDocument.userId, userId))).limit(1);
  if (!row) return notFound();
  const bytes = openBuffer(await storage.download(row.storageKey), { purpose: 'coffre-file', context: coffreCtx(userId, row.id) });
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.checksumSha256) return bad('INTEGRITY_ERROR', 'Le document stocké est altéré.', 500);
  return { ok: true, status: 200, bytes, mimeType: row.mimeType, name: docView(row).name };
}

export async function deleteCoffre(userId, id, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const rows = await db.delete(CitizenDocument).where(and(eq(CitizenDocument.id, String(id || '')), eq(CitizenDocument.userId, userId))).returning({ storageKey: CitizenDocument.storageKey });
  if (!rows.length) return notFound();
  await storage.delete(rows[0].storageKey).catch(() => {});   // the row is gone first (the document is unreachable); a failed blob delete is retried by erasure jobs
  return { ok: true, status: 200 };
}

/** Every Coffre blob of an account (account erasure / DSR purge). */
export async function coffreStorageKeys(userId, db = defaultDb) {
  return (await db.select({ k: CitizenDocument.storageKey }).from(CitizenDocument).where(eq(CitizenDocument.userId, userId))).map((r) => r.k);
}

// ───────────── Mon Espace summary (C13)
/**
 * C13 summary. R45 / ENG-LR-6 (data minimisation): a part of the summary whose capability is closed (api/_utils/capabilities.js) is neither read nor returned —
 * no count, no flag, no key: Mon Parcours (citizen.parcours), Mon Coffre (citizen.vault), favourites (citizen.favorites), shared dossiers
 * (citizen.shared_dossier), next appointment (citizen.booking), message state (citizen.booking_message). In the LAB (enforcement off) every part is returned.
 * @param {string} userId @param {any} [db] @param {{ isOpen?: (capability: string) => boolean }} [opts]
 */
export async function espaceSummary(userId, db = defaultDb, opts = {}) {
  const isOpen = opts.isOpen || ((c) => capabilityOpen(c));
  const summary = {};
  if (isOpen('citizen.parcours')) {
    const parcours = (await listParcours(userId, db)).items;
    const open = parcours.filter((i) => !['CLOSED', 'DECISION_POSITIVE', 'DECISION_NEGATIVE'].includes(i.status));
    const nextDue = open.filter((i) => i.dueDate && new Date(i.dueDate).getTime() > Date.now()).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] || null;
    summary.parcours = { total: parcours.length, open: open.length, nextDue: nextDue ? { id: nextDue.id, title: nextDue.title, dueDate: nextDue.dueDate } : null };
  }
  if (isOpen('citizen.vault')) summary.documents = (await listCoffre(userId, db)).quota.files;
  if (isOpen('citizen.favorites')) {
    const [{ f }] = (await db.execute(sql`SELECT count(*)::int AS f FROM "CitizenFavorite" WHERE "userId" = ${userId}`)).rows;
    summary.favorites = f;
  }
  if (isOpen('citizen.shared_dossier')) {
    const [{ s }] = (await db.execute(sql`SELECT count(*)::int AS s FROM "SharedDiagnostic" WHERE "ownerCitizenId" = ${userId}`)).rows;
    summary.dossiers = s;
  }
  if (isOpen('citizen.booking')) {
    const appts = await db.select({ id: ProAppointment.id, startAt: ProAppointment.startAt, status: ProAppointment.status }).from(ProAppointment)
      .where(and(eq(ProAppointment.citizenUserId, userId), sql`${ProAppointment.startAt} > NOW()`, sql`${ProAppointment.status} <> 'cancelled'`)).orderBy(asc(ProAppointment.startAt)).limit(1);
    summary.nextAppointment = appts[0] || null;
  }
  if (isOpen('citizen.booking_message')) {
    // C13: the message state of the account (no read markers exist, so no « unread » count is invented): how many conversations, when the latest message was
    // written and whether the structure wrote last (= the person may have something to read or answer). Message bodies are never read here.
    const [m] = (await db.execute(sql`SELECT count(DISTINCT c.id)::int AS conversations, max(msg."createdAt") AS "lastAt",
        (SELECT x."senderType" FROM "RdvConversationMessage" x JOIN "RdvConversation" y ON y.id = x."conversationId" WHERE y."citizenUserId" = ${userId} ORDER BY x."createdAt" DESC LIMIT 1) AS "lastSender"
      FROM "RdvConversation" c LEFT JOIN "RdvConversationMessage" msg ON msg."conversationId" = c.id WHERE c."citizenUserId" = ${userId}`)).rows;
    summary.messages = { conversations: m?.conversations || 0, lastMessageAt: m?.lastAt || null, lastFromStructure: m?.lastSender ? m.lastSender !== 'USER' : false };
  }
  return { ok: true, status: 200, summary };
}

// ───────────── R16 / C17 — transparency on a dossier the ACCOUNT owns
const ACCESS_LABELS = Object.freeze({
  DOSSIER_ACCESS_GRANTED: 'a ouvert l’accès au dossier', DOSSIER_VIEWED: 'a consulté le dossier', DOSSIER_EXPORTED: 'a exporté le dossier',
  DOSSIER_STATUS_UPDATED: 'a mis à jour le suivi', ATTESTATION_VIEWED: 'a consulté l’attestation', FILE_UPLOADED: 'a ajouté un document',
  DOSSIER_FILE_DOWNLOADED: 'a téléchargé un document', DOSSIER_SYNTHESIS_DRAFTED: 'a fait rédiger une synthèse automatique',
  DOSSIER_SYNTHESIS_APPROVED: 'a validé une synthèse automatique',
});

async function ownedDossier(userId, shareId, db) {
  const [s] = await db.select({ id: SharedDiagnostic.id, ownerCitizenId: SharedDiagnostic.ownerCitizenId, results: SharedDiagnostic.results })
    .from(SharedDiagnostic).where(eq(SharedDiagnostic.id, String(shareId || ''))).limit(1);
  return s && s.ownerCitizenId === userId ? s : null;
}
async function structureNames(ids, db) {
  const uniq = [...new Set(ids.filter(Boolean))]; if (!uniq.length) return {};
  const { Structure } = await import('../../src/db/schema.js');
  const rows = await db.select({ id: Structure.id, nom: Structure.nom }).from(Structure).where(inArray(Structure.id, uniq));
  return Object.fromEntries(rows.map((r) => [r.id, r.nom]));
}

/** R16: who did what with the dossier, by ORGANISATION (no staff identifier, no IP), newest first. */
export async function dossierAccessLog(userId, shareId, db = defaultDb) {
  const s = await ownedDossier(userId, shareId, db);
  if (!s) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  const rows = (await db.execute(sql`SELECT action, "timestamp" AS at, details->>'structureId' AS sid FROM "AuditLog"
    WHERE details->>'shareId' = ${s.id} AND action IN (${sql.join(Object.keys(ACCESS_LABELS).map((a) => sql`${a}`), sql`, `)}) ORDER BY "timestamp" DESC LIMIT 200`)).rows;
  const names = await structureNames(rows.map((r) => r.sid), db);
  return { ok: true, status: 200, events: rows.map((r) => ({ action: r.action, label: ACCESS_LABELS[r.action], at: r.at, organization: names[r.sid] || 'Organisation' })) };
}

const fileCtx = (shareId, fileId) => `file:${shareId}:${fileId}`;
/** C17: the documents organisations attached to the person's dossier — listed with their organisation, downloadable, removable by the person. */
export async function dossierDocuments(userId, shareId, db = defaultDb) {
  const s = await ownedDossier(userId, shareId, db);
  if (!s) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  const files = Array.isArray(s.results?._files) ? s.results._files : [];
  const names = await structureNames(files.map((f) => f.structureId), db);
  return { ok: true, status: 200, documents: files.map((f) => ({ id: f.id, name: (f.filenameEncrypted && openText(f.filenameEncrypted, { purpose: 'dossier-filename', context: fileCtx(s.id, f.id) })) || 'Document',
    mimeType: f.mimeType, byteLength: f.byteLength, uploadedAt: f.uploadedAt, organization: names[f.structureId] || 'Organisation' })) };
}

export async function downloadDossierDocument(userId, shareId, fileId, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const s = await ownedDossier(userId, shareId, db); if (!s) return notFound();
  const f = (Array.isArray(s.results?._files) ? s.results._files : []).find((x) => x && x.id === String(fileId || ''));
  if (!f) return notFound();
  const bytes = openBuffer(await storage.download(f.storageKey), { purpose: 'dossier-file', context: fileCtx(s.id, f.id) });
  if (f.checksumSha256 && crypto.createHash('sha256').update(bytes).digest('hex') !== f.checksumSha256) return bad('INTEGRITY_ERROR', 'Le document stocké est altéré.', 500);
  return { ok: true, status: 200, bytes, mimeType: f.mimeType || 'application/octet-stream', name: openText(f.filenameEncrypted, { purpose: 'dossier-filename', context: fileCtx(s.id, f.id) }) || 'document' };
}

/** The person removes a document from THEIR dossier: atomic JSON removal (concurrent uploads are kept), then the encrypted blob is purged. */
export async function removeDossierDocument(userId, shareId, fileId, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const s = await ownedDossier(userId, shareId, db); if (!s) return notFound();
  const id = String(fileId || '');
  const f = (Array.isArray(s.results?._files) ? s.results._files : []).find((x) => x && x.id === id);
  if (!f) return notFound();
  const rows = (await db.execute(sql`UPDATE "SharedDiagnostic" SET results = jsonb_set(results, '{_files}', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(results->'_files') e WHERE e->>'id' <> ${id}), '[]'::jsonb))
    WHERE id = ${s.id} AND "ownerCitizenId" = ${userId} AND jsonb_typeof(results->'_files') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(results->'_files') e WHERE e->>'id' = ${id})
    RETURNING id`)).rows;
  if (!rows.length) return notFound();
  if (f.storageKey) await storage.delete(f.storageKey).catch(() => {});
  return { ok: true, status: 200 };
}

/**
 * Share-from-Coffre: the person sends ONE of their Coffre documents to ONE organisation that holds an active grant on ONE of their dossiers. The bytes are re-encrypted for that
 * dossier and organisation (dossier-file purpose); the projection only shows an entry to the organisation it names, so no other grantee sees it. Removal = C17 removeDossierDocument.
 */
export async function shareFromCoffre(userId, input, deps = {}) {
  const db = deps.db || defaultDb; const storage = deps.storage || defaultStorage;
  const gate = await ageGate(userId, db); if (!gate.allowed) return ageRefusal(gate);   // C05 (R28): sending a document to an organisation, same rule
  const s = await ownedDossier(userId, input?.shareId, db);
  if (!s) return bad('not_found', 'Ce dossier est introuvable ou n’est pas rattaché à votre compte.', 404);
  // PKG-11 audit: nothing new is shared while the person restricts processing (art. 18)
  if (await isRestricted(userId, db)) return bad('PROCESSING_RESTRICTED', 'Vous avez demandé la limitation du traitement : levez-la avant de transmettre un document.', 409);
  const structureId = String(input?.structureId || '');
  const [{ g }] = (await db.execute(sql`SELECT count(*)::int AS g FROM "SharedDossierGrant" WHERE "sharedDiagnosticId" = ${s.id} AND "structureId" = ${structureId} AND "revokedAt" IS NULL`)).rows;
  if (!g) return bad('NO_ACTIVE_GRANT', 'Cette organisation n’a pas accès à ce dossier.', 404);
  const [doc] = await db.select().from(CitizenDocument).where(and(eq(CitizenDocument.id, String(input?.documentId || '')), eq(CitizenDocument.userId, userId))).limit(1);
  if (!doc) return notFound();
  // R15 (HDS, fail-closed): a document filed under « Santé » before R15 stays the person's (list, download, erase) but is never copied to an organisation's dossier
  if (!COFFRE_UPLOAD_CATEGORIES.includes(doc.category)) return bad('HEALTH_DOCUMENTS_NOT_ACCEPTED', 'Les documents de santé ne peuvent pas être transmis depuis Mon Coffre : leur hébergement demande un hébergeur agréé (HDS), qui n’est pas encore en place.', 422);
  const plain = openBuffer(await storage.download(doc.storageKey), { purpose: 'coffre-file', context: coffreCtx(userId, doc.id) });
  const name = openText(doc.filenameEncrypted, { purpose: 'coffre-filename', context: coffreCtx(userId, doc.id) }) || 'document';
  const fileId = crypto.randomUUID(); const ctx = fileCtx(s.id, fileId);
  const key = await storage.upload(sealBuffer(plain, { purpose: 'dossier-file', context: ctx }), 'application/octet-stream');
  const entry = { id: fileId, structureId, storageKey: key, filenameEncrypted: sealText(name, { purpose: 'dossier-filename', context: ctx }), mimeType: doc.mimeType, uploadedAt: new Date().toISOString(),
    byteLength: plain.length, checksumSha256: doc.checksumSha256, encrypted: true, source: 'CITIZEN_COFFRE' };
  const rows = (await db.execute(sql`UPDATE "SharedDiagnostic" SET results = jsonb_set(coalesce(results, '{}'::jsonb), '{_files}', (CASE WHEN jsonb_typeof(results->'_files') = 'array' THEN results->'_files' ELSE '[]'::jsonb END) || ${JSON.stringify([entry])}::jsonb)
    WHERE id = ${s.id} AND "ownerCitizenId" = ${userId} AND EXISTS (SELECT 1 FROM "SharedDossierGrant" g WHERE g."sharedDiagnosticId" = ${s.id} AND g."structureId" = ${structureId} AND g."revokedAt" IS NULL) RETURNING id`)).rows;
  if (!rows.length) { await storage.delete(key).catch(() => {}); return bad('NO_ACTIVE_GRANT', 'Cette organisation n’a plus accès à ce dossier.', 409); }
  await db.execute(sql`INSERT INTO "AuditLog" (id, action, actor, actor_id, entity, entity_id, details, "timestamp") VALUES (${crypto.randomUUID()}, 'CITIZEN_DOCUMENT_SHARED', 'citizen', ${userId}, 'SharedDiagnostic', ${s.id}, ${JSON.stringify({ shareId: s.id, structureId, fileId })}::jsonb, NOW())`).catch(() => {});
  return { ok: true, status: 201, fileId };
}
