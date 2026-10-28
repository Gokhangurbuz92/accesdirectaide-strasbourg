// @ts-nocheck
/**
 * Automatic verification chain — « Veille automatique » (owner decision D-5 v2, 2026-10-25, confirmed by the owner's definitive directive: the system finds,
 * checks, cross-checks, publishes, corrects and withdraws by itself; the owner gets a dashboard and alerts, never a queue). One run:
 *   1. sources: the Annuaire de l'administration of the département and the Service-Public open-data archive of the day (checked: not much smaller than the
 *      last one, not older), each with its health in the registry; once a week the registry of official sources refreshes itself (sites the Annuaire attests,
 *      online services Service-Public cites; sources.js);
 *   2. aides, démarches and dispositifs: their official page — the Service-Public fiche of the day (dila.js) or the page of a public body (pages.js), found
 *      automatically when the record has none, and used only if that body is an authority for that kind of information and the fiche applies to the
 *      territory; does it still exist? did it change since the texts were written (DILA's date of last important change, the facts of a page)? → the normal
 *      summary and the FALC version are written again and checked (texts.js) → published with the evidence, or withdrawn when the official page is gone;
 *   3. structures: SIRENE (open or closed, address) and the Annuaire (public offices: address, telephones, hours) — corrected when the official sources agree,
 *      withdrawn when the establishment closed, merged when two records are the same establishment; never a person's own e-mail address in a public listing;
 *   4. growth: the public offices of the département listed in the Annuaire, the health, social and medico-social establishments of the département in the
 *      FINESS+ register (finess.js: the kinds of place a person may turn to; closed ones never), and a few Service-Public fiches of the social themes per run;
 *   5. upkeep: a light monthly visit of the registry's sites (a few per night), then the self-check of everything public (audit.js);
 *   6. the journal: CronRun 'veille' (counts, progress, health of the machine, alerts) and VeilleEvent (what happened to which record, and why).
 * Fail-closed and bounded: what could not be checked is not published, or keeps its verified state when only a source failed (an outage is not a closure);
 * a page that disappears is withdrawn only when it is still missing the next day; the withdrawals of one night are capped (many at once is more likely a fault
 * of a source); every content change keeps the previous version (EntityVersion: reversible) and goes through the ledger (content-verification.js) with the
 * reviewer « ada-veille-automatique » (role system) and its evidence — never presented as a person's review.
 * Bounded by the machine too (resources.js: disk floor for the native QA, no run during a QA campaign, model only with free memory, model unloaded after) and
 * by the owner's pause (control.js). Records are checked when due: every night when the source is a feed read anyway, every other day for the page of a site,
 * every week for the SIRENE identity of an association, sooner when a date (deadline, application window) is near.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../../src/db/index.js';
import { Aide, Demarche, Dispositif, Structure, SourceSnapshot, SourceRegistryEntry, VeilleEvent, CronRun, StructureDuplicateDecision } from '../../../src/db/schema.js';
import { recordVerification, rowJson, contentVersion } from '../content-verification.js';
import { snapshotRow, isEditHold } from '../content-versions.js';
import { DUPLICATE_HOLD, decide as decideDuplicate } from '../duplicate-register.js';
import { isAllowedSource } from '../../lib/services/official-sources.js';
import { fetchArchive, ficheMeta, readSource, resolveId, titleTokens, titleAcronym } from './dila.js';
import { readOfficialPage, sha256, frenchDate } from './pages.js';
import { digits, lookupSiret, searchEstablishments } from './registries.js';
import { checkStructure, sameStreet, sameStreetNumber, streetOnly, readableCase } from './structure-check.js';
import { writeTexts, inventedNumbers, contradictions, TEXT_RULES_VERSION } from './texts.js';
import { refreshRegistry, refreshOnlineServices, ensureSeed, listDepartmentOffices, recordFeedHealth, reviewSources } from './sources.js';
import { officeRecord, officeTexts } from './offices.js';
import { fetchFiness, readFiness, finessTexts, termsVersion } from './finess.js';
import { fetchDataInclusion, readDataInclusion, servicesValue, servicesFor, sameServices, producerOf, NOT_A_PLACE_NAME, termsVersion as diTermsVersion } from './datainclusion.js';
import { nominativeEmail, publicEmail } from './contacts.js';
import { probe as probeMachine, allowed, guardEnabled, modelOptions, unloadModel } from './resources.js';
import { publicationAudit, WITHDRAW_ON } from './audit.js';
import { acquireRun, recordSkip, pauseState, stopRequested, clearStop } from './control.js';
import { SourceError, networkEnabled, hostIn } from './fetcher.js';

export { veilleDigest, recordHistory } from './digest.js';
export { requestStop, setPause, pauseState } from './control.js';

export const SYSTEM_REVIEWER = Object.freeze({ id: 'ada-veille-automatique', role: 'system' });
export const SYSTEM_HOLD = 'Veille automatique';
const TABLES = { aide: Aide, demarche: Demarche, dispositif: Dispositif, structure: Structure };
const PUBLISHED = { aide: 'publie', demarche: 'publie', dispositif: 'publie', structure: 'actif' };
const REVERIFY_DAYS = 7;
const HOUR = 3600000;
const BEAT_MS = 15000;
/** holds the chain never lifts: a duplicate (the duplicate register decides those), privacy, safety, a report — recognised by their marker, not by a word in a free note */
const PROTECTED_RE = /^\s*(PRIVACY|CONFIDENTIAL|CONFIDENTIALIT[ÉE]|SAFETY|S[ÉE]CURIT[ÉE]|DONN[ÉE]ES PERSONNELLES|SIGNALEMENT|REPORT)(?!\p{L})/iu;   // « PRIVACY_REVIEW: … » too
const PROTECTED_HOLD = { test: (h) => String(h || '').startsWith(DUPLICATE_HOLD) || PROTECTED_RE.test(String(h || '')) };
/**
 * Supervision (D-5 v2): a person's « Refuser » or « Mettre en attente » recorded after the veille's first automatic decision (its activation) stays as it is: the
 * veille neither lifts it nor publishes over it, and says so in its journal. The decisions of the earlier per-record queue (before that first decision) are
 * superseded by the evidence; a person's edit or rollback (« Contenu modifié par l’administration… ») is not a refusal: the record is checked again.
 */
async function personDecision(tx, kind, cur, activatedAt) {
  if (!cur) return null;
  // R14: the record's own state set by a person is a decision too — an archived aide / démarche / dispositif, a suspended organisation (org-lifecycle, MFA + reason),
  // a record a person set back to draft after it was published (the chain only ever creates drafts, it never unpublishes): the chain used to publish over them
  if (cur.statut === 'archive') return { outcome: 'ARCHIVED', day: null, note: null };
  if (kind === 'structure' && cur.statut === 'suspendu') return { outcome: 'SUSPENDED', day: null, note: cur.commentaire_statut || null };
  if (cur.statut === 'brouillon' && cur.published_at) return { outcome: 'UNPUBLISHED', day: null, note: null };
  if (!activatedAt) return null;
  const held = Boolean(cur.publication_hold) && !String(cur.publication_hold).startsWith(SYSTEM_HOLD) && !isEditHold(cur.publication_hold);
  // R14: the latest decision of a PERSON — a later automatic withdrawal (a system HOLD row) no longer makes a refusal lapse when the source comes back
  const [last] = (await tx.execute(sql`SELECT outcome, "createdAt" AS at, to_char("createdAt", 'DD/MM/YYYY') AS day, "evidenceNote" AS note FROM "ContentVerification"
    WHERE "entityType" = ${kind} AND "entityId" = ${cur.id} AND "reviewerRole" <> 'system' ORDER BY "createdAt" DESC, id DESC LIMIT 1`)).rows;
  if (!last || !(new Date(last.at) > activatedAt)) return null;
  if (last.outcome === 'REJECTED') return { outcome: 'REJECTED', day: last.day, note: last.note };
  if (last.outcome === 'HOLD' && held) return { outcome: 'HOLD', day: last.day, note: cur.publication_hold };
  return null;
}
const PERSON_WORD = { REJECTED: 'refusée', HOLD: 'mise en attente', ARCHIVED: 'archivée', SUSPENDED: 'suspendue', UNPUBLISHED: 'retirée de la publication' };
const refusedLine = (r) => (r.code === 'PROTECTED_HOLD' ? `retenue pour une autre raison (${r.hold})`
  : r.code === 'PERSON_DECISION' ? `${PERSON_WORD[r.person.outcome] || 'mise en attente'} par une personne${r.person.day ? ` le ${r.person.day}` : ''}${r.person.note ? ` (« ${String(r.person.note).slice(0, 160)} »)` : ''} : la veille respecte cette décision`
  : r.message || r.code);
/** the moment of the veille's first automatic decision (null before its first run) */
async function firstAutomaticDecision(db) {
  const [r] = (await db.execute(sql`SELECT min("createdAt") AS at FROM "ContentVerification" WHERE "reviewerRole" = 'system'`)).rows;
  return r?.at ? new Date(r.at) : null;
}
const SP_ID = /service-public\.(?:gouv\.)?fr\/(?:particuliers|associations|professionnels-entreprises)\/vosdroits\/([FN]\d+)/i;
/** the territories a Service-Public fiche may cover for a record of the Bas-Rhin (the archive says « France entière » or « Métropole ») */
const OUR_COVERAGE = /^\s*$|France enti[èe]re|M[ée]tropole|France m[ée]tropolitaine|Alsace|Moselle|Bas-Rhin|Grand Est/i;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const frDay = (d) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const safeJson = (s) => { try { return JSON.parse(String(s || '')); } catch { return null; } };
const titleOf = (row) => row.titre || row.nom || '';

// ------------------------------------------------------------------------------------------------------------------------------- matching helpers
const GENERIC = new Set(['demande', 'demander', 'information', 'generale', 'bas', 'rhin', 'strasbourg', 'eurometropole', 'alsace', 'grand', 'est', 'jeune', 'faire', 'obtenir', 'informer', 'comment', 'vous', 'voulez']);
/** plural-insensitive word (« titres » = « titre ») */
const stem = (w) => (w.length > 4 ? w.replace(/[sx]$/, '') : w);
const STOPWORDS = new Set(['pour', 'avec', 'dans', 'votre', 'vous', 'sont', 'etre', 'avoir', 'plus', 'cette', 'elle', 'leur', 'leurs', 'aussi', 'peut', 'entre', 'sous', 'tout',
  'tous', 'toute', 'faire', 'mais', 'comme', 'sans', 'chez', 'apres', 'avant', 'selon', 'personnes', 'personne', 'certaines', 'conditions']);
const contentWords = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
/** share of the record's words found in the candidate source (record → source containment) */
function contentScore(recordText, sourceText) {
  const a = contentWords(recordText); const b = contentWords(sourceText);
  if (!a.size || !b.size) return 0;
  let c = 0; for (const w of a) if (b.has(w)) c += 1;
  return c / a.size;
}
/** title closeness: the record's distinctive title words found in the source title, with the acronym as a strong signal */
function titleScore(recordTitle, sourceTitle) {
  const want = titleTokens(recordTitle).map(stem).filter((w) => !GENERIC.has(w)); const have = new Set(titleTokens(sourceTitle).map(stem));
  if (!want.length) return 0;
  const acr = titleAcronym(recordTitle); const sacr = titleAcronym(sourceTitle);
  const wantPlain = want.filter((w) => !acr || w !== acr.toLowerCase());
  const base = wantPlain.length ? wantPlain.filter((w) => have.has(w)).length / wantPlain.length : 0;
  // the source title says nothing more than the record's (« Prime d'activité » for « Demande de prime d'activité ») — the general page, not a particular case
  const extra = [...have].filter((w) => !GENERIC.has(w) && !want.includes(w) && (!sacr || w !== sacr.toLowerCase()));
  return base + (acr && (sacr === acr || have.has(acr.toLowerCase())) ? 0.3 : 0) - (acr && sacr && sacr !== acr ? 0.3 : 0) + (base >= 1 && extra.length === 0 ? 0.35 : 0);
}
/**
 * R20: a page found from a research hint becomes a record's official source only when the page itself is about it — its TITLE names the record's distinctive words.
 * The opening of the text was enough before: a « help and contact » page that mentions the product among others passed, and the Carte Solidaire Grand Est was
 * drafted from that page's school-transport paragraphs (stopped only by the FALC check). A page of the right body that is about something else is not a source.
 */
export function pageIsAbout(row, pageTitle) { return titleScore(titleOf(row), String(pageTitle || '')) >= 0.5; }
const recordText = (r) => [r.titre, r.nom, r.cest_quoi, r.pour_qui, r.ce_que_ca_aide, r.description_courte, r.description_falc, r.summary_falc, r.conditions_falc, r.montant_falc, r.montant, r.ou_faire, r.ou_demander].filter(Boolean).join(' ');

/** research-aid candidates (data/strasbourg/ws2-source-candidates.v1.json): only hints — every hint is checked like any other source */
function loadHints(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'data', 'strasbourg', 'ws2-source-candidates.v1.json'), 'utf8'));
    return new Map((j.records || []).map((r) => [r.slug, (r.candidates || []).map((c) => c.url).filter(Boolean)]));
  } catch { return new Map(); }
}

// ------------------------------------------------------------------------------------------------------------------------------- run
/**
 * One run of the automatic verification. @param {{
 *   db?: any, env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, generate?: Function, now?: Date, trigger?: string, departement?: string,
 *   root?: string, maxMinutes?: number, texts?: boolean, forceRegistry?: boolean, force?: boolean, cacheDir?: string | null, ignorePause?: boolean,
 *   limits?: { newOffices?: number, newFiches?: number, reviewSources?: number, withdrawCap?: number }, only?: string[], log?: (m: string) => void,
 *   select?: (kind: string, row: any) => boolean, probe?: Function, activatedAt?: Date
 * }} [opts] only: the steps (aide, demarche, dispositif, structure, offices, finess, fiches, review, audit; all by default); finessFiles: the FINESS files already
 * on disk ({ structures: { file, date, sha1 }, activites }: tests, the disposable rehearsal) instead of the download of the day; select: the records to check (all by default;
 * tests restrict a run to their own); force: check every record even when it is not due; probe: the machine's probe (tests: a double); activatedAt: the veille's
 * activation (default: its first automatic decision; tests: another moment)
 */
export async function runVeille(opts = {}) {
  const db = opts.db || defaultDb; const env = opts.env || process.env;
  const startedAt = opts.now ? new Date(opts.now) : new Date(); const t0 = Date.now();
  const deadline = t0 + (Number(opts.maxMinutes) || 150) * 60000;
  const ALL_STEPS = ['aide', 'demarche', 'dispositif', 'structure', 'offices', 'finess', 'datainclusion', 'fiches', 'review', 'audit'];
  const only = new Set(opts.only || ALL_STEPS);
  // R12: a run of some steps only (« --only », a rehearsal) is not the night's veille: the schedule still starts the full one (schedule.js dueNow)
  const scope = ALL_STEPS.every((s) => only.has(s)) ? 'full' : 'partial';
  const log = opts.log || (() => {});
  const trigger = opts.trigger || 'manual';
  if (!networkEnabled(env)) return { ok: false, skipped: 'NETWORK_DISABLED', message: 'Consultation des sources désactivée (ADA_VERIFICATION_NETWORK=off).' };
  const pause = await pauseState(db);
  if (pause.paused && !opts.ignorePause) return recordSkip(db, trigger, 'PAUSED', `veille en pause${pause.reason ? ` (${pause.reason})` : ''} : reprise depuis la page de la veille ou « lab-local veille resume »`);
  const machine = opts.probe || (guardEnabled(env) ? probeMachine : null);
  const health = machine ? await machine({ env }).catch(() => null) : null;
  const gate = machine ? allowed(health, 'start', env) : { ok: true };
  if (!gate.ok) return recordSkip(db, trigger, gate.code, gate.reason);
  const acq = await acquireRun(db, { trigger, startedAt, updatedAt: startedAt, metrics: { scope, steps: [...only], health: { start: health } } });
  if (acq.busy) return { ok: false, skipped: 'ALREADY_RUNNING', runId: acq.busy };
  clearStop();
  const ctx = { db, env, runId: acq.id, scope, log, deadline, counts: {}, texts: opts.texts !== false, generate: opts.generate, force: Boolean(opts.force),
    limits: { newOffices: 150, newFiness: 150, newDataInclusion: 100, examineDataInclusion: 150, newFiches: 6, reviewSources: 30, ...(opts.limits || {}) }, only, finessFiles: opts.finessFiles || null, finess: null, finessOk: false,
    dataInclusionFiles: opts.dataInclusionFiles || null, di: null, select: typeof opts.select === 'function' ? opts.select : () => true,
    net: { fetchImpl: opts.fetchImpl, env }, hints: loadHints(opts.root || process.cwd()), archive: null, metas: [], offices: [], allOffices: [], officeRows: [], annuaireOk: false,
    trusted: [], registry: [], departement: opts.departement || '67', cacheDir: opts.cacheDir !== undefined ? opts.cacheDir : (env.ADA_VEILLE_CACHE_DIR || null),
    machine, health, lastHealth: null, modelOptions: machine ? modelOptions(env) : {}, modelUsed: false, stop: null, progress: {}, lastBeat: 0,
    withdrawn: {}, caps: {}, deferred: {}, alerts: [],
    now: () => (opts.now ? new Date(opts.now) : new Date()), timeUp: () => Date.now() > deadline };
  ctx.halted = () => ctx.timeUp() || Boolean(ctx.stop);
  ctx.activatedAt = opts.activatedAt ? new Date(opts.activatedAt) : await firstAutomaticDecision(db);   // supervision: see personDecision
  let error = null;
  try {
    await sources(ctx, opts);
    await withdrawalCaps(ctx);
    for (const kind of ['aide', 'demarche', 'dispositif']) if (only.has(kind)) await eachRecord(ctx, kind, checkContent);
    if (only.has('structure')) {
      await eachRecord(ctx, 'structure', checkStructureRecord);
      if (ctx.sirene) await recordFeedHealth(db, 'sirene', { ok: ctx.sirene.ok > 0 || ctx.sirene.failed === 0, status: null, error: ctx.sirene.failed ? `${ctx.sirene.failed} requête(s) sans réponse (${ctx.sirene.error})` : null, detail: ctx.sirene });
      if (!ctx.halted()) await mergeDuplicates(ctx);
    }
    if (only.has('offices')) await feedOffices(ctx);
    if (only.has('finess')) await feedFiness(ctx);
    if (only.has('datainclusion')) await feedDataInclusion(ctx);
    if (only.has('fiches')) await feedFiches(ctx);
    if (only.has('review') && !ctx.halted()) {
      await beat(ctx, { phase: 'review', current: null }, true);
      ctx.review = await reviewSources({ db, net: ctx.net, now: new Date(), limit: ctx.limits.reviewSources, halted: ctx.halted });
    }
    if (only.has('audit')) await selfCheck(ctx);
  } catch (e) {
    error = String(e?.cause?.message || e?.code || e?.message || e).slice(0, 300);
    log(`ERREUR ${error}`);
  }
  if (ctx.modelUsed && machine) ctx.modelUnloaded = await unloadModel(env);
  const endHealth = machine ? await machine({ env }).catch(() => null) : null;
  // R11: records whose texts must be (re)written from their source and could not be tonight stay OFF the public site (never an old text shown as current):
  // the owner is told how many and why; the next run with model capacity writes them (production: docs/verification-production.md)
  if (ctx.counts['texts:waitingModel']) ctx.alerts.push({ code: 'TEXTS_WAITING_MODEL', level: 'warning', count: ctx.counts['texts:waitingModel'], message: `${ctx.counts['texts:waitingModel']} fiche(s) attendent leurs textes (résumé et FALC) réécrits depuis la source officielle : ${ctx.textsWaitingReason || 'modèle indisponible'}. Elles restent hors ligne jusqu’à la prochaine veille disposant du modèle.` });
  for (const [kind, n] of Object.entries(ctx.deferred)) ctx.alerts.push({ code: 'WITHDRAWALS_CAPPED', level: 'warning', message: `${n} retrait(s) de ${kind} reporté(s) : nombre inhabituel de retraits en une nuit (contrôle de cohérence, ils seront repris à la prochaine veille si la source le confirme).` });
  const status = error ? 'error' : ctx.stop ? 'stopped' : ctx.timeUp() ? 'partial' : 'success';
  const finishedAt = new Date();
  await db.update(CronRun).set({ status, finishedAt, durationMs: Date.now() - t0, skipReason: ctx.stop?.code || null, errorSample: error || ctx.stop?.reason || null, updatedAt: finishedAt,
    metrics: { scope, steps: [...only], counts: ctx.counts, progress: { ...ctx.progress, phase: 'done' }, archive: ctx.archive ? { builtAt: ctx.archive.builtAt, lastModified: ctx.archive.lastModified, fiches: ctx.archive.fiches.size, cached: Boolean(ctx.archive.cached) } : null,
      offices: ctx.officeRows.length, annuaireOk: ctx.annuaireOk, trusted: ctx.trusted.length, health: { start: health, end: endHealth },
      model: { used: ctx.modelUsed, unloaded: ctx.modelUnloaded ?? null, options: ctx.modelOptions, deferredBecause: ctx.textsDeferred || null },
      finess: ctx.finess ? { version: ctx.finess.version, entities: ctx.finess.entities, establishments: ctx.finess.establishments, inScope: ctx.finess.inScope, closed: ctx.finess.closed, files: ctx.finess.fileMeta } : null,
      datainclusion: ctx.di ? ctx.di.summary : null,
      caps: ctx.caps, withdrawn: ctx.withdrawn, deferred: ctx.deferred, alerts: ctx.alerts, review: ctx.review || null, audit: ctx.audit || null, registry: ctx.registryRefresh || null } })
    .where(and(eq(CronRun.id, ctx.runId), eq(CronRun.status, 'running')));   // R14: a superseded run never rewrites its successor's « interrupted »
  return { ok: status !== 'error', status, runId: ctx.runId, counts: ctx.counts, durationMs: Date.now() - t0, error, stop: ctx.stop, alerts: ctx.alerts, audit: ctx.audit || null };
}

const count = (ctx, key, n = 1) => { ctx.counts[key] = (ctx.counts[key] || 0) + n; };
/** one line of the journal (only what changed, failed or needs telling: an unchanged record is only counted) */
async function note(ctx, e) {
  count(ctx, `${e.kind}:${e.outcome}`);
  if (e.entityType) count(ctx, `${e.entityType}.${e.outcome}`);   // per kind of record (« aide.PUBLISHED »): the owner's page splits by kind without counting twice
  ctx.log(`${e.outcome.padEnd(10)} ${e.entityType || ''} ${String(e.title || e.entityId || '').slice(0, 60)} — ${e.summary.slice(0, 160)}`);
  await ctx.db.insert(VeilleEvent).values({ runId: ctx.runId, entityType: e.entityType || null, entityId: e.entityId || null, kind: e.kind, outcome: e.outcome, summary: e.summary.slice(0, 2000),
    details: { ...(e.details && typeof e.details === 'object' ? e.details : {}), ...(e.title ? { title: String(e.title).slice(0, 200) } : {}) } });
}

/**
 * The heartbeat of the run (at most every 15 s): its progress for the owner's page, and the reasons to stop now — the owner's pause or stop, a native QA
 * campaign that started, disk space under the floor. Returns false when the run must stop.
 */
async function beat(ctx, progress = null, force = false) {
  if (progress) ctx.progress = { ...ctx.progress, ...progress };
  // a stop asked in this process (the owner's, or the LAB server's own shutdown) is seen at the next record; the database and the machine are asked at most every 15 s
  if (!ctx.stop && stopRequested()) { ctx.stop = { ...stopRequested() }; force = true; }
  if (!force && Date.now() - ctx.lastBeat < BEAT_MS) return !ctx.stop;
  ctx.lastBeat = Date.now();
  if (!ctx.stop) { const p = await pauseState(ctx.db).catch(() => null); if (p?.paused) ctx.stop = { code: 'PAUSED', reason: `veille mise en pause${p.reason ? ` (${p.reason})` : ''}` }; }
  if (!ctx.stop && ctx.machine) {
    const h = await ctx.machine({ env: ctx.env }).catch(() => null);
    if (h) { ctx.lastHealth = h; const g = allowed(h, 'start', ctx.env); if (!g.ok) ctx.stop = { code: g.code, reason: g.reason }; }
  }
  if (ctx.stop) ctx.log(`ARRÊT ${ctx.stop.reason}`);
  // R14: only while this run still owns its row — a run declared interrupted (heartbeat older than 20 min) whose process is still alive stops instead of
  // working beside its successor (two withdrawal caps in one night, the same new establishment inserted twice)
  const owned = await ctx.db.update(CronRun).set({ updatedAt: new Date(), metrics: { scope: ctx.scope, progress: ctx.progress, counts: ctx.counts, health: { start: ctx.health, now: ctx.lastHealth } } })
    .where(and(eq(CronRun.id, ctx.runId), eq(CronRun.status, 'running'))).returning({ id: CronRun.id }).catch(() => null);
  if (owned && owned.length === 0 && !ctx.stop) { ctx.stop = { code: 'SUPERSEDED', reason: 'cette veille a été déclarée interrompue et une autre a pris le relais' }; ctx.log(`ARRÊT ${ctx.stop.reason}`); }
  return !ctx.stop;
}

/** may the local model write texts now? (the run's choice, its time, the machine's memory — probed at most once a minute) */
async function textsAllowed(ctx) {
  if (!ctx.texts) return { ok: false, reason: 'modèle local non utilisé pour cette veille' };
  if (ctx.halted()) return { ok: false, reason: 'temps de la veille écoulé' };
  if (!ctx.machine) return { ok: true };
  if (!ctx.textsProbe || Date.now() - ctx.textsProbe.at > 60000) {
    const h = await ctx.machine({ env: ctx.env }).catch(() => null);
    ctx.textsProbe = { at: Date.now(), verdict: allowed(h, 'texts', ctx.env) };
  }
  if (!ctx.textsProbe.verdict.ok) { ctx.textsDeferred = ctx.textsProbe.verdict.reason; return { ok: false, reason: `mémoire de la machine insuffisante pour le modèle local : ${ctx.textsProbe.verdict.reason}` }; }
  return { ok: true };
}

async function sources(ctx, opts) {
  await beat(ctx, { phase: 'sources' }, true);
  await ensureSeed(ctx.db);
  // 1. the Annuaire of the département: the registry's weekly refresh, the public offices, the structure checks
  const t1 = Date.now();
  try {
    const r = await listDepartmentOffices(ctx.departement, ctx.net);
    ctx.officeRows = r.rows; ctx.annuaireOk = r.rows.length > 0;
    ctx.allOffices = ctx.officeRows.map((x) => officeRecord(x, { any: true })).filter(Boolean);   // every public body: identity of existing records
    ctx.offices = ctx.allOffices.filter((o) => o.kind);                                            // the kinds the directory takes: growth
    await recordFeedHealth(ctx.db, 'annuaire-administration', { ok: ctx.annuaireOk, status: 200, ms: Date.now() - t1, version: `${r.total ?? r.rows.length} services`, detail: { rows: r.rows.length } });
    if (!ctx.annuaireOk) await note(ctx, { kind: 'REGISTRY', outcome: 'RETRY', summary: "Annuaire de l'administration vide cette fois : les fiches qui en dépendent gardent leur état ; nouvel essai à la prochaine veille." });
  } catch (e) {
    await recordFeedHealth(ctx.db, 'annuaire-administration', { ok: false, ms: Date.now() - t1, error: e?.code || e?.message || String(e) }).catch(() => {});
    await note(ctx, { kind: 'REGISTRY', outcome: 'RETRY', summary: `Annuaire de l'administration non consulté cette fois (${e?.message || e}) : les fiches qui en dépendent gardent leur état ; nouvel essai à la prochaine veille.` });
  }
  // 2. the Service-Public archive of the day — not used when it is much smaller than the last one or older (a broken or stale copy is not a removal)
  try {
    const a = await fetchArchive({ ...ctx.net, cacheDir: ctx.cacheDir });
    if (a.ok) {
      const sane = await archiveSanity(ctx.db, a);
      await recordFeedHealth(ctx.db, 'dila-service-public', { ok: sane.ok, status: 200, ms: a.ms, version: a.builtAt || a.lastModified, error: sane.reason || null, detail: { fiches: a.fiches.size, builtAt: a.builtAt, cached: Boolean(a.cached) } });
      if (sane.ok) { ctx.archive = a; ctx.metas = [...a.fiches.entries()].map(([id, xml]) => ({ ...ficheMeta(xml), id })); ctx.metaById = new Map(ctx.metas.map((m) => [m.id, m])); }
      else await note(ctx, { kind: 'SOURCE', outcome: 'RETRY', summary: `Flux Service-Public du jour écarté : ${sane.reason}. Les fiches gardent leur état ; nouvel essai à la prochaine veille.` });
    } else {
      await recordFeedHealth(ctx.db, 'dila-service-public', { ok: false, status: a.status, ms: a.ms, error: `réponse ${a.status}` });
      await note(ctx, { kind: 'SOURCE', outcome: 'RETRY', summary: `Flux Service-Public non disponible (réponse ${a.status}). Nouvel essai à la prochaine veille.` });
    }
  } catch (e) {
    await recordFeedHealth(ctx.db, 'dila-service-public', { ok: false, error: e?.code || e?.message || String(e) }).catch(() => {});
    await note(ctx, { kind: 'SOURCE', outcome: 'RETRY', summary: `Flux Service-Public non téléchargé (${e?.message || e}). Nouvel essai à la prochaine veille.` });
  }
  // 3. the registry of official sources: refreshed once a week from the Annuaire (attested sites) and from Service-Public (cited online services)
  const [last] = await ctx.db.select({ startedAt: CronRun.startedAt }).from(CronRun).where(and(eq(CronRun.job, 'veille-registre'), eq(CronRun.status, 'success'))).orderBy(desc(CronRun.startedAt)).limit(1);
  const due = opts.forceRegistry || !last || Date.now() - new Date(last.startedAt).getTime() > 6.5 * 86400000;
  if (due && (ctx.officeRows.length || ctx.archive)) {
    const started = new Date();
    const annuaire = ctx.officeRows.length ? await refreshRegistry({ db: ctx.db, departement: ctx.departement, rows: ctx.officeRows, now: started }) : null;
    const online = ctx.archive ? await refreshOnlineServices({ db: ctx.db, archive: ctx.archive, now: started }) : null;
    ctx.registryRefresh = { annuaire, online };
    await ctx.db.insert(CronRun).values({ job: 'veille-registre', status: 'success', trigger: 'veille', startedAt: started, finishedAt: new Date(), durationMs: Date.now() - started.getTime(), metrics: { ...(annuaire || {}), online }, updatedAt: new Date() });
    const parts = [annuaire && `${annuaire.attestedSites} sites officiels attestés par l'Annuaire de l'administration (${annuaire.added} nouveaux, ${annuaire.retired} retirés)`,
      online && `${online.added + online.kept + online.restored} services en ligne cités par Service-Public (${online.added} nouveaux, ${online.retired} retirés)`,
      `${(annuaire?.rejectedCount || 0) + (online?.rejectedCount || 0)} écartés (plateformes partagées, services d’un autre territoire)`].filter(Boolean);
    await note(ctx, { kind: 'REGISTRY', outcome: 'UPDATED', summary: `Registre des sources mis à jour : ${parts.join(' ; ')}.`, details: { annuaire, online } });
  }
  // 4. the sources this run may read and cite, with what each is an authority on
  ctx.registry = await ctx.db.select({ sourceId: SourceRegistryEntry.sourceId, level: SourceRegistryEntry.level, capabilities: SourceRegistryEntry.capabilities, trustedDomains: SourceRegistryEntry.trustedDomains })
    .from(SourceRegistryEntry).where(eq(SourceRegistryEntry.status, 'ACTIVE'));
  ctx.trusted = [...new Set(ctx.registry.flatMap((r) => r.trustedDomains || []).map((d) => String(d).toLowerCase()))];
  ctx.net.trustedDomains = ctx.trusted;
  // 5. FINESS+ of the day (the establishments of the département), for the records made from it and the new ones
  if (ctx.only.has('finess') || ctx.only.has('structure')) await loadFiness(ctx);
  // 6. data·inclusion of the week (D05): the services producers list for the places of the département, attributed to them
  if (ctx.only.has('datainclusion')) await loadDataInclusion(ctx);
}

/**
 * The FINESS+ files of the day: downloaded as a stream, SHA-1 checked against the publisher's, read as a stream (finess.js). Not used — the records made from
 * it keep their state — when it could not be read, when it is older than the last one used, or when it lists far fewer establishments of the département in
 * scope than the last one (a truncated or broken file is not a wave of closures).
 */
async function loadFiness(ctx) {
  await beat(ctx, { phase: 'FINESS', current: null }, true);
  const t1 = Date.now();
  try {
    const files = ctx.finessFiles || await fetchFiness({ cacheDir: ctx.cacheDir, net: ctx.net });
    const r = await readFiness({ structures: files.structures.file, activites: files.activites?.file || null, departement: ctx.departement });
    const fileMeta = Object.fromEntries(Object.entries(files).filter(([, f]) => f).map(([k, f]) => [k, { title: f.title || null, date: f.date || null, sha1: f.sha1 || null, reused: Boolean(f.reused) }]));
    const [prev] = (await ctx.db.execute(sql`SELECT metrics->'finess' AS f FROM "CronRun" WHERE job = 'veille' AND status IN ('success', 'partial', 'stopped')
      AND jsonb_typeof(metrics->'finess') = 'object' ORDER BY "startedAt" DESC LIMIT 1`)).rows;
    const p = prev?.f; const version = files.structures.date || null;
    const reason = p && version && p.version && String(version) < String(p.version) ? `fichier plus ancien que celui déjà utilisé (${version} au lieu de ${p.version} ou après)`
      : p && Number(p.inScope) >= 50 && r.inScope < 0.9 * Number(p.inScope) ? `fichier incomplet (${r.inScope} établissements du département au lieu d’environ ${p.inScope})`
        : r.entities === 0 ? 'fichier vide' : null;
    await recordFeedHealth(ctx.db, 'finess', { ok: !reason, status: 200, ms: Date.now() - t1, version, error: reason,
      detail: { files: fileMeta, entities: r.entities, establishments: r.establishments, open: r.open, closed: r.closed, inScope: r.inScope, withActivities: r.withActivities, terms: termsVersion() } });
    if (reason) { await note(ctx, { kind: 'REGISTRY', outcome: 'RETRY', summary: `FINESS du jour écarté : ${reason}. Les fiches qui en dépendent gardent leur état ; nouvel essai à la prochaine veille.` }); return; }
    ctx.finess = { ...r, version, fileMeta }; ctx.finessOk = true;
  } catch (e) {
    await recordFeedHealth(ctx.db, 'finess', { ok: false, ms: Date.now() - t1, error: e?.code || e?.message || String(e) }).catch(() => {});
    await note(ctx, { kind: 'REGISTRY', outcome: 'RETRY', summary: `FINESS non consulté cette fois (${e?.message || e}) : les fiches qui en dépendent gardent leur état ; nouvel essai à la prochaine veille.` });
  }
}

/** the archive of the day against the last one used: not much smaller (a truncated download), not older (a stale copy) */
async function archiveSanity(db, a) {
  const [prev] = (await db.execute(sql`SELECT metrics->'archive' AS a FROM "CronRun" WHERE job = 'veille' AND status IN ('success', 'partial', 'stopped')
    AND jsonb_typeof(metrics->'archive') = 'object' ORDER BY "startedAt" DESC LIMIT 1`)).rows;
  const p = prev?.a;
  if (!p) return { ok: true };
  if (Number(p.fiches) >= 500 && a.fiches.size < 0.9 * Number(p.fiches)) return { ok: false, reason: `archive incomplète (${a.fiches.size} fiches au lieu d’environ ${p.fiches})` };
  if (p.builtAt && a.builtAt && String(a.builtAt) < String(p.builtAt)) return { ok: false, reason: `archive plus ancienne que celle déjà utilisée (${a.builtAt} au lieu de ${p.builtAt} ou après)` };
  return { ok: true };
}

/** at most 20 % of the public records of a kind (and at least 5) are withdrawn in one night */
async function withdrawalCaps(ctx) {
  const rows = (await ctx.db.execute(sql`SELECT 'aide' AS k, count(*)::int AS n FROM "Aide" WHERE statut = 'publie' AND verification_status = 'VERIFIED' AND publication_hold IS NULL
    UNION ALL SELECT 'demarche', count(*)::int FROM "Demarche" WHERE statut = 'publie' AND verification_status = 'VERIFIED' AND publication_hold IS NULL
    UNION ALL SELECT 'dispositif', count(*)::int FROM "Dispositif" WHERE statut = 'publie' AND verification_status = 'VERIFIED' AND publication_hold IS NULL
    UNION ALL SELECT 'structure', count(*)::int FROM "Structure" WHERE statut IN ('actif', 'publie') AND verification_status = 'VERIFIED' AND publication_hold IS NULL`)).rows;
  for (const r of rows) ctx.caps[r.k] = Number.isFinite(ctx.limits.withdrawCap) ? ctx.limits.withdrawCap : Math.max(5, Math.ceil(0.2 * Number(r.n || 0)));
}

/**
 * due now? A record shown to the public is checked again at its interval; a pending, held or withdrawn one at every run; and at once when its Service-Public
 * fiche changed or disappeared in today's archive (event-driven: the archive is read every run, comparing its dates costs nothing).
 */
function isDue(ctx, kind, row) {
  if (ctx.force) return true;
  if (kind === 'structure' && (ctx.di?.changed.has(row.id) || ctx.di?.gone.has(row.id))) return true;   // D05: tonight's data·inclusion export changed its services
  const a = row.auto_check || {};
  const next = a.nextCheckAt; if (!next) return true;
  const shown = row.verification_status === 'VERIFIED' && row.statut === PUBLISHED[kind] && !row.publication_hold;
  if (!shown) return true;
  if (a.origin === 'DILA' && a.sourceId && ctx.archive) {
    const meta = ctx.metaById?.get(resolveId(a.sourceId, ctx.archive.redirections));
    if (!meta) return true;                                                                                            // removed or moved
    const isDossier = /^N/.test(a.sourceId);                                                                           // a dossier's date is its fiches' (read at the nightly check)
    if (!isDossier && (meta.importantChangeAt || null) !== (a.importantChangeAt || null)) return true;                // an important change
    if (a.sourceModifiedAt && meta.modifiedAt !== a.sourceModifiedAt) return true;                                    // any change of the fiche
  }
  return new Date(next).getTime() <= ctx.now().getTime();
}

/** how often a record is checked: a date soon in its source (deadline, application window); a feed read anyway every night; a site's page; a registry identity */
function tierOf(origin, src) {
  const soon = (src?.facts?.dates || []).some((d) => { const iso = frenchDate(d); if (!iso) return false; const t = new Date(`${iso}T12:00:00Z`).getTime(); return t > Date.now() && t < Date.now() + 60 * 86400000; });
  if (soon) return { tier: 'HAUTE', hours: 20, why: 'une date proche dans la source (délai, période de demande)' };
  if (origin === 'DILA' || origin === 'ANNUAIRE' || origin === 'FINESS') return { tier: 'QUOTIDIENNE', hours: 20, why: 'flux officiel lu chaque nuit' };
  if (origin === 'PAGE') return { tier: 'MOYENNE', hours: 44, why: 'page d’un site officiel' };
  if (origin === 'SIRENE') return { tier: 'BASSE', hours: 164, why: 'identité au répertoire SIRENE (change rarement)' };
  return { tier: 'QUOTIDIENNE', hours: 20, why: 'par défaut' };
}
const nextAt = (ctx, tier) => new Date(ctx.now().getTime() + tier.hours * HOUR).toISOString();

async function eachRecord(ctx, kind, fn) {
  // the records checked the longest ago first: a run cut short (time, pause, QA) is continued by the next one
  const table = TABLES[kind];
  const rows = (await ctx.db.select().from(table).orderBy(sql`${table.last_checked_at} ASC NULLS FIRST`)).filter((r) => ctx.select(kind, r));
  let done = 0;
  for (const row of rows) {
    if (ctx.halted() || !(await beat(ctx, { phase: kind, done, total: rows.length, current: String(titleOf(row)).slice(0, 80) }))) { count(ctx, `${kind}:later`); continue; }
    done += 1;
    if (!isDue(ctx, kind, row)) { count(ctx, `${kind}:notDue`); if (kind === 'structure') rememberIdentity(ctx, row); continue; }
    count(ctx, `${kind}:checked`);
    try { await fn(ctx, kind, row); } catch (e) {
      await note(ctx, { kind: 'SOURCE', outcome: 'RETRY', entityType: kind, entityId: row.id, title: titleOf(row), summary: `Vérification interrompue (${String(e?.cause?.message || e?.code || e?.message || e).slice(0, 220)}). Nouvel essai à la prochaine veille.` });
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------------------- authority
const CLAIM = { aide: 'aides', dispositif: 'aides', demarche: 'demarches' };
/** is the site of this page an official source for this kind of information? The registry says what each source is an authority on (capabilities). */
export function authorityFor(ctx, url, kind, row = null) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { ok: false, reason: `adresse illisible (${String(url).slice(0, 80)})` }; }
  const claim = CLAIM[kind] || 'aides';
  const covering = (ctx.registry || []).filter((e) => hostIn(host, e.trustedDomains || []));
  if (!covering.length) return isAllowedSource(url) ? { ok: true, via: 'domaines officiels de l’État' } : { ok: false, reason: `le site ${host} n'est pas dans le registre des sources officielles` };
  const len = (e) => Math.max(0, ...(e.trustedDomains || []).filter((d) => hostIn(host, [d])).map((d) => String(d).length));
  const best = [...covering].sort((a, b) => len(b) - len(a))[0];
  const caps = best.capabilities || [];
  if (!caps.some((c) => c === claim || String(c).startsWith(`${claim}:`))) {
    return { ok: false, reason: `le site ${host} est une source officielle pour ${caps.length ? caps.join(', ') : 'd’autres informations'}, pas pour ${claim === 'aides' ? 'les règles d’une aide' : 'une démarche'}` };
  }
  // R14: a « :local » authority only (an attested local site) never decides the rules of a national record
  if (!caps.includes(claim) && caps.includes(`${claim}:local`) && String(row?.territory_scope || '').toUpperCase() === 'NATIONAL') {
    return { ok: false, reason: `le site ${host} est une source officielle locale : il ne fait pas autorité sur les règles d’une aide ou d’une démarche nationale` };
  }
  return { ok: true, sourceId: best.sourceId, level: best.level };
}

// ------------------------------------------------------------------------------------------------------------------------------- aides, démarches, dispositifs
/** the official source of a record: { status: FOUND | REMOVED | NONE | RETRY, … } */
async function locateSource(ctx, kind, row) {
  const current = String(row.source_url_exact || row.source_url || '').trim();
  if (current) {
    const m = current.match(SP_ID);
    if (m) {
      if (!ctx.archive) return { status: 'RETRY', note: 'flux Service-Public indisponible' };
      const id = resolveId(m[1].toUpperCase(), ctx.archive.redirections);
      const source = readSource(id, ctx.archive);
      if (source) return covers(source) ? { status: 'FOUND', origin: 'DILA', id, source, url: source.url, moved: id !== m[1].toUpperCase() ? m[1].toUpperCase() : null }
        : { status: 'NONE', url: source.url, note: `la fiche officielle ${id} ne s’applique pas au Bas-Rhin (couverture : ${source.coverage})` };
      const again = await discover(ctx, kind, row);
      if (again) return { ...again, replaced: m[1] };
      return { status: 'REMOVED', url: current, note: `la fiche ${m[1]} n'est plus publiée par Service-Public` };
    }
    return readPage(ctx, current, row, { kind });
  }
  return (await discover(ctx, kind, row)) || { status: 'NONE', note: 'aucune page officielle trouvée automatiquement' };
}
const covers = (src) => OUR_COVERAGE.test(String(src?.coverage || ''));

async function readPage(ctx, url, row, { requireMatch = false, kind = 'aide' } = {}) {
  try {
    const p = await readOfficialPage(url, { ...ctx.net });
    if (p.exists === false) {
      if (requireMatch) return null;
      // a page that answers « not found » once may be under maintenance: it is withdrawn only when it is still missing the next day (« gone » at once)
      const since = row.auto_check?.missing?.since;
      if (p.status === 410 || (since && ctx.now().getTime() - new Date(since).getTime() > 20 * HOUR)) return { status: 'REMOVED', url, note: `la page officielle ${url} n'existe plus (réponse ${p.status}${since ? `, absente depuis le ${frDay(since)}` : ''})` };
      return { status: 'RETRY', url, note: `la page officielle ne répond plus (réponse ${p.status}) : elle sera relue avant tout retrait`, missing: { since: since || ctx.now().toISOString(), status: p.status } };
    }
    if (p.exists !== true) return requireMatch ? null : { status: 'RETRY', url, note: `la page officielle n'a pas répondu normalement (réponse ${p.status})` };
    const auth = authorityFor(ctx, p.url || url, kind, row);
    if (!auth.ok) return requireMatch ? null : { status: 'NONE', url, note: auth.reason };
    const score = contentScore(recordText(row), `${p.title} ${p.text}`);
    if (requireMatch && (score < 0.25 || !pageIsAbout(row, p.title))) return null;
    return { status: 'FOUND', origin: 'PAGE', url: p.url || url, authority: auth, score,
      source: { title: p.title, description: null, text: p.text, url: p.url || url, fingerprint: p.fingerprint, facts: p.facts, chapters: p.chapters, officialCheckedAt: p.officialCheckedAt, abbreviations: {}, definitions: {} } };
  } catch (e) {
    if (e instanceof SourceError && e.code === 'URL_REFUSED') return requireMatch ? null : { status: 'NONE', url, note: `l'adresse ${url} n'est pas celle d'un site officiel reconnu` };
    return requireMatch ? null : { status: 'RETRY', url, note: `page officielle non lue (${e?.message || e})` };
  }
}

/** Service-Public candidates of a record, best first (exported for the diagnostics and the tests). */
export function rankCandidates(ctx, kind, row) {
  const title = titleOf(row);
  const text = recordText(row);
  const hinted = new Set();
  for (const u of ctx.hints.get(row.slug) || []) { const m = u.match(SP_ID); if (m) hinted.add(m[1].toUpperCase()); }
  // a démarche about an aide already sourced (« Demande de prime d'activité » → the source of « Prime d'activité »)
  if (kind === 'demarche') for (const [aideTitle, id] of ctx.aideSources || []) if (aideTitle.length >= 5 && norm(title).includes(aideTitle)) hinted.add(id);
  const scored = [];
  for (const m of ctx.metas) {
    if (!m.title || /Recherche guidée|liens externes|Comment faire si/i.test(m.kind || '')) continue;
    const ts = titleScore(title, m.title); const hint = hinted.has(m.id);
    if (ts < 0.5 && !hint) continue;
    scored.push({ m, ts, hint });
  }
  for (const c of scored) { const src = readSource(c.m.id, ctx.archive); c.src = src; c.cs = src ? contentScore(text, `${src.title} ${src.description} ${src.text}`) : 0; c.qr = /Question-réponse/i.test(c.m.kind || '') ? 1 : 0; }
  // a question-answer fiche is a weaker page than a fiche or a dossier, not an excluded one (the pass Culture has only a question-answer fiche)
  const total = (c) => c.ts + c.cs + (c.hint ? 0.3 : 0) - (c.qr ? 0.3 : 0);
  return scored.filter((c) => c.src && covers(c.src)).sort((a, b) => total(b) - total(a)).map((c) => ({ ...c, total: total(c) }));
}

/** finding the official page of a record that has none: Service-Public first (title + content agree), then the hints on official sites */
async function discover(ctx, kind, row) {
  const pages = [];
  for (const u of ctx.hints.get(row.slug) || []) if (!SP_ID.test(u)) pages.push(u);
  if (ctx.archive) {
    const [best, second] = rankCandidates(ctx, kind, row);
    if (best) {
      const clear = !second || best.total - second.total >= 0.1;
      const strong = (best.ts >= 1 && best.cs >= 0.2) || (best.hint && best.cs >= 0.25) || (best.ts >= 0.6 && best.cs >= 0.35);
      if (clear && strong) return { status: 'FOUND', origin: 'DILA', id: best.m.id, source: best.src, url: best.src.url, discovered: { titleScore: Number(best.ts.toFixed(2)), contentScore: Number(best.cs.toFixed(2)), hinted: best.hint } };
    }
  }
  for (const u of pages) {
    let host = ''; try { host = new URL(u).hostname.toLowerCase(); } catch { continue; }
    if (!hostIn(host, ctx.trusted) && !isAllowedSource(u)) continue;
    const r = await readPage(ctx, u, row, { requireMatch: true, kind });
    if (r && r.status === 'FOUND') return { ...r, discovered: { hinted: true, contentScore: Number(r.score.toFixed(2)) } };
  }
  return null;
}

/** what changed in the source since its last reading (the journal; the texts follow sourceMark) */
function changeOf(prev, src, origin) {
  if (!prev) return { first: true, any: true, important: true, facts: {} };
  const any = prev.fingerprint !== src.fingerprint;
  const facts = {};
  for (const k of Object.keys(src.facts || {})) {
    const was = new Set(prev.facts?.[k] || []); const now = new Set(src.facts[k] || []);
    const added = [...now].filter((x) => !was.has(x)); const removed = [...was].filter((x) => !now.has(x));
    if (added.length || removed.length) facts[k] = { added: added.slice(0, 8), removed: removed.slice(0, 8) };
  }
  const important = origin === 'DILA' ? Boolean(src.importantChangeAt && prev.importantChangeAt !== src.importantChangeAt) : Boolean(facts.amounts || facts.percentages || facts.ages || facts.durations);
  return { first: false, any, important, facts };
}
const factsLine = (facts) => Object.entries(facts).map(([k, v]) => `${{ amounts: 'montants', percentages: 'pourcentages', ages: 'âges', durations: 'durées', dates: 'dates' }[k] || k} : ${[...v.removed.map((x) => `− ${x}`), ...v.added.map((x) => `+ ${x}`)].join(', ')}`).join(' ; ');
/**
 * The version of the source the texts were written from: DILA's date of last IMPORTANT change for a fiche (a reworded sentence does not rewrite the texts, a
 * new condition or amount does); the amounts, percentages, ages and durations of a page. Kept with the texts: a run that could not rewrite them does not
 * « forget » the change — the next run still sees texts older than their source.
 */
const FACT_KEYS = ['amounts', 'percentages', 'ages', 'durations'];
function sourceMark(src, origin) {
  if (origin === 'DILA') return `dila:${src.importantChangeAt || src.fingerprint}`;
  const f = {}; for (const k of FACT_KEYS) f[k] = [...new Set(src.facts?.[k] || [])].sort();
  return `facts:${sha256(JSON.stringify(f)).slice(0, 24)}`;
}
/** legal references added or removed (Légifrance links of the fiche) */
function legalChange(before, after) {
  const key = (r) => String(r?.url || r?.title || r || '');
  const b = new Set((before || []).map(key)); const a = new Set((after || []).map(key));
  const added = (after || []).filter((r) => !b.has(key(r))); const removed = (before || []).filter((r) => !a.has(key(r)));
  return added.length || removed.length ? { added: added.slice(0, 6), removed: removed.slice(0, 6) } : null;
}

async function lastSnapshot(db, type, id) {
  const [s] = await db.select().from(SourceSnapshot).where(and(eq(SourceSnapshot.entity_type, type), eq(SourceSnapshot.entity_id, id))).orderBy(desc(SourceSnapshot.fetched_at)).limit(1);
  return s ? { ...safeJson(s.raw_excerpt), fingerprint: s.content_hash, url: s.final_url } : null;
}
async function saveSnapshot(db, type, id, src, url) {
  await db.insert(SourceSnapshot).values({ entity_type: type, entity_id: id, raw_excerpt: JSON.stringify({ title: src.title, importantChangeAt: src.importantChangeAt || null, officialCheckedAt: src.officialCheckedAt || null,
    coverage: src.coverage || null, facts: src.facts, references: (src.references || []).slice(0, 12), chapters: (src.chapters || []).map((c) => ({ heading: c.heading, h: sha256(squash(c.text).toLowerCase()) })),
    chars: src.chars || (src.text || '').length }).slice(0, 60000), content_hash: src.fingerprint, http_status: 200, final_url: url });
}

const hasChainTexts = (row) => row.falc_origin === 'AI_LOCAL' && Boolean(row.auto_check?.texts?.at);
const currentTexts = (row) => [row.cest_quoi, row.description_courte, row.description_falc, row.pour_qui, row.ce_que_ca_aide, row.montant, row.summary_falc, row.conditions_falc, row.montant_falc,
  ...(Array.isArray(row.etapes_falc) ? row.etapes_falc : [])].filter(Boolean).join('\n');
const listText = (items) => (items && items.length ? items.map((x) => `- ${x}`).join('\n') : null);
const steps = (items) => (items || []).map((t, i) => ({ numero: i + 1, titre: t, description: '' }));

/** where to go / online services of a Service-Public source, as the record's fields */
function practical(src) {
  const online = (src.online || []).filter((o) => /^https:\/\//.test(o.url || ''));
  const apply = online.find((o) => /t[ée]l[ée]service|demarche|formulaire en ligne/i.test(`${o.type} ${o.title}`)) || online.find((o) => !/simulateur/i.test(`${o.type} ${o.title}`)) || null;
  const where = [...new Set((src.whereToGo || []).map((w) => w.title).filter(Boolean))];
  return { apply: apply ? apply.url : null, where: where.length ? `Selon votre situation : ${where.join(', ')}.` : null };
}

/** the record's fields from checked texts */
function textPatch(kind, t, src) {
  const p = practical(src);
  if (kind === 'dispositif') {
    // a dispositif has one description and a FALC summary: the normal text with who it is for and how, the links of the official source
    const description = [t.normal.resume, t.normal.pour_qui?.length ? `Pour qui :\n${listText(t.normal.pour_qui)}` : null,
      t.normal.etapes?.length ? `Comment faire :\n${listText(t.normal.etapes)}` : null].filter(Boolean).join('\n\n');   // bullets, not numbers: a number the source does not have is an invented one
    return { summary_falc: t.falc.resume.join('\n'), description_falc: description, montant: t.normal.montant || null, falc_origin: 'AI_LOCAL',
      liens: [{ nom: 'Fiche officielle', url: src.url }, ...(p.apply && p.apply !== src.url ? [{ nom: 'Faire la demande en ligne', url: p.apply }] : [])] };
  }
  const common = { summary_falc: t.falc.resume.join('\n'), etapes_falc: t.falc.etapes, falc_origin: 'AI_LOCAL', etapes: steps(t.normal.etapes),
    documents_necessaires: t.normal.documents || [], pour_qui: listText(t.normal.pour_qui) };   // documents_necessaires is a text[] column
  if (kind === 'aide') return { ...common, cest_quoi: t.normal.resume, description: t.normal.resume, ce_que_ca_aide: t.normal.montant, conditions_falc: t.falc.pour_qui.join('\n'), montant_falc: t.falc.montant,
    ...(p.where ? { ou_demander: p.where } : {}), ...(p.apply ? { lien_demande: p.apply } : {}) };
  return { ...common, description_courte: t.normal.resume, conditions_falc: t.falc.pour_qui.join('\n'), contenu_detaille: [t.normal.resume, t.normal.montant].filter(Boolean).join('\n\n'),
    ...(p.where ? { ou_faire: p.where } : {}), ...(p.apply ? { lien_teleservice: p.apply } : {}) };
}

/**
 * R12 — the official excerpt: the first sentences of the source itself (Service-Public fiche, page of a public body), verbatim, attributed, at most ~600
 * characters ending on a sentence. Licence Ouverte 2.0 for Service-Public: reuse with the source named and its date (the record keeps both). null when the source
 * has no usable text.
 */
export function officialExcerpt(src, origin, url) {
  const paras = String(src?.text || '').split(/\n+/).map((x) => x.trim()).filter((x) => x && !/^#+\s/.test(x) && x.length > 40);
  let out = '';
  for (const p of paras) { if ((out + ' ' + p).length > 600) break; out = out ? `${out} ${p}` : p; }
  if (!out && paras[0]) { const cut = paras[0].slice(0, 600); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.»')); out = end > 120 ? cut.slice(0, end + 1) : ''; }
  if (out.length < 60) return null;
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* none */ }
  const who = origin === 'DILA' ? 'Service-Public.gouv.fr' : host || 'la source officielle';
  return `Extrait de la fiche officielle « ${squash(src.title || '')} » (${who}) : « ${out} »`;
}
/** the fields of a record while it shows the official excerpt: the excerpt as its summary; the texts written from an older version of the source removed */
export function excerptPatch(kind, excerpt) {
  const cleared = { summary_falc: null, conditions_falc: null, falc_origin: null };
  if (kind === 'dispositif') return { ...cleared, description_falc: excerpt, montant: null };
  if (kind === 'aide') return { ...cleared, cest_quoi: excerpt, description: excerpt, ce_que_ca_aide: null, montant_falc: null, pour_qui: null, etapes: [], etapes_falc: [], documents_necessaires: [] };
  return { ...cleared, description_courte: excerpt, contenu_detaille: excerpt, pour_qui: null, etapes: [], etapes_falc: [], documents_necessaires: [] };
}

/** a refused decision inside the publication transaction rolls the whole of it back (content, bookkeeping) */
class Refused extends Error { constructor(result) { super(result?.code || 'REFUSED'); this.result = result; } }

/**
 * publish (or keep published) with the evidence: bookkeeping, content (previous version kept), release of a lifted hold, VERIFY, statut — one transaction:
 * nothing of it is kept when one step is refused (a content change is never left without its verification).
 */
async function publish(ctx, kind, row, { patch, fixed, sourceUrl, evidence, reverify }) {
  const table = TABLES[kind];
  try {
    return await ctx.db.transaction(async (tx) => {
      const [before] = await tx.select().from(table).where(eq(table.id, row.id)).for('update');
      // a hold the chain never lifts (privacy, safety, a report, a duplicate): the record is left exactly as it is
      if (before?.publication_hold && PROTECTED_HOLD.test(before.publication_hold)) return { ok: false, code: 'PROTECTED_HOLD', hold: before.publication_hold };
      // a person's refusal or hold made after the activation: the record stays as the person left it
      const person = await personDecision(tx, kind, before, ctx.activatedAt);
      if (person) return { ok: false, code: 'PERSON_DECISION', hold: person.note, person };
      if (fixed) await tx.update(table).set(fixed).where(eq(table.id, row.id));
      let versionId = null;
      if (patch && Object.keys(patch).length) {
        versionId = await snapshotRow(tx, kind, row.id, 'veille automatique', SYSTEM_REVIEWER.id);
        await tx.update(table).set({ ...patch, updatedBy: SYSTEM_REVIEWER.id, updatedAt: new Date() }).where(eq(table.id, row.id));
      }
      const [cur] = await tx.select().from(table).where(eq(table.id, row.id));
      if (cur.publication_hold && !isEditHold(cur.publication_hold)) {
        const r = await recordVerification({ entityType: kind, entityId: row.id, action: 'RELEASE_HOLD', reviewer: SYSTEM_REVIEWER, evidenceNote: `Levée automatique : ${evidence}`.slice(0, 2000) }, { db: tx, env: ctx.env, trustedDomains: ctx.trusted });
        if (!r.ok) throw new Refused(r);
      }
      const age = cur.date_verification ? (Date.now() - new Date(cur.date_verification).getTime()) / 86400000 : Infinity;
      const needVerify = cur.verification_status !== 'VERIFIED' || (patch && Object.keys(patch).length) || isEditHold(cur.publication_hold) || reverify || age > REVERIFY_DAYS;
      if (needVerify) {
        const r = await recordVerification({ entityType: kind, entityId: row.id, action: 'VERIFY', reviewer: SYSTEM_REVIEWER, sourceUrl, evidenceNote: evidence.slice(0, 2000), territoryConfirmed: true }, { db: tx, env: ctx.env, trustedDomains: ctx.trusted });
        if (!r.ok) throw new Refused(r);
      }
      if (cur.statut !== PUBLISHED[kind]) await tx.update(table).set({ statut: PUBLISHED[kind], published_at: cur.published_at || new Date() }).where(eq(table.id, row.id));
      return { ok: true, verified: needVerify, versionId, firstPublication: cur.statut !== PUBLISHED[kind] || cur.verification_status !== 'VERIFIED' };
    });
  } catch (e) { if (e instanceof Refused) return e.result; throw e; }
}

/** withdraw (or keep out) with the reason — only a record that is or could be shown; a record never published is just left as it is */
async function withdraw(ctx, kind, row, reason, { force = false } = {}) {
  const table = TABLES[kind];
  const [cur] = await ctx.db.select().from(table).where(eq(table.id, row.id));
  if (!cur) return { ok: true, already: true };
  if (cur.verification_status === 'REJECTED' || cur.statut === 'archive' || (kind === 'structure' && cur.statut === 'suspendu')) return { ok: true, already: true };   // R14: a person's decision stays as it is
  if (cur.verification_status !== 'VERIFIED' && cur.statut !== PUBLISHED[kind]) return { ok: true, already: true };
  const holdReason = `${SYSTEM_HOLD} : ${reason}`.slice(0, 480);
  // already withdrawn by the chain: the recorded reason follows the latest cause (no new ledger row for the same reason every night)
  if (cur.publication_hold && String(cur.publication_hold).startsWith(SYSTEM_HOLD) && cur.publication_hold === holdReason) return { ok: true, already: true };
  if (cur.publication_hold && !String(cur.publication_hold).startsWith(SYSTEM_HOLD) && !isEditHold(cur.publication_hold)) return { ok: true, already: true };   // a person's hold stays as it is
  // many withdrawals in one night are more likely the fault of a source than real closures: beyond the night's cap they wait for the next run
  const shown = !cur.publication_hold && cur.verification_status === 'VERIFIED' && cur.statut === PUBLISHED[kind];
  if (shown && !force && (ctx.withdrawn[kind] || 0) >= (ctx.caps[kind] ?? Infinity)) { ctx.deferred[kind] = (ctx.deferred[kind] || 0) + 1; return { ok: true, deferred: true }; }
  const r = await recordVerification({ entityType: kind, entityId: row.id, action: 'HOLD', reviewer: SYSTEM_REVIEWER, holdReason }, { db: ctx.db, env: ctx.env });
  if (r.ok && shown) ctx.withdrawn[kind] = (ctx.withdrawn[kind] || 0) + 1;
  return r;
}
const deferredLine = (why) => `Retrait reporté à la prochaine veille (${why}) : trop de retraits cette nuit pour être sûr qu’il ne s’agit pas d’une panne de source.`;
const outcomeOf = (out, fallback = 'WITHDRAWN') => (out.deferred ? 'RETRY' : out.already ? 'UNRESOLVED' : out.ok === false ? 'UNRESOLVED' : fallback);

async function checkContent(ctx, kind, row) {
  const title = titleOf(row);
  const table = TABLES[kind];
  const where = await locateSource(ctx, kind, row);
  const base = { entityType: kind, entityId: row.id, title };
  if (where.status === 'RETRY') {
    if (where.missing) await ctx.db.update(table).set({ auto_check: { ...(row.auto_check || {}), missing: where.missing } }).where(eq(table.id, row.id));
    await note(ctx, { ...base, kind: 'SOURCE', outcome: 'RETRY', summary: `Source non lue cette fois : ${where.note}. Nouvel essai à la prochaine veille.` });
    return;
  }
  if (where.status === 'NONE') {
    const out = await withdraw(ctx, kind, row, where.note);
    await note(ctx, { ...base, kind: 'SOURCE', outcome: outcomeOf(out), summary: out.deferred ? deferredLine(where.note) : `Pas publiée : ${where.note}. La recherche reprendra à chaque veille.` });
    return;
  }
  if (where.status === 'REMOVED') {
    const out = await withdraw(ctx, kind, row, `source officielle retirée (${where.note})`);
    await note(ctx, { ...base, kind: 'EXISTENCE', outcome: out.deferred ? 'RETRY' : 'WITHDRAWN', summary: out.deferred ? deferredLine(where.note) : `Retirée automatiquement : ${where.note}. Elle reviendra si la source réapparaît.`, details: { url: where.url } });
    return;
  }
  const { source: src, origin } = where;
  if (kind === 'aide' && origin === 'DILA') { ctx.aideSources = ctx.aideSources || new Map(); ctx.aideSources.set(norm(String(title).replace(/\s*\([^)]*\)\s*/g, ' ')).trim(), where.id); }
  const prev = await lastSnapshot(ctx.db, kind, row.id);
  const change = changeOf(prev && prev.url === where.url ? prev : null, src, origin);
  if (change.any) await saveSnapshot(ctx.db, kind, row.id, src, where.url);
  const fullSource = `${src.title || ''}\n${src.description || ''}\n${src.text}`;
  const lines = (v) => String(v || '').split('\n').map((x) => x.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  const published = { normal: { resume: row.cest_quoi || row.description_courte || row.description_falc || '', pour_qui: lines(row.pour_qui) }, falc: { resume: lines(row.summary_falc), pour_qui: lines(row.conditions_falc) } };
  const mark = sourceMark(src, origin);
  const chainTexts = hasChainTexts(row);
  // texts written from an older version of the source (an important change since), texts with a number the source no longer has or a « condition » it says is
  // none, texts written under older rules
  const outdated = chainTexts && row.auto_check?.texts?.sourceMark !== mark;
  const stale = chainTexts && (inventedNumbers(currentTexts(row), fullSource).length > 0 || contradictions(published.normal, published.falc, fullSource).length > 0);
  const oldRules = chainTexts && Number(row.auto_check?.texts?.checks?.rules || 1) < TEXT_RULES_VERSION;
  const needTexts = !chainTexts || outdated || stale || oldRules;
  const keepable = chainTexts && !outdated && !stale;   // only the rules improved: the texts stay published until they are rewritten
  // R12 (production autonomy): the official excerpt shown while no model can write the texts, still the excerpt of THIS version of the source
  const excerptCurrent = row.auto_check?.texts?.mode === 'OFFICIAL_EXCERPT' && row.auto_check?.texts?.sourceMark === mark;
  let patch = {}; let textsNote = 'textes inchangés (la fiche officielle n’a pas changé)'; let textsMeta = row.auto_check?.texts || null;
  if (needTexts) {
    const may = await textsAllowed(ctx);
    // only a record shown today stays online on the excerpt (a first publication still waits for its texts)
    const shownNow = row.verification_status === 'VERIFIED' && row.statut === PUBLISHED[kind] && !row.publication_hold;
    const excerpt = !may.ok && !keepable && !excerptCurrent && shownNow && String(ctx.env.ADA_VEILLE_TEXT_FALLBACK || 'excerpt') !== 'withdraw' ? officialExcerpt(src, origin, where.url) : null;
    if (!may.ok && !keepable && excerptCurrent && shownNow) {   // R14: a record withdrawn since (shown no longer) is not put back online on the excerpt
      textsNote = 'extrait mot pour mot de la source officielle inchangé ; résumé et version facile à lire en attente du modèle local';
      count(ctx, 'texts:waitingModel'); ctx.textsWaitingReason = may.reason;
    } else if (excerpt) {
      // the facts are still the official source's: the record stays online with the source's own words (attributed, verbatim) instead of texts written from
      // an older version — never an old summary or FALC presented as current, never a withdrawal only because a model is missing
      patch = excerptPatch(kind, excerpt);
      textsMeta = { at: ctx.now().toISOString(), mode: 'OFFICIAL_EXCERPT', sourceFingerprint: src.fingerprint, sourceMark: mark, waitingBecause: may.reason };
      textsNote = `résumé remplacé par un extrait mot pour mot de la source officielle (modèle local indisponible : ${may.reason}) ; version facile à lire retirée en attendant sa réécriture`;
      count(ctx, 'texts:waitingModel'); count(ctx, 'texts:excerpt'); ctx.textsWaitingReason = may.reason;
    } else if (!may.ok && !keepable) {
      if (row.verification_status === 'VERIFIED') {
        const out = await withdraw(ctx, kind, row, outdated || stale ? 'la fiche officielle a changé : textes à réécrire' : 'textes à rédiger depuis la fiche officielle');
        if (out.deferred) { await note(ctx, { ...base, kind: 'TEXTS', outcome: 'RETRY', summary: deferredLine('textes à réécrire') }); return; }
      }
      await note(ctx, { ...base, kind: 'TEXTS', outcome: 'RETRY', summary: `Textes à rédiger depuis la fiche officielle : reporté à la prochaine veille (${may.reason}).` });
      count(ctx, 'texts:waitingModel'); ctx.textsWaitingReason = may.reason;   // R11: summed into one alert at the end of the run (visible, recoverable)
      return;
    }
    if (may.ok) {
      ctx.modelUsed = true;
      const t = await writeTexts(src, { generate: ctx.generate, modelOptions: ctx.modelOptions, beat: () => beat(ctx) });
      if (!t.ok) {
        count(ctx, 'texts:refused');
        if (!keepable && row.verification_status === 'VERIFIED') await withdraw(ctx, kind, row, 'textes non confirmés par le contrôle automatique');
        await note(ctx, { ...base, kind: 'TEXTS', outcome: keepable ? 'OK' : 'RETRY', summary: `Le contrôle automatique a refusé les textes rédigés (${t.reasons.slice(-2).join(' ; ').slice(0, 400)}). Nouvel essai à la prochaine veille.`, details: { reasons: t.reasons, draft: t.draft || null } });
        if (!keepable) return;
      } else {
        patch = textPatch(kind, t, src);
        textsMeta = { at: ctx.now().toISOString(), model: t.model, sourceFingerprint: src.fingerprint, sourceMark: mark, checks: t.checks, attempts: t.attempts, ms: t.ms };
        textsNote = `résumé et version FALC rédigés à partir de cette source et contrôlés automatiquement (aucun nombre inventé, phrases FALC de ${t.checks.falcAvgWords} mots en moyenne, chaque phrase relue contre la source)`;
      }
    }
  }
  const sourceLabel = origin === 'DILA'
    ? `fiche ${where.id} « ${src.title} » du flux officiel Service-Public (DILA, archive du ${frDay(ctx.archive.builtAt)}), dernière modification importante le ${frDay(src.importantChangeAt) || 'non précisée'}`
    : `page officielle « ${src.title || where.url} » (${new URL(where.url).hostname}) lue le ${frDay(day(ctx.now()))}${src.officialCheckedAt ? `, vérifiée par l’éditeur le ${frDay(src.officialCheckedAt)}` : ''}`;
  const evidence = `Vérification automatique du ${frDay(day(ctx.now()))} : ${sourceLabel} ; ${textsNote}.`;
  const tier = tierOf(origin, src);
  const legal = legalChange(row.auto_check?.legal, (src.references || []).slice(0, 6));
  const coverageChanged = row.auto_check?.coverage !== undefined && (row.auto_check.coverage || null) !== (src.coverage || null);
  const auto = { checkedAt: ctx.now().toISOString(), runId: ctx.runId, origin, sourceUrl: where.url, sourceTitle: src.title, sourceId: where.id || null, importantChangeAt: src.importantChangeAt || null,
    sourceModifiedAt: origin === 'DILA' ? (ctx.metaById?.get(where.id)?.modifiedAt || null) : null, officialCheckedAt: src.officialCheckedAt || null, coverage: src.coverage || null, legal: (src.references || []).slice(0, 6), texts: textsMeta, discovered: where.discovered || null, moved: where.moved || null,
    authority: where.authority || (origin === 'DILA' ? { sourceId: 'dila-service-public', level: 'NATIONAL' } : null), tier: tier.tier, nextCheckAt: nextAt(ctx, tier) };
  // bookkeeping (not public content: no new verification for it) and provenance (public: a new address of the source is verified like a new text)
  const fixed = { auto_check: auto, last_checked_at: ctx.now(), retrieved_at: ctx.now(), ...(src.importantChangeAt ? { source_last_modified: new Date(src.importantChangeAt) } : {}) };
  const provenance = { ...(String(row.source_url || '') !== where.url || String(row.source_url_exact || '') !== where.url ? { source_url: where.url, source_url_exact: where.url } : {}),
    ...(kind === 'aide' && origin === 'DILA' && row.source_name !== 'Service-Public.gouv.fr' ? { source_name: 'Service-Public.gouv.fr', source_org: 'DILA' } : {}) };
  const content = Object.keys(patch).length || Object.keys(provenance).length ? { ...patch, ...provenance } : null;
  const r = await publish(ctx, kind, row, { patch: content, fixed, sourceUrl: where.url, evidence, reverify: change.important || outdated });
  if (!r.ok) { await note(ctx, { ...base, kind: 'SOURCE', outcome: 'UNRESOLVED', summary: `Non publiée : ${refusedLine(r)}.` }); return; }
  const details = { auto, change, fields: content ? Object.keys(content) : [], versionId: r.versionId || null, ...(legal ? { legal } : {}), ...(coverageChanged ? { coverage: { before: row.auto_check.coverage, after: src.coverage || null } } : {}) };
  if (r.firstPublication) await note(ctx, { ...base, kind: 'SOURCE', outcome: 'PUBLISHED', summary: `Publiée automatiquement. Source : ${sourceLabel}.${where.discovered ? ' Source trouvée automatiquement (titre et contenu concordants).' : ''}`, details });
  else if (content) {
    const what = [change.important ? `modification importante du ${frDay(src.importantChangeAt) || 'jour'}` : null, Object.keys(change.facts).length ? factsLine(change.facts) : null,
      legal ? 'références juridiques modifiées' : null, coverageChanged ? `territoire couvert modifié (${src.coverage || 'non précisé'})` : null].filter(Boolean);
    await note(ctx, { ...base, kind: 'CHANGE', outcome: 'UPDATED', summary: `Mise à jour automatique : la source officielle a changé${what.length ? ` — ${what.join(' ; ')}` : ''} ; textes réécrits et contrôlés.`, details });
  } else count(ctx, `${kind}:unchanged`);
}

// ------------------------------------------------------------------------------------------------------------------------------- structures
const annuaireIdOf = (u) => { const m = String(u || '').match(/lannuaire\.service-public\.gouv\.fr\/[^?#]*\/([0-9a-f-]{36})/i); return m ? m[1] : null; };
const siretOf = (u) => { const m = String(u || '').match(/annuaire-entreprises\.data\.gouv\.fr\/etablissement\/(\d{14})/); return m ? m[1] : null; };
/**
 * The Annuaire office of a structure record: its recorded id, a hint, the same SIRET, or — by name in the same postal code — only when every distinctive word of
 * the record's name is in the office's, or most of them and the same street (« Agence France Travail Strasbourg Seyboth » is not « … Pont Matthis »: the
 * shared words « agence France Travail » are not an identity, and the addresses differ).
 */
export function matchOffice(ctx, row) {
  const hints = ctx.hints.get(row.slug) || [];
  const ids = [row.source_annuaire, ...hints.map(annuaireIdOf)].filter(Boolean);
  const all = ctx.allOffices || ctx.offices;
  for (const id of ids) { const o = all.find((x) => x.annuaireId === id); if (o) return o; }
  const cp = digits(row.code_postal).slice(0, 5);
  const siret = digits(row.siret);
  if (siret) { const o = all.find((x) => x.siret === siret && x.code_postal === cp); if (o) return o; }
  const want = titleTokens(row.nom).filter((w) => !GENERIC.has(w));
  let best = null;
  for (const o of all) {
    if (o.code_postal !== cp || !want.length) continue;
    const have = new Set(titleTokens(o.nom)); const s = want.filter((w) => have.has(w)).length / want.length;
    if (s < 0.75) continue;
    const street = sameStreet(row.adresse, o.adresse, o.code_postal, o.ville);
    if (street === false) continue;                            // another street (or another number): another office
    if (s < 1 && street !== true) continue;                    // a distinctive word missing: only the same street makes it the same office
    if (!best || s > best.s) best = { o, s };
  }
  return best ? best.o : null;
}
const asOffice = (o) => ({ postalCode: o.code_postal, address: o.adresse, city: o.ville, communeInsee: o.insee, evidenceUrl: o.evidenceUrl });
/**
 * A public reception office of a kind the Annuaire de l'administration lists everywhere (France Travail agency, Caf, CPAM, mairie, CCAS, France services,
 * Espace Solidarités, MDPH, préfecture, tax office): the Annuaire is the authority on whether it receives the public. Absent from the complete listing of the
 * département, it is not published on SIRENE's word alone (an establishment number can stay « open » after the agency closed or moved — France Travail Seyboth).
 */
const PUBLIC_OFFICE_NAME = /^(agence )?france travail\b|\bcaf\b|caisse d.allocations familiales|\bcpam\b|caisse primaire d.assurance maladie|\bmairie\b|\bccas\b|centre communal d.action sociale|\bfrance services\b|maison des solidarit|espace solidarit|\bmdph\b|maison d[ée]partementale des personnes handicap|pr[ée]fecture|service des imp[ôo]ts/i;
export const isPublicOfficeName = (name) => PUBLIC_OFFICE_NAME.test(norm(name).replace(/[’']/g, "'")) || PUBLIC_OFFICE_NAME.test(String(name || ''));
/** a structure not checked tonight (not due) still counts for the duplicates: the identity a previous run established */
function rememberIdentity(ctx, row) {
  if (row.verification_status !== 'VERIFIED' || String(row.publication_hold || '').startsWith(DUPLICATE_HOLD)) return;
  ctx.structureIdentity = ctx.structureIdentity || new Map();
  ctx.structureIdentity.set(row.id, { siret: digits(row.siret) || null, annuaireId: row.source_annuaire || null, evidenceUrl: row.source_url || null });
}

/** the identity description of an association (what the registry establishes; its services are its own to describe) */
function associationTexts(row, s, { street, city, services = 0 } = {}) {
  const where = [street || (s.address ? readableCase(s.address.replace(new RegExp(`\\s*${s.postalCode || '$^'}.*$`), '')) : null), [s.postalCode, city || readableCase(s.city)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const name = squash(row.nom);
  return {
    resume: `${name} est ${s.isAssociation ? 'une association' : 'un organisme'} installé${s.isAssociation ? 'e' : ''} ${where ? `${where}` : 'dans le Bas-Rhin'}. Le répertoire officiel SIRENE confirme que cet établissement est ouvert${s.registryUpdatedAt ? ` (mise à jour du ${frDay(s.registryUpdatedAt)})` : ''}.`
      + (services ? ' Des plateformes publiques décrivent certains de ses services : ils sont listés sur cette page avec la source de chaque information. Pour ses horaires, et pour être sûr qu’un service est toujours proposé, contactez-le directement.'
        : ' Pour connaître ses services et ses horaires, contactez-le directement.'),
    falc: [`${name} est ${s.isAssociation ? 'une association' : 'un organisme'}.`, ...(where ? [`L’adresse est : ${where}.`] : []), 'L’État confirme que ce lieu est ouvert.',
      ...(services ? ['D’autres sites disent ce que ce lieu propose.', 'Appelez-le pour être sûr.'] : ['Appelez-le pour savoir ce qu’il propose.'])],
  };
}

/** the record's own wording of its street when it names the same street and number as the registry: the record's, else its latest earlier version's (EntityVersion) */
async function ownStreet(ctx, row, official, postalCode, city) {
  const fits = (a) => { const s = streetOnly(a); return s && /\p{Ll}/u.test(s) && sameStreetNumber(s, official, postalCode, city) ? s : null; };
  const now = fits(row.adresse); if (now) return now;
  const earlier = (await ctx.db.execute(sql`SELECT snapshot_json::jsonb->>'adresse' AS a FROM "EntityVersion" WHERE lower(entity_type) = 'structure' AND entity_id = ${row.id}
    ORDER BY "createdAt" DESC LIMIT 40`)).rows;
  for (const e of earlier) { const s = fits(e.a); if (s) return s; }
  return null;
}

async function checkStructureRecord(ctx, kind, row) {
  const base = { entityType: 'structure', entityId: row.id, title: row.nom };
  if (String(row.publication_hold || '').startsWith(DUPLICATE_HOLD)) { count(ctx, 'structure:duplicate'); return; }   // put aside by the duplicate register: the kept record carries the checks
  if (ctx.di?.gone.has(row.id)) {
    const why = `plus aucun producteur de data·inclusion ne liste ce lieu (absent des exports du ${(row.services_externes?.absentFrom || []).concat(ctx.di.version).filter((v, i, a) => a.indexOf(v) === i).slice(-2).map(frDay).join(' et du ')})`;
    const out = await withdraw(ctx, 'structure', row, why);
    await note(ctx, { ...base, kind: 'IDENTITY', outcome: outcomeOf(out), summary: out.deferred ? deferredLine(why) : `${out.already ? 'Pas publiée' : 'Retirée automatiquement'} : ${why}.` });
    return;
  }
  if (fromFiness(row)) return checkFinessRecord(ctx, row);
  // the Annuaire could not be read tonight: a record known through it keeps its state (an outage is not a closure)
  if (!ctx.annuaireOk && row.source_annuaire) { await note(ctx, { ...base, kind: 'IDENTITY', outcome: 'RETRY', summary: "Annuaire de l'administration indisponible cette fois : fiche gardée en l’état, nouvel essai à la prochaine veille." }); return; }
  const hints = ctx.hints.get(row.slug) || [];
  const office = matchOffice(ctx, row);
  let siret = digits(row.siret) || hints.map(siretOf).find(Boolean) || office?.siret || null;
  let sirene = null; let candidate = null; let obsolete = null;
  // a public office already tied to its Annuaire entry: the Annuaire is the authority (address, telephones, hours) — no SIRENE request every night for ~1 000 offices
  const annuaireOnly = Boolean(office && row.source_annuaire && row.source_annuaire === office.annuaireId);
  try {
    if (annuaireOnly) { /* identity, place and territory from the Annuaire entry */ }
    else if (siret) {
      sirene = await lookupSiret(siret, ctx.net); sireneStat(ctx, true);
      // a public office listed by the Annuaire is open whatever an old SIRET says (offices change SIRET when they move or merge): the old number is not kept
      if (office && sirene?.found && !sirene.open) { obsolete = { siret, closedAt: sirene.closedAt }; sirene = null; siret = null; }
    } else {
      const c = await searchEstablishments(row.nom, { postalCode: row.code_postal }, ctx.net); sireneStat(ctx, true);
      // by name only with one open establishment of the same name AND, when the record has an address, on the same street
      const close = (c.candidates || []).filter((x) => x.open && titleScore(row.nom, `${x.name || ''} ${x.sign || ''}`) >= 0.75
        && sameStreet(row.adresse, x.address, x.postalCode, x.city) !== false);
      if (close.length === 1) { candidate = close[0]; sirene = { found: true, ...candidate }; siret = candidate.siret; }
    }
  } catch (e) {
    sireneStat(ctx, false, e);
    await note(ctx, { ...base, kind: 'IDENTITY', outcome: 'RETRY', summary: `Registre SIRENE non consulté cette fois (${e?.message || e}). Nouvel essai à la prochaine veille.` });
    return;
  }
  const check = checkStructure(row, { sirene, offices: office ? [asOffice(office)] : [], candidate });
  if (check.identity === 'CLOSED') {
    const out = await withdraw(ctx, 'structure', row, check.reasons.join(' '));
    await note(ctx, { ...base, kind: 'IDENTITY', outcome: outcomeOf(out), summary: out.deferred ? deferredLine(check.reasons.join(' ')) : `${out.already ? 'Pas publiée' : 'Retirée automatiquement'} : ${check.reasons.join(' ')}`, details: { evidence: check.evidence } });
    return;
  }
  // a public office the complete Annuaire of the département no longer lists: not published on a registry number alone (see PUBLIC_OFFICE_NAME)
  if (!office && ctx.annuaireOk && isPublicOfficeName(row.nom)) {
    const why = "service public absent de l'Annuaire de l'administration, qui liste tous les lieux d'accueil de ce type dans le département (le répertoire SIRENE ne dit pas s'il reçoit encore le public)";
    const out = await withdraw(ctx, 'structure', row, why);
    await note(ctx, { ...base, kind: 'IDENTITY', outcome: outcomeOf(out), summary: out.deferred ? deferredLine(why) : `Pas publiée : ${why}. La recherche reprendra à chaque veille.`,
      details: { sirene: sirene ? { siret: sirene.siret, open: sirene.open } : null } });
    return;
  }
  if (!office && !(check.identity === 'OPEN')) {
    const out = await withdraw(ctx, 'structure', row, 'identité non confirmée par un registre officiel');
    await note(ctx, { ...base, kind: 'IDENTITY', outcome: outcomeOf(out), summary: out.deferred ? deferredLine('identité non confirmée') : `Pas publiée : ni le répertoire SIRENE ni l'Annuaire de l'administration ne confirment cette structure${check.reasons.length ? ` (${check.reasons.join(' ')})` : ''}. La recherche reprendra à chaque veille.` });
    return;
  }
  if (check.territory === false) {
    const out = await withdraw(ctx, 'structure', row, check.reasons.join(' '));
    await note(ctx, { ...base, kind: 'IDENTITY', outcome: outcomeOf(out), summary: out.deferred ? deferredLine(check.reasons.join(' ')) : `Hors du territoire couvert : ${check.reasons.join(' ')}` });
    return;
  }
  // the official facts: the Annuaire for a public office (address, telephones, hours), SIRENE for the identity and the address of the others
  const patch = {}; const corrected = [];
  const di = servicesPatch(ctx, row, patch);
  const set = (k, v, label) => { if (v === null || v === undefined || v === '') return; if (String(row[k] ?? '') !== String(v)) { patch[k] = v; corrected.push(label || k); } };
  if (siret) {
    const taken = (await ctx.db.execute(sql`SELECT id FROM "Structure" WHERE siret = ${siret} AND id <> ${row.id} LIMIT 1`)).rows[0];
    if (!taken) set('siret', siret, 'numéro SIRET');
  }
  if (office) {
    set('adresse', office.adresse, 'adresse'); set('code_postal', office.code_postal, 'code postal'); set('ville', office.ville, 'commune'); set('telephone', office.telephone, 'téléphone');
    set('horaires', office.horaires, 'horaires'); set('latitude', office.latitude); set('longitude', office.longitude); set('source_annuaire', office.annuaireId);
    if (!row.site_web && office.site_web) set('site_web', office.site_web, 'site internet');
    if (!row.type_structure) set('type_structure', office.kind ? office.kind.label : 'Service public');
    const t = officeTexts(office); set('description_courte', t.resume); set('summary_falc', t.falc.join('\n'));
  } else if (check.sirene) {
    if (check.corrections.code_postal) set('code_postal', check.corrections.code_postal, 'code postal');
    // SIRENE writes capitals without accents: the record's own wording of the same street and number is kept (now, or in its latest earlier version that had it);
    // another street takes SIRENE's, in readable case
    const official = check.sirene.address ? check.sirene.address.replace(new RegExp(`\\s*${check.sirene.postalCode || '$^'}.*$`), '') : null;
    const street = official ? (await ownStreet(ctx, row, official, check.sirene.postalCode, check.sirene.city)) || readableCase(official) : null;
    const city = check.sirene.city ? check.sirene.city.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : null;
    set('adresse', street, 'adresse');
    set('ville', city, 'commune');
    set('latitude', check.sirene.latitude); set('longitude', check.sirene.longitude);
    if (!row.type_structure) set('type_structure', check.sirene.isAssociation ? 'Association' : 'Organisme');
    const t = associationTexts(row, check.sirene, { street, city, services: servicesCount(row, patch) }); set('description_courte', t.resume); set('summary_falc', t.falc.join('\n'));
  }
  // a person's own work address is never a public contact: the office's generic one replaces it, or none (contacts.js)
  if (row.email && nominativeEmail(row.email)) { patch.email = publicEmail(null, office?.email); corrected.push('adresse électronique personnelle d’un agent retirée (donnée personnelle)'); }
  else if (!row.email && office?.email && !nominativeEmail(office.email)) set('email', office.email, 'courriel');
  if (patch.description_courte || patch.summary_falc) patch.falc_origin = 'DETERMINISTIC';
  const sourceUrl = office?.evidenceUrl || check.sirene?.evidenceUrl;
  if (sourceUrl && (row.source_url !== sourceUrl || row.source_url_exact !== sourceUrl)) { patch.source_url = sourceUrl; patch.source_url_exact = sourceUrl; }
  const sourcesLine = [office ? `Annuaire de l'administration (DILA), fiche mise à jour le ${frDay(day(office.updatedAt)) || 'non précisé'}` : null,
    check.sirene ? `répertoire SIRENE : établissement ${check.sirene.siret} ouvert` : null].filter(Boolean).join(' ; ');
  const evidence = `Vérification automatique du ${frDay(day(ctx.now()))} : ${sourcesLine}${corrected.length ? ` ; corrigé d'après ces sources : ${corrected.join(', ')}` : ''}${di ? ` ; ${di}` : ''}.`;
  const tier = tierOf(office ? 'ANNUAIRE' : 'SIRENE', null);
  const territorial = corrected.some((c) => c === 'commune' || c === 'code postal');
  const auto = { checkedAt: ctx.now().toISOString(), runId: ctx.runId, identity: check.identity, sources: [office && { kind: 'ANNUAIRE', url: office.evidenceUrl, updatedAt: office.updatedAt }, check.sirene && { kind: 'SIRENE', url: check.sirene.evidenceUrl, siret: check.sirene.siret }].filter(Boolean),
    corrected, differences: check.differences, obsoleteSiret: obsolete, accessiblePhone: office?.accessible || [], phones: office?.telephones || [], contactForm: office?.formulaire || null, tier: tier.tier, nextCheckAt: nextAt(ctx, tier) };
  const r = await publish(ctx, 'structure', row, { patch: Object.keys(patch).length ? patch : null, fixed: { auto_check: auto, last_checked_at: ctx.now() }, sourceUrl, evidence });
  if (!r.ok) { await note(ctx, { ...base, kind: 'IDENTITY', outcome: 'UNRESOLVED', summary: `Non publiée : ${refusedLine(r)}.` }); return; }
  ctx.structureIdentity = ctx.structureIdentity || new Map();
  ctx.structureIdentity.set(row.id, { siret: siret || (office ? null : digits(row.siret) || null), annuaireId: office?.annuaireId || null, evidenceUrl: sourceUrl });
  const details = { ...auto, versionId: r.versionId || null, fields: Object.keys(patch), ...(territorial ? { territorial: true } : {}) };
  if (r.firstPublication) await note(ctx, { ...base, kind: 'IDENTITY', outcome: 'PUBLISHED', summary: `Publiée automatiquement : ${sourcesLine}${corrected.length ? ` ; corrigé : ${corrected.join(', ')}` : ''}.`, details });
  else if (corrected.length) await note(ctx, { ...base, kind: 'CHANGE', outcome: 'CORRECTED', summary: `Corrigée automatiquement d'après les sources officielles : ${corrected.join(', ')}${di ? ` ; ${di}` : ''}.`, details });
  else if (di) await note(ctx, { ...base, kind: 'CHANGE', outcome: 'CORRECTED', summary: `Mise à jour : ${di}.`, details });
  else count(ctx, 'structure:unchanged');
}

/** the SIRENE requests of the night, for the registry's health of the feed */
function sireneStat(ctx, ok, e = null) {
  ctx.sirene = ctx.sirene || { ok: 0, failed: 0, error: null };
  if (ok) ctx.sirene.ok += 1; else { ctx.sirene.failed += 1; ctx.sirene.error = String(e?.code || e?.message || e).slice(0, 120); }
}

/** two records of the same establishment (same SIRET or same Annuaire office): the most complete is kept, the other is put aside through the duplicate register */
async function mergeDuplicates(ctx) {
  await beat(ctx, { phase: 'doublons', current: null }, true);
  const ids = ctx.structureIdentity || new Map();
  const groups = new Map();
  for (const [id, x] of ids) { const key = x.annuaireId ? `a:${x.annuaireId}` : x.siret ? `s:${x.siret}` : null; if (key) groups.set(key, [...(groups.get(key) || []), { id, ...x }]); }
  for (const [key, members] of groups) {
    if (members.length < 2 || ctx.halted()) continue;
    const rows = await ctx.db.select().from(Structure).where(sql`${Structure.id} IN (${sql.join(members.map((m) => sql`${m.id}`), sql`, `)})`);
    const filled = (r) => ['telephone', 'email', 'site_web', 'horaires', 'description_courte', 'siret'].filter((k) => r[k]).length;
    rows.sort((a, b) => filled(b) - filled(a) || new Date(a.createdAt) - new Date(b.createdAt));
    const primary = rows[0];
    for (const other of rows.slice(1)) {
      const [a, b] = [primary.id, other.id].sort();
      const active = (await ctx.db.select().from(StructureDuplicateDecision).where(and(eq(StructureDuplicateDecision.structureA, a), eq(StructureDuplicateDecision.structureB, b), sql`"supersededAt" IS NULL`)))[0];
      if (active) continue;
      const versions = { [primary.id]: contentVersion(await rowJson(ctx.db, 'structure', primary.id)), [other.id]: contentVersion(await rowJson(ctx.db, 'structure', other.id)) };
      const r = await decideDuplicate({ a, b, decision: 'SAME_ENTITY', primaryId: primary.id, versionA: versions[a], versionB: versions[b], evidenceUrl: members[0].evidenceUrl,
        note: `Même établissement selon ${key.startsWith('a:') ? "l'Annuaire de l'administration" : 'le répertoire SIRENE'} (${key.slice(2)}) : la fiche la plus complète est conservée.` }, SYSTEM_REVIEWER.id, { db: ctx.db, env: ctx.env, role: SYSTEM_REVIEWER.role, trustedDomains: ctx.trusted });
      await note(ctx, { entityType: 'structure', entityId: other.id, title: other.nom, kind: 'DUPLICATE', outcome: r.ok ? 'WITHDRAWN' : 'UNRESOLVED',
        summary: r.ok ? `Doublon de « ${primary.nom} » (${key.startsWith('a:') ? 'même fiche de l’Annuaire' : `même SIRET ${key.slice(2)}`}) : mise de côté automatiquement, la fiche « ${primary.nom} » est conservée.` : `Doublon probable de « ${primary.nom} » non traité (${r.message || r.code}).`,
        details: { primaryId: primary.id, key } });
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------------------- FINESS+
/**
 * a record the chain made from FINESS (its identity is the register's: checked against it every night, not against SIRENE) — also after a content transfer to
 * another environment, which does not copy the verification projection (auto_check) but keeps the record's source: its FINESS page
 */
const fromFiness = (row) => Boolean(row.numero_finess) && (row.auto_check?.identity === 'FINESS' || (row.auto_check?.sources || []).some((x) => x?.kind === 'FINESS')
  || String(row.source_url || '').startsWith('https://finess.esante.gouv.fr/'));
const finessSource = (ctx, e) => ({ kind: 'FINESS', url: e.evidenceUrl, finess: e.finess, category: e.category, categoryLabel: e.categoryLabel, version: ctx.finess.version, updatedAt: e.updatedAt,
  dataset: 'https://www.data.gouv.fr/datasets/finess-structures-1', terms: termsVersion() });
const finessRecordFields = (e) => ({ type_structure: e.scope[0], categories_aidees: [e.scope[1]], publics_accueillis: e.publics || [] });

/**
 * A record made from FINESS: open in the register (macro-state A, no closing date), of a kind the directory takes, in the département → its facts are the
 * register's (address, telephone, kind, publics of its activities); closed, gone from the register or of another kind → withdrawn with that reason. When the
 * register could not be read tonight the record keeps its state (an outage is not a closure).
 */
async function checkFinessRecord(ctx, row) {
  const base = { entityType: 'structure', entityId: row.id, title: row.nom };
  if (!ctx.finessOk) { await note(ctx, { ...base, kind: 'IDENTITY', outcome: 'RETRY', summary: 'Répertoire FINESS indisponible cette fois : fiche gardée en l’état, nouvel essai à la prochaine veille.' }); return; }
  const e = ctx.finess.byFiness.get(String(row.numero_finess));
  const why = !e ? `établissement ${row.numero_finess} absent du répertoire FINESS du ${frDay(ctx.finess.version)} pour le département`
    : !e.open ? `établissement fermé selon le répertoire FINESS${e.closedAt ? ` (fermeture le ${frDay(e.closedAt)})` : ''}`
      : !e.scope ? `catégorie FINESS « ${e.categoryLabel || e.category} » : hors du champ de l’annuaire`
        : !String(e.insee || e.code_postal || '').startsWith(ctx.departement) ? `hors du territoire (commune ${e.insee || e.code_postal})` : null;
  if (why) {
    const out = await withdraw(ctx, 'structure', row, why);
    await note(ctx, { ...base, kind: 'IDENTITY', outcome: outcomeOf(out), summary: out.deferred ? deferredLine(why) : `${out.already ? 'Pas publiée' : 'Retirée automatiquement'} : ${why}.`, details: { finess: row.numero_finess, evidence: e?.evidenceUrl || null } });
    return;
  }
  const patch = {}; const corrected = [];
  const di = servicesPatch(ctx, row, patch);
  const set = (k, v, label) => { if (v === null || v === undefined || v === '') return; const a = Array.isArray(v) ? JSON.stringify(v) : String(v); const b = Array.isArray(row[k]) ? JSON.stringify(row[k]) : String(row[k] ?? ''); if (a !== b) { patch[k] = v; corrected.push(label || k); } };
  set('nom', e.nom, 'nom'); set('adresse', e.adresse, 'adresse'); set('code_postal', e.code_postal, 'code postal'); set('ville', e.ville, 'commune'); set('telephone', e.telephone, 'téléphone');
  set('latitude', e.latitude); set('longitude', e.longitude);
  const f = finessRecordFields(e); set('type_structure', f.type_structure, 'catégorie'); set('categories_aidees', f.categories_aidees); set('publics_accueillis', f.publics_accueillis, 'publics');
  if (!row.email && e.email) set('email', e.email, 'courriel');
  if (row.email && nominativeEmail(row.email)) { patch.email = null; corrected.push('adresse électronique personnelle retirée (donnée personnelle)'); }
  const t = finessTexts(e, { updatedDay: frDay(day(e.updatedAt)) }); set('description_courte', t.resume); set('summary_falc', t.falc.join('\n'));
  if (patch.description_courte || patch.summary_falc) patch.falc_origin = 'DETERMINISTIC';
  if (row.source_url !== e.evidenceUrl || row.source_url_exact !== e.evidenceUrl) { patch.source_url = e.evidenceUrl; patch.source_url_exact = e.evidenceUrl; }
  const line = `répertoire FINESS (fichier du ${frDay(ctx.finess.version)}) : établissement ${e.finess} ouvert, catégorie « ${e.categoryLabel || e.category} »`;
  const evidence = `Vérification automatique du ${frDay(day(ctx.now()))} : ${line}${corrected.length ? ` ; corrigé d'après ce répertoire : ${corrected.join(', ')}` : ''}${di ? ` ; ${di}` : ''}.`;
  const tier = tierOf('FINESS', null);
  const auto = { checkedAt: ctx.now().toISOString(), runId: ctx.runId, identity: 'FINESS', sources: [finessSource(ctx, e)], corrected, tier: tier.tier, nextCheckAt: nextAt(ctx, tier) };
  const r = await publish(ctx, 'structure', row, { patch: Object.keys(patch).length ? patch : null, fixed: { auto_check: auto, last_checked_at: ctx.now() }, sourceUrl: e.evidenceUrl, evidence });
  if (!r.ok) { await note(ctx, { ...base, kind: 'IDENTITY', outcome: 'UNRESOLVED', summary: `Non publiée : ${refusedLine(r)}.` }); return; }
  if (r.firstPublication) await note(ctx, { ...base, kind: 'IDENTITY', outcome: 'PUBLISHED', summary: `Publiée automatiquement : ${line}.`, details: { ...auto, versionId: r.versionId || null } });
  else if (corrected.length) await note(ctx, { ...base, kind: 'CHANGE', outcome: 'CORRECTED', summary: `Corrigée automatiquement d'après le répertoire FINESS : ${corrected.join(', ')}${di ? ` ; ${di}` : ''}.`, details: { ...auto, versionId: r.versionId || null, fields: Object.keys(patch) } });
  else if (di) await note(ctx, { ...base, kind: 'CHANGE', outcome: 'CORRECTED', summary: `Mise à jour : ${di}.`, details: { ...auto, versionId: r.versionId || null, fields: Object.keys(patch) } });
  else count(ctx, 'structure:unchanged');
}

/**
 * Growth from FINESS: the open establishments of the département of a kind the directory takes, not yet in it (a capped number per run). An establishment
 * already in the directory is not added again — the same FINESS number, or a record of ANOTHER source (Annuaire, SIRENE) with the same SIRET or on the same
 * street with the same name in the same postal code (a public office such as the MDPH or a PMI): that record keeps its own sources. Two FINESS establishments
 * are two records even with the same SIRET (an EHPAD and its home-care service at one address are two services of one place).
 */
async function feedFiness(ctx) {
  if (!ctx.finessOk || ctx.halted()) return;
  await beat(ctx, { phase: 'nouveaux établissements FINESS', current: null }, true);
  const all = (await ctx.db.execute(sql`SELECT id, nom, adresse, code_postal, siret, numero_finess FROM "Structure"`)).rows;
  const byFiness = new Set(all.map((r) => r.numero_finess).filter(Boolean));
  const takenSiret = new Set(all.map((r) => digits(r.siret)).filter(Boolean));
  const rows = all.filter((r) => !r.numero_finess);                                  // the records of the other sources
  const bySiret = new Map(rows.filter((r) => r.siret).map((r) => [digits(r.siret), r.id]));
  const sameRecord = (e) => {
    if (e.siret && bySiret.has(e.siret)) return { id: bySiret.get(e.siret), by: 'SIRET' };
    const want = titleTokens(e.nom).filter((w) => !GENERIC.has(w));
    for (const r of rows) {
      if (digits(r.code_postal).slice(0, 5) !== e.code_postal || !want.length) continue;
      const have = new Set(titleTokens(r.nom)); if (want.filter((w) => have.has(w)).length / want.length < 0.75) continue;
      if (sameStreet(r.adresse, e.adresse, e.code_postal, e.ville) === true) return { id: r.id, by: 'adresse' };
    }
    return null;
  };
  const fresh = [...ctx.finess.byFiness.values()].filter((e) => e.open && e.scope && !byFiness.has(e.finess) && e.nom && e.code_postal && String(e.insee || e.code_postal).startsWith(ctx.departement));
  let created = 0; let seen = 0;
  for (const e of fresh) {
    if (created >= ctx.limits.newFiness || ctx.halted() || !(await beat(ctx, { done: created, total: Math.min(fresh.length, ctx.limits.newFiness), current: e.nom }))) break;
    seen += 1;
    const same = sameRecord(e);
    if (same) { count(ctx, 'finess:alreadyListed'); continue; }
    const id = crypto.randomUUID(); const tier = tierOf('FINESS', null); const t = finessTexts(e, { updatedDay: frDay(day(e.updatedAt)) });
    const siretFree = e.siret && !takenSiret.has(e.siret);   // the SIRET column is one record's: the first establishment of that place holds it
    await ctx.db.insert(Structure).values({ id, nom: e.nom, slug: `${slugify(e.nom)}-${id.slice(0, 8)}`, ...finessRecordFields(e), adresse: e.adresse, code_postal: e.code_postal, ville: e.ville,
      ...(siretFree ? { siret: e.siret } : {}), numero_finess: e.finess, departement: ctx.departement, telephone: e.telephone, email: e.email, latitude: e.latitude, longitude: e.longitude,
      source_url: e.evidenceUrl, source_url_exact: e.evidenceUrl, data_origin: 'official', statut: 'brouillon', description_courte: t.resume, summary_falc: t.falc.join('\n'), falc_origin: 'DETERMINISTIC',
      services: [], insee_codes: e.insee ? [e.insee] : [], department_codes: [ctx.departement], last_checked_at: ctx.now(),
      auto_check: { checkedAt: ctx.now().toISOString(), runId: ctx.runId, identity: 'FINESS', sources: [finessSource(ctx, e)], tier: tier.tier, nextCheckAt: nextAt(ctx, tier) },
      updatedBy: SYSTEM_REVIEWER.id, updatedAt: new Date() });
    if (siretFree) takenSiret.add(e.siret);
    byFiness.add(e.finess);
    const evidence = `Vérification automatique du ${frDay(day(ctx.now()))} : répertoire FINESS (fichier du ${frDay(ctx.finess.version)}), établissement ${e.finess} ouvert, catégorie « ${e.categoryLabel || e.category} » (nom, adresse et téléphone repris du répertoire).`;
    const r = await recordVerification({ entityType: 'structure', entityId: id, action: 'VERIFY', reviewer: SYSTEM_REVIEWER, sourceUrl: e.evidenceUrl, evidenceNote: evidence, territoryConfirmed: true }, { db: ctx.db, env: ctx.env, trustedDomains: ctx.trusted });
    if (r.ok) await ctx.db.update(Structure).set({ statut: 'actif', published_at: new Date() }).where(eq(Structure.id, id));
    created += 1;
    await note(ctx, { entityType: 'structure', entityId: id, title: e.nom, kind: 'NEW_RECORD', outcome: r.ok ? 'CREATED' : 'UNRESOLVED', summary: r.ok ? `Ajoutée automatiquement depuis le répertoire FINESS (${e.scope[0]}, ${e.ville || e.code_postal}).` : `Ajoutée mais non publiée (${r.message || r.code}).`, details: { finess: e.finess } });
  }
  if (fresh.length > seen) count(ctx, 'finess:later', fresh.length - seen);
}

// ------------------------------------------------------------------------------------------------------------------------------- data·inclusion (D05)
/**
 * The export of the week (datainclusion.js): downloaded as a stream, SHA-1 checked, read as a stream. Not used — the services already listed stay as they are —
 * when it could not be read, when it is older than the last one used, or when it lists far fewer places of the département than the last one.
 */
async function loadDataInclusion(ctx) {
  await beat(ctx, { phase: 'data·inclusion', current: null }, true);
  const t1 = Date.now();
  try {
    const files = ctx.dataInclusionFiles || await fetchDataInclusion({ cacheDir: ctx.cacheDir, net: ctx.net });
    const r = await readDataInclusion({ structures: files.structures.file, services: files.services.file, departement: ctx.departement });
    const version = files.date || null;
    const fileMeta = Object.fromEntries(['structures', 'services'].map((k) => [k, { title: files[k].title || null, sha1: files[k].sha1 || null, reused: Boolean(files[k].reused) }]));
    const [prev] = (await ctx.db.execute(sql`SELECT metrics->'datainclusion' AS d FROM "CronRun" WHERE job = 'veille' AND status IN ('success', 'partial', 'stopped')
      AND jsonb_typeof(metrics->'datainclusion') = 'object' ORDER BY "startedAt" DESC LIMIT 1`)).rows;
    const p = prev?.d;
    const reason = !version ? 'export sans date' : p && p.version && String(version) < String(p.version) ? `export plus ancien que celui déjà utilisé (${version} au lieu de ${p.version} ou après)`
      : p && Number(p.inScope) >= 50 && r.counts.inScope < 0.9 * Number(p.inScope) ? `export incomplet (${r.counts.inScope} lieux du département au lieu d’environ ${p.inScope})`
        : r.counts.structures === 0 ? 'export vide' : null;
    await recordFeedHealth(ctx.db, 'data-inclusion', { ok: !reason, status: 200, ms: Date.now() - t1, version, error: reason,
      detail: { files: fileMeta, ...r.counts, unknownValues: r.unknown, terms: diTermsVersion(), licence: files.licence || null, publisher: files.publisher || null } });
    if (reason) { await note(ctx, { kind: 'REGISTRY', outcome: 'RETRY', summary: `data·inclusion de la semaine écarté : ${reason}. Les services déjà listés restent en l’état ; nouvel essai à la prochaine veille.` }); return; }
    ctx.di = await matchDataInclusion(ctx, r, version, p && p.version === version ? p : null);
    ctx.di.summary = { ...ctx.di.summary, files: fileMeta, structures: r.counts.structures, services: r.counts.services, inScope: r.counts.inScope, withSiret: r.counts.withSiret,
      servicesInScope: r.counts.servicesInScope, bySource: r.counts.bySource, unknownValues: r.unknown, terms: diTermsVersion() };
  } catch (e) {
    await recordFeedHealth(ctx.db, 'data-inclusion', { ok: false, ms: Date.now() - t1, error: e?.code || e?.message || String(e) }).catch(() => {});
    await note(ctx, { kind: 'REGISTRY', outcome: 'RETRY', summary: `data·inclusion non consulté cette fois (${e?.message || e}) : les services déjà listés restent en l’état ; nouvel essai à la prochaine veille.` });
  }
}

/**
 * Which record each place of data·inclusion is: the record holding its SIRET (a registry's identity), else its FINESS number, else — same postal code — a record of
 * the same name on the same street. A place of another postal code than the record is another site of the same organisation: not attached (its services are
 * not this place's). Places matching no record, with a well-formed SIRET, of a producer whose places may become records, are the candidates of feedDataInclusion.
 * `prev`: tonight's export was already used by an earlier run (its summary): the candidates it examined are not examined again for this export.
 */
async function matchDataInclusion(ctx, r, version, prev) {
  const rows = (await ctx.db.execute(sql`SELECT id, nom, adresse, code_postal, siret, numero_finess, services_externes FROM "Structure"`)).rows;
  const bySiret = new Map(); const byFiness = new Map(); const byPostal = new Map();
  for (const x of rows) {
    const s = digits(x.siret); if (s && !bySiret.has(s)) bySiret.set(s, x);
    if (x.numero_finess) byFiness.set(String(x.numero_finess), x);
    const cp = digits(x.code_postal).slice(0, 5); if (cp) { const l = byPostal.get(cp) || []; l.push({ x, tokens: new Set(titleTokens(x.nom)) }); byPostal.set(cp, l); }
  }
  const samePostal = (x, pl) => !x.code_postal || !pl.code_postal || digits(x.code_postal).slice(0, 5) === digits(pl.code_postal).slice(0, 5);
  const byName = (pl) => {
    const want = titleTokens(pl.nom).filter((w) => !GENERIC.has(w)); if (!want.length || !pl.code_postal || !pl.adresse) return null;
    for (const { x, tokens } of byPostal.get(digits(pl.code_postal).slice(0, 5)) || []) {
      if (want.filter((w) => tokens.has(w)).length / want.length < 0.75) continue;
      if (sameStreet(x.adresse, pl.adresse, pl.code_postal, pl.commune) === true) return x;
    }
    return null;
  };
  const placesOf = new Map(); const candidates = new Map(); const n = { bySiret: 0, byFiness: 0, byName: 0, otherSite: 0, noSiret: 0, notGrowth: 0 };
  for (const pl of r.places.values()) {
    let x = (pl.siret && bySiret.get(pl.siret)) || null; let by = x ? 'bySiret' : null;
    if (!x && pl.finess && byFiness.get(pl.finess)) { x = byFiness.get(pl.finess); by = 'byFiness'; }
    if (!x) { x = byName(pl); by = x ? 'byName' : null; }
    if (x) {
      if (!samePostal(x, pl)) { n.otherSite += 1; continue; }
      n[by] += 1; const l = placesOf.get(x.id) || []; l.push(pl); placesOf.set(x.id, l); continue;
    }
    if (!pl.siret) { n.noSiret += 1; continue; }
    if (!producerOf(pl.source).growth || NOT_A_PLACE_NAME.test(pl.nom)) { n.notGrowth += 1; continue; }
    const key = `${pl.siret}|${digits(pl.code_postal).slice(0, 5)}`; const l = candidates.get(key) || []; l.push(pl); candidates.set(key, l);
  }
  const byRecord = new Map(); const changed = new Set(); const gone = new Set();
  for (const x of rows) {
    const before = x.services_externes && typeof x.services_externes === 'object' ? x.services_externes : null;
    const list = placesOf.get(x.id);
    if (list) {
      const v = servicesValue({ version, placeList: list, servicesOf: r.servicesOf, previous: before });
      byRecord.set(x.id, v);
      if (!sameServices(before, v) || (before?.absentFrom || []).length) changed.add(x.id);
      continue;
    }
    if (!before || before.origin !== 'DATA_INCLUSION') continue;
    // listed before, not in this export: its services are no longer shown; a record that exists BECAUSE of data·inclusion goes after two exports without it
    if (!before.createdFromDataInclusion) { byRecord.set(x.id, null); changed.add(x.id); continue; }
    const absentFrom = [...new Set([...(before.absentFrom || []), version])].sort();
    const v = { ...before, places: [], services: [], categories: [], absentFrom };
    byRecord.set(x.id, v);
    if (absentFrom.length !== (before.absentFrom || []).length || (before.services || []).length) changed.add(x.id);
    if (absentFrom.length >= 2) gone.add(x.id);
  }
  const rank = { OPERATEUR_PUBLIC: 0, ORGANISME_GESTIONNAIRE: 1, PLATEFORME_DECLARATIVE: 2 };
  const examined = new Set(prev?.examined || []);
  const fresh = [...candidates.entries()].map(([key, places]) => ({ key, siret: places[0].siret, places: [...places].sort((a, b) => rank[producerOf(a.source).authority] - rank[producerOf(b.source).authority] || a.id.localeCompare(b.id)) }))
    .filter((c) => servicesFor(c.places, r.servicesOf, { asOf: version }).services.length);
  const pending = fresh.filter((c) => !examined.has(c.key)).sort((a, b) => rank[producerOf(a.places[0].source).authority] - rank[producerOf(b.places[0].source).authority] || a.key.localeCompare(b.key));
  return { version, r, byRecord, changed, gone, pending, examined,
    summary: { version, matched: placesOf.size, ...n, changed: changed.size, gone: gone.size, candidates: fresh.length, examinedBefore: examined.size, examined: [...examined], created: 0, skipped: {} } };
}

/** D05: the services data·inclusion lists for this record, when tonight's export changed them — the line the evidence and the journal say about it, or null */
function servicesPatch(ctx, row, patch) {
  if (!ctx.di || !ctx.di.changed.has(row.id)) return null;
  const v = ctx.di.byRecord.has(row.id) ? ctx.di.byRecord.get(row.id) : null;
  if (sameServices(row.services_externes, v) && JSON.stringify(row.services_externes?.absentFrom || []) === JSON.stringify(v?.absentFrom || [])) return null;
  patch.services_externes = v;
  const producers = [...new Set((v?.services || []).map((s) => s.producerLabel))];
  return v?.services?.length ? `services listés par data·inclusion (export du ${frDay(ctx.di.version)}) : ${v.services.length}, attribués à leurs producteurs (${producers.join(', ')}), non vérifiés par l’État`
    : `services de data·inclusion retirés de la fiche (plus listés dans l’export du ${frDay(ctx.di.version)})`;
}
const servicesCount = (row, patch) => ((Object.prototype.hasOwnProperty.call(patch, 'services_externes') ? patch.services_externes : row.services_externes)?.services || []).length;

/**
 * Growth from data·inclusion: a place no record is, of a producer whose places may become records, with a well-formed SIRET and at least one service still kept
 * up to date by its producer. Its identity is the REGISTRY's: SIRENE must say the establishment is open, in the département, at the same postal code, and not a
 * person (an individual entrepreneur is a person, not a place) — else nothing is created and the place is examined again with the next export. Then the record
 * is created and checked at once like any structure (checkStructureRecord: SIRENE identity, texts written from it). Capped per run (SIRENE requests).
 */
async function feedDataInclusion(ctx) {
  if (!ctx.di || ctx.halted()) return;
  await beat(ctx, { phase: 'nouveaux lieux data·inclusion', current: null }, true);
  const { version, r } = ctx.di; const sum = ctx.di.summary;
  let created = 0; let examined = 0;
  for (const c of ctx.di.pending) {
    if (created >= ctx.limits.newDataInclusion || examined >= ctx.limits.examineDataInclusion || ctx.halted() || !(await beat(ctx, { done: examined, total: Math.min(ctx.di.pending.length, ctx.limits.examineDataInclusion), current: c.places[0].nom }))) break;
    examined += 1;
    const skip = (why) => { sum.skipped[why] = (sum.skipped[why] || 0) + 1; ctx.di.examined.add(c.key); count(ctx, 'datainclusion:skipped'); };
    if ((await ctx.db.execute(sql`SELECT 1 FROM "Structure" WHERE siret = ${c.siret} LIMIT 1`)).rows.length) { skip('déjà listé'); continue; }
    let s;
    try { s = await lookupSiret(c.siret, ctx.net); sireneStat(ctx, true); } catch (e) { sireneStat(ctx, false, e); count(ctx, 'datainclusion:later'); continue; }   // an outage: examined again
    const pl = c.places[0];
    if (!s?.found) { skip('SIRET inconnu du répertoire SIRENE'); continue; }
    if (!s.open) { skip('établissement fermé selon SIRENE'); continue; }
    if (/^1/.test(String(s.legalForm || ''))) { skip('entrepreneur individuel (une personne)'); continue; }
    if (s.postalCode && digits(s.postalCode).slice(0, 5) !== digits(pl.code_postal).slice(0, 5)) { skip('adresse SIRENE dans une autre commune'); continue; }
    if (!String(s.postalCode || pl.code_postal || '').startsWith(ctx.departement)) { skip('hors du département'); continue; }
    const v = servicesValue({ version, placeList: c.places, servicesOf: r.servicesOf, created: true });
    const id = crypto.randomUUID();
    await ctx.db.insert(Structure).values({ id, nom: pl.nom, slug: `${slugify(pl.nom)}-${id.slice(0, 8)}`, adresse: pl.adresse, code_postal: pl.code_postal, ville: pl.commune, siret: c.siret,
      departement: ctx.departement, latitude: pl.latitude, longitude: pl.longitude, data_origin: 'official', statut: 'brouillon', services: [], publics_accueillis: [], categories_aidees: v.categories,
      insee_codes: pl.code_insee ? [pl.code_insee] : [], department_codes: [ctx.departement], services_externes: v, updatedBy: SYSTEM_REVIEWER.id, updatedAt: new Date() });
    ctx.di.examined.add(c.key); created += 1; sum.created += 1;
    const [row] = await ctx.db.select().from(Structure).where(eq(Structure.id, id));
    await checkStructureRecord(ctx, 'structure', row);
    const [after] = await ctx.db.select({ statut: Structure.statut, v: Structure.verification_status, hold: Structure.publication_hold }).from(Structure).where(eq(Structure.id, id));
    const ok = after?.statut === 'actif' && after?.v === 'VERIFIED' && !after?.hold;
    const producers = [...new Set(c.places.map((p) => producerOf(p.source).label))].join(', ');
    await note(ctx, { entityType: 'structure', entityId: id, title: pl.nom, kind: 'NEW_RECORD', outcome: ok ? 'CREATED' : 'UNRESOLVED',
      summary: ok ? `Ajoutée automatiquement : lieu listé par data·inclusion (${producers}), identité confirmée par le répertoire SIRENE ; ${v.services.length} service(s) attribué(s) à leurs producteurs.`
        : `Lieu listé par data·inclusion (${producers}) ajouté hors ligne : la vérification officielle ne l’a pas confirmé (voir la ligne précédente).`, details: { siret: c.siret, places: c.places.map((p) => p.id) } });
  }
  sum.examined = [...ctx.di.examined];
  if (ctx.di.pending.length > examined) count(ctx, 'datainclusion:later', ctx.di.pending.length - examined);
}

// ------------------------------------------------------------------------------------------------------------------------------- growth
const slugify = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

/** the public offices of the département not yet in the directory (a capped number per run, the whole Annuaire within a few runs) */
async function feedOffices(ctx) {
  if (!ctx.offices.length || ctx.halted()) return;
  await beat(ctx, { phase: 'nouveaux services publics', current: null }, true);
  const known = new Set((await ctx.db.execute(sql`SELECT source_annuaire FROM "Structure" WHERE source_annuaire IS NOT NULL`)).rows.map((r) => r.source_annuaire));
  const fresh = ctx.offices.filter((o) => !known.has(o.annuaireId) && o.nom && o.code_postal && o.evidenceUrl);
  let created = 0;
  for (const o of fresh) {
    if (created >= ctx.limits.newOffices || ctx.halted() || !(await beat(ctx, { done: created, total: Math.min(fresh.length, ctx.limits.newOffices), current: o.nom }))) break;
    const t = officeTexts(o);
    const id = crypto.randomUUID();
    const tier = tierOf('ANNUAIRE', null);
    // the SIRET the Annuaire gives, unless another record already holds it (then the duplicate register decides; the next check does not « correct » it again)
    const siretFree = o.siret && !(await ctx.db.execute(sql`SELECT 1 FROM "Structure" WHERE siret = ${o.siret} LIMIT 1`)).rows.length;
    await ctx.db.insert(Structure).values({ id, nom: o.nom, slug: `${slugify(o.nom)}-${id.slice(0, 8)}`, type_structure: o.kind.label, adresse: o.adresse, code_postal: o.code_postal, ville: o.ville, ...(siretFree ? { siret: o.siret } : {}),
      departement: ctx.departement, telephone: o.telephone, email: publicEmail(null, o.email), site_web: o.site_web, horaires: o.horaires, latitude: o.latitude, longitude: o.longitude, source_annuaire: o.annuaireId,
      source_url: o.evidenceUrl, source_url_exact: o.evidenceUrl, data_origin: 'official', statut: 'brouillon', description_courte: t.resume, summary_falc: t.falc.join('\n'), falc_origin: 'DETERMINISTIC',
      services: [], publics_accueillis: [], categories_aidees: [o.kind.categorie], insee_codes: o.insee ? [o.insee] : [], department_codes: [ctx.departement], last_checked_at: ctx.now(),
      auto_check: { checkedAt: ctx.now().toISOString(), runId: ctx.runId, identity: 'PUBLIC_OFFICE', sources: [{ kind: 'ANNUAIRE', url: o.evidenceUrl, updatedAt: o.updatedAt }], accessiblePhone: o.accessible, phones: o.telephones,
        contactForm: o.formulaire, tier: tier.tier, nextCheckAt: nextAt(ctx, tier) },
      updatedBy: SYSTEM_REVIEWER.id, updatedAt: new Date() });
    const evidence = `Vérification automatique du ${frDay(day(ctx.now()))} : Annuaire de l'administration (DILA), fiche « ${o.nom} » mise à jour le ${frDay(day(o.updatedAt)) || 'non précisé'} (adresse, téléphones et horaires repris de l'Annuaire).`;
    const r = await recordVerification({ entityType: 'structure', entityId: id, action: 'VERIFY', reviewer: SYSTEM_REVIEWER, sourceUrl: o.evidenceUrl, evidenceNote: evidence, territoryConfirmed: true }, { db: ctx.db, env: ctx.env, trustedDomains: ctx.trusted });
    if (r.ok) await ctx.db.update(Structure).set({ statut: 'actif', published_at: new Date() }).where(eq(Structure.id, id));
    created += 1;
    await note(ctx, { entityType: 'structure', entityId: id, title: o.nom, kind: 'NEW_RECORD', outcome: r.ok ? 'CREATED' : 'UNRESOLVED', summary: r.ok ? `Ajoutée automatiquement depuis l'Annuaire de l'administration (${o.kind.label}, ${o.ville || o.code_postal}).` : `Ajoutée mais non publiée (${r.message || r.code}).` });
  }
  if (fresh.length > created) count(ctx, 'offices:later', fresh.length - created);
}

/** Service-Public fiches of the social themes, not yet in the catalogue (a few per run: each needs its texts written and checked) */
const SOCIAL_PATH = /aides? (personnelles )?au logement|logement social|h[ée]bergement|handicap|personnes [âa]g[ée]es|autonomie|\bRSA\b|revenu de solidarit[ée]|prime d.activit[ée]|minima sociaux|compl[ée]mentaire sant[ée]|aide m[ée]dicale|protection sociale|prestations familiales|allocations familiales|garde d.enfant|naissance|ch[ôo]mage|insertion|surendettement|microcr[ée]dit|aide juridictionnelle|victime|titre de s[ée]jour|asile|ch[èe]que [ée]nergie|pr[ée]carit[ée]|aide sociale|retraite/i;
const AIDE_TITLE = /^(aides?|allocation|prime|revenu|prestation|compl[ée]ment|compl[ée]mentaire|ch[èe]que|bourse|carte|pass\b|indemni|fonds|microcr[ée]dit|tarif|r[ée]duction|majoration|cong[ée])/i;
/** a programme rather than a benefit or a procedure (« Contrat d'engagement jeune », « Service civique », « Parcours emploi compétences »…) */
const DISPOSITIF_TITLE = /^(contrat d.engagement|contrat d.insertion|parcours|service civique|garantie|dispositif|programme|accompagnement)/i;
const CATEGORY = [[/handicap/i, 'handicap'], [/personnes [âa]g[ée]es|autonomie|retraite/i, 'personnes-agees'], [/^Logement/i, 'logement'], [/^Social - Sant[ée]/i, 'social-sante'], [/^Famille/i, 'famille'],
  [/^Travail/i, 'travail-formation'], [/^Argent/i, 'argent'], [/^Justice/i, 'justice'], [/^[ÉE]tranger/i, 'etranger'], [/^Papiers/i, 'papiers-citoyennete'], [/^Transports/i, 'transports'], [/^Loisirs/i, 'loisirs']];
const categoryOf = (meta) => { const p = meta.path.map((x) => x.title).join(' > '); for (const [re, c] of CATEGORY) if (re.test(p) || re.test(meta.subject || '')) return c; return 'social-sante'; };

async function feedFiches(ctx) {
  if (!ctx.archive || ctx.halted()) return;
  const may = await textsAllowed(ctx); if (!may.ok) return;
  await beat(ctx, { phase: 'nouvelles fiches', current: null }, true);
  const linked = new Set();
  for (const t of ['Aide', 'Demarche', 'Dispositif']) for (const r of (await ctx.db.execute(sql`SELECT source_url FROM ${sql.raw(`"${t}"`)} WHERE source_url IS NOT NULL`)).rows) { const m = String(r.source_url).match(SP_ID); if (m) linked.add(resolveId(m[1].toUpperCase(), ctx.archive.redirections)); }
  const failed = new Set((await ctx.db.execute(sql`SELECT "entity_id" FROM "VeilleEvent" WHERE kind = 'TEXTS' AND outcome = 'RETRY' AND entity_type = 'fiche' AND created_at > ${new Date(Date.now() - 30 * 86400000).toISOString()} GROUP BY 1 HAVING count(*) >= 3`)).rows.map((r) => r.entity_id));
  const candidates = ctx.metas.filter((m) => /Fiche d'information/.test(m.kind || '') && !linked.has(m.id) && !failed.has(m.id) && OUR_COVERAGE.test(String(m.coverage || '')) && SOCIAL_PATH.test(`${m.path.map((x) => x.title).join(' ')} ${m.title}`))
    .sort((a, b) => String(b.importantChangeAt || '').localeCompare(String(a.importantChangeAt || '')));
  let created = 0;
  for (const meta of candidates) {
    if (created >= ctx.limits.newFiches || ctx.halted() || !(await beat(ctx, { done: created, total: Math.min(candidates.length, ctx.limits.newFiches), current: meta.title }))) break;
    if (!(await textsAllowed(ctx)).ok) break;
    const src = readSource(meta.id, ctx.archive); if (!src) continue;
    const kind = DISPOSITIF_TITLE.test(meta.title) ? 'dispositif' : AIDE_TITLE.test(meta.title) ? 'aide' : 'demarche';
    ctx.modelUsed = true;
    const t = await writeTexts(src, { generate: ctx.generate, modelOptions: ctx.modelOptions, beat: () => beat(ctx) });
    if (!t.ok) { count(ctx, 'texts:refused'); await note(ctx, { entityType: 'fiche', entityId: meta.id, title: meta.title, kind: 'TEXTS', outcome: 'RETRY', summary: `Nouvelle fiche « ${meta.title} » pas encore ajoutée : textes refusés par le contrôle automatique.`, details: { reasons: t.reasons } }); continue; }
    const id = crypto.randomUUID(); const table = TABLES[kind];
    const patch = textPatch(kind, t, src);
    const tier = tierOf('DILA', src);
    const auto = { checkedAt: ctx.now().toISOString(), runId: ctx.runId, origin: 'DILA', sourceUrl: src.url, sourceTitle: src.title, sourceId: meta.id, importantChangeAt: src.importantChangeAt || null, coverage: src.coverage || null,
      legal: (src.references || []).slice(0, 6), authority: { sourceId: 'dila-service-public', level: 'NATIONAL' }, tier: tier.tier, nextCheckAt: nextAt(ctx, tier),
      texts: { at: ctx.now().toISOString(), model: t.model, sourceFingerprint: src.fingerprint, sourceMark: sourceMark(src, 'DILA'), checks: t.checks, attempts: t.attempts, ms: t.ms }, created: true };
    const common = { id, titre: meta.title, slug: `${slugify(meta.title)}-${id.slice(0, 6)}`, ...patch, source_url: src.url, source_url_exact: src.url, data_origin: 'official', statut: 'brouillon',
      auto_check: auto, last_checked_at: ctx.now(), source_last_modified: src.importantChangeAt ? new Date(src.importantChangeAt) : null, updatedAt: new Date() };
    if (kind === 'dispositif') await ctx.db.insert(table).values({ ...common, public: [] });
    else await ctx.db.insert(table).values({ ...common, categorie: categoryOf(meta), department_codes: [], updatedBy: SYSTEM_REVIEWER.id,
      ...(kind === 'aide' ? { source_name: 'Service-Public.gouv.fr', source_org: 'DILA', externalId: `dila:${meta.id}`, theme: meta.subject || null } : {}) });
    await saveSnapshot(ctx.db, kind, id, src, src.url);
    const evidence = `Vérification automatique du ${frDay(day(ctx.now()))} : fiche ${meta.id} « ${src.title} » du flux officiel Service-Public (DILA, archive du ${frDay(ctx.archive.builtAt)}), dernière modification importante le ${frDay(src.importantChangeAt) || 'non précisée'} ; résumé et version FALC rédigés à partir de cette fiche et contrôlés automatiquement.`;
    const r = await recordVerification({ entityType: kind, entityId: id, action: 'VERIFY', reviewer: SYSTEM_REVIEWER, sourceUrl: src.url, evidenceNote: evidence, territoryConfirmed: true }, { db: ctx.db, env: ctx.env, trustedDomains: ctx.trusted });
    if (r.ok) await ctx.db.update(table).set({ statut: 'publie', published_at: new Date() }).where(eq(table.id, id));
    created += 1;
    await note(ctx, { entityType: kind, entityId: id, title: meta.title, kind: 'NEW_RECORD', outcome: r.ok ? 'CREATED' : 'UNRESOLVED', summary: r.ok ? `Ajoutée automatiquement depuis Service-Public (fiche ${meta.id}, ${kind === 'dispositif' ? 'dispositif' : categoryOf(meta)}).` : `Ajoutée mais non publiée (${r.message || r.code}).` });
  }
  count(ctx, 'fiches:candidates', candidates.length);
}

// ------------------------------------------------------------------------------------------------------------------------------- self-check
/** the D-5 v2 contract on everything public (audit.js); what breaks it on ledger, evidence or privacy is withdrawn at once */
async function selfCheck(ctx) {
  await beat(ctx, { phase: 'contrôle de cohérence', current: null }, true);
  const a = await publicationAudit({ db: ctx.db, env: ctx.env, trusted: ctx.trusted, now: ctx.now(), select: ctx.select });
  let withdrawn = 0;
  for (const v of a.violations.filter((x) => WITHDRAW_ON.has(x.code))) {
    // R14: only a privacy breach is withdrawn beyond the night's cap; a retired evidence host or a texts rule can hit many records at once (a source fault)
    const out = await withdraw(ctx, v.kind, { id: v.id }, `contrôle de cohérence : ${v.detail}`, { force: v.code === 'PRIVACY' });
    if (out.ok && !out.already) withdrawn += 1;
    await note(ctx, { entityType: v.kind, entityId: v.id, title: v.title, kind: 'AUDIT', outcome: out.ok && !out.already ? 'WITHDRAWN' : 'UNRESOLVED', summary: `Contrôle de cohérence (${v.code}) : ${v.detail}. Retirée jusqu’à une nouvelle vérification.` });
  }
  const counts = a.violations.reduce((m, v) => ({ ...m, [v.code]: (m[v.code] || 0) + 1 }), {});
  ctx.audit = { at: new Date().toISOString(), checked: a.checked, byKind: a.byKind, violations: a.violations.length, byCode: counts, withdrawn, sample: a.violations.slice(0, 20) };
  if (counts.FRESHNESS) ctx.alerts.push({ code: 'FRESHNESS', level: 'warning', message: `${counts.FRESHNESS} fiche(s) publiée(s) pas revérifiée(s) à temps : la veille n’a pas pu tourner normalement.` });
  if (counts.DUPLICATE) ctx.alerts.push({ code: 'DUPLICATES', level: 'info', message: `${counts.DUPLICATE} doublon(s) possible(s) entre fiches publiées (même SIRET ou même fiche de l’Annuaire) : le registre des doublons les traitera.` });
  if (withdrawn) ctx.alerts.push({ code: 'AUDIT_WITHDRAWALS', level: 'warning', message: `${withdrawn} fiche(s) retirée(s) par le contrôle de cohérence (décision manquante, preuve hors source officielle ou donnée personnelle).` });
}
