/**
 * R34 — a search that describes DANGER gets the official emergency numbers first. Before, « mon mari me frappe » returned five town halls and no number:
 * the word search had nothing to match and nothing said « call 17 or 3919 ». safetySignal() reads the query (any of the six languages, the original
 * words AND their French translation) and returns the kind of danger, the official numbers to show (keys of data/reference/social-domains.v1.json
 * « emergency ») and the kinds of office that receive such people. It never hides the ordinary results and it never decides anything for the person.
 * Patterns are deliberately narrow (a person + an act), so « violence » alone in a question about a law is not treated as an emergency.
 */
/** @param {unknown} s */
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");
/** @param {string} alts */
const w = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'u');

/**
 * R40 — a wish to die, said by the person or about someone close. R39 silenced every query naming the end-of-life debate (« aide à mourir »), so « je veux
 * qu'on m'aide à mourir » got no number; and a query ABOUT suicide (statistics, history, a law, a film, the news) showed the 3114 as if the person were in
 * danger. The words of distress always win: the exception applies only to a query that speaks of suicide as a subject (law, end-of-life debate,
 * information) AND carries no first-person or close-person marker. In doubt (« suicide » alone, « tentative de suicide de mon fils ») the number is shown.
 */
const SUICIDE = w("suicides?|suicider|suicidaires?|idees? noires|me tuer|se tuer|en finir|envie de mourir|plus envie de vivre|veux mourir|"
  + "m'aide\\p{L}* a mourir|aidez[- ]moi a mourir|kill (?:myself|himself|herself|themselves)|end my life|suicidal|want to die|(?:don't|dont|do not) want to live|"
  + "intihar\\p{L}*|kendimi oldur\\p{L}*|olmek istiyorum|selbstmord\\p{L}*|suizid\\p{L}*|mich umbringen|nicht mehr leben|will sterben|"
  + "суіцид\\p{L}*|самогубств\\p{L}*|покінчити з собою|не хочу жити|انتحار|انتحر|اريد ان اموت");
/** the end-of-life debate and its law, in the six languages (folded) */
const END_OF_LIFE = w("suicides? assistes?|assistance au suicide|aide (?:active |medicale )?a mourir|euthanasie|fin de vie|mourir dans la dignite|"
  + "assisted (?:suicide|dying)|euthanasia|end of life|sterbehilfe|assistierte\\p{L}* suizid\\p{L}*|otanazi\\p{L}*|евтаназі\\p{L}*|القتل الرحيم");
/** suicide as a subject of information */
const ABOUT = w("lois?|projet de loi|proposition de loi|legislation|law|laws|gesetz\\p{L}*|yasa\\p{L}*|закон\\p{L}*|قانون|"
  + "statistiques?|statistics?|statistik\\p{L}*|chiffres|taux|rate|histoire|historique|history|durkheim|film|livre|roman|documentaire|serie|"
  + "actualites?|news|senat|assemblee nationale|debat|etude|these|expose|sociologie");
/** a person speaks of themself or of someone close: never an « information » query */
const PERSONAL = w("je|j'\\p{L}*|moi|me|m'\\p{L}*|mon|ma|mes|veux|envie|aidez|ami|amie|copain|copine|fils|fille|frere|soeur|"
  + "mari|femme|conjoint|compagnon|compagne|enfant|ado|i|i'm|im|my|myself|friend|ben|benim|istiyorum|ich|mich|mein\\p{L}*|я|мене|мій|моя|хочу|"
  + "انا|اريد|صديقي|ابني|ابنتي");
/** @param {string} q a folded query */
const suicideSignal = (q) => SUICIDE.test(q) && !((END_OF_LIFE.test(q) || ABOUT.test(q)) && !PERSONAL.test(q));

/** [kind, test(folded query), numbers, office types, French topic searched for a query typed in another language] — the first matching kind wins; order = gravity */
/** @type {[string, RegExp | ((q: string) => boolean), string[], string[], string][]} */
const SIGNALS = [
  // R39: the topic for another language finds the official listening-line sheet (F33954, the 3114) as well as the psychologist one
  ['suicide', suicideSignal, ['3114', '15', '112'], [], 'numéro écoute psychologue'],
  ['enfant', (q) => w('enfant|fils|fille|mineur|bebe|child|my son|my daughter|cocuk|kind|дитин|طفل').test(q) && w('frappe|frapper|battu|battue|bat|(?:des|recu|recoit|donne) coups|maltrait\\w*|danger|abuse\\w*|beats?|hits?|hurts?|dovuyor|schlagt|missbrauch\\w*|б.є|насильств\\w*|يضرب|عنف').test(q), ['119', '17', '112'], [], 'enfant maltraitance'],
  ['personne-agee', (q) => w('agee?s?|vieux|vieille|grand[- ]?(mere|pere)|elderly|yasli|alter\\w*|літн\\w*|مسن').test(q) && w('maltrait\\w*|frappe\\w*|battue?|abuse\\w*|vole|escroqu\\w*').test(q), ['3133', '17', '112'], [], 'maltraitance personne agee'],
  ['violence', (q) => w('frappe|frapper|frappee?|me bat|il bat|battue?|(?:des|recu|recois|donne|prend|pris) coups|coups et blessures|cogne|gifle\\w*|etrangl\\w*|menace\\w* de mort|violente?s?|violences?|viol|violee?|agression sexuelle|agresse\\w*|hits me|beats me|abus\\w*|abuse\\w*|violence|rape\\w*|dovuyor|siddet|tecavuz|schlagt mich|gewalt|vergewaltig\\w*|б.є мене|мене б.є|насильств\\w*|зґвалтуван\\w*|يضربني|عنف|اغتصاب').test(q)
    && !w('loi|article|statistiques?|definition|formation|colloque|conference|film|livre|jeu video').test(q), ['17', '3919', '116006', '112'], ["Bureau d'aide aux victimes", 'CIDFF (droits des femmes et des familles)'], 'violences'],
  ['sans-abri', w("dors? dehors|dormir dehors|a la rue|sans abri|sans toit|pas de toit|nulle part ou dormir|nowhere to sleep|homeless tonight|sokakta|obdachlos|на вулиці|بلا ماوى"), ['115'], [], 'hebergement urgence'],
];

/** @param {...string} queries the query as typed, and its French translation when there is one @returns {{ kind: string, numbers: string[], structureTypes: string[], topic: string } | null} */
export function safetySignal(...queries) {
  const qs = queries.filter(Boolean).map(fold);
  for (const [kind, test, numbers, structureTypes, topic] of SIGNALS) {
    const t = typeof test === 'function' ? test : (/** @type {string} */ q) => test.test(q);
    if (qs.some((q) => t(q))) return { kind, numbers, structureTypes, topic };
  }
  return null;
}
