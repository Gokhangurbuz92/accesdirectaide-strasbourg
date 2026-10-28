/**
 * PKG-11 / C21 — restriction of processing (RGPD art. 18): every enforcement point stays wired (behaviour on real PostgreSQL: pkg11-c21-restriction-db).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GROUNDS, REQUEST_TYPE } from '../../api/_services/processing-restriction.js';

const read = (p) => readFileSync(p, 'utf8');

describe('PKG-11 / C21 restriction of processing', () => {
  it('the four grounds of art. 18(1), as codes; its own request type', () => {
    expect(GROUNDS).toEqual({ ACCURACY_CONTESTED: 'a', UNLAWFUL_PROCESSING: 'b', LEGAL_CLAIMS: 'c', OBJECTION_PENDING: 'd' });
    expect(REQUEST_TYPE).toBe('RESTRICT');
  });
  it('organizations: the central access predicate and the grant lookup refuse a restricted dossier; redemption too', () => {
    const access = read('api/_utils/share-access.js');
    expect(access).toMatch(/g\."revokedAt" IS NULL\) AND NOT \$\{restrictedDossierSql\(dossierId\)\}/);
    expect(access).toMatch(/if \(await isDossierRestricted\(dossierId\)\) return null;/);
    expect(read('api/_handlers/pro/dossier/redeem.js')).toMatch(/if \(await isDossierRestricted\(shareId\)\) return res\.status\(404\)/);
  });
  it('the person: no new sharing or widened purpose; no notification; the purge keeps the dossiers', () => {
    expect(read('api/_handlers/public/dossier-grants.js')).toMatch(/const widens = action === 'invite' \|\|/);
    expect(read('api/_services/citizen-account.js')).toMatch(/if \(await isRestricted\(userId, db\)\) return false;/);
    expect(read('api/_handlers/cron/gdpr-purge.js')).toMatch(/sql`NOT \$\{restrictedDossierSql\(SharedDiagnostic\.id\)\}`/);
  });
  it('screens: the person asks and lifts in Mon compte; ADA sees and lifts with a reason in the privacy console', () => {
    const page = read('src/pages/CompteParametres.jsx');
    expect(page).toMatch(/data-testid="compte-restriction"/); expect(page).toMatch(/action: 'lift'/); expect(page).toMatch(/action: 'request', ground/);
    const console = read('src/pages/admin/k5/Privacy.jsx');
    expect(console).toMatch(/data-testid="admin-privacy-restrictions"/); expect(console).toMatch(/'processing-restrictions'\)/);
    const routes = read('api/routes.js');
    expect(routes).toContain("path: 'citizen/restriction'"); expect(routes).toContain("path: 'admin/processing-restrictions'");
  });
});
