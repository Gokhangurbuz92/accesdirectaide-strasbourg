import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';

/**
 * Documentation completeness — vérifier que tous les docs requis existent.
 */
describe('Documentation completeness', () => {
  const requiredDocs = [
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'docs/ARCHITECTURE.md',
    'docs/CONTRIBUTING.md',
    'docs/api-reference.md',
    'docs/deployment.md',
    'docs/security.md',
    'docs/rgpd.md',
    'docs/monitoring.md',
    'docs/disaster-recovery.md',
    'docs/database.md',
    'docs/testing.md',
    'docs/onboarding.md',
    'docs/troubleshooting.md',
    'docs/known-issues.md',
    'docs/audit-status.md',
    'docs/secrets-rotation.md',
  ];

  requiredDocs.forEach(doc => {
    it(`${doc} exists`, () => {
      expect(existsSync(doc)).toBe(true);
    });
  });
});
