import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runGate(limit) {
  const env = { ...process.env };

  if (limit === undefined) {
    delete env.MAX_DESIGN_SYSTEM_VIOLATIONS;
  } else {
    env.MAX_DESIGN_SYSTEM_VIOLATIONS = String(limit);
  }

  return spawnSync(
    process.execPath,
    ['scripts/lint-design-system.mjs'],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf-8',
    },
  );
}

describe('design-system documented baseline gate', () => {
  it('accepts the documented current ceiling by default', () => {
    const result = runGate(undefined);
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(result.status).toBe(0);
    expect(output).toContain('non-regression ceiling (<= 150)');
  });

  it('allows callers to tighten the ceiling to zero', () => {
    const result = runGate(0);
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(result.status).toBe(1);
    expect(output).toContain('max allowed: 0');
  });

  it('refuses any attempt to loosen the documented ceiling', () => {
    const result = runGate(151);
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(result.status).toBe(2);
    expect(output).toContain('may only be tightened');
  });

  it('refuses malformed ceiling values', () => {
    const result = runGate('not-a-number');
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    expect(result.status).toBe(2);
    expect(output).toContain(
      'expected an integer between 0 and 150',
    );
  });
});
