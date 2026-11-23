// @vitest-environment jsdom
/**
 * G14-RG (owner approval 23/11/2026) — « Ma situation » (/situation, /situation/:id): the one-door flow of the Rights Graph.
 *   - data integrity: every situation link resolves to a sourced record (official URL + date), no orphan id, closed Mon Parcours list only, no entitlement
 *     wording, no amount, danger ⇒ emergency numbers of the catalogue;
 *   - matching: deterministic, in the browser, six languages (« loyer impayé », « expulsion », « perte d'emploi », « arrivée Strasbourg », « violences »…);
 *   - the page: six languages, Arabic right-to-left, axe clean, no request (the typed text never leaves the page nor enters the address), sections in order,
 *     booking and Mon Parcours only when their surfaces are open; open during the restricted beta; reachable from the home hero.
 * No JSX in the test body.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import fs from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { ENTITLEMENT_CLAIMS } from '../../scripts/i18n-check.mjs';
import { bookingOpened, isBetaRestrictedPath, parcoursOpened } from '../../src/lib/publicBeta.js';
import { setLanguage } from '../../src/i18n/index.js';
import Situation from '../../src/pages/Situation.jsx';
import { RAW_SITUATIONS, SITUATIONS, STEP_TYPES, STRUCTURE_TYPES, EMERGENCY_NUMBERS, matchSituations, normalise, sourcedFiche, directoryHref } from '../../src/lib/lifeSituations.js';

const LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk'];
const file = JSON.parse(fs.readFileSync('data/reference/life-situations.v1.json', 'utf8'));
const view = JSON.parse(fs.readFileSync('data/reference/rights-public-view.v1.json', 'utf8'));
const domains = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
const routes = fs.readFileSync('src/pages/index.jsx', 'utf8');
let fetchSpy;
beforeEach(() => { fetchSpy = vi.fn(async () => { throw new Error('no request expected'); }); globalThis.fetch = fetchSpy; });
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await setLanguage('fr', { persist: false }); });
afterAll(async () => { await setLanguage('fr', { persist: false }); });

let lastLocation = null;
function LocationProbe() { lastLocation = useLocation(); return null; }
const page = (path) => render(createElement(HelmetProvider, null, createElement(MemoryRouter, { initialEntries: [path] },
  createElement(LocationProbe),
  createElement(Routes, null, createElement(Route, { path: '/situation', element: createElement(Situation) }), createElement(Route, { path: '/situation/:id', element: createElement(Situation) })))));
const allText = (container) => [container.textContent, ...[...container.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))].join('\n');
const serious = async (container) => (await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }))
  .violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OFFICIAL = /^https:\/\/www\.service-public\.gouv\.fr\/particuliers\/vosdroits\/[FN]\d{1,6}$/;

describe('G14-RG data — every link sourced, no orphan id', () => {
  it('ids are unique, and every need, subdomain, right, step, structure type and number resolves (nothing is dropped silently)', () => {
    expect(new Set(RAW_SITUATIONS.map((s) => s.id)).size).toBe(RAW_SITUATIONS.length);
    const needIds = new Set(view.needs.map((n) => n.id));
    const subdomains = new Set(domains.domains.flatMap((d) => d.subdomains.map((s) => `${d.id}/${s.id}`)));
    for (const raw of RAW_SITUATIONS) {
      const s = SITUATIONS.find((x) => x.id === raw.id);
      expect(raw.needs.filter((n) => !needIds.has(n)), raw.id).toEqual([]);
      expect(raw.subdomains.filter((x) => !subdomains.has(x)), raw.id).toEqual([]);
      expect(raw.subdomains.length, `${raw.id}: at least one catalogue subdomain`).toBeGreaterThan(0);
      expect(raw.rights.filter((f) => !sourcedFiche(f)), raw.id).toEqual([]);
      expect(raw.steps.filter((x) => (x.stepType ? !STEP_TYPES.has(x.stepType) : !sourcedFiche(x.fiche))), raw.id).toEqual([]);
      expect(raw.structures.filter((x) => !STRUCTURE_TYPES.has(x)), raw.id).toEqual([]);
      expect(raw.emergency.filter((x) => !Object.prototype.hasOwnProperty.call(domains.emergency, x)), raw.id).toEqual([]);
      expect(s.rights).toHaveLength(raw.rights.length); expect(s.steps).toHaveLength(raw.steps.length); expect(s.needs).toHaveLength(raw.needs.length);
      expect(s.steps.length + s.emergency.length, `${raw.id}: something to do`).toBeGreaterThan(0);
      expect(Object.keys(raw.keywords).sort(), raw.id).toEqual([...LANGS].sort());
      for (const l of LANGS) expect(raw.keywords[l].length, `${raw.id} ${l}`).toBeGreaterThan(0);
    }
  });

  it('every right and démarche shown carries its official URL, the source date and the read date', () => {
    for (const s of SITUATIONS) {
      const fiches = [...s.rights, ...s.steps.flatMap((x) => (x.kind === 'stepType' ? x.sources : [x.fiche]))];
      for (const f of fiches) {
        expect(f.url, `${s.id} ${f.id}`).toMatch(OFFICIAL);
        expect(f.url.endsWith(`/${f.id}`)).toBe(true);
        expect(f.modifiedAt, `${s.id} ${f.id}`).toMatch(DATE);
        expect(f.readAt, `${s.id} ${f.id}`).toMatch(DATE);
        expect(f.title, `${s.id} ${f.id}`).toBeTruthy();
      }
    }
  });

  it('danger ⇔ emergency numbers; the five owner numbers are all reachable; Mon Parcours steps only from its closed list', () => {
    for (const s of SITUATIONS) {
      if (s.danger) expect(s.emergency.length, s.id).toBeGreaterThan(0);
      else expect(s.emergency, s.id).toEqual([]);
    }
    const numbers = new Set(SITUATIONS.flatMap((s) => s.emergency));
    for (const n of ['115', '119', '3919', '3114', '112']) expect(numbers.has(n), n).toBe(true);
    for (const n of numbers) expect(EMERGENCY_NUMBERS[n]).toBeTruthy();
    const closed = new Set(JSON.parse(fs.readFileSync('data/reference/parcours-step-types.v1.json', 'utf8')).types.map((t) => t.code));
    for (const s of SITUATIONS) for (const st of s.steps) if (st.kind === 'stepType') expect(closed.has(st.code)).toBe(true);
  });

  it('the data file states no entitlement and no amount', () => {
    const text = JSON.stringify(file);
    expect(claimsEntitlement(text)).toBe(false);
    expect(text).not.toMatch(/€|\beuros?\b|éligible/i);
  });
});

describe('G14-RG matching — deterministic, local, six languages', () => {
  const first = (q) => matchSituations(q)[0]?.id;
  it.each([
    ['loyer impayé', 'loyer-impaye'], ["Je n'arrive plus à payer mon loyer", 'loyer-impaye'], ['expulsion', 'expulsion'], ["perte d'emploi", 'perte-emploi'],
    ["j'ai perdu mon emploi", 'perte-emploi'], ['arrivée Strasbourg', 'arrivee-strasbourg'], ["je viens d'arriver à Strasbourg", 'arrivee-strasbourg'],
    ['I lost my job', 'perte-emploi'], ['Ich habe meine Arbeit verloren', 'perte-emploi'], ['kiramı ödeyemiyorum', 'loyer-impaye'],
    ['لا أستطيع دفع الإيجار', 'loyer-impaye'], ['я втратив роботу', 'perte-emploi'], ['je dors dehors ce soir', 'sans-logement'], ['trop de dettes', 'dettes'],
  ])('%s → %s', (q, id) => { expect(first(q)).toBe(id); });

  it('« violences » (and an implicit wording) put a danger situation first, with its emergency numbers', () => {
    for (const q of ['violences', 'mon mari me frappe', 'domestic violence', 'Gewalt', 'şiddet', 'عنف', 'насильство']) {
      const hit = matchSituations(q)[0];
      expect(hit?.id, q).toBe('violences'); expect(hit.danger).toBe(true);
    }
    expect(SITUATIONS.find((s) => s.id === 'violences').emergency).toEqual(expect.arrayContaining(['3919', '112']));
    // a danger match comes before a stronger ordinary one
    expect(matchSituations('violences et loyer impayé expulsion')[0].id).toBe('violences');
  });

  it('a short keyword must be a whole word; nothing typed, nothing found; « je n’arrive plus » is not an arrival', () => {
    expect(matchSituations('')).toEqual([]);
    expect(matchSituations('amélioration')).toEqual([]);
    expect(first("je n'arrive plus à payer mon loyer")).not.toBe('arrivee-strasbourg');
    expect(normalise('L’AÏD — Straße, Kiramı')).toBe('l aid strasse kirami');
  });
});

describe('G14-RG /situation — six languages, every situation', () => {
  for (const lang of LANGS) {
    it(`${lang}: index and all ${RAW_SITUATIONS.length} situations render without entitlement wording or request; index and danger pages axe clean`, async () => {
      await setLanguage(lang, { persist: false });
      const idx = page('/situation');
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByTestId('situation-list').querySelectorAll('a')).toHaveLength(RAW_SITUATIONS.length);
      expect(await serious(idx.container)).toEqual([]);
      const texts = [allText(idx.container)];
      cleanup();
      for (const s of SITUATIONS) {
        const r = page(`/situation/${s.id}`);
        expect(screen.getByTestId(`situation-result-${s.id}`)).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        texts.push(allText(r.container), globalThis.document.title);
        if (['violences', 'loyer-impaye', 'perte-emploi'].includes(s.id)) expect(await serious(r.container), `${lang} ${s.id}`).toEqual([]);
        cleanup();
      }
      for (const t of texts) {
        expect(claimsEntitlement(t)).toBe(false);
        if (ENTITLEMENT_CLAIMS[lang]) expect(ENTITLEMENT_CLAIMS[lang].test(t), `${lang}: ${t.match(ENTITLEMENT_CLAIMS[lang])}`).toBe(false);
        expect(t).not.toMatch(/éligible|vous avez droit|undefined|\{\{|\bsituation:[a-z]/i);
      }
      expect(globalThis.document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      expect(fetchSpy).not.toHaveBeenCalled();
    }, 90000);
  }
});

describe('G14-RG /situation — one result page', () => {
  it('loyer impayé: rights to check with source and dates, démarches of the closed list, structures by commune, booking links on the online-booking filter, orientation link; no Mon Parcours button without a session', () => {
    page('/situation/loyer-impaye');
    const sections = [...globalThis.document.querySelectorAll('h2')].map((h) => h.textContent);
    expect(sections.indexOf('Vos droits possibles (à vérifier)')).toBeLessThan(sections.indexOf('Les démarches'));
    expect(sections.indexOf('Les démarches')).toBeLessThan(sections.indexOf('Qui peut vous aider près de chez vous'));
    const fsl = screen.getByTestId('situation-right-F1334');
    expect(fsl.querySelector('a[href="https://www.service-public.gouv.fr/particuliers/vosdroits/F1334"]')).toBeTruthy();
    expect(fsl).toHaveTextContent(/Source : fiche F1334 de Service-Public, mise à jour le .+, relue le 18 novembre 2026\./);
    expect(screen.getByText(/Vous pouvez vérifier si ces aides peuvent vous concerner/)).toBeInTheDocument();
    expect(screen.getByTestId('situation-steps').querySelector('[data-step="FSL_DEMANDE"]')).toHaveTextContent('Demander une aide du Fonds de solidarité pour le logement (FSL)');
    expect(screen.queryByTestId('situation-emergency')).toBeNull();
    // this test build is outside the beta (booking open): the « Prendre rendez-vous » links use the directory's online-booking filter only
    const booking = screen.getByTestId('situation-booking');
    expect([...booking.querySelectorAll('a')].every((a) => a.getAttribute('href').includes('bookable=1'))).toBe(true);
    expect(screen.queryByTestId('situation-parcours-FSL_DEMANDE')).toBeNull();
    const cafLink = () => screen.getByTestId('situation-structures').querySelector('a');
    const caf = cafLink();
    expect(caf.getAttribute('href')).toBe(directoryHref("Caf (Caisse d'allocations familiales)"));
    fireEvent.change(screen.getByTestId('situation-commune'), { target: { value: 'Schiltigheim' } });
    expect(cafLink().getAttribute('href')).toBe('/structures?type=Caf+%28Caisse+d%27allocations+familiales%29&city=Schiltigheim');
    expect(screen.getByTestId('situation-orientation').getAttribute('href')).toBe('/orientation');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('violences: the emergency block comes first, with 3919 and 112 as phone links and its official source', () => {
    page('/situation/violences');
    const em = screen.getByTestId('situation-emergency');
    expect(globalThis.document.querySelector('article h2')).toBe(em.querySelector('h2'));
    expect(em.querySelector('a[href="tel:3919"]')).toBeTruthy();
    expect(em.querySelector('a[href="tel:112"]')).toBeTruthy();
    expect(em).toHaveTextContent('Source : fiche F33954 de Service-Public.');
    expect(screen.getByTestId('situation-rights-none')).toBeInTheDocument();
  });

  it('the typed text is matched here: no request, the address never carries it, results link to a situation', () => {
    page('/situation');
    fireEvent.change(screen.getByTestId('situation-text'), { target: { value: 'mon conjoint me frappe et je dois payer mon loyer' } });
    fireEvent.click(screen.getByTestId('situation-find'));
    const hits = screen.getByTestId('situation-hits').querySelectorAll('a[data-situation]');
    expect(hits[0].getAttribute('data-situation')).toBe('violences');
    expect([...hits].map((a) => a.getAttribute('href'))).toContain('/situation/loyer-impaye');
    expect(lastLocation.pathname).toBe('/situation');
    expect(lastLocation.search).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(globalThis.localStorage)).not.toMatch(/frappe/);
    expect(JSON.stringify(globalThis.sessionStorage)).not.toMatch(/frappe/);
  });

  it('an unknown situation says so', () => {
    page('/situation/inconnue');
    expect(screen.getByTestId('situation-unknown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Toutes les situations' })).toHaveAttribute('href', '/situation');
  });
});

describe('G14-RG — public, reachable, sources of the page', () => {
  it('is not a beta-restricted screen, whatever the Production surfaces', () => {
    for (const open of [[], ['admin'], ['admin', 'accounts']]) {
      for (const p of ['/situation', '/situation/violences']) expect(isBetaRestrictedPath(p, open, { accountsScope: 'booking', proSelfRegistration: false }, false)).toBe(false);
    }
  });

  it('booking and Mon Parcours follow their own surfaces during the beta (closed by default)', () => {
    const sub = { accountsScope: 'booking', proSelfRegistration: false };
    expect(bookingOpened(true, [], sub)).toBe(false);
    expect(parcoursOpened(true, ['accounts'], sub)).toBe(false);
    expect(parcoursOpened(true, ['accounts'], { ...sub, accountsExtras: ['parcours'] })).toBe(true);
    expect(bookingOpened(true, ['appointments'], sub)).toBe(true);
  });

  it('is routed and linked from the home hero', () => {
    expect(routes).toContain('<Route path="/situation" element={<Situation />} />');
    expect(routes).toContain('<Route path="/situation/:id" element={<Situation />} />');
    expect(fs.readFileSync('src/components/organisms/HeroSearch.tsx', 'utf8')).toMatch(/to="\/situation"[\s\S]*data-testid="hero-situation-link"/);
  });

  it('the page and the matcher make no network call of their own and use no AI client (the only calls: the header session query and the Mon Parcours add, on click)', () => {
    for (const f of ['src/pages/Situation.jsx', 'src/lib/lifeSituations.js']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\bfetch\(|axios|openai|anthropic|['"`]\/api\/|localStorage|sessionStorage/i);
    }
    const page = fs.readFileSync('src/pages/Situation.jsx', 'utf8');
    expect(page.match(/citizenApi\.\w+/g)).toEqual(['citizenApi.parcours']);
    expect(page).toMatch(/citizenApi\.parcours\(\{ action: 'add', stepType: code \}\)/);
  });
});
