/**
 * UI modernisation (24/11/2026) — guards of the design-token layer and of the ADA Pro audit names.
 *  - src/styles/theme-palette.css is the output of scripts/gen-theme-palette.mjs (not edited by hand);
 *  - in light mode every palette variable equals Tailwind's own colour (the light rendering and its contrast tests are unchanged);
 *  - the dark theme and the accessibility panel's dark mode share one rule; high contrast is light-only;
 *  - every action code written by logProAudit has a readable name (display only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { proAuditActionNames } from '../../src/lib/proAuditLabels.js';

const require = createRequire(import.meta.url);
const twColors = require('tailwindcss/colors');
const css = fs.readFileSync('src/styles/theme-palette.css', 'utf8');
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`; };

describe('UI modernisation — palette variables', () => {
  it('the committed palette is the generator output', () => {
    expect(() => execFileSync(process.execPath, ['scripts/gen-theme-palette.mjs', '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('light values equal the Tailwind colours', () => {
    const light = css.slice(css.indexOf(':root {'), css.indexOf('}'));
    for (const f of ['slate', 'blue', 'red', 'amber', 'emerald', 'indigo']) {
      for (const s of ['50', '200', '500', '700', '900']) expect(light).toContain(`--c-${f}-${s}: ${rgb(twColors[f][s])};`);
    }
  });

  it('dark applies to html.dark and html.dark-mode; high contrast only on a light page', () => {
    expect(css).toMatch(/:root:is\(\.dark, \.dark-mode\) \{/);
    expect(css).toMatch(/:root\.high-contrast:not\(\.dark\):not\(\.dark-mode\) \{/);
    const tokens = fs.readFileSync('src/styles/tokens.css', 'utf8');
    expect(tokens).toMatch(/:root:is\(\.dark, \.dark-mode\) \{[^}]*--ada-surface/);
  });
});

describe('UI modernisation — ADA Pro audit log names', () => {
  it('every code passed to logProAudit has a name', () => {
    const codes = new Set();
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', 'tests'].includes(e.name)) walk(p); } else if (/\.(js|mjs)$/.test(e.name)) {
          for (const m of fs.readFileSync(p, 'utf8').matchAll(/logProAudit\(\s*'([A-Z_]+)'/g)) codes.add(m[1]);
        }
      }
    };
    walk('api');
    expect(codes.size).toBeGreaterThan(40);
    const names = proAuditActionNames((_k, fr) => fr);
    const known = ['DOSSIER_VIEWED', 'DOSSIER_STATUS_UPDATED', 'REGISTER_VIA_INVITE', 'INVITATION_SENT', 'LOGIN_SUCCESS', 'USER_DISABLED', 'REGISTER_SUCCESS'];   // named in AuditLog.jsx
    const missing = [...codes].filter((c) => !names[c] && !known.includes(c));
    expect(missing).toEqual([]);
    expect(names.MFA_ENABLED).toBe('Double authentification activée');
  });
});
