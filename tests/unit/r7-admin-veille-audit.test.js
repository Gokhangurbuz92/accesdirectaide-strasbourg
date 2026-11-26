/**
 * R7 admin — every write action of the « Veille automatique » page (pause, resume, run) leaves one AuditLog row naming the administrator, like the
 * other admin decisions; the free-text pause reason (which could hold anything) is not copied into it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audits = [];
vi.mock('../../src/db/index.js', () => ({ db: { insert: () => ({ values: async (v) => { audits.push(v); } }) } }));
vi.mock('../../api/_utils/rateLimit.js', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }), getClientIp: () => '127.0.0.1', getRateLimitStatus: () => 429 }));
vi.mock('../../api/_utils/auth.js', () => ({ isAdminRole: () => true, resolveAuthContext: vi.fn().mockResolvedValue({ email: 'admin@example.test', role: 'admin', authType: 'admin_jwt', mfa_verified: true }) }));
vi.mock('../../api/_services/verification/digest.js', () => ({ veilleDigest: vi.fn(), recordHistory: vi.fn() }));
vi.mock('../../api/_services/verification/control.js', () => ({ pauseState: vi.fn().mockResolvedValue({ paused: false }), setPause: vi.fn().mockResolvedValue({ paused: true }), requestStop: vi.fn() }));
vi.mock('../../api/_services/verification/sources.js', () => ({ SEED_SOURCES: [] }));
vi.mock('../../api/_services/verification/resources.js', () => ({ guardEnabled: () => false, probe: null }));
vi.mock('../../api/_services/verification/schedule.js', () => ({ startVeille: vi.fn(), veilleRunning: () => false, nextRunAt: vi.fn() }));

const resOf = () => ({ statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const post = async (body) => {
  const handler = (await import('../../api/_handlers/admin/veille.js')).default;
  const res = resOf();
  await handler({ method: 'POST', headers: {}, query: {}, body }, res);
  return res;
};

describe('R7 admin — veille write actions are audited', () => {
  beforeEach(() => { audits.length = 0; process.env.ADA_VEILLE_RUNNER = 'inline'; });
  it.each([['pause', 'VEILLE_PAUSED'], ['resume', 'VEILLE_RESUMED'], ['run', 'VEILLE_RUN_STARTED']])('%s writes one %s row naming the administrator', async (action, code) => {
    const r = await post({ action, reason: 'Mme Exemple a appelé au 06 00 00 00 00' });
    expect(r.statusCode).toBeLessThan(300);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: code, actor: 'admin@example.test', actor_id: 'admin@example.test', entity: 'Veille' });
    expect(JSON.stringify(audits[0].details || {})).not.toMatch(/Exemple|06 00/);
  });
  it('a refused action writes nothing', async () => {
    expect((await post({ action: 'nope' })).statusCode).toBe(400);
    expect(audits).toHaveLength(0);
  });
});
