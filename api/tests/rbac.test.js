import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set Env BEFORE imports
process.env.JWT_SECRET = 'test-secret';

// Mock dependencies

vi.mock('../_utils/rateLimit.js', () => ({
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true })
}));

// Import AFTER mocks and env setup
import { requireAuth, ROLE, signProToken } from '../_utils/auth.js';

describe('RBAC Middleware', () => {
    /** @typedef {import('../_utils/http-types').ApiRequest} ApiRequest */
    /** @typedef {import('../_utils/http-types').ApiResponse} ApiResponse */

    /** @returns {ApiRequest} */
    const mockReq = (overrides = {}) => {
        return {
            method: 'GET',
            url: 'http://localhost/api/tests/rbac',
            headers: {},
            query: {},
            body: {},
            cookies: {},
            ...overrides,
        };
    };

    /** @returns {ApiResponse} */
    const mockRes = () => {
        const res = {};
        res.statusCode = 200;
        res.getHeader = vi.fn();
        res.setHeader = vi.fn();
        res.set = vi.fn();
        res.writeHead = vi.fn();
        res.end = vi.fn();
        res.status = vi.fn().mockReturnThis();
        res.json = vi.fn().mockReturnThis();
        res.send = vi.fn().mockReturnThis();
        res.redirect = vi.fn().mockReturnThis();
        return res;
    };

    it('should block requests without token', async () => {
        const handler = vi.fn();
        const wrapped = requireAuth(handler);

        const req = mockReq({ headers: {} });
        const res = mockRes();

        await wrapped(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('should allow valid pro token', async () => {
        const handler = vi.fn();
        const wrapped = requireAuth(handler);

        const user = { id: '123', email: 'test@test.com', structureId: 's1', role: ROLE.PRO };
        const token = signProToken(user);

        const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
        const res = mockRes();

        await wrapped(req, res);

        expect(handler).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.userId).toBe(user.id);
    });

    it('should enforce allowed roles', async () => {
        const handler = vi.fn();
        const wrapped = requireAuth(handler, [ROLE.STRUCTURE_ADMIN]);

        const user = { id: '123', email: 'pro@test.com', structureId: 's1', role: ROLE.PRO };
        const token = signProToken(user);

        const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
        const res = mockRes();

        await wrapped(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('should allow superadmin bypass', async () => {
        const handler = vi.fn();
        const wrapped = requireAuth(handler, [ROLE.STRUCTURE_ADMIN]);

        const user = {
            id: 'admin',
            email: 'superadmin@test.com',
            structureId: 's1',
            role: ROLE.SUPERADMIN,
        };
        const token = signProToken(user);

        const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
        const res = mockRes();

        await wrapped(req, res);

        expect(handler).toHaveBeenCalled();
    });
});
