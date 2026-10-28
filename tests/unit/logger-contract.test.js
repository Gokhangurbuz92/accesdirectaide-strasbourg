import { describe, it, expect } from 'vitest';

/**
 * Logger contract tests — vérifier que Pino est configuré.
 */
describe('Logger', () => {
  it('logger utility exists', async () => {
    const mod = await import('../../api/_utils/logger.js');
    expect(mod).toBeDefined();
  });

  it('exports a logger with info/error/warn', async () => {
    const mod = await import('../../api/_utils/logger.js');
    const logger = mod.default || mod.logger || mod;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });
});
