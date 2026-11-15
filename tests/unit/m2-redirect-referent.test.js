/**
 * M2 — the parts that need no database: the next action of a referral (pure), the schema guard for a database without migrations 0047 / 0048, the wording
 * of the « référent de parcours » in every language (a contact person — never a responsibility or a legal role), the access module that never reads the
 * référent tables, and the conventions of the two migrations. The behaviour is tested on real PostgreSQL in tests/integration/m2-*.test.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { ACCEPTED_NO_PROGRESS_DAYS, RESPONSES, REPLY_SEPARATOR, UNRESOLVED_FOLLOW_UP_DAYS, nextActionOf } from '../../api/_services/referrals.js';
import { REFERRAL_CHAIN_COLUMNS, readReferralChainSchema, referralTable } from '../../api/_utils/schema-features.js';
import { CATALOGUE } from '../../api/_services/pro-notifications.js';
import { RESPONSE_LABELS } from '../../src/lib/caseLabels.js';
import { TARGET_LANGUAGES } from '../../src/i18n/languages.js';

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NOW = new Date('2026-11-15T12:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * 86400000);
const next = (r, o = {}) => nextActionOf(r, { now: NOW, ...o });

describe('M2 — next action of a referral (derived, never stored)', () => {
  it('names whose move it is at each state', () => {
    expect(next({ status: 'PENDING_CITIZEN' })).toEqual({ nextAction: { code: 'CITIZEN_DECIDE', by: 'CITIZEN' }, needsFollowUp: false });
    expect(next({ status: 'SENT', dueAt: ago(-3) }).nextAction).toMatchObject({ code: 'RECEIVER_ANSWER', by: 'RECEIVER' });
    expect(next({ status: 'ACKNOWLEDGED', dueAt: ago(-3) }).nextAction.code).toBe('RECEIVER_ANSWER');
    expect(next({ status: 'NEEDS_INFO', dueAt: ago(-3) }).nextAction).toMatchObject({ code: 'SENDER_REPLY', by: 'SENDER' });
    expect(next({ status: 'ACCEPTED', respondedAt: ago(1) }).nextAction).toMatchObject({ code: 'RECEIVER_FIRST_STEP', by: 'RECEIVER' });
    expect(next({ status: 'IN_PROGRESS' }).nextAction.code).toBe('RECEIVER_RESULT');
    expect(next({ status: 'IN_PROGRESS', appointmentAt: ago(-2) }).nextAction).toMatchObject({ code: 'APPOINTMENT', by: 'RECEIVER' });
    expect(next({ status: 'IN_PROGRESS', appointmentAt: ago(2) }).nextAction.code).toBe('RECEIVER_RESULT');
    expect(next({ status: 'DECLINED', respondedAt: ago(1) }).nextAction).toMatchObject({ code: 'SENDER_NEXT', by: 'SENDER' });
    expect(next({ status: 'DECLINED', respondedAt: ago(1), suggestedStructureId: 's' }).nextAction.code).toBe('SENDER_PROPOSE_SUGGESTED');
    expect(next({ status: 'EXPIRED', closedAt: ago(1) }).nextAction.code).toBe('SENDER_NEXT');
    for (const status of ['COMPLETED', 'CANCELLED', 'CLOSED']) expect(next({ status, suggestedStructureId: 's' })).toEqual({ nextAction: null, needsFollowUp: false });
  });
  it('flags a late or motionless step — and nothing else', () => {
    expect(next({ status: 'SENT', dueAt: ago(1) }).needsFollowUp).toBe(true);
    expect(next({ status: 'SENT', dueAt: ago(-1) }).needsFollowUp).toBe(false);
    expect(next({ status: 'NEEDS_INFO', dueAt: ago(1) }).needsFollowUp).toBe(true);
    expect(next({ status: 'ACCEPTED', respondedAt: ago(ACCEPTED_NO_PROGRESS_DAYS + 1) }).needsFollowUp).toBe(true);
    expect(next({ status: 'ACCEPTED', respondedAt: ago(ACCEPTED_NO_PROGRESS_DAYS - 1) }).needsFollowUp).toBe(false);
    expect(next({ status: 'DECLINED', respondedAt: ago(UNRESOLVED_FOLLOW_UP_DAYS + 1), suggestedStructureId: 's' }).needsFollowUp).toBe(true);
    expect(next({ status: 'DECLINED', respondedAt: ago(UNRESOLVED_FOLLOW_UP_DAYS + 1), suggestedStructureId: 's' }, { hasNext: true })).toEqual({ nextAction: null, needsFollowUp: false });
    expect(next({ status: 'PENDING_CITIZEN', dueAt: ago(40) }).needsFollowUp).toBe(false);
  });
  it('the redirect is a response code, not a 13th state; a reply is appended under a dated, language-neutral separator', () => {
    expect(RESPONSES).toContain('REDIRECT_SUGGESTED');
    expect(Object.keys(RESPONSE_LABELS)).toEqual(RESPONSES);
    expect(REPLY_SEPARATOR(NOW)).toBe('— Précisions apportées le 2026-11-15 —');
    const service = read('api/_services/referrals.js');
    expect(service).not.toMatch(/status: 'REDIRECT/);
    // A05: the reply never replaces the authorized message
    expect(service).not.toContain("messageEncrypted: sealText(msg, ctxOf(r.id)), dueAt");
  });
});

describe('M2 — a database without migrations 0047 / 0048', () => {
  const fake = (cols, tables, messages) => ({ execute: async () => ({ rows: [{ cols, tables, messages }] }) });
  it('reads what the database has', async () => {
    expect(await readReferralChainSchema(fake(3, 2, 1))).toEqual({ chain: true, referent: true, messages: true });
    expect(await readReferralChainSchema(fake(0, 0, 0))).toEqual({ chain: false, referent: false, messages: false });
    expect(await readReferralChainSchema(fake(2, 1, 0))).toEqual({ chain: false, referent: false, messages: false });   // a half-applied schema is « not there »
    expect(await readReferralChainSchema(fake(3, 2, 0))).toEqual({ chain: true, referent: true, messages: false });   // 0047 without 0048
  });
  it('the table object used before the migration names none of the 0047 columns (drizzle lists every column of the object)', () => {
    const before = Object.keys(getTableColumns(referralTable({ chain: false })));
    const after = Object.keys(getTableColumns(referralTable({ chain: true })));
    for (const c of REFERRAL_CHAIN_COLUMNS) { expect(before).not.toContain(c); expect(after).toContain(c); }
    expect(after.length - before.length).toBe(REFERRAL_CHAIN_COLUMNS.length);
  });
  it('the service never selects, inserts or returns through the full table object without a column list', () => {
    const service = read('api/_services/referrals.js');
    expect(service).not.toMatch(/select\(\)\.from\(Referral\)/);
    expect([...service.matchAll(/select\(\)\.from\(R\)/g)].length).toBeGreaterThanOrEqual(4);
    expect(service).not.toMatch(/insert\(Referral\)/);
    for (const m of service.matchAll(/update\(Referral\)[^\n]*\n?[^\n]*/g)) expect(m[0]).toMatch(/returning\(\{/);
  });
  it('the notices of M2 are in-app only: no new e-mail type', () => {
    expect(CATALOGUE.referral_follow_up).toMatchObject({ category: 'referrals', email: false });
    expect(CATALOGUE.referent_update).toMatchObject({ category: 'cases', email: false });
  });
});

describe('M2 — « référent de parcours »: a contact person, no access, no legal role', () => {
  it('the access module never reads the référent tables (the record cannot open anything)', () => {
    for (const file of ['api/_utils/share-access.js', 'api/_utils/auth.js', 'api/_handlers/pro/dossier.js']) expect(read(file), file).not.toMatch(/DossierReferent/);
    // and the service reads access FROM the access module, never the other way round
    expect(read('api/_services/dossier-referent.js')).toMatch(/import \{ activeGrantExists, activeMemberSql, referralGrantLapsedSql \} from '\.\.\/_utils\/share-access\.js';/);
  });
  const KEYS = { compte: ['referent.title', 'referent.what_it_is', 'referent.proposal_intro', 'referent.accepted', 'referent.ended'], pro: ['referent.title', 'referent.notice', 'referent.accepted', 'referent.proposed', 'referent.volunteer', 'referent.consent'] };
  /** words that would present the role as a responsibility, a mandate or a legal status */
  const FORBIDDEN = {
    fr: /responsable|mandataire|tuteur|curateur|représentant légal|garant/i,
    en: /\bresponsible\b|\bliable\b|\bguardian\b|\blegal representative\b|\bin charge\b|\bcase manager\b/i,
    de: /verantwortlich|Betreuer\b|Vormund|gesetzliche[rn]? Vertreter|haftet/i,
    tr: /sorumlu|vasi\b|kayyum|yasal temsilci/i,
    ar: /مسؤول|وصي|ولي أمر|الممثل القانوني/,
    uk: /відповідальн|опікун|законн\S* представник/i,
  };
  it('French source strings (interface, e-mails, notices, API messages) never present it as a responsibility', () => {
    for (const file of ['src/components/sharing/ReferentCard.jsx', 'api/_services/dossier-referent.js']) {
      const text = read(file).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
      expect(text, file).not.toMatch(FORBIDDEN.fr);
    }
    const cases = read('src/pages/pro/Cases.jsx');
    const block = cases.slice(cases.indexOf('data-testid="pro-case-referent"'), cases.indexOf("t('pro:cases.card_notes'"));
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(FORBIDDEN.fr);
    // the two disclaimers are on both screens
    for (const text of [read('src/components/sharing/ReferentCard.jsx'), block]) {
      expect(text).toMatch(/aucun accès supplémentaire/);
      expect(text).toMatch(/ne remplace aucune désignation légale ou contractuelle/);
      expect(text).toMatch(/aucune obligation de résultat/);
    }
  });
  it('every language carries the same wording: a contact person, with the « no access / no legal designation » notice', () => {
    for (const lang of TARGET_LANGUAGES) {
      for (const [ns, keys] of Object.entries(KEYS)) {
        const dict = JSON.parse(read(`src/i18n/locales/${lang}/${ns}.json`));
        for (const [k, v] of Object.entries(dict)) {
          if (!k.startsWith('referent.')) continue;
          expect(String(v).trim().length, `${lang}/${ns}:${k}`).toBeGreaterThan(0);
          expect(String(v), `${lang}/${ns}:${k}`).not.toMatch(FORBIDDEN[lang]);
        }
        for (const k of keys) expect(dict[k], `${lang}/${ns}:${k}`).toBeTruthy();
      }
    }
  });
});

describe('M2 — migrations 0047 / 0048: additive, idempotent, with a rollback that forgets the migration', () => {
  const journal = JSON.parse(read('drizzle/meta/_journal.json')).entries;
  for (const [tag, down] of [['0047_m2_referral_redirect_referent', '0047_down.sql'], ['0048_m2_referral_message_history', '0048_down.sql']]) {
    it(tag, () => {
      const entry = journal.find((e) => e.tag === tag);
      expect(entry).toBeTruthy();
      expect(entry.when).toBeGreaterThan(journal.find((e) => e.tag === '0045_r43_appointment_notice_kinds').when);
      const sql = read(`drizzle/${tag}.sql`).replace(/--[^\n]*/g, '');
      // additive: nothing existing is dropped or rewritten (a constraint / trigger is only dropped to be re-created by the next statement)
      expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN|TRUNCATE|DELETE FROM|UPDATE "/);
      for (const m of sql.matchAll(/ADD COLUMN (?!IF NOT EXISTS)/g)) throw new Error(`not idempotent: ${m[0]}`);
      for (const m of sql.matchAll(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)) throw new Error(`not idempotent: ${m[0]}`);
      for (const m of sql.matchAll(/CREATE TABLE (?!IF NOT EXISTS)/g)) throw new Error(`not idempotent: ${m[0]}`);
      for (const m of sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g)) expect(sql, m[1]).toContain(`DROP CONSTRAINT IF EXISTS "${m[1]}"`);
      for (const m of sql.matchAll(/ADD COLUMN IF NOT EXISTS "[^"]+" ([^;]+);/g)) expect(m[1]).not.toMatch(/NOT NULL/);   // every new column of an existing table is nullable
      expect(read(`drizzle/rollback/${down}`)).toContain(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when};`);
    });
  }
  it('0048 is later than 0047 (drizzle applies by « when »)', () => {
    expect(journal.find((e) => e.tag.startsWith('0048_')).when).toBeGreaterThan(journal.find((e) => e.tag.startsWith('0047_')).when);
  });
});
