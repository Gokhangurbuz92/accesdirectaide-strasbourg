/**
 * R37 — everyday expressions reach the administrative word of the official texts (production 02/11/2026: « se soigner sans papiers » returned the guides
 * on lost identity papers; « maman solo », « à la rue », « maison de retraite » found nothing or the wrong sheet). Equivalences of meaning only.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/db/index.js', () => ({ db: {} }));
const { searchWords, wordTerms } = await import('../../api/lib/search-query.js');

describe('everyday expressions', () => {
  it.each([
    ['se soigner sans papiers', ['soigner', 'irreguliere']],
    ['je suis sans-papier', ['irreguliere']],
    ['je n’ai pas de papiers et je dois me soigner', ['irreguliere', 'dois', 'soigner']],
    ['je suis maman solo quelles aides', ['monoparentale']],
    ['père célibataire avec deux enfants', ['monoparentale', 'deux', 'enfants']],
    ['je dors dans la rue où trouver un hébergement', ['dors', 'precarite', 'hebergement']],
    ['qui paie la maison de retraite si ma mère n’a pas assez d’argent', ['paie', 'ehpad', 'mere', 'assez', 'argent']],
    ['ma grand-mère ne peut plus vivre seule', ['agee', 'peut', 'plus', 'vivre', 'seule']],
    ['retraité avec une petite pension', ['retraite', 'precarite']],
    ['confier mon enfant à l’aide sociale à l’enfance', ['confier', 'enfant', 'ase']],
  ])('« %s »', (q, words) => { expect(searchWords(q)).toEqual(words); });
  it('the words themselves keep their own meaning elsewhere', () => {
    expect(searchWords('renouveler mes papiers d’identité')).toEqual(['renouveler', 'papiers', 'identite']);
    expect(searchWords('une seule personne')).toEqual(['seule', 'personne']);
    expect(searchWords('la rue du Dôme')).toEqual(['rue', 'dome']);
  });
  it('colloquial synonyms', () => {
    expect(wordTerms('gay')).toEqual(expect.arrayContaining(['homophobie']));
    expect(wordTerms('soigner')).not.toContain('soins');   // « soins » pulled the palliative-care sheets above « traitement de la toxicomanie »
    expect(wordTerms('drogue')).toEqual(expect.arrayContaining(['toxicomanie']));
  });
});

describe('R38 — helping a dependent relative → « aidant » (congé de proche aidant, F16920)', async () => {
  const { searchWords } = await import('../../api/lib/search-query.js');
  it('the everyday words become the official word', () => {
    expect(searchWords('je dois arrêter de travailler pour aider ma mère dépendante')).toContain('aidant');
    expect(searchWords('congé pour m’occuper de mon père malade')).toContain('aidant');
  });
  it('a plain « aider » or a home-help request is left alone', () => {
    expect(searchWords('aider ma mère')).not.toContain('aidant');
    expect(searchWords('aide ménagère pour mon père âgé')).not.toContain('aidant');
  });
});

describe('R38 (D16) — paying for a care home, entrusting a child', async () => {
  const { searchWords } = await import('../../api/lib/search-query.js');
  it('« payer la maison de retraite » → the words of the ASH sheet (F2444), not only « ehpad »', () => {
    expect(searchWords('payer la maison de retraite')).toEqual(['sociale', 'hebergement', 'agee']);   // « aide » is a stopword
    expect(searchWords('maison de retraite pour ma grand-mère')).toContain('ehpad');   // unchanged: looking for a home
  });
  it('« confier mon enfant » → the voluntary placement sheet (F959)', () => {
    expect(searchWords('confier mon enfant ASE')).toEqual(expect.arrayContaining(['placement', 'volontaire', 'enfant']));
    expect(searchWords('le juge a placé mon enfant')).not.toContain('volontaire');
  });
});
