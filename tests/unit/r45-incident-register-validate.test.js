/**
 * R45 (sec, ENG-LR-8) — the breach-register validator (scripts/incident-register-validate.mjs) on the three SYNTHETIC exercise entries
 * (tests/fixtures/incident-register/exercises-r45.json) and on broken copies of them. No real incident, no personal data.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateRegister, riskFromMatrix, deadlineOf, requiredFields, EDPB_FACTORS, SCHEMA_PATH } from '../../scripts/incident-register-validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'incident-register', 'exercises-r45.json');
const NOW = '2026-11-05T18:00:00+01:00';
const load = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const codes = (res) => res.errors.map((e) => `${e.id}:${e.code}`);
/** a copy of the fixture with entry i changed by fn */
const mutate = (i, fn) => { const r = load(); fn(r.entries[i], r); return r; };

describe('incident register — exercise fixture', () => {
  it('the three synthetic exercises are valid, with their 72 h clocks', () => {
    const res = validateRegister(load(), { now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.entries).toBe(3);
    expect(res.clocks.map((c) => [c.id, c.deadline, c.cnil])).toEqual([
      ['EXE-2026-001', '2026-11-05T10:30:00.000Z', 'not_notified'],
      ['EXE-2026-002', '2026-11-06T12:00:00.000Z', 'notified'],
      ['EXE-2026-003', '2026-11-07T06:15:00.000Z', 'not_notified'],
    ]);
  });

  it('every entry and the file are marked synthetic', () => {
    const r = load();
    expect(r.register.synthetic).toBe(true);
    for (const e of r.entries) { expect(e.synthetic).toBe(true); expect(e.id).toMatch(/^EXE-/); }
  });

  it('the CLI prints codes only and exits 0 / 1 / 2', () => {
    const ok = spawnSync(process.execPath, ['scripts/incident-register-validate.mjs', FIXTURE, `--now=${NOW}`], { cwd: ROOT, encoding: 'utf8' });
    expect(ok.status).toBe(0); expect(ok.stdout).toContain('VALID — 3 entries');
    expect(ok.stdout).not.toContain('EXERCICE :');   // no free text echoed
    const usage = spawnSync(process.execPath, ['scripts/incident-register-validate.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(usage.status).toBe(2);
    const missing = spawnSync(process.execPath, ['scripts/incident-register-validate.mjs', join(ROOT, 'does-not-exist.json')], { cwd: ROOT, encoding: 'utf8' });
    expect(missing.status).toBe(2);
  });
});

describe('incident register — rules', () => {
  it('the deadline is awareness + 72 h exactly; awareness cannot precede detection', () => {
    expect(deadlineOf('2026-11-02T11:30:00+01:00')).toBe('2026-11-05T10:30:00.000Z');
    expect(codes(validateRegister(mutate(0, (e) => { e.notificationDeadline = '2026-11-05T11:30:00.000Z'; }), { now: NOW }))).toContain('EXE-2026-001:DEADLINE_NOT_72H');
    expect(codes(validateRegister(mutate(0, (e) => { e.awarenessAt = '2026-11-02T09:00:00+01:00'; e.notificationDeadline = deadlineOf(e.awarenessAt); }), { now: NOW })))
      .toContain('EXE-2026-001:AWARENESS_BEFORE_DETECTION');
    const late = validateRegister(mutate(0, (e) => { e.awarenessAt = '2026-11-03T12:00:00+01:00'; e.notificationDeadline = deadlineOf(e.awarenessAt); }), { now: NOW });
    expect(late.warnings.map((w) => w.code)).toContain('AWARENESS_MORE_THAN_24H_AFTER_DETECTION');
  });

  it('dates need an explicit offset', () => {
    expect(codes(validateRegister(mutate(0, (e) => { e.detectedAt = '2026-11-02 10:05'; }), { now: NOW }))).toContain('EXE-2026-001:BAD_DATE');
    expect(codes(validateRegister(mutate(0, (e) => { e.detectedAt = '2026-11-02T10:05:00'; }), { now: NOW }))).toContain('EXE-2026-001:BAD_DATE');
  });

  it('risk matrix: negligible → unlikely, both ≥ 3 → high, otherwise risk; a different level needs a reason', () => {
    expect([riskFromMatrix(1, 4), riskFromMatrix(4, 1), riskFromMatrix(2, 2), riskFromMatrix(3, 2), riskFromMatrix(3, 3), riskFromMatrix(4, 4)]).toEqual(['unlikely', 'unlikely', 'risk', 'risk', 'high', 'high']);
    const bad = mutate(1, (e) => { e.risk.level = 'risk'; });
    expect(codes(validateRegister(bad, { now: NOW }))).toContain('EXE-2026-002:RISK_LEVEL_DIFFERS_FROM_MATRIX_WITHOUT_REASON');
    const justified = mutate(2, (e) => { e.risk.likelihood = 2; e.risk.overrideReason = 'EXERCICE : restauration PITR vérifiée, aucune donnée perdue, panne courte.'; });
    expect(validateRegister(justified, { now: NOW }).errors).toEqual([]);
  });

  it('each of the seven EDPB 9/2022 criteria is documented', () => {
    expect(EDPB_FACTORS).toHaveLength(7);
    expect(codes(validateRegister(mutate(1, (e) => { delete e.risk.factors.easeOfIdentification; }), { now: NOW }))).toContain('EXE-2026-002:EDPB_FACTOR_MISSING');
  });

  it('« not notified » needs a documented reason, and is refused when the risk is not « unlikely »', () => {
    expect(codes(validateRegister(mutate(0, (e) => { e.cnil.reason = 'trop court'; }), { now: NOW }))).toContain('EXE-2026-001:NOT_NOTIFIED_WITHOUT_REASON');
    expect(codes(validateRegister(mutate(0, (e) => { delete e.cnil.reason; }), { now: NOW }))).toContain('EXE-2026-001:NOT_NOTIFIED_WITHOUT_REASON');
    const risky = mutate(0, (e) => { e.risk.severity = 2; e.risk.level = 'risk'; });
    expect(codes(validateRegister(risky, { now: NOW }))).toContain('EXE-2026-001:CNIL_NOTIFICATION_REQUIRED');
    // a security incident that is not a personal-data breach may stay unnotified whatever its technical severity
    const notBreach = mutate(0, (e) => { e.risk.severity = 2; e.risk.level = 'risk'; e.legalAssessment.isPersonalDataBreach = false; });
    expect(codes(validateRegister(notBreach, { now: NOW }))).not.toContain('EXE-2026-001:CNIL_NOTIFICATION_REQUIRED');
  });

  it('a late notification needs the reasons for the delay; « pending » past the deadline is an error, within 24 h a warning', () => {
    const late = mutate(1, (e) => { e.cnil.notifiedAt = '2026-11-06T14:00:00+01:00'; });
    expect(codes(validateRegister(late, { now: NOW }))).toContain('EXE-2026-002:LATE_NOTIFICATION_WITHOUT_REASON');
    const explained = mutate(1, (e) => { e.cnil.notifiedAt = '2026-11-06T14:00:00+01:00'; e.cnil.delayReason = 'EXERCICE : périmètre des dossiers établi seulement après analyse complète des journaux.'; });
    expect(validateRegister(explained, { now: '2026-11-07T00:00:00Z' }).errors).toEqual([]);
    const pending = mutate(1, (e) => { e.cnil = { decision: 'pending' }; });
    expect(validateRegister(pending, { now: '2026-11-06T00:00:00Z' }).warnings.map((w) => w.code)).toContain('DEADLINE_WITHIN_24H');
    expect(codes(validateRegister(pending, { now: '2026-11-06T12:00:01Z' }))).toContain('EXE-2026-002:DEADLINE_PASSED_WHILE_PENDING');
    expect(codes(validateRegister(mutate(1, (e) => { delete e.cnil.notifiedAt; }), { now: NOW }))).toContain('EXE-2026-002:NOTIFIED_WITHOUT_DATE');
  });

  it('high risk: the persons are informed, or an art. 34(3) ground is documented — « not high risk » is refused', () => {
    const refused = mutate(1, (e) => { e.dataSubjects = { decision: 'not_informed', ground: 'not_high_risk', reason: 'EXERCICE : motif quelconque assez long pour passer.' }; });
    expect(codes(validateRegister(refused, { now: NOW }))).toContain('EXE-2026-002:HIGH_RISK_SUBJECTS_MUST_BE_INFORMED');
    const encrypted = mutate(1, (e) => { e.dataSubjects = { decision: 'not_informed', ground: 'art34_3_a_unintelligible', reason: 'EXERCICE : données chiffrées, clé non compromise (preuve jointe).' }; });
    expect(validateRegister(encrypted, { now: NOW }).errors).toEqual([]);
    const pub = mutate(1, (e) => { e.dataSubjects = { decision: 'not_informed', ground: 'art34_3_c_public_communication', reason: 'EXERCICE : coordonnées inconnues pour la plupart des personnes.' }; });
    expect(codes(validateRegister(pub, { now: NOW }))).toContain('EXE-2026-002:PUBLIC_COMMUNICATION_WITHOUT_CHANNEL');
    expect(codes(validateRegister(mutate(0, (e) => { delete e.dataSubjects.ground; }), { now: NOW }))).toContain('EXE-2026-001:NOT_INFORMED_WITHOUT_GROUND');
    expect(codes(validateRegister(mutate(1, (e) => { e.dataSubjects = { decision: 'informed' }; }), { now: NOW }))).toEqual(expect.arrayContaining(['EXE-2026-002:INFORMED_WITHOUT_DATE', 'EXE-2026-002:INFORMED_WITHOUT_CHANNEL']));
  });

  it('closing needs a closure date, final decisions, a containment date and a completed initial notification', () => {
    const closed = mutate(1, (e) => { e.status = 'closed'; });
    expect(codes(validateRegister(closed, { now: NOW }))).toEqual(expect.arrayContaining(['EXE-2026-002:CLOSED_WITHOUT_DATE', 'EXE-2026-002:CLOSED_WITH_SUBJECTS_PENDING', 'EXE-2026-002:INITIAL_NOTIFICATION_NEVER_COMPLETED']));
    expect(codes(validateRegister(mutate(0, (e) => { delete e.containment.containedAt; }), { now: NOW }))).toContain('EXE-2026-001:CLOSED_WITHOUT_CONTAINMENT_DATE');
  });

  it('a provider notice records when the processor told us', () => {
    expect(codes(validateRegister(mutate(2, (e) => { delete e.processors[0].processorNotifiedUsAt; }), { now: NOW }))).toContain('EXE-2026-003:PROVIDER_NOTICE_WITHOUT_PROCESSOR_DATE');
  });

  it('no e-mail address, phone number or IBAN in any text (reserved example domains allowed); the error names the path, never the value', () => {
    const email = mutate(0, (e) => { e.containment.actions[0].action = 'écrit à jean.dupont@gmail.com'; });
    const res = validateRegister(email, { now: NOW });
    expect(res.errors).toEqual([{ id: 'EXE-2026-001', code: 'PERSONAL_DATA_PATTERN', path: '$.entries[0].containment.actions[0].action' }]);
    expect(JSON.stringify(res)).not.toContain('gmail');
    expect(codes(validateRegister(mutate(0, (e) => { e.awarenessRationale = 'appel reçu du 06 12 34 56 78 confirmant le signalement'; }), { now: NOW }))).toContain('EXE-2026-001:PERSONAL_DATA_PATTERN');
    expect(codes(validateRegister(mutate(0, (e) => { e.awarenessRationale = 'virement sur FR76 3000 6000 0112 3456 7890 189 signalé'; }), { now: NOW }))).toContain('EXE-2026-001:PERSONAL_DATA_PATTERN');
    expect(validateRegister(mutate(0, (e) => { e.awarenessRationale = 'EXERCICE : compte test.citizen+r45@example.test concerné'; }), { now: NOW }).errors).toEqual([]);
  });

  it('exercise files hold synthetic entries only; synthetic entries never carry a real id', () => {
    expect(codes(validateRegister(mutate(0, (e) => { e.synthetic = false; }), { now: NOW }))).toEqual(expect.arrayContaining(['EXE-2026-001:EXERCISE_NOT_MARKED_SYNTHETIC', 'EXE-2026-001:REAL_ENTRY_IN_EXERCISE_FILE']));
    expect(codes(validateRegister(mutate(0, (e) => { e.id = 'VIO-2026-001'; }), { now: NOW }))).toContain('VIO-2026-001:SYNTHETIC_ENTRY_WITH_REAL_ID');
    expect(codes(validateRegister(mutate(1, (e) => { e.id = 'EXE-2026-001'; }), { now: NOW }))).toContain('EXE-2026-001:DUPLICATE_ID');
  });

  it('required fields come from the JSON schema (one source of truth); a missing one is reported', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const req = requiredFields(schema);
    expect(req.entry).toEqual(expect.arrayContaining(['awarenessAt', 'notificationDeadline', 'cnil', 'dataSubjects', 'processors', 'evidence', 'containment', 'risk']));
    for (const f of req.entry) expect(schema.$defs.entry.properties[f], f).toBeDefined();
    expect(codes(validateRegister(mutate(2, (e) => { delete e.evidence; }), { now: NOW }))).toContain('EXE-2026-003:MISSING_FIELD');
    expect(validateRegister(null).ok).toBe(false);
    expect(validateRegister({}).errors.map((e) => e.code)).toEqual(expect.arrayContaining(['MISSING_FIELD', 'SCHEMA_VERSION', 'ENTRIES_NOT_ARRAY']));
  });
});
