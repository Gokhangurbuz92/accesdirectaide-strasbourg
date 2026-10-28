/**
 * PKG-11 / E08 — organization closure invariants (source checks; the behaviour is proven on real PostgreSQL by pkg11-e08-org-closure-db): its own request type (never a
 * person's erasure), no physical delete of what others hold, two people, the screens on both sides.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { proStructureUpdateSchema } from '../../api/_utils/schemas.js';
import { REQUEST_TYPE } from '../../api/_services/org-closure.js';

const svc = readFileSync('api/_services/org-closure.js', 'utf8');

describe('PKG-11 / E08 organization closure', () => {
  it('has its own request type, never the person-erasure DELETE', () => {
    expect(REQUEST_TYPE).toBe('ORGANIZATION_CLOSURE');
    expect(svc).not.toMatch(/"requestType" = 'DELETE'/);
    expect(readFileSync('api/_services/dsr-erasure-review.js', 'utf8')).toMatch(/"requestType" = 'DELETE'/);   // the person's queue only lists DELETE
  });
  it('never physically deletes what the people, the other organizations or the audit trail hold', () => {
    const deletes = [...svc.matchAll(/DELETE FROM "(\w+)"/g)].map((m) => m[1]).sort();
    expect(deletes).toEqual(['AiOutputReview', 'Invitation', 'ProCaseNote', 'ProNotification']);
    expect(svc).toMatch(/DELETE FROM "ProCaseNote" WHERE "structureId" = \$\{sid\} AND visibility = 'INTERNAL'/);
    for (const t of ['Structure', 'ProUser', 'ProAuditLog', 'Referral', 'SharedDiagnostic', 'SharedDossierThread', 'SharedDossierMessage', 'ConsentLog']) expect(deletes).not.toContain(t);
  });
  it('two people, bound to the proposal read; a legal hold blocks', () => {
    expect(svc).toMatch(/p\.proposedBy === reviewer\) return bad\('second_reviewer_required'/);
    expect(svc).toMatch(/String\(input\?\.proposedAt \|\| ''\) !== String\(p\.proposedAt \|\| ''\)/);
    expect(svc).toMatch(/"dataCategory" = 'Structure' AND "recordId" = \$\{sid\}/);
  });
  it('the organization administrator can ask; the request carries its reason', () => {
    expect(proStructureUpdateSchema.parse({ action: 'request_closure', reason: 'Fin de notre activité.' })).toEqual({ action: 'request_closure', reason: 'Fin de notre activité.' });
    const page = readFileSync('src/pages/pro/Structure.jsx', 'utf8');
    expect(page).toMatch(/state\.canPropose \? \(\s*<Card data-testid="structure-closure">/);
    expect(page).toMatch(/action: 'request_closure', reason: closeReason/);
  });
  it('the privacy console lists closures and acts through the two-person route', () => {
    const page = readFileSync('src/pages/admin/k5/Privacy.jsx', 'utf8');
    expect(page).toMatch(/data-testid="admin-privacy-closure"/);
    expect(page.match(/'org-closure'\)/g).length).toBeGreaterThanOrEqual(6);
    expect(readFileSync('api/routes.js', 'utf8')).toContain("path: 'admin/org-closure'");
  });
});
