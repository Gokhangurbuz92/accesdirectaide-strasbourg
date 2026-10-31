/**
 * R31 (P13 / Q02) — no public text asserts that a person HAS a right. Found on production (31/10/2026) in two machine-written easy-to-read summaries:
 * RSA « Vous avez droit si vous êtes de 25 ans ou plus. » and ALS « Vous avez le droit si vous ne pouvez pas avoir droit à l'APL… ».
 */
import { describe, expect, it } from 'vitest';
import { claimsEntitlement } from '../../api/lib/entitlementWording.js';
import { stripReviewFields } from '../../api/lib/publicVisibility.js';
import { checkTexts } from '../../api/_services/verification/texts.js';

describe('entitlement claims', () => {
  it('catches assertions and lets questions through', () => {
    for (const t of ['Vous avez droit si vous êtes de 25 ans ou plus.', 'Vous avez le droit si vous ne pouvez pas avoir droit à l’APL.', 'Vous êtes éligible.', 'Vous recevrez 600 euros.', 'vous aurez droit à une aide'])
      expect(claimsEntitlement(t), t).toBe(true);
    for (const t of ['La structure locale vérifie si vous avez le droit.', 'Consultez le simulateur pour savoir si vous avez le droit.', 'Vous pouvez peut-être recevoir cette aide.', 'La Caf décide.'])
      expect(claimsEntitlement(t), t).toBe(false);
    expect(claimsEntitlement(['Demandez de l’aide.', 'Vous obtiendrez une réponse.'])).toBe(true);
    expect(claimsEntitlement(null)).toBe(false);
  });
  it('a published simplified text with a claim is withheld from the public payload, the standard text stays', () => {
    const row = { slug: 'rsa', cest_quoi: 'Le RSA est un revenu minimum.', summary_falc: 'Le RSA vous donne un revenu minimum.\nVous avez droit si vous êtes de 25 ans ou plus.', conditions_falc: 'Vous avez 25 ans ou plus.' };
    const out = stripReviewFields(row, false);
    expect(out.summary_falc).toBeUndefined();
    expect(out.falc_withheld).toEqual(['summary_falc']);
    expect(out.conditions_falc).toBe('Vous avez 25 ans ou plus.');
    expect(out.cest_quoi).toBe('Le RSA est un revenu minimum.');
    expect(stripReviewFields(row, true).summary_falc).toContain('Vous avez droit');   // administrators see what is withheld
  });
  it('a field holding the word « null » is no text (FAJ’EMS « Ce que ça aide », 31/10/2026)', async () => {
    expect(stripReviewFields({ slug: 'faj', ce_que_ca_aide: 'null', cest_quoi: 'Texte.' }, false).ce_que_ca_aide).toBeNull();
    const { blankWord } = await import('../../api/_services/verification/texts.js');
    for (const v of [null, '', 'null', ' NULL ', 'undefined', 'aucun', 'N/A']) expect(blankWord(v), String(v)).toBe(true);
    expect(blankWord('Entre 100 et 300 €')).toBe(false);
  });
  it('the automatic writer check refuses a claim', () => {
    const normal = { resume: 'Le RSA est un revenu minimum pour les personnes qui ont peu de ressources. La Caf verse le RSA chaque mois après examen de la demande et de la situation du foyer.' };
    const falc = { resume: ['Le RSA vous donne un peu d’argent chaque mois.', 'Vous avez droit si vous avez 25 ans.', 'La Caf regarde votre demande.'] };
    expect(checkTexts(normal, falc, 'Le RSA est un revenu minimum. 25 ans.').problems.join(' ')).toContain('Ne dites jamais que la personne a droit');
  });
});
