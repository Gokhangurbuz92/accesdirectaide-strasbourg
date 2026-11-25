/**
 * A-14 (art. 15) — coverage contract of the personal-data export: every table keyed on the citizen account (a foreign key to CitizenUser, directly or through
 * one of the person's own rows) has an export section. A new account table without a section makes this test fail. The five sections added by A-14 are
 * minimised: no endpoint, no key, no token hash, no staff identity.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { accountLinkedSections, EXPORT_FORBIDDEN_FIELDS, EXPORT_SECTION_TABLES } from '../../api/_services/export-account-sections.js';

const schema = fs.readFileSync('src/db/schema.ts', 'utf8');
const privacy = fs.readFileSync('api/_services/privacy.js', 'utf8');
/** tables whose definition holds a foreign key to CitizenUser.id */
function accountTables() {
  const starts = [...schema.matchAll(/export const (\w+) = pgTable\('\w+'/g)].map((m) => [m[1], m.index]);
  return starts.filter(([, at], i) => /foreignColumns: \[CitizenUser\.id\]/.test(schema.slice(at, i + 1 < starts.length ? starts[i + 1][1] : schema.length))).map(([name]) => name);
}
/** account data reached through a row the person owns (no direct foreign key): listed by hand, with the owning table */
const INDIRECT = { ParcoursReminder: 'ParcoursItem', AppointmentNotice: 'ProAppointment' };

describe('A-14 export covers every account-keyed table', () => {
  it('the schema scan finds the account tables (the scan itself is not empty or broken)', () => {
    const found = accountTables();
    expect(found.length).toBeGreaterThanOrEqual(15);
    for (const t of ['AuthToken', 'CitizenProfile', 'PushSubscription', 'EmailChangeRequest', 'OwnershipRecoveryCase']) expect(found).toContain(t);
  });

  it('each table with a foreign key to CitizenUser is exported (privacy.js or the A-14 sections)', () => {
    const sections = Object.values(EXPORT_SECTION_TABLES);
    const missing = accountTables().filter((t) => !new RegExp(`\\b${t}\\b`).test(privacy) && !sections.includes(t));
    expect(missing, `account tables without an export section: ${missing.join(', ')}`).toEqual([]);
  });

  it('the indirect account tables are exported and the export assembly spreads the A-14 sections', () => {
    for (const t of Object.keys(INDIRECT)) expect(Object.values(EXPORT_SECTION_TABLES)).toContain(t);
    expect(privacy).toMatch(/accountLinkedSections\(userId, safeRows\)/);
    expect(privacy).toMatch(/\.\.\.accountLinked,/);
  });

  it('each section reads ONLY the person’s rows and selects no secret column', async () => {
    const dialect = new PgDialect();
    const queries = [];
    const rows = async (q) => { const { sql: text, params } = dialect.sqlToQuery(q); queries.push({ text, params }); return /EmailChangeRequest/.test(text) ? [{ id: 'e1', enc: 'sealed', createdAt: 1, expiresAt: 2, usedAt: null }] : []; };
    const out = await accountLinkedSections('user-1', rows, { open: (id, sealed) => (id === 'e1' && sealed === 'sealed' ? 'new@example.test' : ''), hasLegalProtectionTable: async () => true, hasEventTables: async () => true, hasTestimonialTables: async () => true, hasCommunityTables: async () => true, hasEntraideTables: async () => true, hasModerationTables: async () => true, hasSocialReferralTables: async () => true, hasTelegramTable: async () => true });
    expect(Object.keys(out).sort()).toEqual(Object.keys(EXPORT_SECTION_TABLES).sort());
    expect(queries).toHaveLength(24);   // TG: + telegramLinks (with 0065)   // G14-R3G: + legalProtectionMandates (with 0064)   // G14-PS: + socialReferrals (with 0061)   // G14: + moderationDecisions, moderationAppeals, moderationSanctions (with 0059)   // X04: + eventRegistrations (on a database with 0053); X02: + testimonials, testimonialReports (with 0054); X01: + communityMember, communityStories, communityStoryReports (with 0055); X03: + seven entraide sections (with 0057)
    for (const q of queries) { expect(q.params.length).toBeGreaterThan(0); expect(new Set(q.params)).toEqual(new Set(['user-1'])); expect(q.text).toMatch(/"userId" = \$1|"citizenUserId" = \$1|"reporterUserId" = \$1|"subjectUserId" = \$1|"appellantUserId" = \$1|"citizenId" = \$1|"protectedUserId" = \$\d/); }
    // G14-R3G: the links of either side, never the administrator's identity or note
    expect(queries.find((q) => q.text.includes('"LegalProtectionMandate"')).text).toMatch(/"protectedUserId" = \$\d+ OR "representativeUserId" = \$\d+/);
    expect(queries.find((q) => q.text.includes('"LegalProtectionMandate"')).text.split(/\bFROM\b/)[1] ?? '').toBeTruthy();
    for (const [section, table] of Object.entries(EXPORT_SECTION_TABLES)) expect(queries.some((q) => q.text.includes(`"${table}"`)), section).toBe(true);
    const selected = queries.map((q) => q.text.split(/\bFROM\b/)[0]).join(' ');
    for (const f of ['endpointHash', 'subscriptionEncrypted', 'tokenHash', 'evidenceNote', 'decisionNote', 'proposedBy', 'decidedBy', 'verifiedBy', 'verificationNote', 'decisionRefHmac']) expect(selected).not.toContain(f);
    expect(queries.find((q) => q.text.includes('"AppointmentNotice"')).text).toMatch(/recipient = 'citizen'/);
    expect(out.emailChangeRequests).toEqual([{ id: 'e1', requestedEmail: 'new@example.test', createdAt: 1, expiresAt: 2, usedAt: null }]);
    for (const f of EXPORT_FORBIDDEN_FIELDS) expect(JSON.stringify(out)).not.toContain(`"${f}"`);
    expect(sql).toBeTypeOf('function');
  });

  it('an address that cannot be opened is exported as null, never as the sealed value', async () => {
    const out = await accountLinkedSections('user-1', async () => [{ id: 'e1', enc: 'v2:SEALED', createdAt: 1, expiresAt: 2, usedAt: null }], { open: () => { throw new Error('key'); } });
    expect(out.emailChangeRequests[0].requestedEmail).toBeNull();
    expect(JSON.stringify(out.emailChangeRequests)).not.toContain('SEALED');
  });
});
