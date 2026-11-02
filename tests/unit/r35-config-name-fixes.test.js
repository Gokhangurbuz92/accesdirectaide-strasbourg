import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { outlookStatus } from '../../api/_services/calendar-outlook.js';

// R35 (activation audit): two places read a variable name nothing else uses, so a correctly configured deployment looked unconfigured.
const base = { OUTLOOK_ENABLED: 'true', OUTLOOK_CLIENT_ID: 'id', OUTLOOK_CLIENT_SECRET: 's', OUTLOOK_REDIRECT_URI: 'https://x.example/api/auth/callback/outlook' };

describe('R35 configuration name fixes', () => {
  it('Outlook accepts the canonical vault key ADA_VAULT_KEY (and still its former name)', () => {
    expect(outlookStatus({ ...base })).toEqual({ enabled: false, reason: 'MISSING_ENCRYPTION_KEY' });
    expect(outlookStatus({ ...base, ADA_VAULT_KEY: 'k'.repeat(32) })).toEqual({ enabled: true, reason: null });
    expect(outlookStatus({ ...base, OUTLOOK_TOKEN_ENCRYPTION_KEY: 'k'.repeat(32) })).toEqual({ enabled: true, reason: null });
    expect(outlookStatus({ ...base, ADA_VAULT_KEY: 'k'.repeat(32), VERCEL_ENV: 'production' })).toEqual({ enabled: false, reason: 'PRODUCTION_ACTIVATION_PENDING' });
  });

  it('the pro health page reads the object storage variables the upload code uses, not R2_ACCESS_KEY_ID', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../api/_handlers/pro/health-check.js'), 'utf8');
    expect(src).not.toMatch(/process\.env\.R2_ACCESS_KEY_ID/);
    expect(src).toMatch(/env\.storage\.endpoint && env\.storage\.bucket && env\.storage\.accessKeyId && env\.storage\.secretAccessKey/);
  });
});
