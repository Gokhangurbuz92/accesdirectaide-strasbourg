/**
 * R7 admin — « À traiter » counts are exact (count(*), no list capped at 100 / 200), the ADA Pro sign-up count reads only the requests that can be
 * decided (role STRUCTURE_ADMIN, status pending_verification), and the queues that had no card are counted: DSA appeals, partnership requests, news
 * inbox drafts, ADA articles to review, external booking pages, legal-hold release proposals, ownership recovery, funding dossiers, institution accounts.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../src/db/index.js', () => ({ db: {} }));
vi.mock('../../api/lib/ai-foundation.js', () => ({ generateCitizenLocalStructuredContent: vi.fn() }));

const dialect = new PgDialect();
const N = 250;   // more than any former list cap
const fakeDb = () => {
  const seen = [];
  return { seen, execute: async (q) => { const s = dialect.sqlToQuery(q).sql; seen.push(s); return { rows: /count\(\*\)/i.test(s) ? [{ n: N }] : [] }; } };
};

const KEYS = ['proposals', 'falc', 'accessRequests', 'erasures', 'closures', 'aiSuggestions', 'mailContactFailures', 'reports', 'quality', 'support', 'proRegistrations',
  'dsaAppeals', 'partnerships', 'newsInbox', 'adaArticles', 'externalBookings', 'legalHoldReleases', 'ownershipRecovery', 'fundingDossiers', 'institutionAccounts'];

describe('R7 admin — admin tasks: exact counts and every queue', () => {
  it('every count is the exact count(*) of its queue', async () => {
    const { adminTasks } = await import('../../api/_services/admin-tasks.js');
    const out = await adminTasks({ db: fakeDb() });
    for (const k of KEYS) expect([k, out[k]]).toEqual([k, N]);
  });

  it('the rules of the new and corrected counts', async () => {
    const { adminTasks } = await import('../../api/_services/admin-tasks.js');
    const db = fakeDb(); await adminTasks({ db });
    const q = (re) => db.seen.filter((s) => re.test(s));
    expect(q(/"ProUser"/)[0]).toMatch(/upper\(role\) = 'STRUCTURE_ADMIN'/);
    expect(q(/"ProUser"/)[0]).toMatch(/status = 'pending_verification'/);
    expect(q(/"AiOutputReview"/)[0]).toMatch(/kind = 'FALC'/);
    expect(q(/"ModerationAppeal"/)[0]).toMatch(/status = 'open'/);
    expect(q(/"PartnershipRequest"/)[0]).toMatch(/status = 'pending'/);
    expect(q(/"Actualite"/).join('\n')).toMatch(/statut = 'brouillon'/);
    expect(q(/"Actualite"/).join('\n')).toMatch(/statut = 'a_relire'/);
    expect(q(/"StructureExternalBooking"/)[0]).toMatch(/status = 'PENDING'/);
    expect(q(/"LegalHold"/)[0]).toMatch(/"releaseProposedBy" IS NOT NULL/);
    expect(q(/"OwnershipRecoveryCase"/)[0]).toMatch(/status = 'PROPOSED'/);
    expect(q(/"FundingDossier"/)[0]).toMatch(/status = 'PRET_POUR_VALIDATION'/);
    expect(q(/"InstitutionAccount"/)[0]).toMatch(/status = 'PENDING_AGREEMENT'/);
    for (const s of db.seen.filter((x) => /count\(\*\)/i.test(x))) expect(s).not.toMatch(/LIMIT/i);
  });

  it('the dashboard has a card for each new queue', async () => {
    const src = (await import('node:fs')).readFileSync('src/pages/AdminDashboard.jsx', 'utf8');
    for (const k of ['dsaAppeals', 'partnerships', 'newsInbox', 'adaArticles', 'externalBookings', 'legalHoldReleases', 'ownershipRecovery', 'fundingDossiers', 'institutionAccounts']) {
      expect(src).toContain(`tasks.${k}`);
    }
  });
});
