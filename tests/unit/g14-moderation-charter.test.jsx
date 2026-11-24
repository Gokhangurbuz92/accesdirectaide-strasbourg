// @vitest-environment jsdom
/**
 * G14 (owner decisions 23/11/2026) — the public moderation charter (/charte-de-moderation), the statement of reasons pointing to its « Contenus refusés »
 * section, the DSA single point of contact (art. 11 and 12) in the legal notice, the moderation-case retention steps (decided, not approved) and the final
 * consent versions of X02 / X01.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPEAL_MONTHS, CHARTER_PATH, SOLE_REVIEW_DELAY_MS, SUSPENSION_MAX_DAYS, SUSPENSION_MIN_DAYS, TERMS_CLAUSE, WARNING_WINDOW_DAYS, statementText } from '../../api/_services/moderation-dsa.js';
import { RETENTION_POLICY } from '../../api/_services/retention-policy.js';
import { expansionSteps } from '../../api/_services/gdpr-purge-expansion-steps.js';
import { TESTIMONIAL_CONSENT_VERSION } from '../../api/_services/testimonials.js';
import { STORY_CONSENT_VERSION } from '../../api/_services/community-stories.js';
import { TESTIMONIAL_CONSENT_VERSION as TESTIMONIAL_CONSENT_VERSION_UI } from '../../src/lib/testimonials.js';
import { STORY_CONSENT_VERSION as STORY_CONSENT_VERSION_UI } from '../../src/lib/communityStories.js';
import { isBetaRestrictedPath } from '../../src/lib/publicBeta.js';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

async function renderPage(/** @type {string} */ file, /** @type {string} */ path) {
  vi.resetModules();
  const mod = await import(/* @vite-ignore */ `../../src/pages/${file}`);
  return render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(mod.default))));
}

describe('moderation charter page', () => {
  it('describes ONE moderator (the operator), 24 hours / 7 days, statement of reasons, internal appeal, no certified out-of-court body', async () => {
    const { container } = await renderPage('CharteModeration.jsx', '/charte-de-moderation');
    const text = container.textContent || '';
    expect(text).toContain("La modération est assurée par une seule personne : l'exploitant d'AccesDirectAide");
    expect(screen.getByTestId('charter-delais')).toHaveTextContent('traité dans les 24 heures');
    expect(screen.getByTestId('charter-delais')).toHaveTextContent('Autres signalements : décision dans les 7 jours.');
    expect(screen.getByTestId('charter-delais')).toHaveTextContent("n'a pas été relu dans les 60 jours est retiré automatiquement");
    expect(screen.getByTestId('charter-motifs')).toHaveTextContent('exposé des motifs');
    expect(screen.getByTestId('charter-contestation')).toHaveTextContent('pendant six mois');
    expect(screen.getByTestId('charter-contestation')).toHaveTextContent('au plus tôt 24 heures après la contestation');
    expect(screen.getByTestId('charter-recours-externes')).toHaveTextContent("Aucun organe certifié de règlement extrajudiciaire des litiges (article 21 du règlement (UE) 2022/2065");
    expect(screen.getByTestId('charter-abus')).toHaveTextContent('de 1 à 180 jours');
    expect(text).not.toMatch(/deux modérateurs|second modérateur|suppléant|Gurbuz|GURBUZ/i);
    // the figures are the code's
    expect([APPEAL_MONTHS, SOLE_REVIEW_DELAY_MS, SUSPENSION_MIN_DAYS, SUSPENSION_MAX_DAYS, WARNING_WINDOW_DAYS]).toEqual([6, 24 * 3600 * 1000, 1, 180, 365]);
    expect(RETENTION_POLICY.durations.TESTIMONIAL_PENDING_DAYS.days).toBe(60);
  });

  it('is always public (not a beta-restricted path) and routed; the statement of reasons cites its « Contenus refusés » anchor', async () => {
    expect(isBetaRestrictedPath(CHARTER_PATH, [])).toBe(false);
    expect(readFileSync('src/pages/index.jsx', 'utf8')).toContain('<Route path="/charte-de-moderation" element={<CharteModeration />} />');
    expect(TERMS_CLAUSE).toBe('Charte de modération, § 3 « Contenus refusés » — https://www.accesdirectaide.fr/charte-de-moderation#contenus-refuses');
    expect(TERMS_CLAUSE.length).toBeLessThanOrEqual(300);   // CHECK of drizzle/0059 (termsClause 3–300 characters)
    const { container } = await renderPage('CharteModeration.jsx', '/charte-de-moderation');
    const anchor = TERMS_CLAUSE.split('#')[1];
    const section = container.querySelector(`#${anchor}`);
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('3. Contenus refusés');
    const d = { contentType: 'testimonial', action: 'taken_down', reasonCode: 'PERSONAL_DATA', facts: 'FIXTURE faits.', legalGround: null, termsClause: TERMS_CLAUSE, source: 'report',
      decidedAt: new Date('2026-11-23T10:00:00Z'), appealUntil: new Date('2027-05-23T10:00:00Z') };
    expect(statementText(d, 'author')).toContain(`Règle appliquée : ${TERMS_CLAUSE}`);
  });
});

describe('legal notice: DSA single point of contact', () => {
  it('names the site’s existing contact address, a person reads, French', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHER_IDENTITY', 'Personne Test (personne physique)');
    await renderPage('MentionsLegales.jsx', '/mentions-legales');
    const p = screen.getByTestId('legal-dsa-contact');
    expect(p).toHaveTextContent('règlement (UE) 2022/2065');
    expect(p).toHaveTextContent('articles 11 et 12');
    expect(p).toHaveTextContent('contact@accesdirectaide.fr');
    expect(p).toHaveTextContent('Les messages sont lus par une personne');
    expect(screen.getByTestId('legal-charter-link')).toHaveAttribute('href', '/charte-de-moderation');
  });
});

describe('moderation cases: retention decided 23/11/2026, not approved', () => {
  const sqlText = (/** @type {any} */ q) => JSON.stringify(q?.queryChunks ?? q);
  it('two steps on MODERATION_CASE_CLOSED_DAYS (365), decided, not approved; the policy version moves to g14-expansion-2', () => {
    expect(RETENTION_POLICY.version).toBe('g14-r3-2026-11-24-a7-365d');   // R3 (owner 24/11/2026): a new version for the release-3 durations; these durations unchanged
    expect(RETENTION_POLICY.durations.MODERATION_CASE_CLOSED_DAYS.days).toBe(365);
    const steps = expansionSteps({ heldSql: () => 'HELD', personProtectedSql: () => 'PROTECTED' });
    expect(steps.length).toBe(28);   // g14-r2: 25 + the 2 moderation-case steps + G14-PS socialReferralsClosedDeleted (decided by the owner 23/11/2026)
    for (const id of ['moderationDecisionsDeleted', 'moderationSanctionsDeleted']) {
      const s = steps.find((x) => x.id === id);
      expect(s?.durationKey, id).toBe('MODERATION_CASE_CLOSED_DAYS');
      expect(RETENTION_POLICY.decidedSteps[id]).toMatchObject({ decidedOn: '2026-11-23' });
      expect(RETENTION_POLICY.approvedSteps[id]).toBeUndefined();
    }
    const ctx = { cutoff: () => new Date('2025-11-23T00:00:00Z') };
    // a decision is kept while an appeal is open; a sanction counts from its lifting or its end (a warning: 12 months after it was given)
    const captured = [];
    const db = { execute: async (/** @type {any} */ q) => { captured.push(sqlText(q)); return { rows: [{ n: 0 }] }; } };
    return Promise.all(steps.filter((x) => x.id.startsWith('moderation')).map((x) => x.count(db, ctx))).then(() => {
      expect(captured[0]).toContain("ap.status = 'open'");
      expect(captured[0]).toContain('appealUntil');
      expect(captured[1]).toContain("interval '365 days'");
      expect(captured[1]).toContain('liftedAt');
    });
  });
});

describe('X02 / X01 consent wording: final versions (owner 23/11/2026)', () => {
  it('no « lab-proposal » marker; the server and the screen use the same version', () => {
    expect(TESTIMONIAL_CONSENT_VERSION).toBe('x02-v12-2026-11-23');
    expect(STORY_CONSENT_VERSION).toBe('x01-v12-2026-11-23');
    expect(TESTIMONIAL_CONSENT_VERSION_UI).toBe(TESTIMONIAL_CONSENT_VERSION);
    expect(STORY_CONSENT_VERSION_UI).toBe(STORY_CONSENT_VERSION);
  });
});
