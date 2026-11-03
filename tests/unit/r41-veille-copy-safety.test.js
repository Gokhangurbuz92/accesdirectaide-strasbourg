/**
 * R41-IJ — the automatic verification chain never republishes the words of a publisher that forbids it.
 *
 * Real case (R41 content-reuse review, 03/11/2026): the published aide FAJ'EMS carried 185 characters copied word for word from strasbourg.eu, whose legal
 * notice forbids reproduction without written consent; the dispositif FSL of the Collectivité européenne d'Alsace carried six passages of alsace.eu (same
 * terms). Two paths allowed it: (1) the R12 « official excerpt » (≈600 characters verbatim) was produced for any source, not only for Licence Ouverte ones;
 * (2) the copy check of the texts covered the FALC version only, not the normal summary. All texts below are synthetic.
 */
import { describe, it, expect } from 'vitest';

const { REUSE_BY_HOST: REUSE, reuseOf, isReuseOpen } = await import('../../api/_services/verification/reuse.js');
const { REUSE_BY_HOST: NEWS_REUSE } = await import('../../api/_services/news-verification.js');
const { officialExcerpt } = await import('../../api/_services/verification/chain.js');
const { checkNormal, copiedPassages, writeTexts } = await import('../../api/_services/verification/texts.js');

const SOURCE_TEXT = [
  'Le fonds municipal imaginaire soutient les habitants du quartier fictif de Exempleville qui traversent une période difficile.',
  'Il finance des projets ponctuels liés au logement, à la formation ou à la mobilité, en complément des autres dispositifs existants.',
  'La demande est préparée avec un travailleur social du centre communal fictif, qui transmet le dossier au comité du fonds.',
].join('\n');
const page = (url) => ({ title: 'Fonds municipal imaginaire', description: null, text: SOURCE_TEXT, url, fingerprint: 'f1', abbreviations: {}, definitions: {} });

describe('the reuse registry is shared by the news and the content chain', () => {
  it('Service-Public is open; strasbourg.eu, alsace.eu, grandest.fr and the ARS Grand Est require a written authorisation', () => {
    expect(REUSE['www.service-public.gouv.fr'].status).toBe('open');
    expect(REUSE['entreprendre.service-public.gouv.fr'].status).toBe('open');
    for (const host of ['www.strasbourg.eu', 'www.alsace.eu', 'www.grandest.fr', 'www.grand-est.ars.sante.fr']) {
      expect(REUSE[host].status, host).toBe('authorisation-required');
      expect(REUSE[host].evidenceUrl, host).toMatch(/^https:\/\//);
      expect(REUSE[host].checkedAt, host).toMatch(/^2026-\d\d-\d\d$/);
    }
    expect(NEWS_REUSE).toBe(REUSE);   // one registry, never two lists that drift apart
  });

  it('a URL is open only when its host is registered as open (an unknown host is not)', () => {
    expect(isReuseOpen('https://www.service-public.gouv.fr/particuliers/vosdroits/F12006')).toBe(true);
    expect(isReuseOpen('https://www.strasbourg.eu/fond-aide-jeunes')).toBe(false);
    expect(isReuseOpen('https://www.alsace.eu/aides-et-services/habitat/')).toBe(false);
    expect(isReuseOpen('https://site-inconnu.example.fr/page')).toBe(false);
    expect(isReuseOpen('pas une adresse')).toBe(false);
    expect(reuseOf('https://www.strasbourg.eu/x')?.publisher).toMatch(/Strasbourg/);
    expect(reuseOf('https://site-inconnu.example.fr/')).toBeNull();
  });
});

describe('the official excerpt (R12) is produced only for sources whose reuse is open', () => {
  it('a Service-Public fiche (DILA) still gives its attributed excerpt', () => {
    const x = officialExcerpt(page('https://www.service-public.gouv.fr/particuliers/vosdroits/F99999'), 'DILA', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F99999');
    expect(x).toMatch(/^Extrait de la fiche officielle « Fonds municipal imaginaire » \(Service-Public\.gouv\.fr\) : « /);
  });

  it('a page of strasbourg.eu or alsace.eu, or of an unknown site, gives no excerpt (the chain then withdraws or keeps its rule, never copies)', () => {
    for (const url of ['https://www.strasbourg.eu/fond-aide-jeunes', 'https://www.alsace.eu/aides-et-services/habitat/', 'https://site-inconnu.example.fr/aide']) {
      expect(officialExcerpt(page(url), 'PAGE', url), url).toBeNull();
    }
  });

  it('an open page (a registered open host) still gives one', () => {
    const url = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F99999';
    expect(officialExcerpt(page(url), 'PAGE', url)).toMatch(/^Extrait de la fiche officielle/);
  });
});

describe('the normal summary may not copy a passage of a source whose reuse is not open', () => {
  const copied = { resume: 'Le fonds municipal imaginaire soutient les habitants du quartier fictif de Exempleville qui traversent une période difficile. Il existe depuis longtemps dans cette ville imaginaire.', pour_qui: ['Habitants du quartier'], montant: null, etapes: [], documents: [] };
  const own = { resume: "Ce fonds local aide ponctuellement des habitants en difficulté d'un quartier imaginaire. Un travailleur social prépare la demande avec la personne, puis un comité l'examine.", pour_qui: ['Habitants du quartier'], montant: null, etapes: [], documents: [] };

  it('copiedPassages finds a shared run of 60 characters or more, ignoring case, accents, apostrophes and spaces', () => {
    expect(copiedPassages(copied.resume, SOURCE_TEXT).length).toBeGreaterThan(0);
    expect(copiedPassages(copied.resume.toUpperCase().replace(/ /g, '  '), SOURCE_TEXT).length).toBeGreaterThan(0);
    expect(copiedPassages(own.resume, SOURCE_TEXT)).toEqual([]);
  });

  it('checkNormal refuses the copy when the source is not open, and says why', () => {
    const p = checkNormal(copied, SOURCE_TEXT, { reuseOpen: false });
    expect(p.some((x) => /recopie un passage/.test(x))).toBe(true);
    expect(checkNormal(own, SOURCE_TEXT, { reuseOpen: false }).some((x) => /recopie/.test(x))).toBe(false);
  });

  it('a Licence Ouverte source keeps its previous rule (no copy check on the normal summary): nothing changes for the Service-Public records', () => {
    expect(checkNormal(copied, SOURCE_TEXT, { reuseOpen: true }).some((x) => /recopie/.test(x))).toBe(false);
    expect(checkNormal(copied, SOURCE_TEXT).some((x) => /recopie/.test(x))).toBe(false);   // the default is the previous behaviour
  });

  it('writeTexts applies it from the source address: a model that copies strasbourg.eu never gets its summary through', async () => {
    const generate = async () => ({ model: 'double', content: copied });
    const t = await writeTexts(page('https://www.strasbourg.eu/fond-aide-jeunes'), { generate, judge: false });
    expect(t.ok).toBe(false);
    expect(t.reasons.join(' ')).toMatch(/recopie un passage/);
  });

  it('…and an unknown host is treated as not open (fail-closed)', async () => {
    const generate = async () => ({ model: 'double', content: copied });
    const t = await writeTexts(page('https://site-inconnu.example.fr/aide'), { generate, judge: false });
    expect(t.reasons.join(' ')).toMatch(/recopie un passage/);
  });

  it('…while the same draft written from a Service-Public fiche is not refused for copying', async () => {
    const generate = async () => ({ model: 'double', content: copied });
    const t = await writeTexts(page('https://www.service-public.gouv.fr/particuliers/vosdroits/F99999'), { generate, judge: false });
    expect(t.reasons.join(' ')).not.toMatch(/recopie un passage/);
  });
});
