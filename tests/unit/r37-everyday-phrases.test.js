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
    expect(wordTerms('soigner')).toEqual(expect.arrayContaining(['soins']));
  });
});
