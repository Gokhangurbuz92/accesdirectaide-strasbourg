/**
 * C11 / D08 (owner, Paket 4, 17/11/2026) — Aides-territoires records are funding sources for institutions, structures and territories, never citizen aid.
 * The ONE public-visibility rule (api/lib/publicVisibility.js) keeps them out of every public path, in strict AND lab mode, whatever their verification state.
 * The real-PostgreSQL agreement of decide / visibleWhere / visibleSql and the public handlers: tests/integration/c11-d08-institution-funding-db.test.js.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { decide, isInstitutionFundingSource, INSTITUTION_FUNDING_URL_RE } from '../../api/lib/publicVisibility.js';
import { AidesTerritoiresConnector } from '../../api/lib/ingestion/AidesTerritoiresConnector.js';

const now = new Date();
const eligible = { statut: 'publie', status_code: 'PUBLISHED', launch_eligible: true, verification_status: 'VERIFIED', verified_by: 'chain', territory_verified: true,
  publication_hold: null, data_origin: 'official', date_verification: new Date(now.getTime() - 86400000), source_url: 'https://www.service-public.fr/particuliers/vosdroits/F1' };

describe('C11 / D08 — Aides-territoires is never a public citizen aide', () => {
  it('every provenance mark the connector writes is recognised', () => {
    expect(isInstitutionFundingSource({ providerName: 'aides-territoires' })).toBe(true);
    expect(isInstitutionFundingSource({ providerName: ' Aides-Territoires ' })).toBe(true);
    expect(isInstitutionFundingSource({ externalId: 'aides-territoires:123' })).toBe(true);
    expect(isInstitutionFundingSource({ source_donnee: 'Aides-Territoires' })).toBe(true);
    expect(isInstitutionFundingSource({ source_url: 'https://aides-territoires.beta.gouv.fr/aides/abc/' })).toBe(true);
    expect(isInstitutionFundingSource({ source_url_exact: 'http://www.aides-territoires.beta.gouv.fr' })).toBe(true);
  });
  it('other sources and look-alike hosts are not caught', () => {
    for (const r of [eligible, { providerName: 'drees' }, { externalId: 'dila:F123' }, { source_donnee: 'Scraping GrandEst' },
      { source_url: 'https://aides-territoires.beta.gouv.fr.example.org/x' }, { source_url: 'https://example.org/?u=https://aides-territoires.beta.gouv.fr/' },
      { source_url: 'https://notaides-territoires.beta.gouv.fr/' }, null, undefined]) expect(isInstitutionFundingSource(r), JSON.stringify(r)).toBe(false);
  });
  it('a fully verified record from Aides-territoires is hidden in strict and in lab mode, with its own reason', () => {
    for (const mark of [{ providerName: 'aides-territoires' }, { externalId: 'aides-territoires:9' }, { source_url: 'https://aides-territoires.beta.gouv.fr/aides/x/' }]) {
      for (const mode of /** @type {const} */ (['strict', 'lab'])) {
        const d = decide({ ...eligible, ...mark }, 'aide', { now, mode });
        expect(d.visible, `${mode} ${JSON.stringify(mark)}`).toBe(false);
        expect(d.reasons).toContain('INSTITUTION_FUNDING_SOURCE');
      }
      // a LAB fixture (unclassified origin) is not a way around it either
      expect(decide({ ...mark, statut: 'publie' }, 'aide', { now, mode: 'lab' }).visible).toBe(false);
    }
    expect(decide(eligible, 'aide', { now, mode: 'strict' }).visible).toBe(true);
  });
  it('the connector output carries the marks the rule reads (provider id + source URL on the Aides-territoires host)', async () => {
    const item = await new AidesTerritoiresConnector().parse(JSON.stringify({ id: 42, name: 'Subvention pour les communes', url: '/aides/subvention-communes/', description: 'x' }), 'virtual');
    expect(item.external_id).toBe('aides-territoires:42');
    expect(isInstitutionFundingSource({ externalId: item.external_id, source_url: item.source_url, source_donnee: item._source_donnee })).toBe(true);
  });
  it('the URL pattern is the same string the SQL forms use (PostgreSQL ~* and JS RegExp read it the same way)', () => {
    expect(INSTITUTION_FUNDING_URL_RE).not.toMatch(/\\[dws]/);   // no class shorthand whose meaning differs between the engines
  });
  it('the public « Sources et méthode » page never presents Aides-territoires as aid for individuals (6 languages)', () => {
    const page = fs.readFileSync('src/pages/SourcesMethode.jsx', 'utf8');
    expect(page).not.toContain('Base de données nationale et locale des aides publiques');
    expect(page).toMatch(/pas des aides pour les particuliers/);
    for (const lang of ['en', 'de', 'tr', 'ar', 'uk']) {
      const about = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/about.json`, 'utf8'));
      const admin = JSON.parse(fs.readFileSync(`src/i18n/locales/${lang}/admin.json`, 'utf8'));
      expect(about['sources.list.aides_territoires'], lang).toBeTruthy();
      expect(about['sources.list.aides_territoires'], lang).not.toBe('National and local database of public aid schemes');
      expect(admin['review_value.reason.institution_funding_source'], lang).toBeTruthy();
    }
  });
});
