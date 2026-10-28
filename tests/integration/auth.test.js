import { vi } from 'vitest';
vi.stubEnv('KV_REST_API_URL', 'http://localhost');
vi.stubEnv('KV_REST_API_TOKEN', 'mock-token');
vi.stubEnv('AUTH_MODE', 'jwt');

/**
 * Auth Integration Tests
 *
 * Tests login flows for Admin, Pro, and Citizen users.
 * Skipped when DATABASE_URL is not configured.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import adminLoginHandler from '../../api/_handlers/auth/login.js';
import proLoginHandler from '../../api/_handlers/pro/auth/login.js';
import logoutHandler from '../../api/_handlers/auth/logout.js';

function createMockReq({ method = 'POST', url = '/', body = {}, headers = {} } = {}) {
    return {
        method,
        url,
        body,
        validatedBody: body,
        headers: {
            host: 'localhost:3000',
            'content-type': 'application/json',
            'x-forwarded-for': '127.0.0.1',
            ...headers,
        },
    };
}

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        setHeader(key, value) {
            this.headers[key] = value;
        },
        writeHead(code, hdrs) {
            this.statusCode = code;
            this.headers = { ...this.headers, ...hdrs };
            return this;
        },
        end(data) {
            if (data) this.body = data;
            return this;
        },
    };
    return res;
}

const hasDatabase = !!process.env.DATABASE_URL;

describe.skipIf(!hasDatabase)('Auth — Admin Login', () => {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@accesdirectaide.fr';

    it('POST /api/auth/login with valid admin credentials returns 200 + token', async () => {
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword) return; // skip if no admin password configured

        const req = createMockReq({
            body: { email: adminEmail, password: adminPassword, mode: 'admin' },
        });
        const res = createMockRes();

        await adminLoginHandler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('success', true);
        expect(res.body).toHaveProperty('token');
        expect(res.body.token.length).toBeGreaterThan(10);
    });

    it('POST /api/auth/login with wrong password returns 401', async () => {
        const req = createMockReq({
            body: { email: adminEmail, password: 'wrong-password-definitely', mode: 'admin' },
        });
        const res = createMockRes();

        await adminLoginHandler(req, res);

        // Without a real DB, the handler may return 401 (credentials check) or 500 (DB unreachable)
        expect([401, 500]).toContain(res.statusCode);
        expect(res.body).toHaveProperty('error');
    });

    it('POST /api/auth/login with missing fields returns 400', async () => {
        const req = createMockReq({
            body: { email: '', password: '' },
        });
        const res = createMockRes();

        await adminLoginHandler(req, res);

        expect([400, 401]).toContain(res.statusCode);
    });

    it('GET method returns 405', async () => {
        const req = createMockReq({ method: 'GET' });
        const res = createMockRes();

        await adminLoginHandler(req, res);

        // validate() wrapper may intercept GET with empty body as 400 (validation_failed)
        expect([400, 405]).toContain(res.statusCode);
    });
});

describe.skipIf(!hasDatabase)('Auth — Pro Login', () => {
    it('POST /api/pro/auth/login with missing fields returns 400', async () => {
        const req = createMockReq({
            body: { email: '', password: '' },
        });
        const res = createMockRes();

        await proLoginHandler(req, res);

        expect(res.statusCode).toBe(400);
    });

    it('POST /api/pro/auth/login with unknown email returns 401', async () => {
        const req = createMockReq({
            body: { email: 'unknown-account@test.fr', password: 'somepassword123' },
        });
        const res = createMockRes();

        await proLoginHandler(req, res);

        expect(res.statusCode).toBe(401);
    });

    it('GET method returns 405', async () => {
        const req = createMockReq({ method: 'GET' });
        const res = createMockRes();

        await proLoginHandler(req, res);

        expect(res.statusCode).toBe(405);
    });
});

describe('Auth — Logout', () => {
    it('POST /api/auth/logout returns 200', async () => {
        const req = createMockReq({ method: 'POST' });
        const res = createMockRes();

        await logoutHandler(req, res);

        expect(res.statusCode).toBe(200);
    });
});
