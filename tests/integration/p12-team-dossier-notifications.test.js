import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';

import apiHandler from '../../api/index.js';
import { signProToken } from '../../api/_utils/auth.js';

function createReq(overrides = {}) {
    return {
        method: overrides.method || 'GET',
        url: overrides.url || '/api/pro/team',
        headers: {
            host: 'localhost:3000',
            'x-forwarded-proto': 'http',
            ...(overrides.headers || {}),
        },
        query: overrides.query || {},
        body: overrides.body || null,
        cookies: {},
    };
}

function createRes() {
    const headers = {};
    const finishListeners = [];
    return {
        statusCode: 200,
        body: null,
        headersSent: false,
        on(event, listener) {
            if (event === 'finish' && typeof listener === 'function') finishListeners.push(listener);
            return this;
        },
        setHeader(key, value) { headers[String(key).toLowerCase()] = String(value); },
        getHeader(key) { return headers[String(key).toLowerCase()]; },
        status(code) { this.statusCode = code; return this; },
        writeHead(code, outHeaders = {}) {
            this.statusCode = code;
            for (const [key, value] of Object.entries(outHeaders)) headers[String(key).toLowerCase()] = String(value);
            return this;
        },
        json(payload) { this.body = payload; this.headersSent = true; for (const l of finishListeners) l(); return this; },
        send(payload) { this.body = payload; this.headersSent = true; for (const l of finishListeners) l(); return this; },
        end(payload) { if (payload !== undefined) this.body = payload; this.headersSent = true; for (const l of finishListeners) l(); return this; },
    };
}

async function invokeApi(url, options = {}) {
    const req = createReq({ method: options.method, url, headers: options.headers, body: options.body });
    const res = createRes();
    await apiHandler(req, res);
    return res;
}

/**
 * P12 — Team, Dossier, and Notifications integration tests
 */
describe('P12 — Team management', () => {
    const adminToken = signProToken({
        id: 'admin-team-test',
        email: 'admin@test.local',
        structureId: 'structure-team',
        role: 'STRUCTURE_ADMIN',
    });

    const proToken = signProToken({
        id: 'pro-team-test',
        email: 'pro@test.local',
        structureId: 'structure-team',
        role: 'PRO',
    });

    it('GET /api/pro/team without token → 401', async () => {
        const res = await invokeApi('/api/pro/team');
        expect(res.statusCode).toBe(401);
    });

    it('GET /api/pro/team with PRO role → 403 (admin-only)', async () => {
        const res = await invokeApi('/api/pro/team', {
            headers: { authorization: `Bearer ${proToken}` },
        });
        expect(res.statusCode).toBe(403);
    });

    it('GET /api/pro/team with admin token → not 401/403', async () => {
        const res = await invokeApi('/api/pro/team', {
            headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
    });

    it('PATCH /api/pro/team without targetUserId → 400', async () => {
        const res = await invokeApi('/api/pro/team', {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${adminToken}`,
                'content-type': 'application/json',
            },
            body: { role: 'STRUCTURE_ADMIN' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('PATCH /api/pro/team with invalid role → 400', async () => {
        const res = await invokeApi('/api/pro/team', {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${adminToken}`,
                'content-type': 'application/json',
            },
            body: { targetUserId: 'someone', role: 'INVALID' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('PATCH /api/pro/team self-role-change → 400', async () => {
        const res = await invokeApi('/api/pro/team', {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${adminToken}`,
                'content-type': 'application/json',
            },
            body: { targetUserId: 'admin-team-test', role: 'PRO' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('P12 — Dossier export', () => {
    it('GET /api/pro/dossier/export without token → 401', async () => {
        const res = await invokeApi('/api/pro/dossier/export?shareId=abc');
        expect(res.statusCode).toBe(401);
    });

    it('GET /api/pro/dossier/export without shareId → 400', async () => {
        const token = signProToken({
            id: 'pro-dossier-test',
            email: 'dossier@test.local',
            structureId: 'structure-dossier',
            role: 'PRO',
        });
        const res = await invokeApi('/api/pro/dossier/export', {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(400);
    });

    it('GET /api/pro/dossier/views without shareId → 400', async () => {
        const token = signProToken({
            id: 'pro-views-test',
            email: 'views@test.local',
            structureId: 'structure-views',
            role: 'PRO',
        });
        const res = await invokeApi('/api/pro/dossier/views', {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('P12 — Notifications CRUD', () => {
    const proToken = signProToken({
        id: 'pro-notif-test',
        email: 'notif@test.local',
        structureId: 'structure-notif',
        role: 'PRO',
    });

    it('GET /api/pro/notifications without token → 401', async () => {
        const res = await invokeApi('/api/pro/notifications');
        expect(res.statusCode).toBe(401);
    });

    it('PATCH /api/pro/notifications without ids → 400', async () => {
        const res = await invokeApi('/api/pro/notifications', {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${proToken}`,
                'content-type': 'application/json',
            },
            body: { action: 'read' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('PATCH /api/pro/notifications with invalid action → 400', async () => {
        const res = await invokeApi('/api/pro/notifications', {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${proToken}`,
                'content-type': 'application/json',
            },
            body: { ids: ['abc'], action: 'invalid' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('P12 — Outlook OAuth', () => {
    it('GET /api/pro/outlook without token → 401', async () => {
        const res = await invokeApi('/api/pro/outlook?action=status');
        expect(res.statusCode).toBe(401);
    });

    it('GET /api/pro/outlook with token, OUTLOOK_ENABLED=false → not_configured', async () => {
        const originalVal = process.env.OUTLOOK_ENABLED;
        process.env.OUTLOOK_ENABLED = 'false';

        const token = signProToken({
            id: 'pro-outlook-test',
            email: 'outlook@test.local',
            structureId: 'structure-outlook',
            role: 'PRO',
        });

        const res = await invokeApi('/api/pro/outlook?action=status', {
            headers: { authorization: `Bearer ${token}` },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ ok: false, status: 'not_configured' });

        if (originalVal !== undefined) process.env.OUTLOOK_ENABLED = originalVal;
        else delete process.env.OUTLOOK_ENABLED;
    });
});
