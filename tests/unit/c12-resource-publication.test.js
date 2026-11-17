/**
 * C12 (owner decision b) — the publication contract of the /ressources documents (api/_services/resource-publication.js), without a database:
 * plain text only (markup refused, not stripped), https official source on the allow-list with its publisher, a human verification bound to the content
 * version, the catalogue's staleness rule (≤ 90 d current, ≤ 180 d update needed, beyond: hidden), legacy rows never public; migration 0050 is additive
 * with a rollback and a journal entry; one writer only; the public handler never names the reviewer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentVersion, decideResource, httpsUrl, looksLikeMarkup, normalise, problems, publicView, TYPES } from '../../api/_services/resource-publication.js';

const ENV = {};
const good = { title: 'Guide des démarches CAF', type: 'guide', content: 'Présentation officielle des démarches en ligne de la Caf.', source_url: 'https://www.caf.fr/allocataires/mes-services-en-ligne', source_publisher: 'Caf — Caisse nationale des allocations familiales' };
const NOW = new Date('2026-11-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
const published = (over = {}) => { const r = { id: 'r1', slug: 's', status: 'published', ...normalise(good), reviewer_type: 'admin', reviewer_id: 'admin@example.test', verified_at: daysAgo(10), ...over }; return { ...r, verified_version: over.verified_version ?? contentVersion(r) }; };

describe('C12 validation', () => {
  it('a complete document has no problem; types are the four of the public filter', () => {
    expect(problems(normalise(good), { env: ENV })).toEqual([]);
    expect(TYPES).toEqual(['guide', 'tool', 'document', 'link']);
  });
  it('the source must be https, on an official host (host match, not substring), without credentials', () => {
    const p = (source_url) => problems(normalise({ ...good, source_url }), { env: ENV });
    expect(p('http://www.caf.fr/x')).toContain('UNSAFE_SOURCE_URL_NOT_HTTPS');
    expect(p('javascript:alert(1)')).toContain('UNSAFE_SOURCE_URL_NOT_HTTPS');
    expect(p('https://user:pw@www.caf.fr/x')).toContain('UNSAFE_SOURCE_URL_NOT_HTTPS');
    expect(p('https://evil.example/?caf.fr')).toContain('SOURCE_DOMAIN_NOT_OFFICIAL');
    expect(p('https://caf.fr.evil.example/')).toContain('SOURCE_DOMAIN_NOT_OFFICIAL');
    expect(p('https://www.service-public.gouv.fr/particuliers/vosdroits/F2')).toEqual([]);
    expect(p('')).toContain('SOURCE_URL_REQUIRED');
    // the registry's attested sites and the owner's extra list count, like D-5 human verification
    expect(problems(normalise({ ...good, source_url: 'https://www.strasbourg.eu/x' }), { env: ENV, trustedDomains: ['strasbourg.eu'] })).toEqual([]);
    expect(problems(normalise({ ...good, source_url: 'https://www.alsace.eu/x' }), { env: { ADA_VERIFICATION_EXTRA_DOMAINS: 'alsace.eu' } })).toEqual([]);
    expect(httpsUrl('https://www.caf.fr/a b')).toBe('https://www.caf.fr/a%20b');
  });
  it('markup is refused in every text field (never silently stripped); the publisher is required', () => {
    for (const k of ['title', 'content', 'source_publisher']) {
      const p = problems(normalise({ ...good, [k]: `${good[k]} <img src=x onerror=alert(1)>` }), { env: ENV });
      expect(p.some((x) => x.startsWith('UNSAFE_MARKUP')), k).toBe(true);
    }
    expect(looksLikeMarkup('a &lt; b')).toBe(true); expect(looksLikeMarkup('3 < 5 et 6 > 2')).toBe(false);
    expect(problems(normalise({ ...good, source_publisher: '' }), { env: ENV })).toContain('SOURCE_PUBLISHER_REQUIRED');
    expect(normalise({ ...good, type: 'URGENCE' }).type).toBe('');
    expect(normalise({ ...good, content: 'a\u0000b\r\nc' }).content).toBe('ab\nc');
  });
});

describe('C12 public decision (same staleness rule as the catalogue)', () => {
  it('current ≤ 90 days, update needed ≤ 180, hidden beyond; never in the future', () => {
    expect(decideResource(published(), { now: NOW, maxAge: 180 })).toMatchObject({ visible: true, freshness: 'current' });
    expect(decideResource(published({ verified_at: daysAgo(120) }), { now: NOW, maxAge: 180 })).toMatchObject({ visible: true, freshness: 'update_needed' });
    expect(decideResource(published({ verified_at: daysAgo(181) }), { now: NOW, maxAge: 180 }).reasons).toContain('VERIFICATION_STALE');
    expect(decideResource(published({ verified_at: new Date(NOW.getTime() + 3 * 86400000) }), { now: NOW, maxAge: 180 }).reasons).toContain('VERIFICATION_IN_FUTURE');
  });
  it('content changed after the verification, draft, withdrawn: not public', () => {
    const r = published();
    expect(decideResource({ ...r, content: `${r.content} (modifié)` }, { now: NOW, maxAge: 180 }).reasons).toContain('CHANGED_SINCE_VERIFICATION');
    expect(decideResource({ ...r, status: 'draft' }, { now: NOW, maxAge: 180 }).reasons).toContain('NOT_PUBLISHED');
    expect(decideResource({ ...r, status: 'withdrawn' }, { now: NOW, maxAge: 180 }).reasons).toContain('WITHDRAWN');
  });
  it('a legacy row (before 0050, status « published », no publisher / verification / reviewer) is never public: nothing is invented for it', () => {
    const legacy = { id: 'old', slug: 'old', status: 'published', title: 'Ancien document', type: 'guide', content: 'x', source_url: 'https://www.caf.fr/x', createdAt: daysAgo(3) };
    const d = decideResource(legacy, { now: NOW, maxAge: 180 });
    expect(d.visible).toBe(false);
    expect(d.reasons).toEqual(expect.arrayContaining(['NO_SOURCE_PUBLISHER', 'NO_REVIEWER', 'NOT_VERIFIED', 'NO_VERIFICATION_DATE']));
  });
  it('the public view never carries the reviewer, the withdrawal reason or the verified version', () => {
    const v = publicView({ ...published(), withdrawal_reason: 'interne' }, 'current');
    expect(Object.keys(v).sort()).toEqual(['content', 'freshness', 'id', 'published_at', 'slug', 'source_publisher', 'source_url', 'territory_scope', 'title', 'type', 'verified_at']);
  });
});

describe('C12 migration 0050 and single writer', () => {
  const up = fs.readFileSync('drizzle/0050_rs_resource_publication.sql', 'utf8');
  const down = fs.readFileSync('drizzle/rollback/0050_down.sql', 'utf8');
  const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
  const e = journal.find((x) => x.tag === '0050_rs_resource_publication');
  it('is in the journal after 0049, with its snapshot; the rollback forgets exactly that « when »', () => {
    expect(e.idx).toBe(50);
    expect(e.when).toBeGreaterThan(journal.find((x) => x.idx === 49).when);
    expect(fs.existsSync('drizzle/meta/0050_snapshot.json')).toBe(true);
    expect(down).toContain(`WHERE created_at = ${e.when};`);
  });
  it('is additive and idempotent: no DROP of a column or table, every CREATE / ADD guarded; no backfill of a source, date or reviewer', () => {
    const sqlOnly = up.split('\n').filter((l) => !l.startsWith('--')).join('\n');
    expect(sqlOnly).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sqlOnly).not.toMatch(/\bUPDATE\s+"|INSERT\s+INTO|DELETE\s+FROM/i);
    for (const m of sqlOnly.matchAll(/ADD COLUMN (?!IF NOT EXISTS)/g)) throw new Error(`unguarded ADD COLUMN at ${m.index}`);
    expect(sqlOnly).toMatch(/CREATE TABLE IF NOT EXISTS "ResourcePublicationEvent"/);
    expect(sqlOnly).toMatch(/BEFORE UPDATE OR DELETE ON "ResourcePublicationEvent"/);
    expect(sqlOnly).toMatch(/"ResourceAccessibility_verification_check" CHECK \("ResourceAccessibility"\."verified_at" IS NULL OR/);
  });
  it('only api/_services/resource-publication.js writes the documents or their ledger', () => {
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((x) => {
      const p = path.join(dir, x.name);
      if (x.isDirectory()) return ['node_modules', 'tests'].includes(x.name) ? [] : files(p);
      return /\.(m?js|ts)$/.test(x.name) ? [p] : [];
    });
    const writers = [...files('api'), ...files('scripts'), ...files('src')].filter((f) => {
      const s = fs.readFileSync(f, 'utf8');
      return /(insert|update|delete)\(\s*(ResourceAccessibility|ResourcePublicationEvent|schema\.ResourceAccessibility)\b/.test(s) || /(INSERT INTO|UPDATE|DELETE FROM)\s+"(ResourceAccessibility|ResourcePublicationEvent)"/.test(s);
    });
    expect(writers).toEqual([]);
    const svc = fs.readFileSync('api/_services/resource-publication.js', 'utf8');
    expect(svc).toMatch(/tx\.insert\(R\)/); expect(svc).toMatch(/tx\.insert\(E\)/);
  });
  it('the public handler keeps the contract strings and never selects through the full table on a database without 0050', () => {
    const h = fs.readFileSync('api/_handlers/ressources.js', 'utf8');
    expect(h).toContain("eq(ResourceAccessibility.status, 'published')");
    expect(h).toContain('resourcePublicationSchema(db)');
    expect(h).toMatch(/if \(!has0050\) return res\.status\(404\)/);
    expect(h).toMatch(/if \(!has0050 \|\|/);
    expect(h).not.toMatch(/reviewer_id:/);
  });
});
