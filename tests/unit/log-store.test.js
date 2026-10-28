import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @upstash/redis
const mockLpush = vi.fn().mockResolvedValue(1);
const mockLtrim = vi.fn().mockResolvedValue('OK');
const mockLrange = vi.fn().mockResolvedValue([]);

vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    constructor() {
      this.lpush = mockLpush;
      this.ltrim = mockLtrim;
      this.lrange = mockLrange;
    }
  },
}));

// Set env before importing
process.env.KV_REST_API_URL = 'https://fake-redis.upstash.io';
process.env.KV_REST_API_TOKEN = 'fake-token';

const { storeLog, getLogs } = await import('../../api/lib/log-store.js');

describe('log-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeLog', () => {
    it('writes a log entry to Redis via lpush', async () => {
      await storeLog('error', 'Something failed', { requestId: 'abc' });

      expect(mockLpush).toHaveBeenCalledTimes(1);
      const [key, entry] = mockLpush.mock.calls[0];
      expect(key).toBe('app:logs');

      const parsed = JSON.parse(entry);
      expect(parsed.level).toBe('error');
      expect(parsed.message).toBe('Something failed');
      expect(parsed.requestId).toBe('abc');
      expect(parsed.timestamp).toBeDefined();
    });

    it('trims the list to MAX_LOGS after each push', async () => {
      await storeLog('info', 'Test');

      expect(mockLtrim).toHaveBeenCalledWith('app:logs', 0, 499);
    });

    it('does not throw when Redis fails', async () => {
      mockLpush.mockRejectedValueOnce(new Error('Redis down'));

      await expect(storeLog('error', 'test')).resolves.toBeUndefined();
    });
  });

  describe('getLogs', () => {
    it('returns parsed log entries from Redis', async () => {
      const entries = [
        JSON.stringify({ timestamp: '2026-03-22T10:00:00Z', level: 'error', message: 'fail' }),
        JSON.stringify({ timestamp: '2026-03-22T09:00:00Z', level: 'info', message: 'ok' }),
      ];
      mockLrange.mockResolvedValueOnce(entries);

      const logs = await getLogs(10);

      expect(mockLrange).toHaveBeenCalledWith('app:logs', 0, 9);
      expect(logs).toHaveLength(2);
      expect(logs[0].level).toBe('error');
      expect(logs[1].message).toBe('ok');
    });

    it('handles objects already parsed by Redis', async () => {
      mockLrange.mockResolvedValueOnce([
        { timestamp: '2026-03-22T10:00:00Z', level: 'warn', message: 'parsed' },
      ]);

      const logs = await getLogs();
      expect(logs[0].level).toBe('warn');
    });

    it('returns empty array on Redis failure', async () => {
      mockLrange.mockRejectedValueOnce(new Error('Redis down'));

      const logs = await getLogs();
      expect(logs).toEqual([]);
    });
  });
});
