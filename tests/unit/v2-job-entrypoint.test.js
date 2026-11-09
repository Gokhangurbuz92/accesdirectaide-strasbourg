// V2 C7 — the job startup script is delivered as a Secret Manager FILE (Scaleway's model for complex startup scripts), pinned by SHA-256, never as a
// multiline environment variable. Guards: one canonical copy, LF only, small enough for a secret version, the documented one-line startup command
// is the same in the script header and in the README, and the old variable + eval design is gone.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const ep = fs.readFileSync(path.join(ROOT, 'ops/cloud-backup/job-entrypoint.sh'));
const readme = fs.readFileSync(path.join(ROOT, 'ops/cloud-backup/README.md'), 'utf8');
const startupIn = (text) => (text.match(/\/bin\/sh -c 'echo "\$ADA_ENTRYPOINT_SHA256 {2}\/ada\/job-entrypoint\.sh" \| sha256sum -c --status - && exec \/bin\/sh \/ada\/job-entrypoint\.sh \|\| \{ echo "\{\\"ok\\":false,\\"code\\":\\"ENTRYPOINT_DIGEST_MISMATCH\\"\}"; exit 1; \}'/) || [null])[0];

describe('V2 C7 job startup script', () => {
  it('LF only, POSIX sh shebang, set -eu, well under the secret size limit', () => {
    expect(ep.includes(13)).toBe(false);
    const text = ep.toString('utf8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toMatch(/^set -eu$/m);
    expect(ep.length).toBeLessThan(16 * 1024);
  });
  it('the one-line startup command is identical in the script header and the README', () => {
    const inScript = startupIn(ep.toString('utf8'));
    expect(inScript).not.toBeNull();
    expect(startupIn(readme)).toBe(inScript);
    expect(inScript).not.toMatch(/\n/);
  });
  it('no multiline-variable / eval delivery remains as an instruction', () => {
    expect(ep.toString('utf8')).not.toMatch(/eval\s+"\$ADA_ENTRYPOINT"/);
    expect(readme).not.toMatch(/Job command[^\n]*eval "\$ADA_ENTRYPOINT"/);
  });
  it('every pin is enforced in the script: release SHA, archive digest, PGDG fingerprint, PG 18 client', () => {
    const t = ep.toString('utf8');
    for (const code of ['ADA_SCRIPTS_SHA_INVALID', 'SCRIPTS_ARCHIVE_DIGEST_MISMATCH', 'PGDG_KEY_FINGERPRINT_MISMATCH', 'PG_CLIENT_18_MISSING', 'ADA_JOB_INVALID']) expect(t).toContain(code);
  });
});
