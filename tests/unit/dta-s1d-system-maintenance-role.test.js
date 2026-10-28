/**
 * DTA S1D — POST /api/pro/system-maintenance (BACKUP) returns PLATFORM-WIDE counts (every dossier, audit entry and professional user of every organization) and was open to any
 * STRUCTURE_ADMIN.  A structure administrator must not read cross-organization totals: the route is restricted to SUPERADMIN.  Real auth utilities and real pro JWTs; db mocked (no real DB here).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const DB = vi.hoisted(() => ({ selects: 0, inserts: [] }));
vi.mock('../../src/db/index.js', () => ({ db: {
  select: () => ({ from: () => { DB.selects += 1; return Promise.resolve([{ count: 7 }]); } }),
  insert: () => ({ values: (v) => { DB.inserts.push(v); return Promise.resolve([]); } }),
  execute: async () => ({ rows: [] }),
} }));
vi.mock('../../api/_utils/logger.js', () => { const m = () => {}; return { default: { info: m, warn: m, error: m, debug: m } }; });

const mk = () => ({ statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader(k, v) { this.headers[k] = v; } });
let handler, auth;
beforeAll(async () => { process.env.JWT_SECRET ||= 'unit-test-jwt-secret-1234567890'; auth = await import('../../api/_utils/auth.js'); ({ default: handler } = await import('../../api/_handlers/pro/system-maintenance.js')); });
const call = async (role) => {
  const r = mk(); const headers = { host: 'x' };
  if (role) headers.authorization = 'Bearer ' + auth.signProToken({ id: 'u1', email: 'u1@example.test', structureId: 'S1', role });
  await handler({ method: 'POST', url: '/api/pro/system-maintenance', headers, body: { action: 'BACKUP' } }, r); return r;
};

describe('system-maintenance is not a cross-organization read for a structure administrator', () => {
  it('anonymous => 401; STRUCTURE_ADMIN and PRO => refused (no counts, no audit row, no query)', async () => {
    expect((await call(null)).statusCode).toBe(401);
    for (const role of ['STRUCTURE_ADMIN', 'PRO']) {
      DB.selects = 0; DB.inserts.length = 0;
      const r = await call(role);
      expect([401, 403], role).toContain(r.statusCode);
      expect(JSON.stringify(r.body)).not.toMatch(/counts|diagnostics|proUsers|backupId/); expect(DB.selects).toBe(0); expect(DB.inserts).toHaveLength(0);
    }
  });
  it('SUPERADMIN still gets the platform counts (the legitimate operator path is unchanged)', async () => {
    const r = await call('SUPERADMIN'); expect(r.statusCode).toBe(200); expect(r.body.counts).toEqual({ diagnostics: 7, auditEntries: 7, proUsers: 7 });
  });
  it('source guard: the role list contains only superadmin', () => {
    expect(readFileSync('api/_handlers/pro/system-maintenance.js', 'utf8')).toMatch(/requireProRole\(handler, \['superadmin'\]\)/);
  });
});
