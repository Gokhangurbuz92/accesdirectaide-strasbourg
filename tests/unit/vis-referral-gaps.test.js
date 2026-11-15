/**
 * Referral chain gaps (G1 G2 G4): the parts that need no database — one list of « waiting for an answer » states, no new notification/e-mail type, the labels
 * the person and the professionals read for a closed referral, and the new interface strings in every language. The behaviour itself is tested on real
 * PostgreSQL in tests/integration/vis-referral-gaps-db.test.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFERRAL_AWAITING_ANSWER_STATUSES } from '../../api/_utils/share-access.js';
import { CATALOGUE } from '../../api/_services/pro-notifications.js';
import { OUTCOME_LABELS, REFERRAL_STATUS_LABELS } from '../../src/lib/caseLabels.js';
import { TARGET_LANGUAGES } from '../../src/i18n/languages.js';

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('referral chain gaps — static contracts', () => {
  it('G4: one list of states behind « overdue », the overdue notice, the expiry and the access lapse rule', () => {
    expect([...REFERRAL_AWAITING_ANSWER_STATUSES]).toEqual(['SENT', 'ACKNOWLEDGED', 'NEEDS_INFO']);
    expect(Object.isFrozen(REFERRAL_AWAITING_ANSWER_STATUSES)).toBe(true);
    const service = read('api/_services/referrals.js');
    expect(service).toContain('export const AWAITING_ANSWER_STATUSES = REFERRAL_AWAITING_ANSWER_STATUSES;');
    // no second hand-written copy of the list in the cron, in the list query or in the access rule (the transition lists of act() are another matter)
    const cron = service.slice(service.indexOf('export async function runReferralTimeouts'));
    expect(cron.length).toBeGreaterThan(500);
    expect(cron).not.toMatch(/\[\s*'SENT'/);
    expect(cron.match(/AWAITING_ANSWER_STATUSES/g).length).toBeGreaterThanOrEqual(3);
    const list = service.slice(service.indexOf('export async function listBox'), service.indexOf('export async function getReferral'));
    expect(list).toContain('r.status IN (${inList(AWAITING_ANSWER_STATUSES)})) AS overdue');
    const access = read('api/_utils/share-access.js');
    expect(access).not.toMatch(/IN \('SENT'/);
    expect(access.match(/'SENT', 'ACKNOWLEDGED', 'NEEDS_INFO'/g)).toHaveLength(1);
  });

  it('G1 G2: the new notices reuse existing catalogue events (no new e-mail type); the timeout is a number of days, not a claim', async () => {
    const service = read('api/_services/referrals.js');
    const types = [...service.matchAll(/'(referral_[a-z_]+)'/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(10);
    for (const t of types) expect(CATALOGUE[t], t).toBeTruthy();
    expect(Object.keys(CATALOGUE).filter((k) => k.startsWith('referral_'))).toHaveLength(10);
    expect(service).toMatch(/export const PENDING_CITIZEN_EXPIRE_DAYS = \d+;/);
    expect(service).toMatch(/export const ACCEPTED_NO_PROGRESS_DAYS = \d+;/);
  });

  it('G1: a referral closed by the person has a label on both sides (state and outcome)', () => {
    expect(REFERRAL_STATUS_LABELS.CANCELLED).toBeTruthy();
    expect(OUTCOME_LABELS.CITIZEN_WITHDREW).toBeTruthy();
  });

  it('G2 G4: the new professional messages exist in every interface language and are used by the screens', () => {
    const keys = ['cases.referral_no_citizen_account', 'cases.referral_proposed_no_mail', 'referrals.stalled'];
    for (const lang of TARGET_LANGUAGES) {
      const dict = JSON.parse(read(`src/i18n/locales/${lang}/pro.json`));
      for (const k of keys) expect(String(dict[k] || '').trim().length, `${lang} ${k}`).toBeGreaterThan(5);
    }
    const screens = read('src/pages/pro/Cases.jsx') + read('src/pages/pro/Referrals.jsx');
    for (const k of keys) expect(screens).toContain(`pro:${k}`);
    expect(screens).toContain("'NO_CITIZEN_ACCOUNT'");
  });
});
