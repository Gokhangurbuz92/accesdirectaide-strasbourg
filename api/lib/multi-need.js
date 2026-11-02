/**
 * R37 — orientation for a person who describes SEVERAL problems at once (« on va me couper l'électricité, j'ai des dettes et deux enfants »). Deterministic
 * and stateless: the words of the query (and its French translation) → the needs it describes (ids of data/reference/social-domains.v1.json), ordered by
 * urgency, each with the official numbers, the next practical actions, the official Service-Public sheets, and CAUTIONS where a benefit the ordinary search
 * may list depends on a condition the person's own words put in doubt (no residence permit → APL/ALS; no home yet → APL/ALS; under 25 → RSA).
 *
 * Every rule stated here is copied from an official sheet, which is named with it (sheet id), so a reviewer can check it; the archive of 02/11/2026 was
 * read for each one. Nothing here decides a right: a caution says « this depends on… », never « you are not eligible ». Local services are never invented:
 * a need without a verified local route points to the ordinary search and to the generic social offices (CCAS, Maison des solidarités, France Services).
 * No remote AI, no personal data kept: the query is read and forgotten.
 */
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");
const w = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'u');

/** the official sheets this module cites that are not (yet) published on AccesDirectAide; the published ones are resolved to their local page by the caller */
export const SHEET_TITLES = {
  F12006: 'Aide personnalisée au logement (APL)', F1280: 'Allocation de logement sociale (ALS)', F19778: 'RSA : demandeur de 25 ans et plus',
  F20055: 'Impayés de factures (gaz, électricité, eau, téléphone, internet) : quelles conséquences ?', F16920: 'Congé de proche aidant',
};
export const sheetUrl = (id) => `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}`;

// ---------------------------------------------------------------------------------------------------------------- situation markers (not needs by themselves)
const NO_PERMIT = w("sans (titre de sejour|titre|papiers?)|sans-papiers?|pas de (titre de sejour|papiers?)|en situation irreguliere|irregulier|irreguliere|clandestin|undocumented|no residence permit|kagitsiz|oturum izni yok|ohne aufenthalt\\w*|без документів|بدون أوراق");
const HAS_PERMIT = w("avec (un )?titre de sejour|titre de sejour valable|titre de sejour en cours|carte de resident|j'ai (un|mon) titre de sejour|refugie|refugiee|protection subsidiaire");
const NO_HOME = w("sans (logement|domicile|abri|toit)|pas de (logement|toit|domicile)|plus de logement|a la rue|dans la rue|dors? dehors|dormir dehors|sans-abri|sdf|nulle part ou dormir|homeless|evsiz|obdachlos|без житла|بلا مأوى");
const UNDER_25 = (q) => { const m = /(?<!\d)(1[6-9]|2[0-4]) ?ans\b/.exec(q); return Boolean(m) || w('moins de 25 ans|jeune majeur|majeur(e)? depuis peu').test(q); };
const CHILDREN = w('enfants?|bebes?|fils|filles?|mes petits|children|kids|cocuk\\w*|kinder|діти|أطفال');

/** [id (social-domains subdomain), priority (0 = most urgent), test(folded query) ] — the order of this list is the order shown at equal priority */
const NEEDS = [
  ['hebergement-urgence', 1, (q) => NO_HOME.test(q) || w("ou dormir( ce soir)?|hebergement d'urgence|mis(e)? dehors|quitter (le|mon) logement|place en foyer").test(q)],
  ['energie', 2, (q) => w("electricite|electrique|gaz|chauffage|energie|edf|engie|compteur|courant").test(q) && w("coup\\w*|couper|impaye\\w*|factures?|dettes?|payer|retard|reduit\\w*|reduction|puissance").test(q)],
  ['expulsion-impayes', 2, (q) => w("loyers? impayes?|impayes? de loyer|retard de loyer|dettes? de loyer|arrieres? de loyer|expulsion|expulse\\w*|perdre (mon|le) logement|risque de perdre").test(q)],
  ['violences-conjugales', 0, (q) => w("violences? conjugales?|mon (mari|conjoint|compagnon|ex) me (frappe|bat|menace)|ma (femme|compagne|conjointe) me (frappe|bat|menace)|violent avec moi").test(q)],
  ['sortie-ase', 2, (q) => w("(sors?|sortie|sortir|sorti|sortie) de l'?ase|ase a 18 ans|aide sociale a l'?enfance|jeune majeur|foyer de l'enfance|contrat jeune majeur|placee? (a|par) l'?ase").test(q) && !w('mon enfant|ma fille|mon fils|mes enfants').test(q)],
  ['droits-sans-titre', 3, (q) => NO_PERMIT.test(q)],
  ['surendettement', 4, (q) => w("dettes?|endette\\w*|surendette\\w*|credits? a rembourser|commissaire de justice|huissier").test(q)],
  ['recherche-emploi', 4, (q) => w("chomage|chomeur|chomeuse|sans emploi|sans travail|perdu mon (emploi|travail|boulot)|licencie\\w*|france travail").test(q)],
  ['aidants', 3, (q) => w("aidant\\w*|je m'occupe de (ma|mon)|epuise\\w*|repit|a bout").test(q) && w("mere|pere|parent|grand.?(mere|pere)|proche|mari|femme|agee?s?|dependan\\w*|malade|handicap\\w*|domicile").test(q)],
  ['aide-domicile', 3, (q) => w("(ma|mon) (mere|pere)|grand.?(mere|pere)|personne agee|agee?s?|perte d'autonomie|dependan\\w*").test(q) && w("domicile|aide a domicile|ne peut plus|seule? chez|toilette|repas|autonomie|ehpad|maison de retraite").test(q)],
  ['accessibilite-mobilite', 3, (q) => w("handicap\\w*|fauteuil roulant|mobilite reduite|pmr|malvoyant\\w*|aveugle").test(q) && w("transports?|deplacer|deplacements?|bus|tram|stationn\\w*|mobilite|accessib\\w*").test(q)],
  ['psy', 3, (q) => w("deprime\\w*|depression|depressif|depressive|mal[- ]etre|angoiss\\w*|anxi\\w*|idees noires|burn.?out|psy|psychologue|souffrance psychique").test(q)],
  ['isolement', 5, (q) => w("isolee?s?|isolement|solitude|je ne vois personne|n'ai (plus )?personne|tout(e)? seule?|seule? au monde|personne a qui parler").test(q)
    && !w("parent isole|mere isolee|pere isole|personne isolee (au sens|pour le rsa)").test(q)],
  ['prestations-familiales', 6, (q) => CHILDREN.test(q) && w("aides?|allocations?|argent|payer|factures?|dettes?|loyers?|impayes?|caf").test(q)],
];

/** the content of each need: label, official numbers, next actions, sheets, topic for the ordinary search (French catalogue) */
const CONTENT = {
  'hebergement-urgence': { label: 'Trouver un hébergement', numbers: ['115'], sheets: ['F2003', 'F17317'], topic: 'hébergement urgence',
    actions: ['Appelez le 115 (Samu social, gratuit, 24 h/24) pour une place d’hébergement d’urgence.', 'Sans adresse, un CCAS ou une association agréée peut vous domicilier : vous recevez votre courrier et pouvez faire vos démarches (fiche F17317).'] },
  energie: { label: 'Électricité, gaz : impayés et coupure', numbers: [], sheets: ['F20055', 'F38589', 'F1334'], topic: 'facture électricité impayée',
    actions: ['Contactez tout de suite votre fournisseur pour demander un délai ou un échéancier : il doit vous écrire avant de réduire ou couper.', 'Le Fonds de solidarité pour le logement (FSL) peut aider à payer des factures d’électricité ou de gaz (fiche F1334).'],
    rules: [{ text: 'Du 1er novembre au 31 mars (trêve hivernale), les coupures d’électricité et de gaz pour impayé sont interdites ; la puissance de l’électricité peut toutefois être réduite.', sheet: 'F20055', winter: true }] },
  'expulsion-impayes': { label: 'Loyer impayé, risque d’expulsion', numbers: [], sheets: ['F31272', 'F34736', 'F1334', 'F32037'], topic: 'loyer impayé expulsion',
    actions: ['En cas d’impayé, l’aide au logement peut être maintenue sous conditions ; le bailleur doit signaler l’impayé à la Caf ou à la MSA (fiche F32037).', 'Le FSL peut aider à payer une dette de loyer (fiche F1334).'],
    rules: [{ text: 'Du 1er novembre au 31 mars (trêve hivernale), l’expulsion d’un locataire est reportée, sauf exceptions (fiche F34736).', sheet: 'F34736', winter: true }] },
  'violences-conjugales': { label: 'Violences dans le couple', numbers: ['17', '3919'], sheets: ['F12544'], topic: 'violences conjugales',
    actions: ['En danger immédiat : appelez le 17 ou envoyez un SMS au 114.', 'Le 3919 (gratuit, anonyme) écoute et oriente, y compris pour quitter le logement.'] },
  'sortie-ase': { label: 'Sortie de l’aide sociale à l’enfance (18 ans)', numbers: [], sheets: ['F2018'], topic: 'foyer jeunes travailleurs',
    actions: ['L’aide sociale à l’enfance relève du département (à Strasbourg, la Collectivité européenne d’Alsace) : votre éducateur ou référent ASE peut vous dire quel accompagnement est possible après 18 ans.', 'Un foyer de jeunes travailleurs (FJT) loge des jeunes de 16 à 25 ans (parfois jusqu’à 30 ans) qui ont du mal à trouver un logement (fiche F2018).'] },
  'droits-sans-titre': { label: 'Droits sans titre de séjour', numbers: [], sheets: ['F3079', 'F2003', 'F17317'], topic: 'aide médicale État',
    actions: ['Pour vous soigner : l’aide médicale de l’État (AME), après plus de 3 mois de résidence en France, sous conditions de ressources ; les enfants mineurs y ont droit sans délai (fiche F3079).', 'L’hébergement d’urgence se demande au 115 (fiche F2003).'] },
  surendettement: { label: 'Dettes', numbers: [], sheets: ['F134', 'F38589'], topic: 'surendettement',
    actions: ['Si vous ne pouvez plus payer vos dettes : un dossier de surendettement se dépose à la Banque de France ; en Alsace-Moselle, une procédure de faillite civile existe aussi. Un travailleur social peut vous aider à faire le dossier (fiche F134).'] },
  'recherche-emploi': { label: 'Chômage, recherche d’emploi', numbers: [], sheets: ['F827'], topic: 'chômage allocation',
    actions: ['Inscrivez-vous à France Travail : c’est la condition pour une allocation chômage.', 'Signalez le changement de situation à la Caf (fiche F827).'] },
  aidants: { label: 'Aidant d’un proche', numbers: [], sheets: ['F245', 'F246', 'F16920'], topic: 'aidants',
    actions: ['Un salarié peut prendre un congé de proche aidant (fiche F16920).', 'Une aide à domicile ou des soins infirmiers à domicile peuvent soulager l’aidant (fiches F245, F246).'] },
  'aide-domicile': { label: 'Personne âgée : rester à domicile ou être accueillie', numbers: [], sheets: ['F245', 'F246', 'F255', 'F2444'], topic: 'aide à domicile personne âgée',
    actions: ['Le département peut financer une aide à domicile sous conditions de ressources, ou l’Apa pour une personne en perte d’autonomie (fiche F245).', 'Si le maintien à domicile n’est plus possible : les hébergements pour personnes âgées et l’aide sociale à l’hébergement (fiches F255, F2444).'] },
  'accessibilite-mobilite': { label: 'Handicap et déplacements', numbers: [], sheets: ['F34049'], topic: 'MDPH',
    actions: ['La carte mobilité inclusion (CMI) se demande à la MDPH (fiche F34049).'] },
  psy: { label: 'Souffrance psychique', numbers: ['3114'], sheets: ['F34917'], topic: 'psychologue',
    actions: ['Des séances chez un psychologue peuvent être prises en charge par l’Assurance maladie, sous conditions (fiche F34917) ; votre médecin traitant peut vous orienter.', 'Si vous avez des idées suicidaires, ou pour un proche : le 3114 (gratuit, 24 h/24).'] },
  isolement: { label: 'Isolement', numbers: [], sheets: [], topic: 'isolement lien social',
    actions: ['Les centres sociaux, le CCAS de votre commune et des associations proposent des activités et des visites pour rompre l’isolement.'] },
  'prestations-familiales': { label: 'Enfants à charge', numbers: [], sheets: ['F38245'], topic: 'allocations familiales',
    actions: ['Vérifiez auprès de la Caf les prestations liées à vos enfants (simulateur sur caf.fr).'] },
};

/** cautions: a benefit the ordinary search may list, and the condition the person's words put in doubt (the aide titles they apply to, for the result cards) */
const CAUTIONS = [
  { id: 'permit-housing-aid', when: (q) => NO_PERMIT.test(q) && !HAS_PERMIT.test(q), aides: /aide personnalis[ée]e au logement|\(apl\)|allocation de logement|\(als\)|\(alf\)/i,
    text: 'L’APL et l’ALS demandent, pour une personne étrangère, un titre de séjour en cours de validité.', sheets: ['F12006', 'F1280'] },
  { id: 'permit-rsa', when: (q) => NO_PERMIT.test(q) && !HAS_PERMIT.test(q), aides: /revenu de solidarit[ée] active|\(rsa\)|prime d.activit[ée]/i,
    text: 'Le RSA demande, pour une personne étrangère hors Union européenne, un séjour régulier (par exemple un titre de séjour permettant de travailler depuis au moins 5 ans, une carte de résident, ou le statut de réfugié).', sheets: ['F19778'] },
  { id: 'no-home-housing-aid', when: (q) => NO_HOME.test(q) || w("je n'ai pas de logement|n'ai plus de logement").test(q), aides: /aide personnalis[ée]e au logement|\(apl\)|allocation de logement|\(als\)|\(alf\)/i,
    text: 'L’APL et l’ALS aident à payer un loyer ou une redevance : elles ne peuvent être demandées qu’une fois un logement loué ou une place obtenue en établissement ou en foyer (FJT, résidence).', sheets: ['F12006', 'F1280'] },
  { id: 'under-25-rsa', when: UNDER_25, aides: /revenu de solidarit[ée] active|\(rsa\)/i,
    text: 'Le RSA se demande en principe à partir de 25 ans ; avant 25 ans, seulement dans des cas particuliers.', sheets: ['F19778'] },
  { id: 'isolated-meaning', when: (q) => w('isolee?s?').test(q) && w("deprime\\w*|depression|solitude|personne a qui parler|ne vois personne|triste|mal[- ]etre").test(q), aides: /revenu de solidarit[ée] active|\(rsa\)|prime d.activit[ée]/i,
    text: '« Personne isolée » dans les règles du RSA ou de la prime d’activité veut dire « qui vit seule », pas « qui se sent seule » : ces aides dépendent des ressources.', sheets: ['F19778'] },
];

/** the question that changes the answer, when the words do not say it (offered as two re-searches; nothing is stored) */
const QUESTIONS = [
  { id: 'permit', when: (q) => w('etranger\\w*|titre de sejour|prefecture|demandeur d.asile|migrant\\w*').test(q) && !NO_PERMIT.test(q) && !HAS_PERMIT.test(q),
    text: 'Avez-vous un titre de séjour en cours de validité ?', options: [['Oui', 'avec titre de séjour'], ['Non', 'sans titre de séjour']] },
];

const isWinter = (d) => { const m = d.getUTCMonth() + 1; return m >= 11 || m <= 3; };

/**
 * @param {string[]} queries the query as typed and, when it was typed in another language, its French translation
 * @param {{ now?: Date, safetyKind?: string | null }} [opts]
 * @returns {{ needs: any[], cautions: any[], questions: any[], multi: boolean } | null} null when the words describe no need of this list
 */
export function analyseNeeds(queries, { now = new Date(), safetyKind = null } = {}) {
  const qs = (Array.isArray(queries) ? queries : [queries]).filter(Boolean).map(fold);
  const any = (t) => qs.some((q) => t(q));
  const found = NEEDS.filter(([, , t]) => any(t)).map(([id, priority]) => ({ id, priority }));
  if (safetyKind === 'violence' && !found.some((n) => n.id === 'violences-conjugales')) found.push({ id: 'violences-conjugales', priority: 0 });
  const questions = QUESTIONS.filter((x) => any(x.when)).map(({ id, text, options }) => ({ id, text, options: options.map(([label, add]) => ({ label, add })) }));
  if (!found.length && !questions.length) return null;
  const winter = isWinter(now);
  const shown = new Set();   // a sheet is listed once, under the most urgent need that cites it
  const needs = found.sort((a, b) => a.priority - b.priority).map(({ id, priority }) => {
    const c = CONTENT[id];
    const sheets = c.sheets.filter((x) => !shown.has(x)); sheets.forEach((x) => shown.add(x));
    const rules = (c.rules || []).map((r) => ({ text: r.text, sheet: r.sheet, inForceNow: r.winter ? winter : true }));
    return { id, label: c.label, urgent: priority <= 1, numbers: c.numbers, actions: c.actions, rules, sheets, topic: c.topic };
  });
  const cautions = CAUTIONS.filter((c) => any(c.when)).map(({ id, text, sheets, aides }) => ({ id, text, sheets, aides: aides.source }));
  return { needs, cautions, questions, multi: needs.length > 1 };
}

/**
 * The aides of a search result with the cautions that concern them, cautioned aides after the others (stable). An aide is never removed: the person may
 * meet the condition the words seemed to exclude.
 * @param {any[]} items @param {{ cautions: any[] } | null} analysis
 */
export function annotateAides(items, analysis) {
  if (!analysis || !analysis.cautions.length || !Array.isArray(items)) return items;
  const tagged = items.map((it) => {
    const title = String(it.title || it.titre || '');
    const hit = analysis.cautions.filter((c) => new RegExp(c.aides, 'i').test(title));
    return hit.length ? { ...it, cautions: hit.map((c) => c.id) } : it;
  });
  return [...tagged.filter((x) => !x.cautions), ...tagged.filter((x) => x.cautions)];
}
