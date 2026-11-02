// R38 — the everyday situations of the five R37 sheets (F20055, F12006, F1280, F19778, F16920, published 02/11/2026) reach their need, without new false positives.
import { describe, it, expect } from 'vitest';
import { analyseNeeds } from '../../api/lib/multi-need.js';

const ids = (q) => (analyseNeeds([q]) || { needs: [] }).needs.map((n) => n.id);
const sheets = (q) => (analyseNeeds([q]) || { needs: [] }).needs.flatMap((n) => n.sheets);
const cautions = (q) => (analyseNeeds([q]) || { cautions: [] }).cautions.map((c) => c.id);

describe('R38 — the R37 sheets in everyday words', () => {
  it('unpaid bills of any kind → F20055', () => {
    expect(ids('Je n’arrive plus à payer mes factures.')).toEqual(['energie']);
    expect(sheets('on m’a coupé l’eau')).toContain('F20055');
    expect(ids('j’ai des dettes de téléphone')).toEqual(['energie', 'surendettement']);
  });
  it('helping a dependent parent → congé de proche aidant (F16920)', () => {
    expect(ids('Je dois arrêter de travailler pour aider ma mère dépendante.')).toEqual(['aidants']);
    expect(sheets('Je dois arrêter de travailler pour aider ma mère dépendante.')).toContain('F16920');
  });
  it('no resources at 25 or over → RSA (F19778); under 25 the need is not offered', () => {
    expect(ids('J’ai plus de 25 ans, je suis sans ressources.')).toEqual(['minima-sociaux']);
    expect(sheets('J’ai plus de 25 ans, je suis sans ressources.')).toEqual(['F19778']);
    expect(ids('j’ai 22 ans sans revenus')).toEqual([]);
    expect(ids('je sors de l’ASE, j’ai 18 ans, pas de logement et très peu de revenus')).toEqual(['hebergement-urgence', 'sortie-ase']);
  });
  it('housing aid → APL / ALS, with the residence-permit caution when the words say « sans titre »', () => {
    expect(ids('Est-ce que je peux toucher les APL ?')).toEqual(['aides-logement']);
    const q = 'Je suis étranger sans titre de séjour et j’ai besoin d’un logement.';
    expect(ids(q)).toEqual(['droits-sans-titre', 'aides-logement']);
    expect(cautions(q)).toContain('permit-housing-aid');
  });
  it('no false positive: online payments, identity card, curatelle', () => {
    for (const q of ['je veux payer mes impôts sur internet', 'renouveler ma carte d’identité', 'curatelle', 'payer la cantine en ligne']) expect(ids(q)).toEqual([]);
  });
});

describe('R38 — suicidal crisis goes first, with the 3114 (sheet F33954)', () => {
  it('explicit or euphemistic words → crise-suicide before every other need, 3114 and 15 shown', () => {
    expect(ids('je me sens isolé et j’ai des idées noires')).toEqual(['crise-suicide', 'psy', 'isolement']);
    expect(ids('j’ai envie de mourir')).toEqual(['crise-suicide']);
    expect(ids('I want to kill myself')).toEqual(['crise-suicide']);
    const n = analyseNeeds(['j’ai envie de mourir']).needs[0];
    expect(n.numbers).toEqual(['3114', '15']); expect(n.sheets).toEqual(['F33954']);
  });
  it('a question about the law of end of life is not a crisis; depression alone stays « psy »', () => {
    expect(ids('suicide assisté loi')).toEqual([]); expect(ids('aide à mourir')).toEqual([]);
    expect(ids('je suis déprimé')).toEqual(['psy']);
  });
});
