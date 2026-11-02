/**
 * R35 (D16, defect B) — a request that is plainly not a social need gets NO result. « acheter une voiture de luxe » listed Action Logement and Mobilex:
 * since R34 a place also matches the data·inclusion services attributed to it, and one shared word (« voiture », « acheter ») is enough for the word
 * search. offTopicIntent() recognises purchases of luxury or consumer goods and leisure requests, in the six languages' French translation and the
 * original words, and steps aside as soon as the query carries a social marker (help, work, debt, disability, addiction, mobility to work…):
 * « acheter une voiture pour aller travailler », « permis de conduire », « jeux d'argent dette » keep their results. Danger always wins (search-safety.js).
 */
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");
const w = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'u');

/** luxury or prestige goods: never a social need on their own */
const LUXURY = w('luxe|luxueu\\w*|haut de gamme|prestige|lamborghini|ferrari|porsche|rolex|yacht|jet prive|bijoux? de luxe|grand cru|caviar|luxury|luks|luxus|розкіш\\w*|فاخر\\w*');
/** buying something (a consumer request), and the consumer goods it is about */
const BUY = w("acheter|achat|commander|ou trouver (?:un|une) (?:pas cher)?|prix (?:d'un|d'une|du|de la)|promo\\w*|soldes|buy|purchase|satin almak|kaufen|купити|شراء");
const GOODS = w("voitures?|auto|telephone|smartphone|iphone|ordinateur portable|console|playstation|xbox|tele|tv|television|televiseur|montre|sac a main|bijou\\w*|parfum\\w*|baskets|sneakers|vetements? de marque|meubles? design|phone|araba|telefon|auto|handy|машин\\w*|телефон|سيارة|هاتف");
/** leisure and entertainment requests */
const LEISURE = w("film|films|serie|series|netflix|streaming|concert|place de concert|match de foot|resultats? (?:du )?foot|ligue des champions|jeu video|jeux video|playstation|horoscope|meteo|blague|recette|recettes|restaurant gastronomique|cocktail|vacances aux|croisiere|club de golf|bitcoin|crypto\\w*|trading|forex|bourse en ligne|casino|movie|recipe|joke|weather|wetter|witz|фільм|погода|وصفة|طقس");
/** a social marker keeps the ordinary search: the person may need help with exactly this */
const SOCIAL = w("aide|aides|aider|social\\w*|travail\\w*|emploi|insertion|chomage|rsa|caf|dette\\w*|surendett\\w*|credit|microcredit|pret|handicap\\w*|mdph|pch|addict\\w*|dependan\\w*|jeux? d'argent|pari\\w*|mobilite|permis|transport\\w*|deplac\\w*|garage solidaire|location solidaire|vieillesse|retraite|enfant\\w*|famille|logement|hebergement|sante|malad\\w*|urgence|canicule|grand froid|precarite|pauvrete|budget|reduction|tarif social|gratuit\\w*|association|benevol\\w*|help|work|job|debt|disability|yardim|hilfe|arbeit|допомог\\w*|робот\\w*|مساعدة|عمل");

/**
 * @param {...string} queries the query as typed and its French translation when there is one
 * @returns {{ kind: 'luxury' | 'consumer' | 'leisure' } | null}
 */
export function offTopicIntent(...queries) {
  const qs = queries.filter(Boolean).map(fold);
  if (!qs.length || qs.some((q) => SOCIAL.test(q))) return null;
  if (qs.some((q) => LUXURY.test(q))) return { kind: 'luxury' };
  if (qs.some((q) => BUY.test(q) && GOODS.test(q))) return { kind: 'consumer' };
  if (qs.some((q) => LEISURE.test(q))) return { kind: 'leisure' };
  return null;
}
