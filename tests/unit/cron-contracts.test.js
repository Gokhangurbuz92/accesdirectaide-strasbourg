import { describe, it, expect } from 'vitest';

/**
 * Cron contract tests — vérifier que chaque handler cron existe et exporte une fonction.
 */
describe('Cron contracts', () => {
  const crons = [
    ['gdpr-purge', 'api/_handlers/cron/gdpr-purge.js'],
    ['health-alert', 'api/_handlers/cron/health-alert.js'],
    ['backup-db', 'api/_handlers/cron/backup-db.js'],
    ['review-queue-scan', 'api/_handlers/cron/review-queue-scan.js'],
    ['rdv-reminder', 'api/_handlers/cron/rdv-reminder.js'],
    ['hive-scan', 'api/_handlers/cron/hive-scan.js'],
    ['actualites', 'api/_handlers/cron/actualites.js'],
    ['ingest-aids', 'api/_handlers/cron/ingest-aids.js'],
    ['ingest-annuaire', 'api/_handlers/cron/ingest-annuaire.js'],
    ['link-check', 'api/_handlers/cron/link-check.js'],
    ['pipeline', 'api/_handlers/cron/pipeline.js'],
  ];

  for (const [name, path] of crons) {
    it(`${name} handler exists and exports default`, async () => {
      const mod = await import(`../../${path}`);
      expect(typeof mod.default).toBe('function');
    });
  }
});
