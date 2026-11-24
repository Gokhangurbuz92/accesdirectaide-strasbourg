// services/hds/scripts/owner-deploy.sh must not reset the owner's « Santé » decision on a redeploy (R4, 24/11/2026):
// HDS_HEALTH_CATEGORY_ENABLED=false is the fail-closed default of a FIRST install only. Runs the script with fake scalingo/curl on PATH.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../services/hds/scripts/owner-deploy.sh');
const PUB = `k1:${'A'.repeat(120)}`;

function run(envNames) {
  const dir = mkdtempSync(join(tmpdir(), 'hds-owner-deploy-'));
  try {
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'scalingo'), `#!/usr/bin/env bash
echo "$*" >> "${log}"
for a in "$@"; do case "$a" in
  env) printf '%s\\n' ${envNames.map((n) => `'${n}=x'`).join(' ')}; exit 0 ;;
  addons) echo "postgresql running"; exit 0 ;;
esac; done
exit 0
`);
    writeFileSync(join(dir, 'curl'), '#!/usr/bin/env bash\necho ok\n');
    chmodSync(join(dir, 'scalingo'), 0o755); chmodSync(join(dir, 'curl'), 0o755);
    const out = execFileSync('bash', [SCRIPT, '--origin', 'https://www.example.fr', '--public-keys', PUB],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' });
    const sets = readFileSync(log, 'utf8').split('\n').filter((l) => l.includes(' env-set '));
    return { out, sets };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('HDS owner-deploy.sh keeps the health-category decision', () => {
  it('redeploy: HDS_HEALTH_CATEGORY_ENABLED already set → never written', () => {
    const { out, sets } = run(['DATABASE_URL', 'HDS_DATA_KEYS', 'HDS_HEALTH_CATEGORY_ENABLED', 'HDS_HEALTH_CONSENT_VERSION']);
    expect(sets.join('\n')).not.toMatch(/HDS_HEALTH_CATEGORY_ENABLED/);
    expect(sets.join('\n')).not.toMatch(/HDS_DATA_KEYS/);
    expect(sets.join('\n')).toMatch(/ALLOWED_ORIGIN=https:\/\/www\.example\.fr/);
    expect(out).toMatch(/HDS_HEALTH_CATEGORY_ENABLED kept/);
  });
  it('first install: fail-closed default false is written', () => {
    const { sets } = run(['DATABASE_URL', 'HDS_DATA_KEYS']);
    expect(sets.join('\n')).toMatch(/HDS_HEALTH_CATEGORY_ENABLED=false/);
  });
});
