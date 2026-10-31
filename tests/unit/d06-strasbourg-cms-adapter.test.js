/**
 * D06 — the Strasbourg CMS source path (strasbourg.eu, a Liferay site). The page reader must read the content area only: not the skip link, the
 * « Mon quartier, ma commune » / « Mon profil » header blocks, the anchor menu or the footer address, and not a hidden « Entête de page » label.
 * The fixture reproduces the structure of the real pages (31/10/2026) with neutral, invented text.
 */
import { describe, it, expect } from 'vitest';
import { parseOfficialPage, mainScope, cmsContent, innerOfBalanced } from '../../api/_services/verification/pages.js';

const HEADER = `<a href="#content" class="skip">Aller au contenu</a>
  <header><nav><a href="/">Accueil</a></nav></header>
  <div class="portlet-body"><div class="journal-content-article "><h2>Mon quartier, ma commune</h2><p>Sélectionnez votre commune pour participer à la vie de votre quartier.</p></div></div>
  <div class="portlet-body"><div class="journal-content-article "><h2>Mon profil</h2><p>Association Entreprise Parent</p></div></div>`;
const FOOTER = `<footer><div class="journal-content-article "><p>Ville et Eurométropole, 1 place de l'Exemple, 67000 Strasbourg. Accès et horaires.</p></div></footer>`;
const liferay = (content) => `<html><head><title>Aide exemple | Strasbourg.eu</title></head><body><div id="wrapper"><div class="st-page-wrapper">${HEADER}
  <div id="master-layout-wrapper"><div id="layout"><div class="layout-content portlet-layout">
    <div id="frag"><div class="st-ancres"><nav class="st-ancres__container"><a href="#a">Qu’est-ce que l’aide ?</a><a href="#b">Comment la demander ?</a></nav></div>
    ${content}
  </div></div></div></div>${FOOTER}</div></div></body></html>`;
const CONTENT = `<h1>Aide exemple de l’Eurométropole</h1>
    <div class="component-paragraph"><p>L’aide exemple soutient les personnes de 18 à 25 ans qui habitent l’Eurométropole.</p></div>
    <div><h2 id="a">Qu’est-ce que l’aide ?</h2><div><p>Une aide financière ponctuelle de 300 euros au plus, versée après avis d’une commission.</p></div></div>
    <div><h2 id="b">Comment la demander ?</h2><p>Prenez rendez-vous avec un travailleur social de votre secteur.</p></div>`;

describe('D06 Strasbourg CMS adapter', () => {
  it('reads the layout content, without the header blocks, the anchor menu, the skip link or the footer', () => {
    const p = parseOfficialPage(liferay(CONTENT), 'https://www.strasbourg.eu/aide-exemple');
    expect(p.title).toBe('Aide exemple de l’Eurométropole');
    expect(p.chapters.map((c) => c.heading)).toEqual([null, 'Qu’est-ce que l’aide ?', 'Comment la demander ?']);
    expect(p.text).toMatch(/300 euros au plus/);
    expect(p.text).not.toMatch(/Mon quartier|Mon profil|Aller au contenu|place de l'Exemple|Comment la demander \?Qu/);
    expect(JSON.stringify(p.facts)).toMatch(/300/);
  });
  it('a change of the header menus does not change the fingerprint; a change of the aid does', () => {
    const a = parseOfficialPage(liferay(CONTENT));
    const menus = parseOfficialPage(liferay(CONTENT).replace('Association Entreprise Parent', 'Association Entreprise Parent Senior'));
    const aid = parseOfficialPage(liferay(CONTENT.replace('300 euros', '350 euros')));
    expect(menus.fingerprint).toBe(a.fingerprint);
    expect(aid.fingerprint).not.toBe(a.fingerprint);
  });
  it('a hidden « Entête de page » label is not a chapter, its text is kept', () => {
    const p = parseOfficialPage(`<html><body><article><h2>Entête de page</h2><p>Le fonds aide à garder son logement, sur rendez-vous.</p><h2>Contact</h2><p>Le service logement répond du lundi au vendredi.</p></article></body></html>`);
    expect(p.chapters.map((c) => c.heading)).toEqual([null, 'Contact']);
    expect(p.text).toMatch(/garder son logement/);
  });
  it('pages with <main> or a substantial <article> keep their rule (Service-Public, alsace.eu)', () => {
    expect(mainScope('<body><nav>menu</nav><main><p>contenu principal assez long</p></main></body>')).toMatch(/contenu principal/);
    expect(cmsContent('<body><p>pas de mise en page Liferay</p></body>')).toBeNull();
  });
  it('the balanced reader matches nested elements', () => {
    expect(innerOfBalanced('<div class="x"><div>a</div><div><div>b</div></div></div><div>after</div>', 0, 'div')).toBe('<div>a</div><div><div>b</div></div>');
  });
});
