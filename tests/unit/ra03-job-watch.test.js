/**
 * RA-03 — every scheduled job leaves a run record, and the health check judges each job on its own.
 * Pure rules and source pins here; the real database run is tests/integration/ra03-cron-run-records-db.test.js.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WATCHED_JOBS, evaluateJob, jobAlert, hoursSince } from '../../api/_services/job-watch.js';
import { countsOnly } from '../../api/_utils/cron-run.js';
import { purgeRunRecord } from '../../api/_handlers/cron/gdpr-purge.js';

const root = path.resolve(import.meta.dirname, '../..');
const crons = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons;
/** the longest gap, in hours, between two runs of a five-field cron expression */
function cronMaxGapHours(expr) {
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  if (dom !== '*' || mon !== '*') throw new Error(`unsupported schedule: ${expr}`);
  const field = (f, max) => { const out = new Set(); for (const part of f.split(',')) { const [range, step] = part.split('/'); const [a, b] = range === '*' ? [0, max] : range.includes('-') ? range.split('-').map(Number) : [Number(range), step ? max : Number(range)];
    for (let v = a; v <= b; v += Number(step || 1)) out.add(v); } return [...out].sort((x, y) => x - y); };
  const days = dow === '*' ? [0, 1, 2, 3, 4, 5, 6] : field(dow, 6); const times = [];
  for (const d of days) for (const hh of field(h, 23)) for (const mm of field(m, 59)) times.push(d * 1440 + hh * 60 + mm);
  times.sort((a, b) => a - b);
  return Math.max(...times.map((t, i) => (i === 0 ? t + 7 * 1440 - times[times.length - 1] : t - times[i - 1]))) / 60;
}

describe('RA-03 watched jobs follow vercel.json', () => {
  it('reads schedules', () => {
    expect(cronMaxGapHours('0 */6 * * *')).toBe(6); expect(cronMaxGapHours('0 3 * * *')).toBe(24); expect(cronMaxGapHours('0 2 * * 0')).toBe(168); expect(cronMaxGapHours('7 * * * *')).toBe(1);
  });
  it('every scheduled job except the health check itself and the veille (own check) is watched, with twice its gap + 1 h', () => {
    const scheduled = crons.map((c) => ({ job: c.path.replace('/api/cron/', ''), gap: cronMaxGapHours(c.schedule) })).filter((c) => !['health-alert', 'veille'].includes(c.job));
    expect(scheduled.map((c) => c.job).sort()).toEqual(Object.keys(WATCHED_JOBS).sort());
    for (const c of scheduled) expect(WATCHED_JOBS[c.job].maxAgeHours, c.job).toBe(2 * c.gap + 1);
  });
  it('every scheduled handler writes a run record', () => {
    for (const c of crons) {
      const src = fs.readFileSync(path.join(root, 'api/_handlers/cron', `${c.path.replace('/api/cron/', '')}.js`), 'utf8');
      expect(/startCronRun\(|insert\(CronRun\)|verification\/chain\.js/.test(src), c.path).toBe(true);
    }
    for (const job of ['gdpr-purge', 'rdv-reminder', 'referral-timeouts', 'health-alert']) {
      const src = fs.readFileSync(path.join(root, 'api/_handlers/cron', `${job}.js`), 'utf8');
      expect(src, job).toMatch(new RegExp(`startCronRun\\((db|defaultDb), '${job}'`)); expect(src, job).toMatch(/finishCronRun\(/);
    }
  });
  it('the referral job is wrapped at the handler: the service is not touched and knows nothing of run records', () => {
    expect(fs.readFileSync(path.join(root, 'api/_services/referrals.js'), 'utf8')).not.toMatch(/CronRun|cron-run/);
  });
});

describe('RA-03 one job, judged alone (pure)', () => {
  const f = (o) => ({ runs: 1, lastGoodAgeHours: null, lastFailedAgeHours: null, ...o });
  it('a fresh good run is OK; an old one is LATE at the job’s own allowance', () => {
    expect(evaluateJob({ job: 'actualites', named: true, facts: f({ lastGoodAgeHours: 5 }) })).toMatchObject({ ok: true, state: 'OK', alert: null });
    expect(evaluateJob({ job: 'actualites', named: true, facts: f({ lastGoodAgeHours: 13 }) })).toMatchObject({ ok: false, state: 'LATE', alert: 'stale', maxAgeHours: 13 });
    expect(evaluateJob({ job: 'ingest-structures', named: true, facts: f({ lastGoodAgeHours: 200 }) })).toMatchObject({ ok: true, state: 'OK' });   // weekly: 200 h is normal
    expect(evaluateJob({ job: 'ingest-structures', named: true, facts: f({ lastGoodAgeHours: 480 }) })).toMatchObject({ ok: false, state: 'LATE' });   // 20 days
  });
  it('a failed newest run is FAILED even when an older good run is still fresh; a good run after a failure clears it', () => {
    expect(evaluateJob({ job: 'ingest-aids', named: true, facts: f({ lastGoodAgeHours: 30, lastFailedAgeHours: 6 }) })).toMatchObject({ ok: false, state: 'FAILED', alert: 'failed' });
    expect(evaluateJob({ job: 'ingest-aids', named: true, facts: f({ lastGoodAgeHours: 6, lastFailedAgeHours: 30 }) })).toMatchObject({ ok: true, state: 'OK' });
    expect(evaluateJob({ job: 'ingest-aids', named: false, facts: f({ lastFailedAgeHours: 300 }) })).toMatchObject({ ok: false, state: 'FAILED' });
  });
  it('no run at all: opened by name → awaiting, then MISSING after the allowance; not named (beta lifted) → not a failure (R8)', () => {
    const none = { runs: 0, lastGoodAgeHours: null, lastFailedAgeHours: null };
    expect(evaluateJob({ job: 'rdv-reminder', named: true, facts: none, firstExpectedAgeHours: 0 })).toMatchObject({ ok: true, state: 'AWAITING_FIRST_RUN' });
    expect(evaluateJob({ job: 'rdv-reminder', named: true, facts: none, firstExpectedAgeHours: 48.9 })).toMatchObject({ ok: true, state: 'AWAITING_FIRST_RUN' });
    expect(evaluateJob({ job: 'rdv-reminder', named: true, facts: none, firstExpectedAgeHours: 49 })).toMatchObject({ ok: false, state: 'MISSING', alert: 'stale' });
    expect(evaluateJob({ job: 'rdv-reminder', named: true, facts: none, firstExpectedAgeHours: null })).toMatchObject({ ok: true, state: 'AWAITING_FIRST_RUN' });
    expect(evaluateJob({ job: 'rdv-reminder', named: false, facts: none })).toMatchObject({ ok: true, state: 'NOT_STARTED' });
  });
  it('alerts name the job, in French, with hours and states only', () => {
    const a = jobAlert('ingest-structures', evaluateJob({ job: 'ingest-structures', named: true, facts: f({ lastGoodAgeHours: 480 }) }));
    expect(a).toMatchObject({ name: 'job.stale.ingest-structures', details: { job: 'ingest-structures', state: 'LATE', ageHours: 480, maxAgeHours: 337 } });
    expect(a.message).toMatch(/« ingest-structures » : aucune exécution réussie depuis 480 h/);
    expect(jobAlert('gdpr-purge', evaluateJob({ job: 'gdpr-purge', named: true, facts: f({ lastFailedAgeHours: 1 }) })).name).toBe('job.failed.gdpr-purge');
    expect(jobAlert('gdpr-purge', evaluateJob({ job: 'gdpr-purge', named: true, facts: f({ lastGoodAgeHours: 1 }) }))).toBeNull();
    expect(hoursSince(Date.parse('2031-01-01T00:00:00Z'), Date.parse('2031-01-01T06:00:00Z'))).toBe(6); expect(hoursSince('x')).toBeNull();
  });
});

describe('RA-03 run records hold counts and step ids only', () => {
  it('countsOnly keeps numbers and flags, drops everything else', () => {
    expect(countsOnly({ sent: 3, ok: true, errors: ['rdv 12 for someone@example.test'], who: 'someone@example.test', nested: { a: 1 } })).toEqual({ sent: 3, ok: true });
    expect(countsOnly(null)).toEqual({});
  });
  it('the purge outcome: dry run, dry run with count errors, executed, partial failure, lock held', () => {
    const dry = purgeRunRecord(200, { skipped: true, reason: 'GDPR_PURGE_DISABLED', message: 'x', steps: [{ id: 'unverifiedAccountsDeleted', count: 4, label: 'free text' }, { id: 'b', countsByOption: { A: 1 } }] }, 0);
    expect(dry).toMatchObject({ status: 'success', metrics: { mode: 'dry-run', reason: 'GDPR_PURGE_DISABLED', counts: { unverifiedAccountsDeleted: 4 }, failedSteps: [] } });
    expect(JSON.stringify(dry)).not.toContain('free text');
    expect(purgeRunRecord(200, { skipped: true, reason: 'X', count_errors: ['b'], steps: [] }, 0)).toMatchObject({ status: 'partial', metrics: { countErrors: ['b'] } });
    expect(purgeRunRecord(200, { status: 'success', steps: [{ id: 'a', count: 2 }] }, 0)).toMatchObject({ status: 'success', metrics: { mode: 'execute', outcome: 'success', counts: { a: 2 } } });
    expect(purgeRunRecord(500, { status: 'partial_failure', failed_steps: ['a'], steps: [] }, 0)).toMatchObject({ status: 'partial', error: 'failed steps: a', metrics: { failedSteps: ['a'] } });
    expect(purgeRunRecord(409, { skipped: true, reason: 'ALREADY_RUNNING' }, 0)).toEqual({ status: 'skipped', skipReason: 'ALREADY_RUNNING', startedAtMs: 0 });
  });
});
