/**
 * R37 — multi-need orientation (api/lib/multi-need.js): the needs a person describes, most urgent first; cautions only where the person's own words put
 * a benefit's condition in doubt; a question only when the answer depends on it; nothing for a query that describes no need of the list.
 */
import { describe, expect, it } from 'vitest';
import { analyseNeeds, annotateAides } from '../../api/lib/multi-need.js';

const WINTER = new Date('2026-11-02T12:00:00Z'); const SUMMER = new Date('2026-06-15T12:00:00Z');
const ids = (q, o) => (analyseNeeds([q], { now: WINTER, ...o })?.needs || []).map((n) => n.id);
const cautions = (q) => (analyseNeeds([q], { now: WINTER })?.cautions || []).map((c) => c.id);

describe('the directive scenarios', () => {
  it('rent arrears + electricity shut-off + children', () => {
    const r = analyseNeeds(['loyers impayés, on va me couper l’électricité et j’ai trois enfants'], { now: WINTER });
    expect(r.needs.map((n) => n.id)).toEqual(['energie', 'expulsion-impayes', 'prestations-familiales']);
    expect(r.multi).toBe(true);
    const energy = r.needs[0];
    expect(energy.sheets).toContain('F20055');
    expect(energy.rules[0]).toMatchObject({ sheet: 'F20055', inForceNow: true });
    expect(analyseNeeds(['on va me couper l’électricité'], { now: SUMMER }).needs[0].rules[0].inForceNow).toBe(false);
  });
  it('exhausted caregiver + dependent older parent', () => {
    expect(ids('je suis aidant, épuisé, ma mère âgée ne peut plus rester seule à domicile')).toEqual(['aidants', 'aide-domicile']);
  });
  it('leaving child protection at 18 + no accommodation + little income: housing first, the APL caution, the RSA caution', () => {
    expect(ids('je sors de l’ASE à 18 ans, je n’ai pas de logement et peu de revenus')).toEqual(['hebergement-urgence', 'sortie-ase']);
    expect(cautions('je sors de l’ASE à 18 ans, je n’ai pas de logement')).toEqual(['no-home-housing-aid', 'under-25-rsa']);
  });
  it('unemployment + debt + housing insecurity', () => {
    expect(ids('au chômage, des dettes, je risque de perdre mon logement')).toEqual(['expulsion-impayes', 'surendettement', 'recherche-emploi']);
  });
  it('isolation + psychological distress: no income caution unless « isolé » is used, then its meaning is explained', () => {
    expect(ids('je suis isolé et déprimé, je ne vois personne')).toEqual(['psy', 'isolement']);
    expect(cautions('je suis isolé et déprimé')).toEqual(['isolated-meaning']);
    expect(analyseNeeds(['je suis déprimé'], { now: WINTER }).needs[0].numbers).toEqual(['3114']);
  });
  it('disability + inaccessible transport', () => { expect(ids('handicap et difficultés pour me déplacer en tram')).toEqual(['accessibilite-mobilite']); });
  it('administrative exclusion + missing residence documents: AME, shelter; APL/ALS and RSA cautioned', () => {
    expect(ids('je suis sans titre de séjour et sans logement')).toEqual(['hebergement-urgence', 'droits-sans-titre']);
    expect(cautions('je suis sans titre de séjour et sans logement')).toEqual(['permit-housing-aid', 'permit-rsa', 'no-home-housing-aid']);
    const r = analyseNeeds(['je suis sans titre de séjour et sans logement'], { now: WINTER });
    expect(r.needs.map((n) => n.sheets)).toEqual([['F2003', 'F17317'], ['F3079']]);   // each sheet once, under the most urgent need
  });
  it('domestic violence + urgent housing: violence first', () => {
    expect(ids('violences conjugales, je dois quitter le logement ce soir')).toEqual(['violences-conjugales', 'hebergement-urgence']);
    expect(ids('il faut que je parte de chez moi', { safetyKind: 'violence' })).toEqual(['violences-conjugales']);
  });
  it('debts + electricity shut-off', () => { expect(ids('j’ai des dettes et on va me couper l’électricité')).toEqual(['energie', 'surendettement']); });
});

describe('negative and ambiguous', () => {
  it.each(['renouveler ma carte d’identité', 'horaires de la mairie', 'acheter une voiture', 'curatelle', 'carte grise'])('« %s » describes no need of the list', (q) => {
    expect(analyseNeeds([q], { now: WINTER })).toBeNull();
  });
  it('a residence permit stated → no permit caution; an unstated status for a foreigner → the question', () => {
    expect(cautions('j’ai un titre de séjour valable et je n’ai pas de logement')).toEqual(['no-home-housing-aid']);
    const r = analyseNeeds(['je suis étranger et je cherche un logement'], { now: WINTER });
    expect(r?.questions?.map((x) => x.id)).toEqual(['permit']);
    expect(r.questions[0].options.map((o) => o.add)).toEqual(['avec titre de séjour', 'sans titre de séjour']);
  });
  it('« mère isolée » (a single mother, the RSA sense) is not isolation', () => {
    expect(ids('mère isolée avec deux enfants, quelles aides')).toEqual(['prestations-familiales']);
  });
  it('« électricité » alone (no unpaid bill, no cut) is not the energy need', () => { expect(ids('changer de fournisseur d’électricité')).toEqual([]); });
  it('« 30 ans » is not under 25; « 19 ans » is', () => {
    expect(cautions('j’ai 30 ans, sans logement')).toEqual(['no-home-housing-aid']);
    expect(cautions('j’ai 19 ans, sans logement')).toEqual(['no-home-housing-aid', 'under-25-rsa']);
  });
  it('the French translation of a query typed in another language is read too', () => {
    expect(analyseNeeds(['I have no residence permit', 'sans titre de séjour'], { now: WINTER }).needs.map((n) => n.id)).toEqual(['droits-sans-titre']);
  });
});

describe('aides with cautions', () => {
  it('a cautioned aide is kept, tagged, and placed after the others', () => {
    const r = analyseNeeds(['sans titre de séjour et sans logement'], { now: WINTER });
    const out = annotateAides([{ title: 'Aide personnalisée au logement (APL)' }, { title: 'Allocation de logement sociale (ALS)' }, { title: 'Aide médicale de l’État' }], r);
    expect(out.map((x) => x.title)).toEqual(['Aide médicale de l’État', 'Aide personnalisée au logement (APL)', 'Allocation de logement sociale (ALS)']);
    expect(out[1].cautions).toEqual(['permit-housing-aid', 'no-home-housing-aid']);
    expect(annotateAides([{ title: 'x' }], null)).toEqual([{ title: 'x' }]);
  });
});
