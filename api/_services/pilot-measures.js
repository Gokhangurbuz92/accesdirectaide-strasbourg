// @ts-nocheck
/**
 * Q14 (R31) — the measurement foundation of the Strasbourg pilot (protocol: docs/pilot/PROTOCOLE_PILOTE.md).
 *
 * Two kinds of figures, never mixed:
 *   1. technical indicators, measured now from the product itself, with no participant: freshness of the verified catalogue, records published but held
 *      back by the D-5 rule, verified news and guides (technicalIndicators);
 *   2. pilot outcomes, only from observed sessions with consenting participants, recorded by a facilitator (recordSession) and reported only as aggregates
 *      with small-number suppression (pilotReport): below K sessions of a journey nothing is shown but the count.
 * No audience tracking is involved (ADR-022): nothing is collected from visitors. A session holds no name or contact, but it is NOT anonymous: participantCode
 * is drawn here and written on the paper consent form that carries the person's name, so the publisher can link the two. Sessions are pseudonymised personal
 * data (GDPR art. 4(5)), and the assistive technology a person uses can reveal a disability, a health data under art. 9. Hence:
 *   - an assistive technology (or a screen-reader difficulty) is recorded only with the person's separate explicit consent (box 3 of the form, art. 9(2)(a));
 *   - the observation describes the site, never the person: contact data and words describing someone's health or disability are refused;
 *   - the session keeps its day, not its time, so it cannot be matched with request logs or a booking sheet;
 *   - outside the product only aggregates leave, every count below K suppressed, difficulty counts included.
 * Until real sessions exist the report says « aucune séance » — no figure is ever produced from nothing.
 */
import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../src/db/index.js';
import { PilotSession } from '../../src/db/schema.js';
import { CURRENT_DAYS, visibleSql } from '../lib/publicVisibility.js';

export const PROTOCOL_VERSION = 'pilote-strasbourg-v1';
export const K = 5;
export const JOURNEYS = {
  J1_AIDE_LOGEMENT: 'Trouver une aide pour payer son loyer et ouvrir sa source officielle',
  J2_DEMARCHE: 'Trouver comment faire une démarche et ce qu’il faut préparer',
  J3_LIEU: 'Trouver un lieu d’accueil proche et ses horaires',
  J4_GUIDE: 'Lire un guide et suivre « Et ensuite ? »',
  J5_ACTUALITE: 'Trouver une actualité récente et sa source',
  J6_ORIENTATION_PRO: 'Professionnel : préparer une sélection d’orientation (espace de test)',
};
export const OUTCOMES = { REUSSI: 'Réussi sans aide', REUSSI_AVEC_AIDE: 'Réussi avec aide', ECHEC: 'Échec', ABANDON: 'Abandon' };
export const ASSISTANCE = { AUCUNE: 'Aucune', INDICE: 'Un indice', PAS_A_PAS: 'Guidage pas à pas' };
export const DEVICES = { ORDINATEUR: 'Ordinateur', TELEPHONE: 'Téléphone', TABLETTE: 'Tablette' };
export const ASSISTIVE = { AUCUNE: 'Aucune', LECTEUR_ECRAN: 'Lecteur d’écran', LOUPE: 'Loupe / zoom', CLAVIER_SEUL: 'Clavier seul', COMMANDE_VOCALE: 'Commande vocale', AUTRE: 'Autre' };
export const A11Y_ISSUES = { CONTRASTE: 'Contraste ou couleurs', TAILLE_TEXTE: 'Taille du texte', CLAVIER: 'Navigation au clavier', LECTEUR_ECRAN: 'Lecteur d’écran', VOCABULAIRE: 'Mots difficiles',
  LONGUEUR: 'Texte trop long', CIBLE_TACTILE: 'Bouton difficile à toucher', ORIENTATION: 'Se perdre dans les pages', AUTRE: 'Autre' };
export const ENVIRONMENTS = { PRODUCTION: 'Site public', LAB: 'Espace de test' };

const bad = (code, message, status = 400) => ({ ok: false, status, code, message });
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PII = [/[^\s@]+@[^\s@]+\.[^\s@]+/, /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/, /\b\d{13,15}\b/];
// words that describe a person's health or disability, not the site (the closed lists already say what was observed on screen)
const HEALTH = /(?<![\p{L}\d])(handicap\p{L}*|malvoyant\p{L}*|non[- ]voyant\p{L}*|aveugles?|malentendant\p{L}*|sourde?s?|dyslexi\p{L}*|dyspraxi\p{L}*|autis\p{L}*|trisomi\p{L}*|épilep\p{L}*|maladies?|malades?|enceinte|dépressi\p{L}*|psychiatri\p{L}*|diabèt\p{L}*|cancers?|vih|séropositi\p{L}*|alzheimer|parkinson|aah|invalidité)(?![\p{L}\d])/iu;
// a value of these fields can reveal a disability: recorded only with the separate explicit consent of art. 9(2)(a)
export const NEEDS_EXPLICIT_CONSENT = (row) => (row.assistiveTech && row.assistiveTech !== 'AUCUNE') || (row.accessibilityIssues || []).includes('LECTEUR_ECRAN');
/** the day of a session (Paris calendar), kept at noon UTC: the time of day is not stored */
export function sessionDay(date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** a participant code for the paper consent form: random, meaningless, not stored until a session is recorded */
export function newParticipantCode() {
  const b = crypto.randomBytes(6);
  return `P-${[...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('')}`;
}

/** Validate one observed session (facilitator input). Refuses a missing consent and anything that looks like contact data. */
export function normalizeSession(input = {}, now = new Date()) {
  if (input.consentRecorded !== true) return bad('CONSENT_REQUIRED', 'Une séance ne s’enregistre qu’après le recueil du consentement écrit de la personne.');
  const participantCode = String(input.participantCode || '').trim().toUpperCase();
  if (!/^P-[A-Z2-9]{6}$/.test(participantCode)) return bad('INVALID_CODE', 'Code participant invalide : utilisez le code tiré par l’outil (P-XXXXXX), jamais un nom.');
  const pick = (value, vocab, field) => (vocab[value] ? value : null) ?? bad('INVALID_FIELD', `Valeur invalide : ${field}.`);
  const journeyCode = pick(input.journeyCode, JOURNEYS, 'parcours'); if (journeyCode.ok === false) return journeyCode;
  const outcome = pick(input.outcome, OUTCOMES, 'résultat'); if (outcome.ok === false) return outcome;
  const assistance = pick(input.assistance, ASSISTANCE, 'aide apportée'); if (assistance.ok === false) return assistance;
  const deviceType = pick(input.deviceType, DEVICES, 'appareil'); if (deviceType.ok === false) return deviceType;
  const environment = ENVIRONMENTS[input.environment] ? input.environment : 'PRODUCTION';
  const assistiveTech = input.assistiveTech && ASSISTIVE[input.assistiveTech] ? input.assistiveTech : null;
  const int = (v, min, max) => (v === '' || v === null || v === undefined ? null : Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : NaN);
  const durationSeconds = int(input.durationSeconds, 1, 7200); const errorCount = int(input.errorCount, 0, 100) ?? 0; const clarity = int(input.clarity, 1, 5);
  if ([durationSeconds, errorCount, clarity].some(Number.isNaN)) return bad('INVALID_NUMBER', 'Durée (1 à 7200 s), erreurs (0 à 100) ou clarté (1 à 5) invalide.');
  const accessibilityIssues = [...new Set((Array.isArray(input.accessibilityIssues) ? input.accessibilityIssues : []).filter((c) => A11Y_ISSUES[c]))];
  const observation = String(input.observation || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (PII.some((re) => re.test(observation))) return bad('CONTACT_DATA', 'L’observation ne doit contenir ni adresse e-mail, ni numéro de téléphone, ni numéro d’identification.');
  if (HEALTH.test(observation)) return bad('HEALTH_DATA', 'L’observation décrit ce qui s’est passé sur le site, jamais la santé, le handicap ou la situation de la personne.');
  if (NEEDS_EXPLICIT_CONSENT({ assistiveTech, accessibilityIssues }) && input.explicitConsent !== true) {
    return bad('EXPLICIT_CONSENT_REQUIRED', 'L’aide technique utilisée (ou une difficulté avec le lecteur d’écran) peut révéler un handicap : elle ne s’enregistre que si la personne a coché l’accord séparé du formulaire. Sinon, choisissez « Aucune » et ne cochez pas « Lecteur d’écran ».');
  }
  const conductedAt = input.conductedAt ? new Date(input.conductedAt) : now;
  if (!Number.isFinite(conductedAt.getTime()) || conductedAt.getTime() > now.getTime() + 3600000) return bad('INVALID_DATE', 'Date de séance invalide.');
  return { ok: true, row: { protocolVersion: PROTOCOL_VERSION, participantCode, journeyCode, environment, deviceType, assistiveTech, outcome, assistance, durationSeconds, errorCount, clarity,
    accessibilityIssues, observation: observation || null, consentRecorded: true, conductedAt: sessionDay(conductedAt) } };
}

export async function recordSession(input, by, db = defaultDb) {
  const n = normalizeSession(input);
  if (n.ok === false) return n;
  const [row] = await db.insert(PilotSession).values({ ...n.row, recordedBy: by }).returning({ id: PilotSession.id });
  return { ok: true, status: 201, id: row.id };
}

/** a mistaken entry, or a participant who withdraws consent: the session is deleted (the paper form names which codes to remove) */
export async function deleteSessions({ id, participantCode } = {}, db = defaultDb) {
  if (id) { const r = await db.delete(PilotSession).where(eq(PilotSession.id, String(id))).returning({ id: PilotSession.id }); return { ok: true, status: 200, deleted: r.length }; }
  const code = String(participantCode || '').trim().toUpperCase();
  if (!/^P-[A-Z2-9]{6}$/.test(code)) return bad('INVALID_CODE', 'Code participant invalide.');
  const r = await db.delete(PilotSession).where(eq(PilotSession.participantCode, code)).returning({ id: PilotSession.id });
  return { ok: true, status: 200, deleted: r.length };
}

const median = (xs) => { const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** Aggregates per journey, suppressed below K sessions. Pure (tested without a database). */
export function aggregate(rows, k = K) {
  const out = [];
  for (const [code, label] of Object.entries(JOURNEYS)) {
    const s = rows.filter((r) => r.journeyCode === code);
    const participants = new Set(s.map((r) => r.participantCode)).size;
    if (s.length < k) { out.push({ journeyCode: code, label, sessions: s.length, participants, suppressed: s.length > 0, reason: s.length ? `moins de ${k} séances : résultats non publiés` : 'aucune séance' }); continue; }
    const count = (o) => s.filter((r) => r.outcome === o).length;
    const clarity = s.map((r) => r.clarity).filter((x) => x !== null && x !== undefined);
    const issues = {};
    for (const r of s) for (const c of r.accessibilityIssues || []) issues[c] = (issues[c] || 0) + 1;
    out.push({ journeyCode: code, label, sessions: s.length, participants, suppressed: false,
      successAlone: pct(count('REUSSI'), s.length), successWithHelp: pct(count('REUSSI_AVEC_AIDE'), s.length), failure: pct(count('ECHEC') + count('ABANDON'), s.length),
      medianDurationSeconds: median(s.map((r) => r.durationSeconds)), medianErrors: median(s.map((r) => r.errorCount)),
      clarity: clarity.length >= k ? { n: clarity.length, mean: Math.round((clarity.reduce((a, b) => a + b, 0) / clarity.length) * 10) / 10 } : null,
      // a difficulty seen in fewer than k sessions is not counted (it could point to one person's assistive technology)
      accessibilityIssues: Object.entries(issues).sort((a, b) => b[1] - a[1]).map(([c, n]) => (n >= k ? { code: c, label: A11Y_ISSUES[c], sessions: n } : { code: c, label: A11Y_ISSUES[c], sessions: null, suppressed: true })) });
  }
  return out;
}

/** Measured now, from the product, with no participant. */
export async function technicalIndicators(db = defaultDb, now = new Date()) {
  const kinds = [['aide', 'Aide', 'Aides'], ['demarche', 'Demarche', 'Démarches'], ['structure', 'Structure', 'Lieux d’accueil'], ['dispositif', 'Dispositif', 'Dispositifs']];
  const catalogue = [];
  for (const [kind, table, label] of kinds) {
    const t = sql.raw(`"${table}"`);
    const [r] = (await db.execute(sql`SELECT count(*) FILTER (WHERE ${visibleSql(kind)})::int AS visible,
        count(*) FILTER (WHERE ${visibleSql(kind)} AND date_verification >= now() - make_interval(days => ${CURRENT_DAYS}))::int AS current,
        count(*) FILTER (WHERE statut IN ('publie', 'actif') AND NOT ${visibleSql(kind)})::int AS held,
        max(EXTRACT(EPOCH FROM (now() - date_verification)) / 86400) FILTER (WHERE ${visibleSql(kind)})::int AS "oldestDays"
      FROM ${t}`)).rows;
    catalogue.push({ kind, label, visible: r.visible, current: r.current, currentShare: pct(r.current, r.visible), heldBack: r.held, oldestVerificationDays: r.oldestDays });
  }
  const [news] = (await db.execute(sql`SELECT count(*) FILTER (WHERE statut = 'publie')::int AS published, count(*) FILTER (WHERE statut <> 'publie')::int AS drafts FROM "Actualite"`)).rows;
  const [guides] = (await db.execute(sql`SELECT count(*) FILTER (WHERE statut = 'publie')::int AS published FROM "Guide"`)).rows;
  return { measuredAt: now.toISOString(), catalogue, news: { published: news.published, keptUnpublished: news.drafts }, guides: { published: guides.published } };
}

export async function pilotReport(db = defaultDb) {
  const rows = await db.select().from(PilotSession).where(eq(PilotSession.protocolVersion, PROTOCOL_VERSION)).orderBy(desc(PilotSession.conductedAt));
  return { ok: true, status: 200, protocolVersion: PROTOCOL_VERSION, k: K, sessions: rows.length, participants: new Set(rows.map((r) => r.participantCode)).size,
    journeys: aggregate(rows), technical: await technicalIndicators(db),
    recent: rows.slice(0, 50).map((r) => ({ id: r.id, participantCode: r.participantCode, journeyCode: r.journeyCode, outcome: r.outcome, conductedAt: r.conductedAt })),
    vocab: { journeys: JOURNEYS, outcomes: OUTCOMES, assistance: ASSISTANCE, devices: DEVICES, assistive: ASSISTIVE, issues: A11Y_ISSUES, environments: ENVIRONMENTS } };
}

/** CSV of the published aggregates only (no session row leaves the product) */
export function aggregatesCsv(journeys) {
  const head = ['parcours', 'seances', 'participants', 'publie', 'reussi_sans_aide_pct', 'reussi_avec_aide_pct', 'echec_ou_abandon_pct', 'duree_mediane_s', 'erreurs_medianes', 'clarte_moyenne'];
  const esc = (v) => (v === null || v === undefined ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head.join(','), ...journeys.map((j) => [j.journeyCode, j.sessions, j.participants, j.suppressed || !j.sessions ? 'non' : 'oui', j.successAlone, j.successWithHelp, j.failure, j.medianDurationSeconds, j.medianErrors, j.clarity?.mean].map(esc).join(','))].join('\n');
}
