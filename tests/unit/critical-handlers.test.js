import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

/**
 * Critical handlers — vérifier que les handlers les plus importants
 * existent et exportent correctement.
 */
const criticalHandlers = [
  'api/_handlers/auth/login.js',
  'api/_handlers/auth/signup.js',
  'api/_handlers/auth/logout.js',
  'api/_handlers/auth/me.js',
  'api/_handlers/auth/delete-account.js',
  'api/_handlers/auth/export-data.js',
  'api/_handlers/admin/dashboard.js',
  'api/_handlers/cron/gdpr-purge.js',
  'api/_handlers/cron/health-alert.js',
  'api/_handlers/cron/backup-db.js',
  'api/_handlers/cron/actualites.js',
  'api/_handlers/assistant/chat.js',
  'api/_handlers/pro/appointments.js',
];

describe('Critical handlers', () => {
  criticalHandlers.forEach(handler => {
    const name = handler.split('/').pop();

    it(`${name} exists and exports function`, () => {
      expect(existsSync(handler)).toBe(true);
      const content = readFileSync(handler, 'utf-8');
      expect(content.length).toBeGreaterThan(50);
      expect(content).toMatch(/export\s+default|module\.exports|export\s+function|export\s+async/);
    });
  });
});
