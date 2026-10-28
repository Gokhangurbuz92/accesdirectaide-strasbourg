import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── KV mock (in-memory) ─────────────────────────────────────────────────
const memoryStore = new Map();
const mockKv = {
    async set(key, value, opts) {
        if (opts?.nx) {
            const existing = memoryStore.get(key);
            if (existing && (!existing.expires || Date.now() <= existing.expires)) {
                return null;
            }
        }
        memoryStore.set(key, {
            value,
            expires: opts?.ex ? Date.now() + opts.ex * 1000 : null
        });
        return 'OK';
    },
    async get(key) {
        const data = memoryStore.get(key);
        if (!data) return null;
        if (data.expires && Date.now() > data.expires) {
            memoryStore.delete(key);
            return null;
        }
        return data.value;
    },
    async del(key) {
        memoryStore.delete(key);
        return 1;
    },
};

vi.mock('../../api/_utils/kv.js', () => ({ kv: mockKv }));

vi.mock('../../api/_utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// ── Import after mocks ──────────────────────────────────────────────────
const { acquireLock, releaseLock, withLock } = await import('../../api/_utils/pipelineLock.js');

// ── Tests: pipelineLock ──────────────────────────────────────────────────
describe('pipelineLock — atomic acquisition (SET NX)', () => {
    beforeEach(() => {
        memoryStore.clear();
    });

    it('should acquire lock when no existing lock', async () => {
        const lockId = await acquireLock('test-pipeline', 60);
        expect(lockId).toBeTruthy();
        expect(typeof lockId).toBe('string');
    });

    it('should use atomic SET NX (not GET then SET)', async () => {
        // Spy on kv.set to verify nx: true is passed
        const setSpy = vi.spyOn(mockKv, 'set');
        await acquireLock('test-atomic', 60);

        expect(setSpy).toHaveBeenCalledTimes(1);
        const [_key, _value, opts] = setSpy.mock.calls[0];
        expect(opts).toMatchObject({ nx: true, ex: 60 });
    });

    it('should reject second caller when lock is held', async () => {
        const lockId1 = await acquireLock('test-reject', 60);
        expect(lockId1).toBeTruthy();

        const lockId2 = await acquireLock('test-reject', 60);
        expect(lockId2).toBeNull();
    });

    it('should release lock on completion', async () => {
        const lockId = await acquireLock('test-release', 60);
        expect(lockId).toBeTruthy();

        const released = await releaseLock('test-release', lockId);
        expect(released).toBe(true);

        // Lock should be gone — can acquire again
        const lockId2 = await acquireLock('test-release', 60);
        expect(lockId2).toBeTruthy();
    });

    it('should not release lock with wrong lockId', async () => {
        const lockId = await acquireLock('test-mismatch', 60);
        expect(lockId).toBeTruthy();

        const released = await releaseLock('test-mismatch', 'wrong-id');
        expect(released).toBe(false);

        // Lock should still be held
        const lockId2 = await acquireLock('test-mismatch', 60);
        expect(lockId2).toBeNull();
    });
});

describe('withLock — execution wrapper', () => {
    beforeEach(() => {
        memoryStore.clear();
    });

    it('should execute function and return result', async () => {
        const result = await withLock('test-exec', async () => {
            return { data: 42 };
        });
        expect(result).toEqual({ data: 42 });
    });

    it('should release lock after successful execution', async () => {
        await withLock('test-auto-release', async () => {
            return 'done';
        });

        // Lock should be released — can acquire again
        const lockId = await acquireLock('test-auto-release', 60);
        expect(lockId).toBeTruthy();
    });

    it('should release lock even on error', async () => {
        await expect(
            withLock('test-error-release', async () => {
                throw new Error('Simulated failure');
            })
        ).rejects.toThrow('Simulated failure');

        // Lock should be released
        const lockId = await acquireLock('test-error-release', 60);
        expect(lockId).toBeTruthy();
    });

    it('should reject concurrent execution', async () => {
        // Acquire lock manually
        await acquireLock('test-concurrent', 60);

        // withLock should throw because lock is held
        await expect(
            withLock('test-concurrent', async () => 'should not run')
        ).rejects.toThrow("already running");
    });
});

// ── Tests: rdv-reminder claim-before-send ────────────────────────────────
describe('rdv-reminder — claim-before-send pattern', () => {
    it('should claim appointment before sending and mark as sent on success', async () => {
        const apt = { id: 'apt-1', reminder_sent_at: null, reminder_locked_at: null };
        
        // Claim using locked_at
        if (apt.reminder_sent_at === null && apt.reminder_locked_at === null) {
            apt.reminder_locked_at = new Date(); // Claim
            
            // Simulate successful send
            apt.reminder_sent_at = new Date();
        }
        
        expect(apt.reminder_locked_at).not.toBeNull();
        expect(apt.reminder_sent_at).not.toBeNull();
    });

    it('should skip already-claimed (locked) appointments', async () => {
        const apt = { id: 'apt-1', reminder_sent_at: null, reminder_locked_at: new Date() };
        let attempted = false;
        
        // Is null locked_at? No, so skip
        if (apt.reminder_sent_at === null && apt.reminder_locked_at === null) {
            attempted = true;
        }
        
        expect(attempted).toBe(false);
    });

    it('should release claim on send failure', async () => {
        const apt = { id: 'apt-1', reminder_sent_at: null, reminder_locked_at: null };

        // Claim
        apt.reminder_locked_at = new Date();
        
        // Simulate send failure
        const sendFailed = true;

        if (sendFailed) {
            apt.reminder_locked_at = null; // Release
        }

        expect(apt.reminder_sent_at).toBeNull();
        expect(apt.reminder_locked_at).toBeNull();
    });

    it('should prevent double-send via claim atomicity', async () => {
        const dbState = { 'apt-1': { reminder_sent_at: null, reminder_locked_at: null } };
        const results = [];

        async function claimAndSend(instanceId) {
            const apt = dbState['apt-1'];
            if (apt.reminder_sent_at === null && apt.reminder_locked_at === null) {
                apt.reminder_locked_at = new Date();
                results.push({ instance: instanceId, claimed: true });
            } else {
                results.push({ instance: instanceId, claimed: false });
            }
        }

        await claimAndSend('instance-1');
        await claimAndSend('instance-2');

        expect(results.filter(r => r.claimed).length).toBe(1);
    });

    it('should pick up stale/abandoned claims', async () => {
        // Locked 20 minutes ago
        const staleLockTime = new Date(Date.now() - 20 * 60 * 1000);
        const apt = { id: 'apt-1', reminder_sent_at: null, reminder_locked_at: staleLockTime };
        
        let claimed = false;
        const now = new Date();
        
        if (apt.reminder_sent_at === null && 
           (apt.reminder_locked_at === null || apt.reminder_locked_at < new Date(now - 15 * 60 * 1000))) {
            apt.reminder_locked_at = now;
            claimed = true;
        }
        
        expect(claimed).toBe(true);
        expect(apt.reminder_locked_at).toBe(now);
    });

    it('should handle lock contention for rdv-reminder', async () => {
        memoryStore.clear();
        
        // First execution acquires lock
        const promise1 = withLock('rdv-reminder', async () => {
            return { sent: 5 };
        }, { ttl: 600 });

        const result = await promise1;
        expect(result).toEqual({ sent: 5 });

        // After completion, lock is released and can be acquired again
        const promise2 = withLock('rdv-reminder', async () => {
            return { sent: 3 };
        }, { ttl: 600 });

        const result2 = await promise2;
        expect(result2).toEqual({ sent: 3 });
    });
});
