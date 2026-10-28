import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';

/**
 * Notification system contracts.
 */
describe('Notification system', () => {
  const schema = readFileSync('src/db/schema.ts', 'utf-8');

  it('ProNotification table exists in schema', () => {
    expect(schema).toMatch(/ProNotification/);
  });

  it('RdvConversationMessage table exists', () => {
    expect(schema).toMatch(/RdvConversationMessage/);
  });

  it('notifications handler exists', () => {
    expect(existsSync('api/_handlers/pro/notifications.js')).toBe(true);
  });

  it('rdv-reminder cron exists', () => {
    expect(existsSync('api/_handlers/cron/rdv-reminder.js')).toBe(true);
  });
});
