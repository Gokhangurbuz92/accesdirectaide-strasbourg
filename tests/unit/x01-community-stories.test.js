/**
 * X01 (expansion) — community stories, offline: the capability is outside the AIPD and closed in every Production configuration (current one, beta lifted,
 * everything else listed, preview); its surface « stories » is opened by nothing and takes its routes away from « citizen » and « admin »; the pseudonym rules
 * (the pseudonymous principal: no e-mail, no space, no long digit run, no reserved word, not the account's own e-mail); the content rules (length; images,
 * markup, links, e-mails, handles and phone numbers REFUSED; entitlement wording refused at approval); the closed lists are the same in the service, the
 * screens and the database; the export sections; NO seed or sample story anywhere; no comment / reply feature (not in the canonical row).
 * Nothing here touches a database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilitiesOfRoute, capabilityState } from '../../api/_utils/capabilities.js';
import { SURFACES, isAllowedInPublicBeta, surfaceOf } from '../../api/_utils/public-beta.js';
import { EXPORT_SECTION_TABLES } from '../../api/_services/export-account-sections.js';
import { USER_PERSONAL_DATA_LINEAGE } from '../../api/_services/privacy.js';
import * as svc from '../../api/_services/community-stories.js';
import * as front from '../../src/lib/communityStories.js';
import { routes } from '../../api/routes.js';

const ROUTES = ['stories', 'citizen/stories', 'admin/stories'];
const PROD_NOW = { VERCEL_ENV: 'production', ADA_PUBLIC_BETA_RESTRICTED: 'true', ADA_BETA_OPEN_SURFACES: 'admin,accounts' };
const OTHERS = Object.keys(CAPABILITIES).filter((c) => c !== 'community.stories').join(',');
const OK_TITLE = 'Comment j’ai retrouvé un logement';
const OK_BODY = 'J’ai pris rendez-vous dans une permanence près de chez moi, on m’a aidé à préparer le dossier et à comprendre les étapes.';

describe('X01 — closed by default (fail-closed)', () => {
  it('« community.stories » is a known capability OUTSIDE the AIPD, on its own surface « stories », not HDS-bound', () => {
    expect(CAPABILITIES['community.stories']).toMatchObject({ aipd: 'out', surface: 'stories', requiresHds: false });
    expect(SURFACES.stories).toEqual(ROUTES);
  });
  it('closed in the current Production configuration, without the beta, with every other capability listed, in preview — open only when named AND its surface opened', () => {
    for (const env of [PROD_NOW, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: OTHERS }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: OTHERS, ADA_BETA_ACCOUNTS_SCOPE: 'full' },
      { VERCEL_ENV: 'preview' }, { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,stories' }, { ...PROD_NOW, ADA_CAPABILITIES_OPEN: 'community.stories' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,testimonials', ADA_CAPABILITIES_OPEN: 'community.testimonials,community.stories' },
      { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,stories', ADA_CAPABILITIES_OPEN: 'community.*' }]) {
      expect(capabilityState('community.stories', env).open, JSON.stringify(env)).toBe(false);
    }
    expect(capabilityState('community.stories', { ...PROD_NOW, ADA_BETA_OPEN_SURFACES: 'admin,accounts,stories', ADA_CAPABILITIES_OPEN: 'community.stories' }).open).toBe(true);
    expect(capabilityState('community.stories', { VERCEL_ENV: 'production', ADA_CAPABILITIES_OPEN: 'community.stories' }).open).toBe(true);
  });
  it('every route of the surface needs the capability, and the beta gate refuses them all with the Production surfaces', () => {
    for (const r of ROUTES) {
      expect(surfaceOf(r), r).toBe('stories');
      expect(capabilitiesOfRoute(r), r).toEqual(['community.stories']);
      for (const m of ['GET', 'POST']) expect(isAllowedInPublicBeta(m, r, PROD_NOW), `${m} ${r}`).toBe(false);
    }
    expect(surfaceOf('citizen/testimonials')).toBe('testimonials'); expect(surfaceOf('citizen/notifications')).toBe('accounts'); expect(surfaceOf('admin/resources')).toBe('admin');
    const table = routes.map((r) => r.path);
    for (const p of ROUTES) expect(table).toContain(p);
  });
  it('no comment or reply route exists (the canonical row X01 names posting, reporting, moderation and takedown only)', () => {
    const table = routes.map((r) => r.path).filter((p) => /\bstor(y|ies)\b|community/.test(p));
    expect(table.sort()).toEqual(['admin/stories', 'citizen/stories', 'stories']);
    expect(fs.readFileSync('api/_handlers/citizen/stories.js', 'utf8')).not.toMatch(/comment|reply/i);
  });
});

describe('X01 — the pseudonymous principal', () => {
  it('a pseudonym: 3–24 letters / digits / « - » / « _ », any script; never a space, an « @ », a dot, a long digit run, a reserved word or the e-mail local part', () => {
    for (const ok of ['Lune', 'Ciel_bleu', 'Marche-2026', 'Ayşe77', 'Олена', 'نجمة', 'abc']) expect(svc.pseudonymProblems(ok, 'someone@example.test'), ok).toEqual([]);
    for (const bad of ['Marie Dupont', 'ab', 'x'.repeat(25), 'marie@example', 'marie.d', '-lune', '<b>x</b>', '']) expect(svc.pseudonymProblems(bad), bad).toEqual(['PSEUDONYM_INVALID']);
    expect(svc.pseudonymProblems('Lune0612345')).toContain('PSEUDONYM_LOOKS_LIKE_CONTACT');
    for (const r of ['Admin_Lune', 'LeModerateur', 'Modératrice', 'AccesDirectAide', 'Support-67']) expect(svc.pseudonymProblems(r), r).toContain('PSEUDONYM_RESERVED');
    expect(svc.pseudonymProblems('jean_dupont', 'jean.dupont@example.test')).toContain('PSEUDONYM_FROM_EMAIL');
    expect(svc.pseudonymProblems('JeanDupont', 'jean-dupont@example.test')).toContain('PSEUDONYM_FROM_EMAIL');
    expect(svc.pseudonymProblems('Lune', 'jean.dupont@example.test')).toEqual([]);
  });
  it('the database CHECK agrees: 3–24 characters, no « @ », no space', () => {
    const migration = fs.readFileSync('drizzle/0055_x01_community_stories.sql', 'utf8');
    expect(migration).toContain(`char_length("CommunityMember"."pseudonym") BETWEEN 3 AND 24 AND "CommunityMember"."pseudonym" !~ '[@[:space:]]'`);
    expect(migration).toContain('CREATE UNIQUE INDEX "CommunityMember_pseudonym_key" ON "CommunityMember" USING btree (lower("pseudonym"))');
    expect(migration).toContain('CREATE UNIQUE INDEX "CommunityMember_user_key" ON "CommunityMember" USING btree ("citizenUserId")');
  });
  it('stories are keyed on the member, never on the account: no citizenUserId column on CommunityStory', () => {
    const migration = fs.readFileSync('drizzle/0055_x01_community_stories.sql', 'utf8');
    const story = migration.slice(migration.indexOf('CREATE TABLE "CommunityStory"'), migration.indexOf('CREATE TABLE "CommunityStoryReport"'));
    expect(story).toContain('"memberId" text NOT NULL');
    expect(story).not.toContain('citizenUserId');
  });
});

describe('X01 — content rules (refused, never silently cleaned)', () => {
  const p = (over) => svc.contentProblems({ title: OK_TITLE, body: OK_BODY, ...over });
  it('a plain story passes; lengths are enforced', () => {
    expect(p({})).toEqual([]);
    expect(p({ title: 'Oui' })).toContain('TITLE_TOO_SHORT');
    expect(p({ title: 'x'.repeat(121) })).toContain('TITLE_TOO_LONG');
    expect(p({ body: 'Trop court pour une histoire.' })).toContain('BODY_TOO_SHORT');
    expect(p({ body: 'x'.repeat(3001) })).toContain('BODY_TOO_LONG');
  });
  it('images and markup are refused: an HTML tag, a Markdown image, a data: image, an image file name', () => {
    for (const bad of [`${OK_BODY} <img src=x onerror=alert(1)>`, `${OK_BODY} <b>gras</b>`, `${OK_BODY} ![photo](x)`, `${OK_BODY} data:image/png;base64,AAAA`, `${OK_BODY} voir photo.jpg`]) {
      expect(p({ body: bad }), bad).toContain('IMAGE_OR_MARKUP');
    }
    expect(p({ title: '<script>alert(1)</script> titre' })).toContain('IMAGE_OR_MARKUP');
    // a « < » in ordinary text is not markup
    expect(p({ body: `${OK_BODY} J’avais < 100 € par mois.` })).toEqual([]);
  });
  it('links, e-mail addresses, social handles and phone numbers are refused', () => {
    expect(p({ body: `${OK_BODY} Écrivez-moi : lune@example.test` })).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(p({ body: `${OK_BODY} Voir https://exemple.test/x` })).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(p({ body: `${OK_BODY} Voir www.exemple` })).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(p({ body: `${OK_BODY} Allez sur monsite.fr` })).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(p({ body: `${OK_BODY} Suivez-moi @lune_67` })).toContain('CONTACT_OR_LINK_IN_TEXT');
    expect(p({ body: `${OK_BODY} Appelez le 06 12 34 56 78.` })).toContain('PHONE_IN_TEXT');
    expect(p({ body: `${OK_BODY} +33 6 12 34 56 78` })).toContain('PHONE_IN_TEXT');
  });
  it('the approval refuses entitlement wording (title or text) and an invalid pseudonym — the moderator sees them as problems', () => {
    expect(svc.approvalProblems({ title: OK_TITLE, body: `${OK_BODY} Vous avez droit à cette aide, allez-y.`, pseudonym: 'Lune' })).toContain('ENTITLEMENT_WORDING');
    expect(svc.approvalProblems({ title: 'Vous êtes éligible au RSA', body: OK_BODY, pseudonym: 'Lune' })).toContain('ENTITLEMENT_WORDING');
    expect(svc.approvalProblems({ title: OK_TITLE, body: OK_BODY, pseudonym: 'Admin_x' })).toContain('PSEUDONYM_RESERVED');
    expect(svc.approvalProblems({ title: OK_TITLE, body: OK_BODY, pseudonym: 'Lune' })).toEqual([]);
  });
  it('tidy() keeps the text (markup stays visible to the rules) and removes control characters only', () => {
    expect(svc.tidy('Bonjour\u0000 à   tous\r\n\r\n\r\n\r\nfin')).toBe('Bonjour à tous\n\nfin');
    expect(svc.tidy('<b>x</b>')).toBe('<b>x</b>');
  });
});

describe('X01 — one vocabulary for the service, the screens and the database', () => {
  it('reasons, languages, consent version and limits are identical', () => {
    expect([...front.REASONS]).toEqual([...svc.REASONS]);
    expect([...front.STORY_LANGS]).toEqual([...svc.LANGS]);
    expect(front.STORY_CONSENT_VERSION).toBe(svc.STORY_CONSENT_VERSION);
    expect([front.TITLE_MIN, front.TITLE_MAX, front.BODY_MIN, front.BODY_MAX]).toEqual([svc.TITLE_MIN, svc.TITLE_MAX, svc.BODY_MIN, svc.BODY_MAX]);
    const migration = fs.readFileSync('drizzle/0055_x01_community_stories.sql', 'utf8');
    const reasons = svc.REASONS.map((r) => `'${r}'`).join(', ');
    expect(migration).toContain(`"CommunityStory"."moderationReason" IN (${reasons})`);
    expect(migration).toContain(`"CommunityStoryReport"."reason" IN (${reasons})`);
    expect(migration).toContain(`BETWEEN ${svc.BODY_MIN} AND ${svc.BODY_MAX}`);
    expect(migration).toContain(`BETWEEN ${svc.TITLE_MIN} AND ${svc.TITLE_MAX}`);
    expect(svc.CONSENT_PURPOSE).toBe('COMMUNITY_STORY_PUBLICATION');
  });
  it('the export has a section for each table, and the three tables cascade with the account (lineage, foreign keys)', () => {
    expect(EXPORT_SECTION_TABLES).toMatchObject({ communityMember: 'CommunityMember', communityStories: 'CommunityStory', communityStoryReports: 'CommunityStoryReport' });
    expect(USER_PERSONAL_DATA_LINEAGE.CitizenProfile.storageEntities).toEqual(expect.arrayContaining(['CommunityMember', 'CommunityStory', 'CommunityStoryReport']));
    const migration = fs.readFileSync('drizzle/0055_x01_community_stories.sql', 'utf8');
    for (const fk of ['CommunityMember_user_fkey', 'CommunityStory_member_fkey', 'CommunityStoryReport_story_fkey', 'CommunityStoryReport_user_fkey']) {
      expect(migration).toMatch(new RegExp(`"${fk}" FOREIGN KEY .* ON DELETE cascade`));
    }
  });
});

describe('X01 — only real stories: no seed, no sample', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'tests', 'coverage', 'meta', 'e2e-r47'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.(m?js|jsx|ts|tsx|sql|json)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  it('the only writer of the three tables is api/_services/community-stories.js; no SQL file inserts into them; no seed script names them', () => {
    const files = ['api', 'src', 'scripts', 'drizzle', 'public'].filter((d) => fs.existsSync(d)).flatMap((d) => walk(d)).concat(fs.readdirSync('.').filter((f) => /^seed/.test(f)));
    const writers = files.filter((f) => /insert\(\s*Community(?:Member|Story|StoryReport)\b|INSERT INTO\s+"?Community(?:Member|Story|StoryReport)"?\s*\(/.test(fs.readFileSync(f, 'utf8')));
    expect(writers).toEqual([path.join('api', '_services', 'community-stories.js')]);
    for (const f of files.filter((x) => /seed/i.test(x))) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/CommunityStory|CommunityMember|histoire/i);
  });
  it('the screens hold no sample story: they only show what the API returns, and an empty list says so', () => {
    for (const f of ['src/pages/CommunityStories.jsx', 'src/pages/CompteHistoires.jsx', 'src/pages/admin/StoriesAdmin.jsx', 'src/lib/communityStories.js']) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\b(?:SAMPLE|DEMO|FAKE|PLACEHOLDER)_?STOR(?:Y|IES)\b|exampleStories|mockStories/i);
    }
    expect(fs.readFileSync('src/pages/CommunityStories.jsx', 'utf8')).toContain('stories:list.empty');
  });
  it('the public answer is never cached (a withdrawal is effective at once)', () => {
    expect(fs.readFileSync('api/_handlers/stories.js', 'utf8')).toMatch(/Cache-Control', 'no-store'/);
  });
});
