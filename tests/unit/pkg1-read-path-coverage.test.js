// PKG-1 / D-5 — ratchet: every server file that reads the public content tables (Aide, Demarche, Structure, Dispositif) is either GUARDED by the central publication contract
// (api/lib/publicVisibility.js) or REVIEWED as not a public read path. A new reader that is in neither list fails here, so a new public surface cannot silently bypass D-5.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
// R11: also a table map ({ table: Aide, … }) read through a variable (api/_services/page-head.js)
const READS = /query\.(Aide|Demarche|Structure|Dispositif)\b|from\((schema\.)?(Aide|Demarche|Structure|Dispositif)\)|(FROM|JOIN) "?(Aide|Demarche|Structure|Dispositif)"?\b|\btable: (Aide|Demarche|Structure|Dispositif)\b/;
const walk = (dir, out = []) => {
  for (const n of readdirSync(join(root, dir))) {
    const rel = join(dir, n); const st = statSync(join(root, rel));
    if (st.isDirectory()) { if (!['node_modules', 'dist'].includes(n)) walk(rel, out); } else if (/\.(js|mjs|cjs|ts)$/.test(n) && !/\.test\./.test(n)) out.push(rel);
  }
  return out;
};

/** public read paths: MUST apply the publication contract */
const GUARDED = [
  'api/_handlers/translations.js',   // R32: decide()/visibleWhere before any translation is returned
  'api/_handlers/aides.js', 'api/_handlers/demarches.js', 'api/_handlers/structures.js', 'api/_handlers/dispositifs/index.js', 'api/_handlers/drees.js', 'api/_handlers/pdf.js',
  // R31 (D16): api/_handlers/search.js no longer reads a content table itself — its démarche and place sections go through api/lib/search-query.js (guarded)
  'api/_handlers/search-pro.js', 'api/_handlers/sitemap.js', 'api/_handlers/taxonomy.js',
  'api/lib/search-query.js', 'api/lib/hybrid-search.js', 'api/lib/gemini.js', 'scripts/generate-sitemap.mjs',
  // P22 (R11): the record pages' initial HTML (scripts/prerender.mjs no longer reads any record)
  'api/_services/page-head.js',
  // PKG-2: favourites only accept/show records that pass decide(); the access log / document list name organisations that HOLD a grant on the person's dossier (sharing domain)
  'api/_services/mon-espace.js',
];
/** reviewed: not a citizen-facing content read path (reason in the comment) */
const REVIEWED_NOT_PUBLIC = {
  // administration / operations (authenticated staff; reviewers must see hidden records)
  'api/_handlers/admin/dashboard.js': 'admin', 'api/_handlers/admin/national-stats.js': 'admin', 'api/_handlers/admin/rag-health.js': 'admin', 'api/_handlers/admin/stats.js': 'admin',
  'api/_handlers/cron/health-alert.js': 'cron', 'api/_handlers/cron/ingest-annuaire.js': 'cron ingestion (writes)', 'api/_handlers/cron/ingest-structures.js': 'cron ingestion (writes)', 'api/_handlers/cron/link-check.js': 'cron',
  'api/_handlers/pro/health-check.js': 'professional back office', 'api/_handlers/pro/rdv-settings.js': 'professional back office (own organization)', 'api/_handlers/pro/system-maintenance.js': 'admin maintenance', 'api/_handlers/pro/auth/register.js': 'professional registration (writes own structure)',
  'api/_services/duplicate-register.js': 'admin: D13 duplicate register (MFA administrators compare records, hidden ones included)',
  'api/_services/admin-tasks.js': 'admin: « À traiter » counts for the administrator dashboard (counts only, hidden records included, nothing public)',
  'api/_services/verification/chain.js': 'automatic verification chain: reads every record (hidden ones included) to check it against the official sources; publishes only through content-verification.js, returns nothing public',
  'api/lib/agent-orchestrator.js': 'admin orchestrator (discovery of records to review)', 'api/lib/services/siret-merger.js': 'admin maintenance', 'api/_utils/dataQuality.js': 'data-quality monitor',
  // booking and sharing: governed by the ORGANIZATION's own publication (RDV settings / Pro membership), not by directory content verification; see docs/pkg1-d5-publication-policy-and-structure-model.md (open decision recorded)
  'api/_handlers/rdv.js': 'booking governed by StructureRdvSettings.isPublished', 'api/_handlers/public/appointments/create.js': 'booking governed by StructureRdvSettings.isPublished',
  'api/_handlers/public/dossier-grants.js': 'sharing targets = Pro organizations with active members', 'api/_utils/share-access.js': 'authorization helper (membership)', 'api/_handlers/auth/outlook-callback.js': 'OAuth callback (writes)',
  // PKG-4: organization NAMES in the person's own DSR export / follow-ups, and in the professional back office (cases of the caller's organization; referral targets limited
  // to statut 'actif' + verification_status 'VERIFIED' organizations with active members). Not a citizen-facing directory read; no unverified fact is published.
  'api/_services/privacy.js': 'DSR export of the person (names of organizations that hold their grant)', 'api/_services/pro-cases.js': 'professional back office + the person\'s own follow-ups',
  'api/_services/referrals.js': 'professional back office (verified receivers only) + the person\'s own referrals',
  'api/_services/dsr-review.js': 'ADA MFA review of a person\'s access request (organization names of their own case notes); never public',
  'api/_services/content-versions.js': 'PKG-5 / A07: administrator versions and rollback of a record (MFA); never public',
  'api/_services/privacy-console.js': 'PKG-5 / A12: administrator privacy console (legal-hold existence check by id); never public',
  'scripts/lab-local.mjs': 'PKG-5 local LAB CLI (owner machine): counts records for the status line; never public',
  'api/_services/falc-governance.js': 'PKG-6 / D19: administrator FALC review (reads public text of one record by id); never public',
  'api/lib/local-ai-metrics.js': 'PKG-6 / A14: administrator AI metrics (counts Aide rows with an embedding, using visibleSql for the public count); never public',
  'api/_services/territorial-stats.js': 'PKG-5 / I03 I04: counts of verified organizations per commune for institutional aggregates (no record content); signed partners / admins only',
  'api/_services/org-lifecycle.js': 'PKG-5 / E01: administrator organization list (identity, activity, D-5 decision shown apart); admin sessions only, never public',
  'api/_handlers/pro/dossier/redeem.js': 'E01: reads only statut / verification_status of the redeeming organization (eligibility check); never public',
  'api/_handlers/pro/auth/login.js': 'PRO-11: reads only id / nom of the organizations whose account matched the password (the person\'s own), so that they choose one; never public',
  'api/_handlers/pro/auth/forgot-password.js': 'PRO-11: reads only the nom of the organizations of the address\'s own accounts, for the reset e-mail sent to that address; never public',
  'api/_services/org-stats.js': 'organization statistics: own organization, or k-anonymous aggregates over VERIFIED organizations (no organization named); never public',
  'api/_services/structure-proposals.js': 'Espace Structure: the organization\'s OWN record (members only) and the ADA MFA review queue; never public',
  'api/lib/retrieval-index.js': 'PKG-11 / D16: index rebuild of the D-5-VISIBLE aides only (visibleSql); writes vectors, no public output',
  'scripts/search-eval.mjs': 'PKG-11 / D16: LAB measurement on its own synthetic fixtures (refuses a non-local database); no public output',
  'api/_handlers/pro/orientation-baskets.js': 'R18 (R31): reads only the nom of the caller\'s own organization for the summary heading; the catalogue items go through visibleSql (api/_services/orientation-basket.js)',
  'api/_services/link-check.js': 'PKG-11 / A05: link check of the D-5-VISIBLE records only (visibleSql), allow-listed official hosts; no public output',
  'api/_services/org-closure.js': 'PKG-11 / E08: the organization\'s own closure request and the ADA two-person MFA review (organization name, counts); never public',
  'api/_services/admin-content.js': 'PKG-11 / A02: the administrators\' catalogue editing (only through /api/admin/content: admin session + MFA); found by the R11 table-map detection, never a public read',
  'scripts/q11-multi-instance.mjs': 'R11: Q11 local SIMULATION on a DISPOSABLE local database (refuses another): inserts and deletes its own synthetic rows, never served',
  'scripts/transfer-rehearsal.mjs': 'R8: operator rehearsal of the content transfer on a NEW local database it creates (refuses a non-local server); counts and hashes only, never served',
  // maintenance scripts run by an operator, never served
  'scripts/cleanup-test-accounts.js': 'operator script', 'scripts/fix-source-urls.js': 'operator script', 'scripts/measure-phase10-baseline.js': 'operator script', 'scripts/recalculate-quality-scores.js': 'operator script',
  'scripts/seed-test-accounts.js': 'operator script', 'scripts/seed-test-pro-profiles.ts': 'operator script', 'scripts/test-backup-restore.js': 'operator script', 'scripts/test-db-development.cjs': 'operator script', 'scripts/test-db-production.cjs': 'operator script',
};

describe('D-5 read-path coverage ratchet', () => {
  const readers = [...walk('api'), ...walk('scripts')].filter((f) => READS.test(readFileSync(join(root, f), 'utf8')));
  it('every file that reads a content table is guarded or explicitly reviewed (a new reader fails until it is classified)', () => {
    const unclassified = readers.filter((f) => !GUARDED.includes(f) && !(f in REVIEWED_NOT_PUBLIC));
    expect(unclassified, 'unreviewed readers of Aide/Demarche/Structure/Dispositif').toEqual([]);
  });
  it('every guarded public path really uses the publication contract', () => {
    const missing = GUARDED.filter((f) => !/publicVisibility/.test(readFileSync(join(root, f), 'utf8')) && !/search-query|hybrid-search/.test(readFileSync(join(root, f), 'utf8')));
    expect(missing).toEqual([]);
    for (const f of GUARDED) expect(readers, f + ' is expected to read a content table').toContain(f);
  });
  it('no stale entries: every reviewed file still exists', () => {
    for (const f of Object.keys(REVIEWED_NOT_PUBLIC)) expect(statSync(join(root, f)).isFile(), f).toBe(true);
  });
  it('search-pro (citizen directory search) applies the structure contract before any user filter', () => {
    const s = readFileSync(join(root, 'api/_handlers/search-pro.js'), 'utf8');
    expect(s).toMatch(/const whereParts = \[visibleSql\('structure', \{ alias: 's' \}\)\];/);
  });
});
