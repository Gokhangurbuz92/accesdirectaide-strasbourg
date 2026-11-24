/**
 * 24/11/2026 — public/llms.txt (llmstxt.org format): one H1, a summary blockquote, sections of links; every link is a route the site declares;
 * no entitlement claim; the emergency numbers match the footer; served as a static file (the SPA rewrite skips paths with a dot).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';

const txt = fs.readFileSync('public/llms.txt', 'utf8');
const routes = fs.readFileSync('src/pages/index.jsx', 'utf8');

describe('llms.txt', () => {
  it('follows the llms.txt layout', () => {
    expect(txt.split('\n')[0]).toBe('# AccesDirectAide');
    expect(txt.match(/^# /gm)).toHaveLength(1);
    expect(txt).toMatch(/^> .+/m);
    expect(txt).toMatch(/^## Optional$/m);
  });
  it('every link is a declared route of the site (or the sitemap)', () => {
    const links = [...txt.matchAll(/\]\(https:\/\/www\.accesdirectaide\.fr(\/[^)\s]*)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(15);
    for (const l of links) {
      if (l === '/sitemap.xml') continue;
      expect(routes.includes(`path="${l}"`) || routes.includes(`path="${l.slice(1)}"`), l).toBe(true);
    }
  });
  it('never states an entitlement; the deciding body is named; emergency numbers present', () => {
    for (const line of txt.split('\n')) expect(claimsEntitlement(line), line).toBe(false);
    expect(txt).toContain('seul l\'organisme concerné');
    for (const n of ['112', '15 (SAMU)', '17', '115', '119', '3919', '3114']) expect(txt).toContain(n);
  });
  it('is served as a static file', () => {
    expect(fs.readFileSync('vercel.json', 'utf8')).toContain('.*\\\\..*');
  });
});
