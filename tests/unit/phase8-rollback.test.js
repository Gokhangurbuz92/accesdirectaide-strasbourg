import { describe, it, expect, vi } from 'vitest';
import handler from '../../api/_handlers/admin/rollback.js';
import * as auth from '../../api/_utils/auth.js';

vi.mock('../../api/_utils/auth.js', () => ({
  requireAdminAuth: (handler) => async (req, res) => {
    if (req.headers?.authorization === 'Bearer valid-admin-token') {
      req.auth = { email: 'admin1' };
      return handler(req, res);
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
}));

describe('Admin Rollback Endpoint', () => {
  const createMockRes = () => {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockImplementation((data) => {
      res.jsonData = data;
      return res;
    });
    // Add statusCode to easily check it in tests
    res.status.mockImplementation((code) => {
      res.statusCode = code;
      return res;
    });
    return res;
  };

  it('rejects non-POST methods', async () => {
    const req = { method: 'GET', headers: { authorization: 'Bearer valid-admin-token' } };
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('requires admin authentication', async () => {
    const req = { method: 'POST' }; // Missing auth headers
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('requires entity ID', async () => {
    const req = { method: 'POST', query: {}, body: { targetVersion: 1, rationale: 'test rationale' }, headers: { authorization: 'Bearer valid-admin-token' } };
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonData.error).toMatch(/Entity ID required/);
  });

  it('requires target version', async () => {
    const req = { method: 'POST', query: { id: 'ent-123' }, body: { rationale: 'test' }, headers: { authorization: 'Bearer valid-admin-token' } };
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonData.error).toMatch(/Target version required/);
  });

  it('requires rationale', async () => {
    const req = { method: 'POST', query: { id: 'ent-123' }, body: { targetVersion: 1 }, headers: { authorization: 'Bearer valid-admin-token' } };
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonData.error).toMatch(/rationale required/);
  });

  it('successful rollback returns audit trail preserving provenance', async () => {
    const req = {
      method: 'POST',
      query: { id: 'ent-123' },
      body: { targetVersion: 1, rationale: 'test rationale' },
      headers: { authorization: 'Bearer valid-admin-token' }
    };
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.rollback).toBeDefined();
    expect(res.jsonData.rollback.action).toBe('ROLLBACK');
    expect(res.jsonData.rollback.entityId).toBe('ent-123');
    expect(res.jsonData.rollback.targetVersion).toBe(1);
    expect(res.jsonData.rollback.rationale).toBe('test rationale');
    expect(res.jsonData.rollback.adminId).toBe('admin1');
    expect(res.jsonData.rollback.timestamp).toBeDefined();
  });
});
