/**
 * K12 (11/11/2026): the Production veille is six bounded cron slices a night, not ten steps every start.
 *  - FINESS (≈ 100 Mo) and data·inclusion (≈ 294 Mo) never in the same invocation (docs/verification-production.md § 5);
 *  - every step of the chain is in the night's plan; the record steps run twice (the second slice continues the first);
 *  - the withdrawal cap is the night's across the slices (nightCap), the LAB's single run keeps its own count;
 *  - an authorized manual start chooses its slice with ?slot=0..5; outside the plan nothing is read or written.
 */
import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_utils/cronAuth.js', () => ({ getCronAuth: (req) => (req.headers?.authorization === 'Bearer ok' ? { ok: true } : { ok: false, reason: 'unauthorized' }) }));
vi.mock('../../api/lib/search-cache.js', () => ({ bumpContentEpoch: async () => {} }));
vi.mock('../../api/_services/verification/chain.js', () => ({ runVeille: vi.fn() }));

const { CRON_PLAN, planFor, default: handler } = await import('../../api/_handlers/cron/veille.js');
const ALL = ['aide', 'demarche', 'dispositif', 'structure', 'offices', 'finess', 'datainclusion', 'fiches', 'review', 'audit'];
const res = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

describe('the night plan', () => {
  it('six slots, one per scheduled hour of vercel.json « 37 0-5 * * * »', () => {
    expect(Object.keys(CRON_PLAN).map(Number)).toEqual([0, 1, 2, 3, 4, 5]);
    const crons = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons;
    expect(crons.find((c) => c.path === '/api/cron/veille')?.schedule).toBe('37 0-5 * * *');
  });
  it('FINESS and data·inclusion are never read in the same invocation (structure loads FINESS too)', () => {
    for (const steps of Object.values(CRON_PLAN)) {
      const finess = steps.includes('finess') || steps.includes('structure');
      expect(finess && steps.includes('datainclusion'), steps.join(',')).toBe(false);
    }
  });
  it('every step of the chain runs every night; records and structures twice', () => {
    const all = new Set(Object.values(CRON_PLAN).flat());
    expect([...all].sort()).toEqual([...ALL].sort());
    for (const k of ['aide', 'demarche', 'dispositif', 'structure']) expect(Object.values(CRON_PLAN).filter((s) => s.includes(k)).length, k).toBe(2);
    expect(CRON_PLAN[5]).toEqual(['review', 'audit']);   // the contract check closes the night
  });
  it('slot from the UTC hour, or ?slot=0..5; anything else is outside the plan', () => {
    expect(planFor({ query: {} }, new Date('2026-11-12T02:37:00Z'))).toEqual({ slot: 2, only: ['datainclusion'] });
    expect(planFor({ query: { slot: '1' } }, new Date('2026-11-12T14:00:00Z'))).toEqual({ slot: 1, only: ['structure', 'offices', 'finess'] });
    expect(planFor({ query: {} }, new Date('2026-11-12T14:00:00Z'))).toBeNull();
    for (const bad of ['6', '-1', '1;DROP', 'x']) expect(planFor({ query: { slot: bad } }, new Date('2026-11-12T14:00:00Z')), bad).toBeNull();
  });
});

describe('the cron route', () => {
  it('refuses without the cron credentials (nothing read)', async () => {
    const run = vi.fn(); const r = res();
    await handler({ headers: {}, query: {} }, r, { runVeille: run });
    expect(r.code).toBe(401); expect(run).not.toHaveBeenCalled();
  });
  it('runs only the slot\'s steps, bounded to 4 min, with the night\'s withdrawal cap', async () => {
    const run = vi.fn(async () => ({ ok: true, status: 'success', counts: {} })); const r = res();
    await handler({ headers: { authorization: 'Bearer ok' }, query: {} }, r, { runVeille: run, now: '2026-11-12T01:37:00Z' });
    expect(r.code).toBe(200);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ only: ['structure', 'offices', 'finess'], nightCap: true, maxMinutes: 4, trigger: 'cron:slot1', texts: false }));
    expect(r.body).toMatchObject({ success: true, slot: 1, steps: ['structure', 'offices', 'finess'] });
  });
  it('each slice reads FINESS / data·inclusion through its own /tmp directory, removed when it ends', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'k12-test-'));
    let seen = null;
    const run = vi.fn(async (o) => { seen = o.cacheDir; expect(fs.existsSync(o.cacheDir)).toBe(true); fs.writeFileSync(path.join(o.cacheDir, 'big.csv'), 'x'); return { ok: true, status: 'success', counts: {} }; });
    const prev = process.env.ADA_VEILLE_CACHE_DIR; delete process.env.ADA_VEILLE_CACHE_DIR;
    await handler({ headers: { authorization: 'Bearer ok' }, query: { slot: '2' } }, res(), { runVeille: run, tmpdir: base });
    if (prev !== undefined) process.env.ADA_VEILLE_CACHE_DIR = prev;
    expect(seen.startsWith(path.join(base, 'ada-veille-'))).toBe(true);
    expect(fs.existsSync(seen)).toBe(false);   // removed after the slice
    fs.rmSync(base, { recursive: true, force: true });
  });
  it('outside the plan: 200 « OUTSIDE_PLAN », no run', async () => {
    const run = vi.fn(); const r = res();
    await handler({ headers: { authorization: 'Bearer ok' }, query: {} }, r, { runVeille: run, now: '2026-11-12T13:00:00Z' });
    expect(r.code).toBe(200); expect(r.body.skipped).toBe('OUTSIDE_PLAN'); expect(run).not.toHaveBeenCalled();
  });
});

describe('the withdrawal cap is the night\'s across the slices', () => {
  const src = fs.readFileSync('api/_services/verification/chain.js', 'utf8');
  it('the cron passes nightCap; the chain subtracts the system withdrawals of the last NIGHT_HOURS from the allowance', () => {
    expect(src).toMatch(/nightCap: opts\.nightCap === true/);
    expect(src).toMatch(/export const NIGHT_HOURS = 20;/);
    expect(src).toMatch(/WHERE "reviewerRole" = 'system' AND outcome = 'HOLD' AND "createdAt" >= \$\{since\} GROUP BY "entityType"/);
    expect(src).toMatch(/ctx\.caps\[r\.k\] = Math\.max\(0, ctx\.caps\[r\.k\] - Number\(r\.n \|\| 0\)\)/);
    expect(src).toMatch(/if \(!ctx\.nightCap\) return;/);
    expect(src).toMatch(/priorWithdrawn: ctx\.priorWithdrawn \|\| \{\}/);   // recorded in the run's metrics
  });
});

describe('a fiche already in the catalogue never ends the night (LAB: Aide_externalId_unique, every night 29/10 → 11/11)', () => {
  const src = fs.readFileSync('api/_services/verification/chain.js', 'utf8');
  const feed = src.slice(src.indexOf('async function feedFiches'), src.indexOf('// ----', src.indexOf('async function feedFiches')));
  it('the DILA identities already recorded (externalId « dila:F… ») are linked, whatever the address (entreprendre.service-public.gouv.fr)', () => {
    expect(feed).toMatch(/SELECT "externalId" AS x FROM "Aide" WHERE "externalId" LIKE 'dila:%'/);
    expect(feed).toMatch(/linked\.add\(resolveId\(String\(r\.x\)\.slice\(5\)\.toUpperCase\(\), ctx\.archive\.redirections\)\)/);
    // the address SP_ID reads does not cover entreprendre.service-public.gouv.fr — the identity check is what links it
    expect(/service-public\.(?:gouv\.)?fr\/(?:particuliers|associations|professionnels-entreprises)\/vosdroits\/([FN]\d+)/i.test('https://entreprendre.service-public.gouv.fr/vosdroits/F15252')).toBe(false);
  });
  it('one fiche that cannot be added is noted and skipped (RETRY), the run goes on', () => {
    expect(feed).toMatch(/try \{\s+\/\/ K12: one fiche that cannot be added is noted and skipped/);
    expect(feed).toMatch(/count\(ctx, 'fiches:failed'\)/);
    expect(feed).toMatch(/kind: 'NEW_RECORD', outcome: 'RETRY'/);
  });
});
