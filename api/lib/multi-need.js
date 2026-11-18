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
/** @param {unknown} s */
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, "'");
/** @param {string} alts */
const w = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'u');
// R38: Arabic words carry attached prefixes (ال, و, ب, ف) and the folded text has lost its hamza (« أوراق » → « اوراق »): matched without the word boundary.
// (JavaScript's \\w is ASCII only, also with the « u » flag: Cyrillic stems use \\p{L}*.)
/** @param {...{ test: (q: string) => boolean }} res */
const either = (...res) => ({ test: (/** @type {string} */ q) => res.some((re) => re.test(q)) });

/** fallback titles of cited sheets (the first five are published since the owner's R37 batch of 02/11/2026); the caller resolves every published sheet to its local page */
export const SHEET_TITLES = {
  F12006: 'Aide personnalisée au logement (APL)', F1280: 'Allocation de logement sociale (ALS)', F19778: 'RSA : demandeur de 25 ans et plus',
  F20055: 'Impayés de factures (gaz, électricité, eau, téléphone, internet) : quelles conséquences ?', F16920: 'Congé de proche aidant',
  // Wider needs (vis-needs, 15/11/2026): sheets cited by the needs added on 15/11/2026 and not published as local guides — titles as in the DILA archive of 15/11/2026
  // (vosdroits-latest.zip, Last-Modified 15/11/2026 01:54 GMT); each is https://www.service-public.gouv.fr/particuliers/vosdroits/<id>
  F601: 'J\'ai besoin de faire garder mes enfants', F38244: 'Votre enfant entre à l\'école ou est déjà scolarisé : aides financières',
  F33865: 'Élève ou étudiant en situation de handicap : qu\'est-ce que le projet personnalisé de scolarisation (PPS) ?',
  F24610: 'Mon enfant est en situation de handicap', F31029: 'Je suis en situation de handicap',
  F10009: 'Allocation personnalisée d\'autonomie (Apa)', F14202: 'Prestation de compensation du handicap (PCH)',
};
/** @param {string} id */
export const sheetUrl = (id) => `https://www.service-public.gouv.fr/particuliers/vosdroits/${id}`;

// ---------------------------------------------------------------------------------------------------------------- situation markers (not needs by themselves)
const NO_PERMIT = either(w("sans (titre de sejour|titre|papiers?)|sans-papiers?|pas de (titre de sejour|papiers?)|en situation irreguliere|irregulier|irreguliere|clandestin|undocumented|no residence permit|(no|without) (papers|documents|a residence permit)|kagitsiz|oturum izn\\w* yok|ohne aufenthalt\\w*|keinen? aufenthalts\\w*|ohne papiere|без документів|немає документ\\p{L}*|без посвідки"),
  /(بدون|بلا|ليس لدي|ليست لدي|ما عندي) (اوراق|وثائق|اقامة)/u);
const HAS_PERMIT = w("avec (un )?titre de sejour|titre de sejour valable|titre de sejour en cours|carte de resident|j'ai (un|mon) titre de sejour|refugie|refugiee|protection subsidiaire");
const NO_HOME = either(w("sans (logement|domicile|abri|toit)|pas de (logement|toit|domicile)|plus de logement|a la rue|dans la rue|dors? dehors|dormir dehors|sans-abri|sdf|nulle part ou dormir|homeless|nowhere to (sleep|stay|live)|no place to (sleep|stay|live)|evsiz|kalacak yer\\p{L}* yok|sokakta|obdachlos|keine wohnung|без житла|немає (документ\\p{L}* (і|та) )?(житла|де жити|де ночувати)|на вулиці"),
  /بلا ماوى|(لا|ليس لدي) (مكان|سكن|ماوى)|في الشارع/u,
  // Ukrainian puts the negation anywhere in the sentence (« і житла теж немає »)
  { test: (q) => /(?<!\p{L})(немає|нема|без)(?!\p{L})/u.test(q) && /(?<!\p{L})житл\p{L}*/u.test(q) });
/** @param {string} q */
const UNDER_25 = (q) => { const m = /(?<!\d)(1[6-9]|2[0-4]) ?ans\b/.exec(q); return Boolean(m) || w('moins de 25 ans|jeune majeur|majeur(e)? depuis peu').test(q); };
// Wider needs (15/11/2026): old age said in the first person (« j'ai 78 ans », « je suis retraitée ») or about a relative; « âgée de 3 ans » is an age, not old age
/** @param {string} q */
const OLD_AGE = (q) => /(?<!\d)(6\d|[7-9]\d|10\d) ?ans\b/.test(q) || w("agee?s?(?! de \\d)|retraitee?s?|seniors?|vieilli\\w*|troisieme age|grand age").test(q);
/** @param {string} q */
const FRAIL = (q) => OLD_AGE(q) || w("handicap\\w*|fauteuil roulant|perte d'autonomie|autonomie|mobilite reduite|deambulateur|(ma|mon) (mere|pere)|mes parents|grand.?(mere|pere)").test(q);
const MY_CHILD = w("(mon|ma|mes|nos|notre|son|ses) (enfants?|fils|filles?|petite?s?|ainee?s?|garcons?)|enfants? (scolarisee?s?|handicapee?s?)");
const CHILDREN = w('enfants?|bebes?|fils|filles?|mes petits|children|kids|cocuk\\w*|kinder|діти|أطفال');

/** [id (social-domains subdomain), priority (0 = most urgent), test(folded query) ] — the order of this list is the order shown at equal priority */
/** @type {[string, number, (q: string) => boolean][]} */
const NEEDS = [
  ['hebergement-urgence', 1, (q) => NO_HOME.test(q) || w("ou dormir( ce soir)?|hebergement d'urgence|mis(e)? dehors|quitter (le|mon) logement|place en foyer").test(q)],
  ['energie', 2, (q) => (w("electricite|electrique|gaz|chauffage|energie|edf|engie|compteur|courant|elektri\\w*|dogalgaz").test(q) && w("coup\\w*|couper|impaye\\w*|factures?|dettes?|payer|retard|reduit\\w*|reduction|puissance|kes\\w*|fatura\\w*|borc\\w*").test(q))
    || (w("eau|telephone|internet|box").test(q) && w("coupee?s?|couper|impaye\\w*|factures? (impayees?|en retard)|dettes?").test(q))
    || w("factures? impayees?|impayes? de factures?|(payer|regler) (mes|les|nos|ses) factures|factures? en retard|retard de factures?").test(q)],
  ['expulsion-impayes', 2, (q) => w("loyers? impayes?|impayes? de loyer|retard de loyer|dettes? de loyer|arrieres? de loyer|expulsion|expulse\\w*|perdre (mon|le) logement|risque de perdre"
    // Wider needs (15/11/2026): rent arrears said in the first person (« je n'arrive plus à payer mon loyer »), and in the five other languages
    + "|(n'arrive|n'arrivons|ne parviens|n'y arrive) (plus|pas) a payer (mon|le|notre|mes|les|nos) loyers?|(ne peux|ne pouvons|peux|pouvons) (plus|pas) payer (mon|le|notre|mes|les|nos) loyers?"
    + "|loyers? en retard|en retard (de|sur|pour|dans) (mon|le|mes|les|notre) loyers?|mois de loyers? (de retard|impayes?|en retard)|pas (pu )?paye (mon|le|notre) loyer|loyers? (non|pas) payes?"
    + "|(can't|cannot|can not|unable to) pay (my|the|our) rent|behind (on|with) (my|the|our) rent|rent arrears|unpaid rent|kira\\p{L}* odeyem\\p{L}*|kira borc\\p{L}*"
    + "|miete nicht (mehr )?(be)?zahlen|mietschulden|mietruckst\\p{L}*|не можу платити за (оренду|житло|квартиру)|борг\\p{L}* за (оренду|житло|квартиру)").test(q)
    || /لا استطيع دفع (ال)?ايجار|(ال)?ايجار (ال)?متاخر/u.test(q)],
  // R38: suicidal crisis first of all — the national prevention line 3114 (sheet F33954: free, 24 h/24, 7 j/7, Ministry of Health)
  ['crise-suicide', 0, (q) => (w("suicid\\w*|me suicider|me tuer|en finir( avec la vie)?|mettre fin a mes jours|plus envie de vivre|envie de mourir|idees noires|suicide|kill myself|end my life|suicidal|intihar\\w*|kendimi oldur\\w*|selbstmord|suizid\\w*|самогубств\\p{L}*|покінчити з собою").test(q) || /انتحار|انتحر|اقتل نفسي/u.test(q))
    && !w("suicide assiste|aide (active )?a mourir|euthanasie").test(q)],
  ['violences-conjugales', 0, (q) => w("violences? conjugales?|mon (mari|conjoint|compagnon|ex) me (frappe|bat|menace)|ma (femme|compagne|conjointe) me (frappe|bat|menace)|violent avec moi"
    + "|domestic violence|my (husband|partner|boyfriend|wife|ex) (hits|beats|threatens) me|kocam (beni )?(dov\\w*|vur\\w*|tehdit\\w*)|esim (beni )?(dov\\w*|vur\\w*)|ev ici siddet|aile ici siddet"
    + "|mein (mann|partner|freund|ex) (schlagt|bedroht) mich|hausliche gewalt|чоловік (мене )?(б.?є|бʼє|погрожує)|домашн\\p{L}* насильств\\p{L}*").test(q) || /زوجي (يضربني|يهددني)|عنف (اسري|منزلي)/u.test(q)],
  ['sortie-ase', 2, (q) => w("(sors?|sortie|sortir|sorti|sortie) de l'?ase|ase a 18 ans|aide sociale a l'?enfance|jeune majeur|foyer de l'enfance|contrat jeune majeur|placee? (a|par) l'?ase").test(q) && !w('mon enfant|ma fille|mon fils|mes enfants').test(q)],
  ['droits-sans-titre', 3, (q) => NO_PERMIT.test(q)],
  ['surendettement', 4, (q) => w("dettes?|endette\\w*|surendette\\w*|credits? a rembourser|commissaire de justice|huissier").test(q)],
  ['recherche-emploi', 4, (q) => w("chomage|chomeur|chomeuse|sans emploi|sans travail|perdu mon (emploi|travail|boulot)|licencie\\w*|france travail").test(q)],
  ['aidants', 3, (q) => w("aidant\\w*|je m'occupe de (ma|mon)|m'occuper de (ma|mon)|aider (ma|mon)|s'occuper de (sa|son)|epuise\\w*|repit|a bout|je m'occupe d'(elle|lui|eux)|m'occuper d'(elle|lui|eux)|je l'aide (tous les jours|chaque jour|au quotidien)").test(q) && w("mere|pere|parent|grand.?(mere|pere)|proche|mari|femme|agee?s?|dependan\\w*|malade|handicap\\w*|domicile").test(q)],
  ['aide-domicile', 3, (q) => w("(ma|mon) (mere|pere)|grand.?(mere|pere)|personne agee|agee?s?|perte d'autonomie|dependan\\w*").test(q) && w("domicile|aide a domicile|ne peut plus|seule? chez|toilette|repas|autonomie|ehpad|maison de retraite").test(q)
    // Wider needs (15/11/2026): the person's own old age (« j'ai 82 ans, je n'arrive plus à faire mes courses ») — everyday acts only, « domicile » alone is not enough here
    || (OLD_AGE(q) && w("aide a domicile|aide menagere|auxiliaire de vie|plus autonome|(ne peux|n'arrive) plus (a )?(me laver|m'habiller|faire (ma toilette|mes courses|le menage|a manger|la cuisine)|me deplacer|marcher|sortir de chez moi|rester seule?|vivre seule?)"
      + "|du mal a (me laver|m'habiller|marcher|me deplacer|faire (ma toilette|mes courses|le menage|a manger|la cuisine))|perds? (mon|son) autonomie").test(q))
    || w("(elderly|aged) (mother|father|parents?|person|relative)|(mother|father) is (elderly|old)|parents are (elderly|old)|losing (her|his|my|their) (autonomy|independence)|home care|home help"
      + "|yaslı (annem|babam)|(annem|babam) (cok )?yaslı|evde bakım\\p{L}*|pflegebedurftig\\p{L}*|hausliche pflege|pflegedienst\\p{L}*|(mutter|vater) ist alt"
      + "|(мати|мама|батько|тато) літн\\p{L}*|літн\\p{L}* (мати|мама|батько|тато|людин\\p{L}*)|втрача\\p{L}* самост\\p{L}*|догляд\\p{L}* вдома").test(q)
    || /(امي|ابي|والدي|والدتي) (مسن|مسنة|كبير في السن|كبيرة في السن)|(تفقد|يفقد) استقلالي|رعاية منزلية/u.test(q)],
  ['accessibilite-mobilite', 3, (q) => w("handicap\\w*|fauteuil roulant|mobilite reduite|pmr|malvoyant\\w*|aveugle").test(q) && w("transports?|deplacer|deplacements?|bus|tram|stationn\\w*|mobilite|accessib\\w*").test(q)],
  // Wider needs (15/11/2026): a disability file (child or adult) — the MDPH; « handicap » with transport words only stays « accessibilite-mobilite »
  ['mdph-droits', 3, (q) => w("mdph|maison departementale des personnes handicapees|dossier (de |du |d')?handicap|reconnaissance (du|de son|de mon|d'un|de) handicap|aeeh|aah|pch|rqth|allocation (aux )?adultes? handicapes?"
    + "|allocation d'education de l'enfant handicape|prestation de compensation|(enfant|fils|fille|bebe) (est )?(en situation de handicap|handicapee?|autiste|polyhandicapee?)|taux d'incapacite"
    + "|disability (application|claim|file|benefits?|allowance|paperwork)|disabled (child|son|daughter)|engelli (dosya\\p{L}*|rapor\\p{L}*|aylıg\\p{L}*|basvur\\p{L}*|hak\\p{L}*)|engelli (cocu\\p{L}*|oglum|kızım)"
    + "|schwerbehindert\\p{L}*|behindertenausweis|(antrag|anerkennung)\\p{L}* (auf|der|einer|wegen) behinderung|(sohn|tochter|kind) ist behindert"
    + "|(досьє|заяв\\p{L}*|оформ\\p{L}*|допомог\\p{L}*) (на |про |з |щодо |по )?інвалідн\\p{L}*|(син|донька|дитина) має інвалідн\\p{L}*|дитин\\p{L}* з інвалідн\\p{L}*").test(q)
    || (w("handicap\\w*").test(q) && w("dossiers?|formulaires?|papiers|demarches?|reconnaissance|reconnue?s?|reconnaitre|allocations?|demande|demander|droits").test(q))
    || /(ملف|طلب|بطاقة) (ال)?(اعاقة|معاق)|(ابني|ابنتي|طفلي) (معاق|معاقة|من ذوي الاعاقة)/u.test(q)],
  ['psy', 3, (q) => w("deprime\\w*|depression|depressif|depressive|mal[- ]etre|angoiss\\w*|anxi\\w*|idees noires|burn.?out|psy|psychologue|souffrance psychique").test(q)],
  ['isolement', 5, (q) => w("isolee?s?|isolement|solitude|je ne vois personne|n'ai (plus )?personne|tout(e)? seule?|seule? au monde|personne a qui parler").test(q)
    && !w("parent isole|mere isolee|pere isole|personne isolee (au sens|pour le rsa)").test(q)],
  // the RSA sheet cited here is the one for 25 and over: under 25 the « under-25-rsa » caution says it, the need is not offered
  ['minima-sociaux', 4, (q) => !UNDER_25(q) && w("sans (aucunes? )?(ressources?|revenus?)|aucun(e)? (ressources?|revenus?)|pas de (ressources?|revenus?)|plus (d'argent|rien) pour vivre|plus un sou|peu de (ressources?|revenus?)|tres peu de revenus?"
    // Wider needs (15/11/2026): income lost or low, said in the first person (« je n'ai plus de revenus », « nous avons de faibles revenus »), and in the five other languages
    + "|n'ai plus (de|aucune?s?) (ressources?|revenus?|salaire)|n'avons plus (de|aucune?s?) (ressources?|revenus?|salaire)|n'a plus (de|aucune?s?) (ressources?|revenus?)|plus aucune?s? (ressources?|revenus?)"
    + "|perdu (mes|tous mes|nos) revenus|(faibles?|petits?|bas|maigres?) (ressources?|revenus?)|(ressources?|revenus?) (sont |est )?(tres |trop )?(faibles?|modestes?|insuffisante?s?)|pas assez (d'argent )?pour vivre|rien pour vivre|joindre les deux bouts"
    + "|no income|without (any )?income|lost my income|no money to live|gelirim yok|gelirimiz yok|hicbir gelir\\p{L}* yok|kein einkommen|keine einkunfte|ohne einkommen|(немає|нема) (доходу|доходів)|без (доходу|доходів)").test(q)
    || (!UNDER_25(q) && /(ليس لدي|ليس عندي|ما عندي|بدون|بلا) (اي )?(دخل|موارد)/u.test(q))],
  ['aides-logement', 5, (q) => w("(besoin d'un|cherche (un )?|trouver un|louer un) logement|payer (mon|le) loyer|aide (au|pour le) logement|aides? au logement|apl|als").test(q)],
  // Wider needs (15/11/2026): help with paperwork — the words of a difficulty AND the words of administrative procedures (« perdu mes papiers » is not this need)
  ['acces-aux-droits', 5, (q) => (w("demarches?|papiers administratifs|paperasse|formulaires?|dossiers? administratifs?|courriers? (administratifs?|officiels?)|administrati(f|fs|ve|ves|on)").test(q)
      && w("du mal|difficultes?|difficile|besoin d'aide|besoin d'etre aidee?|suis (completement |un peu )?perdue?|n'y arrive (pas|plus)|n'arrive (pas|plus)|ne comprends? (pas|rien|plus)|comprends? rien|aide pour|aidez-moi|m'aider|nous aider|accompagn\\w*|ne sais (pas|plus)|complique\\w*").test(q))
    || w("help with (the |my |our )?(administrative )?(paperwork|forms|procedures|formalities)|fill(ing)? (in|out) (the |my |a )?forms?|resmi islem\\p{L}* yardım\\p{L}*|evrak isler\\p{L}* yardım\\p{L}*|form doldur\\p{L}*"
      + "|hilfe (bei|mit) (den |dem |meinen )?(behordengangen|formularen|antragen|papierkram)|допомог\\p{L}* з (адміністративн\\p{L}* )?(документ\\p{L}*|папер\\p{L}*|формуляр\\p{L}*)|заповнити (форм\\p{L}*|документ\\p{L}*|анкет\\p{L}*)").test(q)
    || /مساعدة في (ال)?(اجراءات|معاملات|اوراق) (ال)?ادارية|ملء (ال)?(استمارة|استمارات)/u.test(q)],
  // Wider needs (15/11/2026): a home to adapt to age or disability — the explicit words always; « mon logement n'est plus adapté » only with words of age, autonomy or disability
  ['adaptation-logement', 5, (q) => w("maprimeadapt\\w*|ma prime adapt\\w*|adaptation (du|de mon|de son|de leur|de notre) (logement|domicile|appartement)|adapter (mon|le|son|leur|notre|sa|ma|la) (logement|maison|appartement|salle de bains?|domicile)"
      + "|monte-?escaliers?|barres? d'appui|douche (adaptee|a l'italienne|de plain-pied)|travaux d'(adaptation|accessibilite)"
      + "|(adapt|adapting) (my|the|our|her|his) (home|house|flat|apartment|bathroom)|home adaptations?|stairlift|treppenlift|altersgerecht\\p{L}*|wohnungsanpassung|barrierefrei\\p{L}* (umbau\\p{L}*|wohnung|bad)"
      + "|merdiven asansor\\p{L}*|(ev\\p{L}*|konut\\p{L}*|banyo\\p{L}*) (yaslı\\p{L}*|engelli\\p{L}*) uygun|пристосува\\p{L}* (житло|квартир\\p{L}*|будин\\p{L}*|ванн\\p{L}*)|адаптаці\\p{L}* житла").test(q)
    || (FRAIL(q) && w("(logement|maison|appartement|domicile|salle de bains?) (n'est |est |n'etait )?(plus|pas|mal|peu) adaptee?|(logement|maison|appartement) inadaptee?"
      + "|amenag\\w* (mon|le|son|leur|notre|sa|ma|la|du|de la) (logement|maison|appartement|salle de bains?|domicile)|(remplacer|changer|enjamber) (la|ma|sa) baignoire").test(q))
    || /(تكييف|تهيئة) (ال)?(سكن|منزل|بيت|مسكن)/u.test(q)],
  // Wider needs (15/11/2026): childcare — not custody after a separation (« garde alternée », « droit de garde »), not « garde à vue »
  ['garde-enfants', 5, (q) => (w("faire garder|modes? de garde|moyen de garde|solution de garde|creches?|micro-creches?|assistante?s? maternelle?s?|nounou|garderie|halte-garderie|baby.?sitt\\w*|garde d'enfants?"
      + "|garde (de|pour) (mon|ma|mes|nos|notre) (enfants?|fils|filles?|bebe|petite?s?)|(pour|qui peut|quelqu'un pour|personne pour) garder (mon|ma|mes|nos|notre|le|la|les) (enfants?|fils|filles?|bebe|petite?s?)"
      + "|childcare|child care|daycare|day care|childminder|babysitt\\w*|kres\\p{L}*|cocuk bakım\\p{L}*|cocuk bakıcı\\p{L}*|kinderbetreuung|kinderkrippe|krippe|kita|tagesmutter"
      + "|дитяч\\p{L}* сад\\p{L}*|ясла|няню|няня|догляд\\p{L}* за дит\\p{L}*").test(q) || /(دار )?(ال)?حضانة|روضة|رعاية (ال)?اطفال/u.test(q))
    && !(w("garde alternee|residence alternee|droit de garde|garde exclusive|garde partagee|divorc\\w*|pension alimentaire|juge aux affaires familiales|custody|velayet|sorgerecht|опік\\p{L}*").test(q) || /طلاق|محكمة|قاضي/u.test(q))],
  // Wider needs (15/11/2026): school — the explicit words, or a school word with the person's own child and a difficulty; « payer la cantine en ligne », a student's certificate are not this need
  ['scolarite-inclusive', 5, (q) => (w("scolarite|scolarisation|scolariser|rentree scolaire|fournitures scolaires|frais (de scolarite|scolaires)|bourses? (de college|de lycee|scolaires?)|decrochage scolaire|aesh|allocation de rentree scolaire"
      + "|inscri\\w* (mon|ma|mes|nos|notre|un|son|ses) (enfants?|fils|filles?) (a l'ecole|au college|au lycee|en maternelle)|inscription (a l'ecole|scolaire|au college|au lycee|en maternelle)"
      + "|school (enrol\\w*|registration|fees|costs|supplies)|enrol\\w* (my|our) (child|children|son|daughter|kids?) (in|at) school|okul kayd\\p{L}*|okula kay\\p{L}*|okul masraf\\p{L}*"
      + "|schulanmeldung|einschulung|schulkosten|schulbedarf|(запис\\p{L}*|зарахува\\p{L}*) (\\p{L}+ )?до школи|шкільн\\p{L}* (витрат\\p{L}*|приладд\\p{L}*)").test(q)
      || (w("ecole|college|lycee|maternelle|cantine|scolaire").test(q) && MY_CHILD.test(q) && w("aides?|frais|payer|cout\\w*|difficulte\\w*|problemes?|inscri\\w*|accompagn\\w*|handicap\\w*|refuse\\w*").test(q))
      || /تسجيل (ابني|ابنتي|طفلي|اطفالي|اولادي) في (ال)?مدرسة|مصاريف (ال)?مدرسة|التمدرس/u.test(q))
    && !w("certificat de scolarite|etudiant\\w*|universit\\w*|auto-?ecole|ecole de conduite|driving school").test(q)],
  ['prestations-familiales', 6, (q) => CHILDREN.test(q) && w("aides?|allocations?|argent|payer|factures?|dettes?|loyers?|impayes?|caf").test(q)],
];

/** the content of each need: label, official numbers, next actions, sheets, topic for the ordinary search (French catalogue) */
/** @type {Record<string, { label: string, numbers: string[], sheets: string[], topic: string, actions: string[], rules?: { text: string, sheet: string, winter?: boolean }[] }>} */
const CONTENT = {
  'hebergement-urgence': { label: 'Trouver un hébergement', numbers: ['115'], sheets: ['F2003', 'F17317'], topic: 'hébergement urgence',
    actions: ['Appelez le 115 (Samu social, gratuit, 24 h/24) pour une place d’hébergement d’urgence.', 'Sans adresse, un CCAS ou une association agréée peut vous domicilier : vous recevez votre courrier et pouvez faire vos démarches (fiche F17317).'] },
  energie: { label: 'Factures impayées : électricité, gaz, eau', numbers: [], sheets: ['F20055', 'F38589', 'F1334'], topic: 'facture électricité impayée',
    actions: ['Contactez tout de suite votre fournisseur pour demander un délai ou un échéancier : il doit vous écrire avant de réduire ou couper.', 'Le Fonds de solidarité pour le logement (FSL) peut aider à payer des factures d’électricité ou de gaz (fiche F1334).'],
    rules: [{ text: 'Du 1er novembre au 31 mars (trêve hivernale), les coupures d’électricité et de gaz pour impayé sont interdites ; la puissance de l’électricité peut toutefois être réduite.', sheet: 'F20055', winter: true }] },
  'expulsion-impayes': { label: 'Loyer impayé, risque d’expulsion', numbers: [], sheets: ['F31272', 'F34736', 'F1334', 'F32037'], topic: 'loyer impayé expulsion',
    actions: ['En cas d’impayé, l’aide au logement peut être maintenue sous conditions ; le bailleur doit signaler l’impayé à la Caf ou à la MSA (fiche F32037).', 'Le FSL peut aider à payer une dette de loyer (fiche F1334).'],
    rules: [{ text: 'Du 1er novembre au 31 mars (trêve hivernale), l’expulsion d’un locataire est reportée, sauf exceptions (fiche F34736).', sheet: 'F34736', winter: true }] },
  'crise-suicide': { label: 'Détresse, idées suicidaires', numbers: ['3114', '15'], sheets: ['F33954'], topic: 'prévention du suicide',
    actions: ['Appelez le 3114, numéro national de prévention du suicide : gratuit, 24 h/24 et 7 j/7, des professionnels répondent ; vous pouvez aussi appeler si vous êtes inquiet pour un proche (fiche F33954).', 'En danger immédiat : appelez le 15 (Samu) ou le 112.'] },
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
  'aide-domicile': { label: 'Personne âgée : rester à domicile ou être accueillie', numbers: [], sheets: ['F245', 'F246', 'F255', 'F2444', 'F10009'], topic: 'aide à domicile personne âgée',
    actions: ['Le département peut financer une aide à domicile sous conditions de ressources, ou l’Apa pour une personne en perte d’autonomie (fiche F245).', 'Si le maintien à domicile n’est plus possible : les hébergements pour personnes âgées et l’aide sociale à l’hébergement (fiches F255, F2444).',
      // Wider needs (15/11/2026): F10009 (DILA archive of 15/11/2026): « Elle est versée par les services du département »
      'Pour une perte d’autonomie, vous pouvez vous renseigner auprès des services du département (à Strasbourg, la Collectivité européenne d’Alsace) sur l’allocation personnalisée d’autonomie (fiche F10009).'] },
  'accessibilite-mobilite': { label: 'Handicap et déplacements', numbers: [], sheets: ['F34049'], topic: 'MDPH',
    actions: ['La carte mobilité inclusion (CMI) se demande à la MDPH (fiche F34049).',
      // R38: the operator's own page (CTS, cts-strasbourg.eu, page Mobistras, read 02/11/2026); no phone number here: two official documents give different ones
      'Dans l’Eurométropole de Strasbourg, Mobistras (exploité par la CTS) transporte de porte à porte les personnes titulaires d’une CMI ou d’une carte d’invalidité, ou reconnues éligibles par la commission médicale de l’Eurométropole ; l’inscription se fait auprès de l’Eurométropole (voir la page Mobistras du site de la CTS).'] },
  // Wider needs (15/11/2026) — the five needs below: every sentence comes from the official sheet it names, read in the DILA archive of 15/11/2026 (vosdroits-latest.zip,
  // Last-Modified 15/11/2026 01:54 GMT; https://www.service-public.gouv.fr/particuliers/vosdroits/<id>). No amount, threshold or deadline; a body is named
  // only as the place to ask (« vous pouvez vous renseigner auprès de… »); nothing says that an aid is due.
  // F24610 / F31029: « il faut prendre contact avec la MDPH […] chargée d'aider les personnes en situation de handicap à évaluer leurs besoins et les accompagner dans leurs démarches »
  'mdph-droits': { label: 'Handicap : dossier MDPH', numbers: [], sheets: ['F24610', 'F31029'], topic: 'MDPH',
    actions: ['Pour une demande liée au handicap d’un enfant ou d’un adulte, vous pouvez vous renseigner auprès de la maison départementale des personnes handicapées (MDPH) de votre département : elle aide à évaluer les besoins et accompagne dans les démarches.',
      'Pour un enfant, la fiche F24610 présente les aides et la scolarité ; pour un adulte, la fiche F31029.'] },
  psy: { label: 'Souffrance psychique', numbers: ['3114'], sheets: ['F34917'], topic: 'psychologue',
    actions: ['Des séances chez un psychologue peuvent être prises en charge par l’Assurance maladie, sous conditions (fiche F34917) ; votre médecin traitant peut vous orienter.', 'Si vous avez des idées suicidaires, ou pour un proche : le 3114 (gratuit, 24 h/24).'] },
  isolement: { label: 'Isolement', numbers: [], sheets: [], topic: 'isolement lien social',
    actions: ['Les centres sociaux, le CCAS de votre commune et des associations proposent des activités et des visites pour rompre l’isolement.'] },
  'minima-sociaux': { label: 'Pas ou peu de ressources', numbers: [], sheets: ['F19778'], topic: 'RSA',
    actions: ['Le RSA se demande en ligne sur le site de la Caf (ou de la MSA), ou sur place auprès de la Caf, des services du département, parfois du CCAS ou d’une association habilitée (fiche F19778).'] },
  'aides-logement': { label: 'Aide pour payer le loyer', numbers: [], sheets: ['F12006', 'F1280'], topic: 'aide au logement',
    actions: ['L’APL ou l’ALS aide à payer le loyer d’une résidence principale ; la demande se fait en ligne sur le site de la Caf (ou de la MSA) (fiches F12006, F1280).'] },
  // France services: https://www.france-services.gouv.fr/ read 15/11/2026 (« vous accompagner dans vos démarches administratives », « l'accompagnement réalisé par
  // les conseillers France services est toujours gratuit »). No Service-Public sheet describes it: no sheet is cited.
  'acces-aux-droits': { label: 'Aide pour les démarches administratives', numbers: [], sheets: [], topic: 'France services',
    actions: ['Pour être accompagné dans vos démarches administratives (papiers, dossiers, démarches en ligne), vous pouvez vous renseigner auprès d’un espace France services : des conseillers y accompagnent gratuitement.',
      'Le CCAS de votre commune ou une Maison des solidarités peuvent aussi vous orienter.'] },
  // F37501: « sous conditions (notamment de ressources) », « prendre contact avec un conseiller France Rénov' », « contacter votre mairie pour en savoir plus sur les aides
  // locales »; F14202: « L'aide à l'aménagement du logement est destinée à prendre en charge une partie des travaux de votre logement pour compenser votre situation de handicap »
  'adaptation-logement': { label: 'Adapter son logement (âge, handicap)', numbers: [], sheets: ['F37501', 'F14202'], topic: 'adaptation du logement',
    actions: ['MaPrimeAdapt’ est une aide pour des travaux d’adaptation du logement à la perte d’autonomie, sous conditions (notamment de ressources) ; vous pouvez vous renseigner auprès d’un conseiller France Rénov’, ou de votre mairie pour les aides locales (fiche F37501).',
      'En situation de handicap, la prestation de compensation du handicap (PCH) peut comprendre une aide à l’aménagement du logement ; vous pouvez vous renseigner auprès de la MDPH (fiche F14202).'] },
  // F601: the ways of childcare by age; « je dois contacter le service d'action sociale de ma mairie » when paying is difficult. F38243: « vous pouvez bénéficier d'aides
  // financières, sous certaines conditions »; the aid it presents (CMG) is « versée par la Caf ou la MSA » (F345, same archive)
  'garde-enfants': { label: 'Faire garder son enfant', numbers: [], sheets: ['F601', 'F38243'], topic: 'garde d’enfants',
    actions: ['Crèche, assistante maternelle, garde à domicile, accueil après l’école : la fiche F601 présente les modes de garde selon l’âge de l’enfant. En cas de difficulté pour payer la garde, vous pouvez vous renseigner auprès du service d’action sociale de votre mairie.',
      'Selon le mode de garde et votre situation, des aides financières peuvent exister, sous conditions ; vous pouvez vous renseigner auprès de la Caf (ou de la MSA) (fiche F38243).'] },
  // F38244: allocation de rentrée scolaire, aides pour la cantine, bourses, « sous conditions de ressources »; « Vous devez vous renseigner auprès de votre collectivité »
  // (mairie, département, région); the ARS is paid by the Caf or the MSA (F1878). F33865: the PPS « précise notamment les aménagements nécessaires, les aides humaines
  // ou matérielles »; « faire la demande de PPS auprès de la maison départementale pour les personnes handicapées (MDPH) »
  'scolarite-inclusive': { label: 'École et scolarité d’un enfant', numbers: [], sheets: ['F38244', 'F33865'], topic: 'scolarité',
    actions: ['Des aides peuvent exister, sous conditions de ressources, pour la rentrée, la cantine ou une bourse de collège ou de lycée ; vous pouvez vous renseigner auprès de la Caf (ou de la MSA), de l’établissement scolaire ou de votre mairie (fiche F38244).',
      'Pour un enfant en situation de handicap, le projet personnalisé de scolarisation (PPS) précise les aménagements et les aides à l’école ; vous pouvez vous renseigner auprès de la MDPH (fiche F33865).'] },
  'prestations-familiales': { label: 'Enfants à charge', numbers: [], sheets: ['F38245'], topic: 'allocations familiales',
    actions: ['Vérifiez auprès de la Caf les prestations liées à vos enfants (simulateur sur caf.fr).'] },
};

/** cautions: a benefit the ordinary search may list, and the condition the person's words put in doubt (the aide titles they apply to, for the result cards) */
// FA-D6: `doubts` names the condition of the D11 register (data/rules/rights-rules.v1.json: right id, condition fact) whose wording the caution repeats; it
// is read only by the rights graph (api/lib/rightsGraph.js) and never changes the answer of analyseNeeds
/** @type {{ id: string, when: (q: string) => boolean, aides: RegExp, text: string, sheets: string[], doubts: { right: string, fact: string }[] }[]} */
const CAUTIONS = [
  { id: 'permit-housing-aid', when: (q) => NO_PERMIT.test(q) && !HAS_PERMIT.test(q), aides: /aide personnalis[ée]e au logement|\(apl\)|allocation de logement|\(als\)|\(alf\)/i,
    text: 'L’APL et l’ALS demandent, pour une personne étrangère, un titre de séjour en cours de validité.', sheets: ['F12006', 'F1280'], doubts: [{ right: 'apl', fact: 'nationality' }] },
  { id: 'permit-rsa', when: (q) => NO_PERMIT.test(q) && !HAS_PERMIT.test(q), aides: /revenu de solidarit[ée] active|\(rsa\)|prime d.activit[ée]/i,
    text: 'Le RSA demande, pour une personne étrangère hors Union européenne, un séjour régulier (par exemple un titre de séjour permettant de travailler depuis au moins 5 ans, une carte de résident, ou le statut de réfugié).', sheets: ['F19778'], doubts: [{ right: 'rsa', fact: 'nationality' }, { right: 'prime-activite', fact: 'nationality' }] },
  { id: 'no-home-housing-aid', when: (q) => NO_HOME.test(q) || w("je n'ai pas de logement|n'ai plus de logement").test(q), aides: /aide personnalis[ée]e au logement|\(apl\)|allocation de logement|\(als\)|\(alf\)/i,
    text: 'L’APL et l’ALS aident à payer un loyer ou une redevance : elles ne peuvent être demandées qu’une fois un logement loué ou une place obtenue en établissement ou en foyer (FJT, résidence).', sheets: ['F12006', 'F1280'], doubts: [{ right: 'apl', fact: 'housing.status' }] },
  { id: 'under-25-rsa', when: UNDER_25, aides: /revenu de solidarit[ée] active|\(rsa\)/i,
    text: 'Le RSA se demande en principe à partir de 25 ans ; avant 25 ans, seulement dans des cas particuliers.', sheets: ['F19778'], doubts: [{ right: 'rsa', fact: 'age' }] },
  { id: 'isolated-meaning', when: (q) => w('isolee?s?').test(q) && w("deprime\\w*|depression|solitude|personne a qui parler|ne vois personne|triste|mal[- ]etre").test(q), aides: /revenu de solidarit[ée] active|\(rsa\)|prime d.activit[ée]/i,
    text: '« Personne isolée » dans les règles du RSA ou de la prime d’activité veut dire « qui vit seule », pas « qui se sent seule » : ces aides dépendent des ressources.', sheets: ['F19778'], doubts: [] },
];

/** the question that changes the answer, when the words do not say it (offered as two re-searches; nothing is stored) */
/** @type {{ id: string, when: (q: string) => boolean, text: string, options: [string, string][] }[]} */
const QUESTIONS = [
  { id: 'permit', when: (q) => w('etranger\\w*|titre de sejour|prefecture|demandeur d.asile|migrant\\w*').test(q) && !NO_PERMIT.test(q) && !HAS_PERMIT.test(q),
    text: 'Avez-vous un titre de séjour en cours de validité ?', options: [['Oui', 'avec titre de séjour'], ['Non', 'sans titre de séjour']] },
];

// FA-D6 (18/11/2026) DEFECT fixed: the trêve hivernale is a French calendar period, « du 1er novembre au 31 mars (inclus) de l'année suivante » (F34736,
// F20055, DILA archive of 17/11/2026). It was read on the UTC month, so the first hour of 1 November (Paris) showed it as not in force and the first two
// hours of 1 April as still in force. The month is now the Paris calendar month.
const PARIS_MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', month: 'numeric' });
/** the trêve hivernale window, as data (read by api/lib/rightsGraph.js) */
export const TREVE_HIVERNALE = Object.freeze({ from: '11-01', to: '03-31', timeZone: 'Europe/Paris', sheets: Object.freeze(['F34736', 'F20055']) });
/** @param {Date} d @returns {boolean} whether the Paris calendar day of `d` is inside the trêve hivernale */
export const inTreveHivernale = (d) => { const m = Number(PARIS_MONTH.format(d)); return m >= 11 || m <= 3; };
const isWinter = inTreveHivernale;

/** @param {any} o @returns {any} */
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
/**
 * FA-D6 — read-only views of the orientation constants, for the rights graph (api/lib/rightsGraph.js): the graph is generated FROM these, never copied.
 * Deep-frozen copies: the orientation itself keeps reading NEEDS / CONTENT / CAUTIONS.
 */
export const NEED_DEFINITIONS = deepFreeze(NEEDS.map(([id, priority]) => ({ id, priority, ...structuredClone(CONTENT[id]) })));
export const CAUTION_DEFINITIONS = deepFreeze(CAUTIONS.map(({ id, aides, text, sheets, doubts }) => ({ id, aides: aides.source, text, sheets: [...sheets], doubts: doubts.map((d) => ({ ...d })) })));

/**
 * @param {string[]} queries the query as typed and, when it was typed in another language, its French translation
 * @param {{ now?: Date, safetyKind?: string | null }} [opts]
 * @returns {{ needs: any[], cautions: any[], questions: any[], multi: boolean } | null} null when the words describe no need of this list
 */
export function analyseNeeds(queries, { now = new Date(), safetyKind = null } = {}) {
  const qs = (Array.isArray(queries) ? queries : [queries]).filter(Boolean).map(fold);
  /** @param {(q: string) => boolean} t */
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
