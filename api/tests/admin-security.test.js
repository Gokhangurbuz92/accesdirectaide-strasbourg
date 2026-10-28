import { describe, it, expect, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.ADMIN_TOKEN = 'test-admin-token';

import { verifyAdmin } from '../_utils/auth.js';
import { signProToken, ROLE } from '../_utils/auth.js';

describe('Admin Security', () => {
    it('should reject Pro token accessing Admin', async () => {
        const proUser = { id: 'pro', role: ROLE.PRO };
        const proToken = signProToken(proUser);

        const req = {
            headers: { authorization: `Bearer ${proToken}` }
        };

        const result = await verifyAdmin(req);
        expect(result).toBe(false);
    });
});
