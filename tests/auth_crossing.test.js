import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from "vitest";

describe("Security: Token Crossing", () => {
    it("should REJECT a Pro JWT on Admin Check (verifyAdmin)", async () => {
        process.env.ADMIN_TOKEN = "SUPER_SECRET_ADMIN_TOKEN_123";
        process.env.JWT_SECRET = "SUPER_SECRET_JWT_KEY_456";

        vi.resetModules();

        const { verifyAdmin } = await import("../api/_utils/auth.js");
        const { signProToken } = await import("../api/_utils/auth.js");

        const proUser = { id: 1, email: "pro@test.com", structureId: 1, role: "PRO" };
        const proToken = signProToken(proUser);

        const req = { headers: { authorization: `Bearer ${proToken}` } };
        expect(await verifyAdmin(req)).toBe(false);
    });

    it("should REJECT an Admin Token on Pro Check (verifyProToken)", async () => {
        process.env.ADMIN_TOKEN = "SUPER_SECRET_ADMIN_TOKEN_123";
        process.env.JWT_SECRET = "SUPER_SECRET_JWT_KEY_456";

        vi.resetModules();

        const { verifyProToken } = await import("../api/_utils/auth.js");
        expect(verifyProToken(process.env.ADMIN_TOKEN)).toBe(null);
    });

    it("should REJECT a forged Admin Token with wrong length", async () => {
        process.env.ADMIN_TOKEN = "SUPER_SECRET_ADMIN_TOKEN_123";
        vi.resetModules();
        const { verifyAdmin } = await import("../api/_utils/auth.js");

        const req = {
            headers: { authorization: 'Bearer SHORT' }
        };
        expect(await verifyAdmin(req)).toBe(false);
    });

    it("should REJECT a forged Admin Token with same length but wrong content", async () => {
        process.env.ADMIN_TOKEN = "SUPER_SECRET_ADMIN_TOKEN_123";
        vi.resetModules();
        const { verifyAdmin } = await import("../api/_utils/auth.js");

        // Same length as 'SUPER_SECRET_ADMIN_TOKEN_123' (28 chars)
        const forged = 'SUPER_SECRET_ADMIN_TOKEN_OOO';
        const req = {
            headers: { authorization: `Bearer ${forged}` }
        };
        expect(await verifyAdmin(req)).toBe(false);
    });
});
