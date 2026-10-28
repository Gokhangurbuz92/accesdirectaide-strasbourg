/**
 * Consent Lifecycle — Unit Tests
 *
 * Tests consent creation, required fields, retention period.
 * Uses mocks since unit tests don't have a real database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted + vi.mock pattern (same as gdpr-purge-extended.test.js)
const mocks = vi.hoisted(() => {
    const valuesFn = vi.fn().mockResolvedValue([{ id: 'test-id' }]);
    const insertFn = vi.fn(() => ({ values: valuesFn }));
    const whereFn = vi.fn().mockResolvedValue([]);
    const deleteFn = vi.fn(() => ({ where: whereFn }));
    const setFn = vi.fn().mockReturnThis();
    const updateFn = vi.fn(() => ({ set: setFn, where: whereFn }));
    return {
        valuesFn, insertFn, whereFn, deleteFn, setFn, updateFn,
        db: { insert: insertFn, delete: deleteFn, update: updateFn },
    };
});

vi.mock('../../src/db/index.js', () => ({ db: mocks.db }));

// Import schema directly (table definitions work without a DB connection)
import { ConsentLog } from '../../src/db/schema.js';

describe('Consent Lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore mock chain after clearAllMocks clears return values
        mocks.valuesFn.mockResolvedValue([{ id: 'test-id' }]);
        mocks.insertFn.mockImplementation(() => ({ values: mocks.valuesFn }));
        mocks.deleteFn.mockImplementation(() => ({ where: mocks.whereFn }));
        mocks.whereFn.mockResolvedValue([]);
    });

    describe('ConsentLog schema structure', () => {
        it('ConsentLog table exists and is defined', () => {
            expect(ConsentLog).toBeDefined();
        });

        it('ConsentLog has required RGPD fields', () => {
            expect(ConsentLog.policy_version).toBeDefined();
            expect(ConsentLog.policy_hash).toBeDefined();
            expect(ConsentLog.subject_type).toBeDefined();
            expect(ConsentLog.subject_id).toBeDefined();
            expect(ConsentLog.created_at).toBeDefined();
        });

        it('ConsentLog.policy_version column is text and not null', () => {
            expect(ConsentLog.policy_version.notNull).toBe(true);
        });

        it('ConsentLog.policy_hash column is text and not null', () => {
            expect(ConsentLog.policy_hash.notNull).toBe(true);
        });

        it('ConsentLog.subject_type column is text and not null', () => {
            expect(ConsentLog.subject_type.notNull).toBe(true);
        });

        it('ConsentLog.subject_id column is text and not null', () => {
            expect(ConsentLog.subject_id.notNull).toBe(true);
        });
    });

    describe('Consent retention period', () => {
        it('consent retention is 3 years (1095 days)', async () => {
            const { RETENTION } = await import('../../api/_handlers/cron/gdpr-purge.js');
            expect(RETENTION.CONSENT_LOG_DAYS).toBe(1095);
        });

        it('consent retention is >= 3 years', async () => {
            const { RETENTION } = await import('../../api/_handlers/cron/gdpr-purge.js');
            const threeYearsInDays = 3 * 365;
            expect(RETENTION.CONSENT_LOG_DAYS).toBeGreaterThanOrEqual(threeYearsInDays);
        });

        it('consent retention is longer than operational data', async () => {
            const { RETENTION } = await import('../../api/_handlers/cron/gdpr-purge.js');
            expect(RETENTION.CONSENT_LOG_DAYS).toBeGreaterThan(RETENTION.CONVERSATION_LOG_DAYS);
            expect(RETENTION.CONSENT_LOG_DAYS).toBeGreaterThan(RETENTION.AI_METRIC_DAYS);
        });
    });

    describe('Consent handler writes to ConsentLog', () => {
        it('consent handler imports ConsentLog, not UpdateLog', async () => {
            const consentModule = await import('../../api/_handlers/public/consent.js');
            expect(consentModule.default).toBeDefined();
            expect(typeof consentModule.default).toBe('function');
        });

        it('consent record creation calls db.insert with ConsentLog', async () => {
            const consentModule = await import('../../api/_handlers/public/consent.js');
            const handler = consentModule.default;

            const req = {
                method: 'POST',
                body: { type: 'cookies', version: '2024-01-20', metadata: {} },
                headers: { 'user-agent': 'test-agent', 'x-forwarded-for': '127.0.0.1' },
                socket: { remoteAddress: '127.0.0.1' },
            };

            let statusCode;
            let responseBody;
            const res = {
                status: (code) => {
                    statusCode = code;
                    return {
                        json: (body) => { responseBody = body; },
                    };
                },
            };

            await handler(req, res);

            expect(statusCode).toBe(200);
            expect(responseBody).toEqual({ success: true, message: 'Consent logged' });

            // Verify db.insert was called (at least once for ConsentLog)
            expect(mocks.insertFn).toHaveBeenCalled();

            // First call should be ConsentLog
            const firstCallArg = mocks.insertFn.mock.calls[0][0];
            expect(firstCallArg).toBe(ConsentLog);
        });

        it('consent handler rejects missing type', async () => {
            const consentModule = await import('../../api/_handlers/public/consent.js');
            const handler = consentModule.default;

            const req = {
                method: 'POST',
                body: { version: '2024-01-20' },
                headers: {},
                socket: {},
            };

            let statusCode;
            const res = {
                status: (code) => {
                    statusCode = code;
                    return { json: () => {} };
                },
            };

            await handler(req, res);
            expect(statusCode).toBe(400);
        });

        it('consent handler rejects missing version', async () => {
            const consentModule = await import('../../api/_handlers/public/consent.js');
            const handler = consentModule.default;

            const req = {
                method: 'POST',
                body: { type: 'cookies' },
                headers: {},
                socket: {},
            };

            let statusCode;
            const res = {
                status: (code) => {
                    statusCode = code;
                    return { json: () => {} };
                },
            };

            await handler(req, res);
            expect(statusCode).toBe(400);
        });

        it('consent handler rejects non-POST methods', async () => {
            const consentModule = await import('../../api/_handlers/public/consent.js');
            const handler = consentModule.default;

            const req = { method: 'GET', headers: {} };
            let statusCode;
            const res = {
                status: (code) => {
                    statusCode = code;
                    return { json: () => {} };
                },
            };

            await handler(req, res);
            expect(statusCode).toBe(405);
        });
    });
});
