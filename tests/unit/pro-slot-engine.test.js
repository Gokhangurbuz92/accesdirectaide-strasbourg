import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, expect, it } from 'vitest';

import { generateSlots } from '../../api/_utils/pro-rdv.js';

describe('pro slot engine', () => {
  it('generates slots from weekday rules', () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startTime: '09:00', endTime: '11:00', isActive: true }],
      from: new Date('2026-03-02T00:00:00.000Z'),
      to: new Date('2026-03-02T23:59:59.000Z'),
      durationMinutes: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      busyWindows: [],
    });

    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      startAt: '2026-03-02T09:00:00.000Z',
      endAt: '2026-03-02T10:00:00.000Z',
    });
    expect(slots[1]).toMatchObject({
      startAt: '2026-03-02T10:00:00.000Z',
      endAt: '2026-03-02T11:00:00.000Z',
    });
  });

  it('removes slots that overlap existing busy windows', () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startTime: '09:00', endTime: '11:00', isActive: true }],
      from: new Date('2026-03-02T00:00:00.000Z'),
      to: new Date('2026-03-02T23:59:59.000Z'),
      durationMinutes: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      busyWindows: [
        {
          start: new Date('2026-03-02T09:30:00.000Z'),
          end: new Date('2026-03-02T10:30:00.000Z'),
        },
      ],
    });

    expect(slots).toEqual([]);
  });

  it('applies buffers when checking collisions', () => {
    const slots = generateSlots({
      rules: [{ weekday: 1, startTime: '09:00', endTime: '11:00', isActive: true }],
      from: new Date('2026-03-02T00:00:00.000Z'),
      to: new Date('2026-03-02T23:59:59.000Z'),
      durationMinutes: 60,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      busyWindows: [
        {
          start: new Date('2026-03-02T10:00:00.000Z'),
          end: new Date('2026-03-02T11:00:00.000Z'),
        },
      ],
    });

    expect(slots).toEqual([]);
  });
});
