#!/usr/bin/env node
/**
 * R45 (sec, ENG-LR-8) — validator of the personal-data breach register (GDPR art. 33(5)), format docs/security/incident-register.schema.json.
 * The REAL register is kept OUTSIDE this public repository (CONTROL/r45/R45_REGISTRE_VIOLATIONS_FORMAT_FR.md § 3); this script only reads the file it is given.
 *
 * Checks, per entry: the required fields of the schema; enumerations; ISO dates with an explicit offset; the 72 h clock (notificationDeadline = awarenessAt
 * + 72 h, awareness not before detection); the severity × likelihood matrix (a different level needs a written reason); the seven EDPB 9/2022 criteria;
 * the CNIL decision (a breach with a risk must be notified; « not notified » needs a documented reason; a late notification needs the reasons for the delay;
 * a deadline passed while still « pending » is an error); the data-subject decision (high risk → informed, or an art. 34(3) ground with its reason);
 * closure completeness; no e-mail address / phone number / IBAN in any text (only reserved example domains); exercise files contain only synthetic entries.
 *
 * Output: codes and JSON paths only — never the text of a field. Usage:
 *   node scripts/incident-register-validate.mjs <register.json> [--now=2026-11-05T12:00:00Z] [--json]
 * Exit: 0 valid (warnings allowed) · 1 errors · 2 unreadable file / usage.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isMainModule } from './lib/is-main.mjs';

export const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'security', 'incident-register.schema.json');
export const DEADLINE_HOURS = 72;
const H = 3600_000;

export const ENUMS = Object.freeze({
  status: ['open', 'contained', 'closed'],
  channel: ['health_alert', 'sentry', 'mail_bounce_burst', 'mail_events_refused', 'provider_notice', 'user_report', 'structure_report', 'staff', 'security_researcher', 'authority', 'other'],
  nature: ['confidentiality', 'integrity', 'availability'],
  cause: ['internal_malicious', 'internal_accidental', 'external_malicious', 'external_accidental', 'unknown'],
  special: ['health', 'racial_ethnic_origin', 'political', 'religious_philosophical', 'trade_union', 'sex_life_orientation', 'biometric', 'genetic', 'offences'],
  level: ['unlikely', 'risk', 'high'],
  processor: ['Vercel', 'Neon', 'Upstash', 'Mailjet', 'Sentry', 'GitHub', 'other'],
  cnilDecision: ['notified', 'not_notified', 'pending'],
  cnilType: ['complete', 'initial', 'complementary'],
  subjectsDecision: ['informed', 'will_inform', 'not_informed', 'pending'],
  ground: ['not_high_risk', 'art34_3_a_unintelligible', 'art34_3_b_subsequent_measures', 'art34_3_c_public_communication'],
});
/** EDPB Guidelines 9/2022 v2.0 §§ 105–118 — one note each */
export const EDPB_FACTORS = Object.freeze(['typeOfBreach', 'natureSensitivityVolume', 'easeOfIdentification', 'severityOfConsequences', 'specialCharacteristicsOfIndividuals',
  'specialCharacteristicsOfController', 'numberOfIndividuals']);

/** The matrix (CONTROL/r45/R45_REGISTRE_VIOLATIONS_FORMAT_FR.md § 2.3): a negligible severity or likelihood → unlikely; both ≥ 3 (importante) → high; otherwise risk. */
export function riskFromMatrix(severity, likelihood) {
  if (severity === 1 || likelihood === 1) return 'unlikely';
  if (severity >= 3 && likelihood >= 3) return 'high';
  return 'risk';
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
/** @param {unknown} v @returns {number | null} */
export const isoMs = (v) => (typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);
export const deadlineOf = (/** @type {string} */ awarenessAt) => { const t = isoMs(awarenessAt); return t === null ? null : new Date(t + DEADLINE_HOURS * H).toISOString(); };

// personal-data patterns: real-looking e-mail addresses (reserved example domains allowed), French phone numbers, IBANs
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const RESERVED_DOMAIN = /@([A-Za-z0-9-]+\.)*(example\.(test|org|com|net)|[A-Za-z0-9-]+\.(test|invalid|example|localhost))$/i;
const PHONE = /(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/;

/** @param {unknown} node @param {string} path @param {(path: string) => void} hit */
function scanText(node, path, hit) {
  if (typeof node === 'string') {
    const mails = node.match(EMAIL) || [];
    if (mails.some((m) => !RESERVED_DOMAIN.test(m)) || PHONE.test(node) || IBAN.test(node)) hit(path);
  } else if (Array.isArray(node)) node.forEach((v, i) => scanText(v, `${path}[${i}]`, hit));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) scanText(v, `${path}.${k}`, hit);
}

/** @returns {{ top: string[], entry: string[] }} required field lists, read from the JSON schema (single source) */
export function requiredFields(schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))) {
  return { top: schema.required, entry: schema.$defs.entry.required };
}

const text = (v, min) => typeof v === 'string' && v.trim().length >= min;

/**
 * @param {any} register parsed JSON
 * @param {{ now?: Date | string, schema?: any }} [options]
 * @returns {{ ok: boolean, entries: number, errors: { id: string, code: string, path: string }[], warnings: { id: string, code: string, path: string }[],
 *   clocks: { id: string, deadline: string | null, hoursLeft: number | null, cnil: string | null }[] }}
 */
export function validateRegister(register, options = {}) {
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const req = requiredFields(options.schema);
  /** @type {{ id: string, code: string, path: string }[]} */ const errors = [];
  /** @type {{ id: string, code: string, path: string }[]} */ const warnings = [];
  /** @type {{ id: string, deadline: string | null, hoursLeft: number | null, cnil: string | null }[]} */ const clocks = [];
  const err = (id, code, path) => errors.push({ id, code, path });
  const warn = (id, code, path) => warnings.push({ id, code, path });

  if (!register || typeof register !== 'object' || Array.isArray(register)) {
    err('-', 'NOT_AN_OBJECT', '$');
    return { ok: false, entries: 0, errors, warnings, clocks };
  }
  for (const k of req.top) if (!(k in register)) err('-', 'MISSING_FIELD', `$.${k}`);
  if (register.schemaVersion !== 1) err('-', 'SCHEMA_VERSION', '$.schemaVersion');
  const syntheticFile = register.register?.synthetic === true;
  for (const k of ['controller', 'keptBy', 'updatedAt']) if (!register.register || !(k in register.register)) err('-', 'MISSING_FIELD', `$.register.${k}`);
  scanText(register.register, '$.register', (p) => err('-', 'PERSONAL_DATA_PATTERN', p));
  const entries = Array.isArray(register.entries) ? register.entries : [];
  if (!Array.isArray(register.entries)) err('-', 'ENTRIES_NOT_ARRAY', '$.entries');
  const seen = new Set();

  entries.forEach((e, i) => {
    const P = `$.entries[${i}]`;
    const id = typeof e?.id === 'string' ? e.id : `#${i}`;
    if (!e || typeof e !== 'object') { err(id, 'ENTRY_NOT_OBJECT', P); return; }
    for (const k of req.entry) if (e[k] === undefined || e[k] === null) err(id, 'MISSING_FIELD', `${P}.${k}`);
    if (!/^(VIO|EXE)-\d{4}-\d{3}$/.test(String(e.id || ''))) err(id, 'BAD_ID', `${P}.id`);
    if (seen.has(e.id)) err(id, 'DUPLICATE_ID', `${P}.id`); seen.add(e.id);
    // exercises: synthetic only, and never mixed with real entries
    if (String(e.id).startsWith('EXE-') && e.synthetic !== true) err(id, 'EXERCISE_NOT_MARKED_SYNTHETIC', `${P}.synthetic`);
    if (e.synthetic === true && !String(e.id).startsWith('EXE-')) err(id, 'SYNTHETIC_ENTRY_WITH_REAL_ID', `${P}.id`);
    if (syntheticFile && e.synthetic !== true) err(id, 'REAL_ENTRY_IN_EXERCISE_FILE', P);
    if (!syntheticFile && e.synthetic === true) warn(id, 'EXERCISE_IN_REAL_REGISTER', P);
    scanText(e, P, (p) => err(id, 'PERSONAL_DATA_PATTERN', p));

    // enumerations
    if (e.status !== undefined && !ENUMS.status.includes(e.status)) err(id, 'BAD_ENUM', `${P}.status`);
    if (e.intake && !ENUMS.channel.includes(e.intake.channel)) err(id, 'BAD_ENUM', `${P}.intake.channel`);
    if (Array.isArray(e.natureOfBreach)) {
      if (!e.natureOfBreach.length) err(id, 'EMPTY_LIST', `${P}.natureOfBreach`);
      e.natureOfBreach.forEach((n, j) => { if (!ENUMS.nature.includes(n)) err(id, 'BAD_ENUM', `${P}.natureOfBreach[${j}]`); });
    }
    if (e.cause !== undefined && !ENUMS.cause.includes(e.cause)) err(id, 'BAD_ENUM', `${P}.cause`);
    if (Array.isArray(e.specialCategories)) e.specialCategories.forEach((n, j) => { if (!ENUMS.special.includes(n)) err(id, 'BAD_ENUM', `${P}.specialCategories[${j}]`); });
    for (const k of ['affectedSystems', 'dataCategories']) if (Array.isArray(e[k]) && !e[k].length) err(id, 'EMPTY_LIST', `${P}.${k}`);
    if (Array.isArray(e.processors)) e.processors.forEach((p, j) => { if (!ENUMS.processor.includes(p?.name)) err(id, 'BAD_ENUM', `${P}.processors[${j}].name`); });

    // dates and the 72 h clock
    const dates = [['detectedAt', e.detectedAt], ['awarenessAt', e.awarenessAt], ['notificationDeadline', e.notificationDeadline], ['intake.receivedAt', e.intake?.receivedAt],
      ['legalAssessment.at', e.legalAssessment?.at], ['controllerDecision.at', e.controllerDecision?.at], ['cnil.notifiedAt', e.cnil?.notifiedAt], ['cnil.complementAt', e.cnil?.complementAt],
      ['dataSubjects.informedAt', e.dataSubjects?.informedAt], ['containment.containedAt', e.containment?.containedAt], ['closure.closedAt', e.closure?.closedAt], ['closure.reviewedAt', e.closure?.reviewedAt]];
    for (const [k, v] of dates) if (v !== undefined && isoMs(v) === null) err(id, 'BAD_DATE', `${P}.${k}`);
    (e.containment?.actions || []).forEach((a, j) => { if (isoMs(a?.at) === null) err(id, 'BAD_DATE', `${P}.containment.actions[${j}].at`); });
    const detected = isoMs(e.detectedAt); const aware = isoMs(e.awarenessAt);
    const deadline = aware === null ? null : aware + DEADLINE_HOURS * H;
    if (aware !== null && isoMs(e.notificationDeadline) !== null && isoMs(e.notificationDeadline) !== deadline) err(id, 'DEADLINE_NOT_72H', `${P}.notificationDeadline`);
    if (detected !== null && aware !== null && aware < detected) err(id, 'AWARENESS_BEFORE_DETECTION', `${P}.awarenessAt`);
    if (detected !== null && aware !== null && aware - detected > 24 * H) warn(id, 'AWARENESS_MORE_THAN_24H_AFTER_DETECTION', `${P}.awarenessAt`);
    if (e.awarenessRationale !== undefined && !text(e.awarenessRationale, 20)) err(id, 'REASON_TOO_SHORT', `${P}.awarenessRationale`);

    if (e.persons && typeof e.persons === 'object') {
      if (!Number.isInteger(e.persons.min) || !Number.isInteger(e.persons.max) || e.persons.min < 0 || e.persons.max < e.persons.min) err(id, 'BAD_PERSON_RANGE', `${P}.persons`);
      if (!text(e.persons.basis, 10)) err(id, 'REASON_TOO_SHORT', `${P}.persons.basis`);
    }

    // risk
    const r = e.risk || {};
    let level = r.level;
    if (e.risk) {
      for (const k of ['severity', 'likelihood']) if (!Number.isInteger(r[k]) || r[k] < 1 || r[k] > 4) err(id, 'BAD_SCALE', `${P}.risk.${k}`);
      if (!ENUMS.level.includes(r.level)) err(id, 'BAD_ENUM', `${P}.risk.level`);
      if (Number.isInteger(r.severity) && Number.isInteger(r.likelihood) && ENUMS.level.includes(r.level) && riskFromMatrix(r.severity, r.likelihood) !== r.level && !text(r.overrideReason, 30))
        err(id, 'RISK_LEVEL_DIFFERS_FROM_MATRIX_WITHOUT_REASON', `${P}.risk.level`);
      for (const f of EDPB_FACTORS) if (!text(r.factors?.[f], 5)) err(id, 'EDPB_FACTOR_MISSING', `${P}.risk.factors.${f}`);
      if (((Array.isArray(e.specialCategories) && e.specialCategories.length) || e.persons?.vulnerable === true) && r.severity === 1) warn(id, 'SENSITIVE_DATA_WITH_NEGLIGIBLE_SEVERITY', `${P}.risk.severity`);
    } else level = undefined;
    const breach = e.legalAssessment?.isPersonalDataBreach;
    if (e.legalAssessment && typeof breach !== 'boolean') err(id, 'MISSING_FIELD', `${P}.legalAssessment.isPersonalDataBreach`);

    // CNIL (art. 33)
    const c = e.cnil || {};
    if (e.cnil) {
      if (!ENUMS.cnilDecision.includes(c.decision)) err(id, 'BAD_ENUM', `${P}.cnil.decision`);
      if (c.decision === 'not_notified' && !text(c.reason, 30)) err(id, 'NOT_NOTIFIED_WITHOUT_REASON', `${P}.cnil.reason`);
      if (c.decision === 'not_notified' && breach !== false && (level === 'risk' || level === 'high')) err(id, 'CNIL_NOTIFICATION_REQUIRED', `${P}.cnil.decision`);
      if (breach === false && c.decision === 'notified') warn(id, 'NOTIFIED_ALTHOUGH_NOT_A_BREACH', `${P}.cnil.decision`);
      if (c.decision === 'notified') {
        const at = isoMs(c.notifiedAt);
        if (at === null) err(id, 'NOTIFIED_WITHOUT_DATE', `${P}.cnil.notifiedAt`);
        if (c.type !== undefined && !ENUMS.cnilType.includes(c.type)) err(id, 'BAD_ENUM', `${P}.cnil.type`);
        if (at !== null && deadline !== null && at > deadline && !text(c.delayReason, 30)) err(id, 'LATE_NOTIFICATION_WITHOUT_REASON', `${P}.cnil.delayReason`);
        if (at !== null && aware !== null && at < aware) err(id, 'NOTIFIED_BEFORE_AWARENESS', `${P}.cnil.notifiedAt`);
        if (c.type === 'initial' && e.status === 'closed' && isoMs(c.complementAt) === null) err(id, 'INITIAL_NOTIFICATION_NEVER_COMPLETED', `${P}.cnil.complementAt`);
      }
      if (c.decision === 'pending' && deadline !== null && level !== 'unlikely') {
        if (now > deadline) err(id, 'DEADLINE_PASSED_WHILE_PENDING', `${P}.cnil.decision`);
        else if (deadline - now < 24 * H) warn(id, 'DEADLINE_WITHIN_24H', `${P}.cnil.decision`);
      }
    }

    // data subjects (art. 34)
    const d = e.dataSubjects || {};
    if (e.dataSubjects) {
      if (!ENUMS.subjectsDecision.includes(d.decision)) err(id, 'BAD_ENUM', `${P}.dataSubjects.decision`);
      if (d.ground !== undefined && !ENUMS.ground.includes(d.ground)) err(id, 'BAD_ENUM', `${P}.dataSubjects.ground`);
      if (d.decision === 'not_informed') {
        if (!d.ground) err(id, 'NOT_INFORMED_WITHOUT_GROUND', `${P}.dataSubjects.ground`);
        if (!text(d.reason, 30)) err(id, 'NOT_INFORMED_WITHOUT_REASON', `${P}.dataSubjects.reason`);
        if (level === 'high' && d.ground === 'not_high_risk') err(id, 'HIGH_RISK_SUBJECTS_MUST_BE_INFORMED', `${P}.dataSubjects.ground`);
        if (d.ground === 'art34_3_c_public_communication' && !text(d.channel, 5)) err(id, 'PUBLIC_COMMUNICATION_WITHOUT_CHANNEL', `${P}.dataSubjects.channel`);
      }
      if (d.decision === 'informed' && isoMs(d.informedAt) === null) err(id, 'INFORMED_WITHOUT_DATE', `${P}.dataSubjects.informedAt`);
      if (d.decision === 'informed' && !text(d.channel, 3)) err(id, 'INFORMED_WITHOUT_CHANNEL', `${P}.dataSubjects.channel`);
    }

    // processors
    (Array.isArray(e.processors) ? e.processors : []).forEach((p, j) => {
      for (const k of ['processorNotifiedUsAt', 'weAskedAt']) if (p?.[k] !== undefined && isoMs(p[k]) === null) err(id, 'BAD_DATE', `${P}.processors[${j}].${k}`);
    });
    if (e.intake?.channel === 'provider_notice' && !(e.processors || []).some((p) => p?.involved && isoMs(p.processorNotifiedUsAt) !== null)) err(id, 'PROVIDER_NOTICE_WITHOUT_PROCESSOR_DATE', `${P}.processors`);

    // closure
    if (e.status === 'closed') {
      if (isoMs(e.closure?.closedAt) === null) err(id, 'CLOSED_WITHOUT_DATE', `${P}.closure.closedAt`);
      if (c.decision === 'pending') err(id, 'CLOSED_WITH_CNIL_PENDING', `${P}.cnil.decision`);
      if (d.decision === 'pending' || d.decision === 'will_inform') err(id, 'CLOSED_WITH_SUBJECTS_PENDING', `${P}.dataSubjects.decision`);
      if (isoMs(e.containment?.containedAt) === null) err(id, 'CLOSED_WITHOUT_CONTAINMENT_DATE', `${P}.containment.containedAt`);
      if ((e.correctiveMeasures || []).some((m) => isoMs(m?.doneAt) === null)) warn(id, 'CLOSED_WITH_OPEN_MEASURES', `${P}.correctiveMeasures`);
      if (isoMs(e.closure?.reviewedAt) === null) warn(id, 'CLOSED_WITHOUT_REVIEW', `${P}.closure.reviewedAt`);
    }
    if (e.evidence && typeof e.evidence.preserved !== 'boolean') err(id, 'MISSING_FIELD', `${P}.evidence.preserved`);
    if (e.evidence?.preserved === false) warn(id, 'EVIDENCE_NOT_PRESERVED', `${P}.evidence.preserved`);

    clocks.push({ id, deadline: deadline === null ? null : new Date(deadline).toISOString(), hoursLeft: deadline === null ? null : Math.round(((deadline - now) / H) * 10) / 10, cnil: typeof c.decision === 'string' ? c.decision : null });
  });
  return { ok: errors.length === 0, entries: entries.length, errors, warnings, clocks };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const nowArg = args.find((a) => a.startsWith('--now='))?.slice('--now='.length);
  if (!file) { console.error('usage: node scripts/incident-register-validate.mjs <register.json> [--now=ISO] [--json]'); process.exit(2); }
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`[incident-register] unreadable or not JSON (${e instanceof Error ? e.name : 'Error'})`); process.exit(2); }
  if (nowArg && Number.isNaN(Date.parse(nowArg))) { console.error('[incident-register] --now is not a date'); process.exit(2); }
  const res = validateRegister(parsed, { now: nowArg });
  if (args.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    console.log(`[incident-register] ${res.ok ? 'VALID' : 'INVALID'} — ${res.entries} entr${res.entries === 1 ? 'y' : 'ies'}, ${res.errors.length} error(s), ${res.warnings.length} warning(s)`);
    for (const x of res.errors) console.log(`  ERROR   ${x.id} ${x.code} ${x.path}`);
    for (const x of res.warnings) console.log(`  WARNING ${x.id} ${x.code} ${x.path}`);
    for (const k of res.clocks) console.log(`  clock   ${k.id} deadline ${k.deadline ?? '?'} (${k.hoursLeft ?? '?'} h left) cnil=${k.cnil ?? '?'}`);
  }
  process.exit(res.ok ? 0 : 1);
}
