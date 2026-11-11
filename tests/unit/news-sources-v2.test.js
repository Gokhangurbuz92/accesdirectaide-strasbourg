/**
 * Actualités v2 — the source registry after the licence review of 11/11/2026, and the « generic » page profile that lets the automatic verifier read the
 * open publishers other than Service-Public (Insee first). Fail-closed: a page that cannot be read, a different title or date, or a summary that is not word
 * for word on the page keeps the item as a draft; a publisher whose terms forbid reuse is never fetched, and its links are never listed.
 */
import fs from 'fs';
import { describe, it, expect } from 'vitest';
import { offlineChecks, pageChecks, pageDates, pageTitles, REUSE_BY_HOST, NEWS_RULES_VERSION } from '../../api/_services/news-verification.js';
import { sourceRights } from '../../api/_services/news/editorial.js';

const NOW = new Date('2026-11-11T10:00:00Z');
const URL_INSEE = 'https://www.insee.fr/fr/statistiques/9999001';
const TITLE = 'Depuis 2012, la région connaît une croissance en demi-teinte';
const SUMMARY = 'En 2023, la région se place au 6e rang des régions françaises dans la contribution au produit intérieur brut.';
const draft = (over = {}) => ({ id: 'i1', statut: 'brouillon', titre: TITLE, canonical_url: URL_INSEE, date_publication: new Date('2026-11-10T11:01:00Z'), resume: SUMMARY, summary_falc: null, key_points_falc: [], ...over });
// the markup an Insee publication page uses (print-only labels inside the <h1>, the date split across spans)
const insee = (over = {}) => `<html><head><title>${over.title ?? TITLE} - Insee Flash Grand Est - 118</title></head><body>
  <h1><div class="impression-seulement">Insee Flash Grand Est · Novembre 2026 · n° 118</div><span class="titre-titre">${over.title ?? TITLE}</span></h1>
  <div><span>Paru le :</span></span><span class="impression-seulement">Paru le</span>${over.day ?? '10/11/2026'}</div>
  <div class="corps">${over.body ?? SUMMARY.replace('produit intérieur brut', '<abbr>produit intérieur brut</abbr>')}</div></body></html>`;
const fetchOk = (html, url = URL_INSEE) => async () => ({ status: 200, url, text: async () => html, headers: new Headers({ 'content-type': 'text/html' }) });
const registry = JSON.parse(fs.readFileSync('data/news-sources.json', 'utf8'));

describe('generic page profile', () => {
  it('reads the dates a page states about itself, in the formats publishers use', () => {
    expect(pageDates(insee())).toEqual(['2026-11-10']);
    expect(pageDates('<p>Publié le 3 novembre 2026</p>')).toEqual(['2026-11-03']);
    expect(pageDates('<meta property="article:published_time" content="2026-11-09T08:00:00+01:00">')).toEqual(['2026-11-09']);
    expect(pageDates('<time datetime="2026-11-08">8 nov.</time>')).toEqual(['2026-11-08']);
    expect(pageDates('<script type="application/ld+json">{"datePublished":"2026-11-07T10:00:00Z"}</script>')).toEqual(['2026-11-07']);
    expect(pageDates('<p>Rien de daté</p>')).toEqual([]);
  });
  it('reads the names a page gives itself', () => {
    expect(pageTitles(insee())).toContain(TITLE);
  });
  it('an Insee item in the publisher’s own words, on its page, with the same title and day, passes (no « Particuliers » audience rule)', async () => {
    expect(offlineChecks(draft(), { now: NOW, takenTitles: new Set() }).reasons).toEqual([]);
    expect((await pageChecks(draft(), { fetchImpl: fetchOk(insee()) })).reasons).toEqual([]);
  });
  it('fails closed: other title, other day, words not on the page, script-only page, page on another site', async () => {
    const reasons = async (html, url) => (await pageChecks(draft(), { fetchImpl: fetchOk(html, url) })).reasons.join(' ');
    expect(await reasons(insee({ title: 'Un autre titre' }))).toMatch(/titre/);
    expect(await reasons(insee({ day: '02/10/2026' }))).toMatch(/datée du 02\/10\/2026/);
    expect(await reasons(insee({ body: 'Un autre texte.' }))).toMatch(/mot pour mot/);
    expect(await reasons('<html><body><script>window.location.href="/redirect_x"</script><noscript>This website requires JS enabled and cookies</noscript></body></html>'))
      .toMatch(/titre.*date.*mot pour mot/);
    // a redirect away from the publisher's own host is refused by the fetcher (only that host is trusted for this read)
    const away = async () => ({ status: 302, url: URL_INSEE, text: async () => '', headers: new Headers({ location: 'https://autre-site.example/page' }) });
    expect((await pageChecks(draft(), { fetchImpl: away })).reasons.join(' ')).toMatch(/non consultée|autre site/);
  });
  it('a title that only starts like the item’s is not the same title', async () => {
    expect((await pageChecks(draft({ titre: 'Depuis 2012' }), { fetchImpl: fetchOk(insee()) })).reasons.join(' ')).toMatch(/titre/);
  });
  it('the publication note names the new rules version', () => { expect(NEWS_RULES_VERSION).toBe(2); });
});

describe('source registry after the licence review (11/11/2026)', () => {
  const byId = Object.fromEntries(registry.map((s) => [s.id, s]));
  it('every fetched source is approved, with its licence, the address of its terms read within the year, and no image right', () => {
    for (const s of registry.filter((x) => x.enabled !== false)) {
      expect(s.status, s.id).toBe('approved');
      expect(sourceRights(s, NOW).lane, s.id).toBe('A');
      expect(s.licence, s.id).toBeTruthy();
      for (const h of s.hosts) expect(REUSE_BY_HOST[h]?.status, `${s.id} ${h}`).toBe('open');
    }
    expect(registry.filter((s) => s.enabled !== false).map((s) => s.id)).toEqual(['service_public_particuliers', 'service_public_professionnels', 'insee_grand_est']);
    expect(registry.filter((s) => s.rights?.images === true)).toEqual([]);
  });
  it('licensed publishers whose feeds or pages refuse automated readers stay off, with the reason (nothing is bypassed)', () => {
    for (const id of ['vie_publique', 'info_gouv', 'europarl_fr']) {
      expect(byId[id].status).toBe('approved');
      expect(byId[id].enabled).toBe(false);
      expect(byId[id].disabledReason).toMatch(/accès automatique refusé/);
    }
  });
  it('sources awaiting a decision, link-only press and forbidden publishers are never fetched', () => {
    for (const id of ['defenseur_droits', 'cnil', 'onu_info']) expect([byId[id].status, byId[id].enabled]).toEqual(['pending_review', false]);
    for (const id of ['oms', 'france24', 'rfi', 'bbc_news', 'deutsche_welle', 'euronews']) { expect(byId[id].status).toBe('restricted'); expect(byId[id].feedUrl).toBeUndefined(); }
    for (const id of ['afp', 'ap', 'reuters']) expect(byId[id].status).toBe('blocked');
    for (const s of registry.filter((x) => x.status !== 'approved')) expect(sourceRights(s, NOW).lane, s.id).toBe('BLOCKED');
  });
  it('the detail page drops links to publishers whose terms forbid any reuse, and credits GDELT when it found links', () => {
    const handler = fs.readFileSync('api/_handlers/actualites.js', 'utf8');
    expect(handler).toMatch(/status === 'blocked'/);
    expect(fs.readFileSync('src/components/news/NewsArticleExtras.jsx', 'utf8')).toMatch(/https:\/\/www\.gdeltproject\.org\//);
  });
});

describe('regional news outside Alsace is labelled « Grand Est », not « Alsace / Strasbourg »', async () => {
  const { classifyGeo, classifyTopics } = await import('../../api/_services/news/editorial.js');
  const { geoLabel } = await import('../../src/components/news/newsLabels.js');
  const t = (_k, d) => d;
  it('a Grand Est item stays in the local tab but keeps its own area and no Strasbourg rubric', () => {
    const item = { titre: 'La construction ralentit en 2025 dans le Grand Est', resume: 'Dans le Grand Est, la mise en chantier des logements recule.' };
    const g = classifyGeo(item, { scope: 'GRAND_EST' });
    expect([g.scope, g.area]).toEqual(['alsace', 'grand_est']);
    expect(classifyTopics(item, g)).not.toContain('strasbourg');
    expect(classifyTopics({ ...item, categorie: 'region' }, g)).not.toContain('strasbourg');
    expect(geoLabel(g.scope, t, g.area)).toBe('Grand Est');
  });
  it('an item naming Strasbourg or Alsace keeps the Alsace label and rubric', () => {
    const item = { titre: 'Strasbourg : nouvelles places en crèche', resume: 'L’Eurométropole ouvre des places dans le Grand Est.' };
    const g = classifyGeo(item, { scope: 'GRAND_EST' });
    expect(g.area).toBe('alsace');
    expect(classifyTopics(item, g)).toContain('strasbourg');
    expect(geoLabel(g.scope, t, g.area)).toBe('Alsace / Strasbourg');
  });
  it('a regional source with no place in the text is Grand Est, a Bas-Rhin source is Alsace', () => {
    expect(classifyGeo({ titre: 'Les chiffres du trimestre' }, { scope: 'GRAND_EST' }).area).toBe('grand_est');
    expect(classifyGeo({ titre: 'Les chiffres du trimestre' }, { scope: 'DEP_67' }).area).toBe('alsace');
  });
});
