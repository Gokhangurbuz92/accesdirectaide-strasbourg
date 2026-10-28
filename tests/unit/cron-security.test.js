import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';

/**
 * Cron handler security — tous les crons doivent vérifier le secret.
 */
describe('Cron handler security', () => {
  const cronDir = 'api/_handlers/cron';

  if (!existsSync(cronDir)) {
    it.skip('cron directory not found', () => {});
    return;
  }

  const cronFiles = readdirSync(cronDir)
    .filter(f => f.endsWith('.js') && !f.includes('.test.'));

  cronFiles.forEach(file => {
    it(`${file} checks cron secret`, () => {
      const content = readFileSync(`${cronDir}/${file}`, 'utf-8');
      expect(content).toMatch(/CRON_SECRET|cronAuth|authorization|secret|verifyCron/i);
    });
  });
});
