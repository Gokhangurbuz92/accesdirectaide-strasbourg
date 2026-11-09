// V2 (final data-integrity review, 09/11/2026) — the notice must state what the mechanism does for never-confirmed accounts. Step 6c erases an
// account whose age exceeds UNVERIFIED_ACCOUNT_DAYS at the moment the purge runs; the purge runs once a day. Worst case: created just after a run,
// 7 days old just after the run 7 days later → erased at the next run: just under 8 days. The notice says « no later than 8 days » in 6 languages.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';

const ROOT = path.resolve(__dirname, '../..');
const DAY = 86400000;
const cron = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).crons.find((c) => c.path === '/api/cron/gdpr-purge')?.schedule;
/** the run instants of a « m h * * * » schedule over a window (UTC) */
const runsDaily = (schedule, from, days) => { const [m, h, dom, mon, dow] = schedule.split(' '); expect([dom, mon, dow]).toEqual(['*', '*', '*']);
  const out = []; const d0 = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); for (let i = 0; i <= days; i += 1) out.push(d0 + i * DAY + (+h * 60 + +m) * 60000); return out; };

describe('never-confirmed accounts: worst-case erasure delay vs the notice', () => {
  it('the purge is daily and step 6c uses 7 days → every account is erased in less than 8 days', () => {
    expect(RETENTION_POLICY.durations.UNVERIFIED_ACCOUNT_DAYS.days).toBe(7);
    const keep = RETENTION_POLICY.durations.UNVERIFIED_ACCOUNT_DAYS.days * DAY;
    let worst = 0;
    const from = new Date(Date.UTC(2026, 10, 1));
    const runs = runsDaily(cron, from, 30);
    for (let created = runs[0] - DAY; created < runs[0] + DAY; created += 60000) {   // every minute of a day
      const erasedAt = runs.find((r) => r - created > keep);
      worst = Math.max(worst, erasedAt - created);
    }
    expect(worst).toBeLessThanOrEqual(8 * DAY);   // exactly 8 days at most (created at the run instant: not yet « older than 7 days » at the next run)
    expect(worst).toBeGreaterThan(7 * DAY + 23 * 3600000);   // so « 7 days » alone would be false
  });
  it('the notice states « no later than 8 days » (and no longer « 7 days after ») in the 6 languages', () => {
    const fr = fs.readFileSync(path.join(ROOT, 'src/config/legal-drafts.js'), 'utf8');
    expect(fr).toContain('au plus tard 8 jours après sa création');
    expect(fr).not.toContain('effacé 7 jours après sa création');
    const expected = { en: 'no later than 8 days after its creation', de: 'spätestens 8 Tage nach seiner Erstellung', tr: 'en geç 8 gün sonra', ar: 'في موعد أقصاه 8 أيام', uk: 'не пізніше ніж через 8 днів' };
    for (const [l, needle] of Object.entries(expected)) {
      const t = JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${l}/legaldraft.json`), 'utf8'))['privacyNotice.retention.i2'];
      expect(t, l).toContain(needle);
    }
  });
});
