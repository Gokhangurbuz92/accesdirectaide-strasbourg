// Wider needs (vis-needs, 15/11/2026) — the multi-need orientation reads income loss, rent arrears and old age said in the first person, and knows five more
// needs (childcare, school, MDPH file, help with paperwork, home adaptation), in the six interface languages, without new false positives. Legal guardrails:
// no amount, threshold or deadline, no « vous avez droit », every sheet cited is a curated official guide or has a fallback title, every id is a subdomain.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { analyseNeeds, SHEET_TITLES } from '../../api/lib/multi-need.js';
import { crossLanguageQuery } from '../../api/lib/search-crosslanguage.js';
import { OFFICIAL_GUIDES } from '../../scripts/official-guides.mjs';

const NOW = new Date('2026-11-15T12:00:00Z');
const ids = (q) => (analyseNeeds([q], { now: NOW })?.needs || []).map((n) => n.id);
const need = (q, id) => analyseNeeds([q], { now: NOW }).needs.find((n) => n.id === id);
const idsIn = (q, lang) => (analyseNeeds([q, crossLanguageQuery(q, lang).query], { now: NOW })?.needs || []).map((n) => n.id);
const NEW = ['mdph-droits', 'acces-aux-droits', 'adaptation-logement', 'garde-enfants', 'scolarite-inclusive'];

describe('the audit scenarios', () => {
  it('no income + rent arrears + debts: the income need is no longer missed', () => {
    expect(ids('je n’ai plus de revenus, je n’arrive plus à payer mon loyer et j’ai des dettes')).toEqual(['expulsion-impayes', 'surendettement', 'minima-sociaux', 'aides-logement']);
  });
  it('78 years old + paperwork + a home that no longer fits', () => {
    const q = 'j’ai 78 ans, j’ai du mal avec mes démarches administratives et mon logement n’est plus adapté';
    expect(ids(q)).toEqual(['acces-aux-droits', 'adaptation-logement']);
    expect(need(q, 'adaptation-logement').sheets).toEqual(['F37501', 'F14202']);
    expect(need(q, 'acces-aux-droits').actions[0]).toMatch(/vous pouvez vous renseigner auprès d’un espace France services/);
  });
  it('an older mother losing her autonomy: home help with the Apa sheet; the caregiver too when the person says so', () => {
    expect(ids('ma mère âgée perd son autonomie')).toEqual(['aide-domicile']);
    expect(need('ma mère âgée perd son autonomie', 'aide-domicile').sheets).toContain('F10009');
    expect(ids('ma mère âgée perd son autonomie, je m’occupe d’elle tous les jours')).toEqual(['aidants', 'aide-domicile']);
    expect(ids('ma mère âgée perd son autonomie et sa salle de bain n’est plus adaptée')).toEqual(['aide-domicile', 'adaptation-logement']);
  });
  it('a family: low income + childcare + school + the MDPH file of a child', () => {
    const q = 'nous avons de faibles revenus, il nous faut une place en crèche pour le petit, des aides pour la scolarité de l’aîné et je dois faire le dossier MDPH de ma fille handicapée';
    expect(ids(q)).toEqual(['mdph-droits', 'minima-sociaux', 'garde-enfants', 'scolarite-inclusive', 'prestations-familiales']);
    expect(analyseNeeds([q], { now: NOW }).needs.every((n) => !n.urgent)).toBe(true);
  });
});

describe('wider recall of existing needs, first person', () => {
  it.each([['je n’ai plus aucun revenu depuis trois mois', 'minima-sociaux'], ['mes revenus sont trop faibles pour vivre', 'minima-sociaux'], ['je n’arrive plus à joindre les deux bouts', 'minima-sociaux'],
    ['je ne peux plus payer mon loyer', 'expulsion-impayes'], ['j’ai deux mois de loyer de retard', 'expulsion-impayes'], ['mon loyer est en retard, je n’ai pas payé mon loyer', 'expulsion-impayes'],
    ['j’ai 82 ans et je n’arrive plus à faire mes courses', 'aide-domicile'], ['je suis retraitée, j’ai du mal à faire ma toilette', 'aide-domicile']])('« %s » → %s', (q, id) => { expect(ids(q)).toContain(id); });
  it('under 25 the income need is still not offered', () => { expect(ids('j’ai 22 ans et je n’ai plus de revenus')).toEqual([]); });
});

describe('the five new needs', () => {
  it.each([['je cherche une nounou pour garder mon bébé', 'garde-enfants'], ['comment faire garder mes enfants après l’école', 'garde-enfants'],
    ['ma fille a des difficultés à l’école, quelles aides', 'scolarite-inclusive'], ['je n’arrive pas à payer les fournitures scolaires', 'scolarite-inclusive'],
    ['mon fils est autiste', 'mdph-droits'], ['je veux demander l’AAH', 'mdph-droits'], ['les papiers pour le handicap de mon mari', 'mdph-droits'],
    ['je ne comprends rien aux formulaires de la Caf', 'acces-aux-droits'], ['j’ai besoin d’aide pour mes démarches en ligne', 'acces-aux-droits'],
    ['installer un monte-escalier chez ma mère', 'adaptation-logement'], ['je suis en fauteuil roulant et ma salle de bain n’est pas adaptée', 'adaptation-logement']])('« %s » → %s', (q, id) => { expect(ids(q)).toContain(id); });
  it('none of them is urgent; the MDPH file comes before the less pressing ones', () => {
    expect(ids('dossier MDPH et place en crèche')).toEqual(['mdph-droits', 'garde-enfants']);
    expect(analyseNeeds(['dossier MDPH'], { now: NOW }).needs[0]).toMatchObject({ urgent: false, numbers: [], sheets: ['F24610', 'F31029'], topic: 'MDPH' });
  });
});

describe('no new false positive', () => {
  it.each(['je veux la garde alternée de mes enfants après le divorce', 'mon fils est en garde à vue', 'payer la cantine en ligne', 'obtenir un certificat de scolarité pour l’université',
    'inscription à l’auto-école', 'mon logement n’est plus adapté, nous sommes six dans un deux-pièces', 'j’ai perdu mes papiers', 'quelles démarches pour renouveler ma carte d’identité',
    'ma fille âgée de 3 ans est malade', 'déclaration de revenus en ligne', 'j’ai plus de revenus que l’an dernier', 'j’ai 70 ans et je cherche un club de marche', 'changer de fournisseur d’électricité',
    'handicap et difficultés pour me déplacer en tram'])('« %s » reaches none of the new or widened needs', (q) => {
    const got = ids(q);
    for (const id of [...NEW, 'minima-sociaux', 'expulsion-impayes', 'aide-domicile']) expect(got).not.toContain(id);
  });
  it.each(['renouveler ma carte d’identité', 'horaires de la mairie', 'acheter une voiture', 'garde à vue', 'déclaration de revenus', 'permis de conduire'])('« %s » still describes no need at all', (q) => {
    expect(analyseNeeds([q], { now: NOW })).toBeNull();
  });
});

const CASES = {
  en: ['I have no income and I cannot pay my rent', 'I need childcare for my baby', 'school registration for my daughter', 'disability application for my son', 'I need help with administrative paperwork', 'my mother is elderly and needs home care', 'how to adapt my home, I need a stairlift'],
  tr: ['gelirim yok ve kiramı ödeyemiyorum', 'çocuğum için kreş arıyorum', 'kızımın okul kaydı', 'oğlum için engelli raporu', 'resmi işlemlerde yardıma ihtiyacım var', 'annem yaşlı, evde bakım lazım', 'merdiven asansörü taktırmak istiyorum'],
  ar: ['ليس لدي دخل ولا أستطيع دفع الإيجار', 'أبحث عن حضانة لطفلي', 'تسجيل ابنتي في المدرسة', 'ملف الإعاقة لابني', 'أحتاج مساعدة في الإجراءات الإدارية', 'أمي مسنة وتفقد استقلاليتها', 'تكييف السكن لشخص مسن'],
  de: ['Ich habe kein Einkommen und kann meine Miete nicht bezahlen', 'Ich suche eine Kinderbetreuung', 'Schulanmeldung für meine Tochter', 'mein Sohn ist behindert', 'Ich brauche Hilfe bei Behördengängen', 'meine Mutter ist pflegebedürftig', 'Wohnung altersgerecht umbauen'],
  uk: ['у мене немає доходу і я не можу платити за оренду', 'шукаю дитячий садок для дитини', 'запис доньки до школи', 'мій син має інвалідність', 'мені потрібна допомога з адміністративними документами', 'моя мати літня і втрачає самостійність', 'пристосувати житло для літньої людини'],
};
describe.each(Object.entries(CASES))('the wider needs in %s', (lang, [income, care, school, mdph, admin, old, adapt]) => {
  it('no income + rent arrears', () => { expect(idsIn(income, lang)).toEqual(expect.arrayContaining(['expulsion-impayes', 'minima-sociaux'])); });
  it('childcare', () => { expect(idsIn(care, lang)).toContain('garde-enfants'); });
  it('school', () => { expect(idsIn(school, lang)).toContain('scolarite-inclusive'); });
  it('disability file', () => { expect(idsIn(mdph, lang)).toContain('mdph-droits'); });
  it('help with paperwork', () => { expect(idsIn(admin, lang)).toContain('acces-aux-droits'); });
  it('an older parent', () => { expect(idsIn(old, lang)).toContain('aide-domicile'); });
  it('home adaptation', () => { expect(idsIn(adapt, lang)).toContain('adaptation-logement'); });
});
describe('no false positive in the other languages', () => {
  it.each([['en', 'opening hours of the town hall'], ['en', 'child custody after divorce'], ['en', 'driving school fees'], ['tr', 'kimlik kartı yenileme'], ['ar', 'تجديد بطاقة الهوية'], ['ar', 'حضانة الأطفال بعد الطلاق'],
    ['de', 'Personalausweis verlängern'], ['de', 'Wohnung in Strasbourg suchen'], ['uk', 'поновити паспорт'], ['uk', 'шукаю житло в Страсбурзі']])('%s « %s »', (lang, q) => {
    for (const id of [...NEW, 'minima-sociaux', 'expulsion-impayes', 'aide-domicile']) expect(idsIn(q, lang)).not.toContain(id);
  });
});

describe('legal guardrails of the texts', () => {
  const all = analyseNeeds(['dossier MDPH, crèche, scolarité de mon fils, j’ai du mal avec mes démarches, adaptation du logement, ma mère âgée perd son autonomie'], { now: NOW }).needs;
  const reference = JSON.parse(fs.readFileSync('data/reference/social-domains.v1.json', 'utf8'));
  const subdomains = new Set(reference.domains.flatMap((d) => d.subdomains.map((s) => s.id)));
  const curated = new Set(OFFICIAL_GUIDES.map((g) => g.id));
  it('the sentence reaches the five new needs', () => { expect(all.map((n) => n.id)).toEqual(expect.arrayContaining(NEW)); });
  it('every need is a subdomain of the social reference; every sheet is a curated official guide or has a fallback title', () => {
    for (const n of all) {
      expect(subdomains.has(n.id), n.id).toBe(true);
      for (const s of n.sheets) expect(curated.has(s) || Boolean(SHEET_TITLES[s]), s).toBe(true);
      for (const m of n.actions.join(' ').matchAll(/F\d+/g)) expect([...all.flatMap((x) => x.sheets), 'F245', 'F246', 'F255', 'F2444'], m[0]).toContain(m[0]);
    }
  });
  it('no amount, threshold, deadline or phone number; never « vous avez droit »; a body is named as a place to ask', () => {
    for (const n of all.filter((x) => NEW.includes(x.id))) {
      const text = `${n.label} ${n.actions.join(' ')}`.replace(/F\d+/g, '');
      expect(text, n.id).not.toMatch(/\d|€|%|vous avez droit|vous y avez droit|a droit à|ont droit|vous êtes éligible|sera versé/i);
      expect(n.numbers).toEqual([]); expect(n.rules).toEqual([]);
      if (/Caf|MDPH|France services|France Rénov|mairie/.test(text)) expect(text, n.id).toMatch(/vous pouvez vous renseigner auprès/);
    }
  });
});
