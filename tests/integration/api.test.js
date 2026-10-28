import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect, beforeEach } from 'vitest';
import aidesHandler from '../../api/_handlers/aides.js';
import structuresHandler from '../../api/_handlers/structures.js';
import bookingHandler from '../../api/_handlers/public/appointments/create.js';

// Mock Sentry
vi.mock('../../api/_utils/sentry.js', () => ({
  default: {
    configureScope: vi.fn(),
    captureException: vi.fn(),
  }
}));

// Mock Rate Limit
vi.mock('../../api/_utils/rateLimit.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1')
}));

// Mock Crypto
vi.mock('../../api/lib/crypto.js', () => ({
  encrypt: vi.fn(val => `encrypted_${val}`),
  decrypt: vi.fn(val => val.replace('encrypted_', '')),
  hash: vi.fn(val => `hash_${val}`)
}));

// Mock Prisma
const db = vi.hoisted(() => ({
  aide: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  structure: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  beneficiary: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  service: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  appointment: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn((callback) => callback(db)),
}));

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor() {
        return db;
      }
    },
    Prisma: {
      PrismaClientKnownRequestError: class extends Error {
        constructor(message, code) {
          super(message);
          this.code = code;
        }
      },
      sql: vi.fn(),
      raw: vi.fn((value) => value),
      join: vi.fn(),
      empty: Symbol('Prisma.empty')
    }
  };
});

describe.skip('API Integration Tests (Obsolete - See p0-api-smoke and aides_v2)', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();

    // Fix $transaction mock to pass db
    db.$transaction.mockImplementation(async (callback) => {
      return await callback(db);
    });

    req = {
      method: 'GET',
      query: {},
      body: {},
      headers: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      headersSent: false
    };
  });

  describe('GET /api/aides', () => {
    it('should return valid envelope on success', async () => {
      // Setup Mock
      db.$queryRaw
        .mockResolvedValueOnce([{ id: '1', rank: 1 }]) // items
        .mockResolvedValueOnce([{ total: 1 }])         // count
        .mockResolvedValueOnce([{ themes: {}, organismes: {}, publics: {}, territoires: {} }]); // facets
      db.aide.findMany.mockResolvedValue([{ id: '1', title: 'Test' }]);
      db.aide.count.mockResolvedValue(1);

      await aidesHandler(req, res);

      // Verify status
      expect(res.status).toHaveBeenCalledWith(200);

      // Verify JSON structure
      const response = res.json.mock.calls[0][0];
      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('pagination');
      // expect(response.pagination).toHaveProperty('total'); // implied
      expect(response.error).toBeUndefined();

      // Verify Data
      expect(response.items).toHaveLength(1);
      expect(response.items[0].id).toBe('1');
    });

    it('should return validation error for invalid page', async () => {
      req.query = { page: 'invalid' };

      await aidesHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const response = res.json.mock.calls[0][0];
      expect(response.error).toMatch(/Invalid parameters/); // Zod error format might satisfy this or detailed check
    });
  });

  describe('GET /api/structures', () => {
    it('should return valid envelope on success', async () => {
      db.$queryRaw
        .mockResolvedValueOnce([{ id: '1' }]) // items
        .mockResolvedValueOnce([{ total: 1 }]); // count
      db.structure.findMany.mockResolvedValue([{ id: '1', nom: 'Structure Test' }]);
      db.structure.count.mockResolvedValue(1);

      await structuresHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = res.json.mock.calls[0][0];
      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('pagination');
      expect(response.items).toHaveLength(1);
      expect(response.items[0].nom).toBe('Structure Test');
    });

    it('should return validation error for invalid zip', async () => {
      req.query = { zip: 12345 }; // zip should be string in query if parsed by express/vercel, but if we pass number manually in req.query object it might be coerced?
      // Zod expects string. if req.query has number, Zod might fail if we don't use coerce.
      // My schema uses z.string().optional().
      // If I pass number in tests, it should fail.
      req.query = { zip: 12345 };

      await structuresHandler(req, res);

      // Actually, Express/Vercel query params are usually strings.
      // But if I manually set it to number in tests, I test Zod behavior.
      // Zod string() doesn't accept number.

      expect(res.status).toHaveBeenCalledWith(400);
      const response = res.json.mock.calls[0][0];
      expect(response.error).toMatch(/Invalid parameters/);
    });
  });

  describe('POST /api/appointments', () => {
    beforeEach(() => {
      req.method = 'POST';
    });

    it('should validate body', async () => {
      req.body = { structureId: '123' }; // Missing email, startAt

      await bookingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const response = res.json.mock.calls[0][0];
      expect(response.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle logic error (SLOT_TAKEN)', async () => {
      // Setup valid body
      req.body = {
        structureId: '123',
        startAt: '2023-01-01T10:00:00Z',
        email: 'test@example.com'
      };

      // Mock dependencies for success up to transaction
      db.beneficiary.findFirst.mockResolvedValue({ id: 'ben_1' });
      db.service.findFirst.mockResolvedValue({ id: 'ser_1', duration_minutes: 60 });

      // Mock transaction to fail
      db.$transaction.mockImplementation(async () => {
        throw new Error('SLOT_TAKEN');
      });

      await bookingHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      const response = res.json.mock.calls[0][0];
      expect(response.error.code).toBe('CONFLICT');
    });
  });
});
