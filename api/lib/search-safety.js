/**
 * R34 — a search that describes DANGER gets the official emergency numbers first. Before, « mon mari me frappe » returned five town halls and no number:
 * the word search had nothing to match and nothing said « call 17 or 3919 ». safetySignal() reads the query (any of the six languages, the original
 * words AND their French translation) and returns the kind of danger, the official numbers to show (keys of data/reference/social-domains.v1.json
 * « emergency ») and the kinds of office that receive such people. It never hides the ordinary results and it never decides anything for the person.
 * Patterns are deliberately narrow (a person + an act), so « violence » alone in a question about a law is not treated as an emergency.
 */
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");
const w = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'u');

/** [kind, test(folded query), numbers, office types, French topic searched for a query typed in another language] — the first matching kind wins; order = gravity */
const SIGNALS = [
  ['suicide', w("suicide|suicider|me tuer|en finir|envie de mourir|plus envie de vivre|veux mourir|kill myself|suicidal|want to die|intihar|kendimi oldur|selbstmord|suizid|mich umbringen|суїцид|самогубств|покінчити з собою|انتحار|أنتحر"), ['3114', '15', '112'], [], 'psychologue psychiatre'],
  ['enfant', (q) => w('enfant|fils|fille|mineur|bebe|child|my son|my daughter|cocuk|kind|дитин|طفل').test(q) && w('frappe|frapper|battu|battue|bat|(?:des|recu|recoit|donne) coups|maltrait\\w*|danger|abuse\\w*|beats?|hits?|hurts?|dovuyor|schlagt|missbrauch\\w*|б.є|насильств\\w*|يضرب|عنف').test(q), ['119', '17', '112'], [], 'enfant maltraitance'],
  ['personne-agee', (q) => w('agee?s?|vieux|vieille|grand[- ]?(mere|pere)|elderly|yasli|alter\\w*|літн\\w*|مسن').test(q) && w('maltrait\\w*|frappe\\w*|battue?|abuse\\w*|vole|escroqu\\w*').test(q), ['3133', '17', '112'], [], 'maltraitance personne agee'],
  ['violence', (q) => w('frappe|frapper|frappee?|me bat|il bat|battue?|(?:des|recu|recois|donne|prend|pris) coups|coups et blessures|cogne|gifle\\w*|etrangl\\w*|menace\\w* de mort|violente?s?|violences?|viol|violee?|agression sexuelle|agresse\\w*|hits me|beats me|abus\\w*|abuse\\w*|violence|rape\\w*|dovuyor|siddet|tecavuz|schlagt mich|gewalt|vergewaltig\\w*|б.є мене|насильств\\w*|зґвалтуван\\w*|يضربني|عنف|اغتصاب').test(q)
    && !w('loi|article|statistiques?|definition|formation|colloque|conference|film|livre|jeu video').test(q), ['17', '3919', '116006', '112'], ["Bureau d'aide aux victimes", 'CIDFF (droits des femmes et des familles)'], 'violences'],
  ['sans-abri', w("dors? dehors|dormir dehors|a la rue|sans abri|sans toit|pas de toit|nulle part ou dormir|nowhere to sleep|homeless tonight|sokakta|obdachlos|на вулиці|بلا مأوى"), ['115'], [], 'hebergement urgence'],
];

/** @param {...string} queries the query as typed, and its French translation when there is one @returns {{ kind: string, numbers: string[], structureTypes: string[], topic: string } | null} */
export function safetySignal(...queries) {
  const qs = queries.filter(Boolean).map(fold);
  for (const [kind, test, numbers, structureTypes, topic] of SIGNALS) {
    const t = typeof test === 'function' ? test : (q) => test.test(q);
    if (qs.some((q) => t(q))) return { kind, numbers, structureTypes, topic };
  }
  return null;
}
