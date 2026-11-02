import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { offTopicIntent } from '../../api/lib/search-off-topic.js';

// R35 (D16, defect B): requests that are not social needs get no result; social needs that mention the same objects keep theirs.
const root = path.resolve(__dirname, '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

describe('R35 off-topic search intent', () => {
  it('negative controls: luxury goods, shopping, entertainment, investment, in several languages', () => {
    for (const q of ['acheter une voiture de luxe', 'montre Rolex prix', 'acheter un iPhone pas cher', 'commander une PlayStation', 'achat télévision soldes',
      'film ce soir', 'résultats du foot', 'recette de cuisine', 'horoscope du jour', 'acheter du bitcoin', 'yacht à louer', 'buy a luxury car', 'lüks araba', 'Luxus Auto kaufen']) {
      expect(offTopicIntent(q), q).not.toBeNull();
    }
  });

  it('social needs that mention cars, phones, games or leisure keep the ordinary search', () => {
    for (const q of ['acheter une voiture pour aller travailler', 'aide pour acheter une voiture', 'permis de conduire', 'garage solidaire', 'microcrédit voiture',
      'aide au transport handicap', 'jeux d\'argent dette', 'addiction aux jeux vidéo', 'téléphone pour personne âgée aide', 'aide vacances enfants',
      'canicule personne âgée', 'louer un logement', 'payer mon loyer', 'curatelle', 'mon mari me frappe']) {
      expect(offTopicIntent(q), q).toBeNull();
    }
  });

  it('does not catch any orientation scenario or any non-off-topic evaluation query', () => {
    const scenarios = read('data/reference/orientation-scenarios.v1.json').scenarios;
    const caught = scenarios.filter((s) => offTopicIntent(s.query)).map((s) => `${s.id} ${s.query}`);
    expect(caught).toEqual([]);
    const evalSet = read('data/search-eval/retrieval-eval.v2.catalogue.json').queries;
    const wrongly = evalSet.filter((q) => q.category !== 'off-topic' && q.category !== 'offtopic' && !['voiture-luxe', 'recette', 'bitcoin'].includes(q.id) && offTopicIntent(q.query)).map((q) => q.query);
    expect(wrongly).toEqual([]);
    for (const id of ['voiture-luxe', 'recette', 'bitcoin']) expect(offTopicIntent(evalSet.find((q) => q.id === id).query), id).not.toBeNull();
  });
});
