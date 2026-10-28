import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

/**
 * RDV system contracts.
 */
describe('RDV system contracts', () => {
  const schema = readFileSync('src/db/schema.ts', 'utf-8');

  it('ProAppointment table in schema', () => {
    expect(schema).toMatch(/ProAppointment/);
  });

  it('ProRdvService table in schema', () => {
    expect(schema).toMatch(/ProRdvService/);
  });

  it('ProAvailabilityRule table in schema', () => {
    expect(schema).toMatch(/ProAvailabilityRule/);
  });

  it('appointments handler exists', () => {
    expect(existsSync('api/_handlers/pro/appointments.js')).toBe(true);
  });

  it('services handler exists', () => {
    expect(existsSync('api/_handlers/pro/services.js')).toBe(true);
  });

  it('slots handler exists', () => {
    expect(existsSync('api/_handlers/pro/slots.js')).toBe(true);
  });

  it('visio fields in schema', () => {
    expect(schema).toMatch(/visio/i);
  });
});
