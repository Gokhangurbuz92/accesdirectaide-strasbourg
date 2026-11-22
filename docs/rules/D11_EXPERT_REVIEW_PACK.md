# D11 — dossier de revue experte des règles de droits (ADA Strasbourg)

Registre : data/rules/rights-rules.v1.json (consulté le 2026-10-21). Cas proposés : data/rules/reference-cases.proposed.v1.json.

**Statut : aucune règle n'est validée par un expert ; approuvées par le responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) : rsa, prime-activite, apl, aah, apa, are, c2s, faj-strasbourg.** Ce document est généré à partir des données du produit ; il ne contient aucune décision. Pour chaque droit,
l'expert (nom, fonction, date) accepte, corrige ou rejette chaque condition, chaque lecture automatique et chaque cas proposé, et tranche les ambiguïtés.
Une règle approuvée par le responsable du traitement n'est lue que par l'orientation dans le navigateur (« règle relue par l'équipe ADA ; l'organisme décide ») ; le serveur n'applique que les règles relues par un expert. Les résultats restent « à faire vérifier » et l'organisme compétent décide.

Légende des résultats : MET = condition remplie d'après les réponses ; NOT_MET = non remplie ; UNKNOWN = ADA ne peut pas le dire.

## RSA (revenu de solidarité active) (`rsa`) — OWNER_VALIDATED

Décide : Caf (MSA pour les exploitants agricoles), sur dossier ; département

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F19778 | 2026-04-01 | 2026-10-21 |  |
| https://www.service-public.gouv.fr/particuliers/vosdroits/F286 | 2026-04-01 | 2026-10-21 | RSA jeune actif (moins de 25 ans) |

Base légale citée : CASF L262-2 à L262-12 ; CASF L262-27 à L262-39 ; CASF R262-32 à R262-42 ; CASF R262-43 à R262-49 ; CASF L262-45 à L262-49 ; CASF D262-25-1 à D262-25-4 (RSA jeune actif) ; Décret n°2025-293 du 29 mars 2025

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | au moins 25 ans (F19778 ; CASF L262-4 1° : « plus de vingt-cinq ans ») ; moins de 25 ans : voie générale si la personne assume la charge d'un enfant né ou à naître (CASF L262-4 1°, F15553), ou RSA jeune actif de 18 à 25 ans avec condition d'activité (CASF L262-7-1, F286) | F19778 | âge ≥ 25 ; en dessous : UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| residence | résider en France de manière stable et effective | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| resources | ressources de l'ensemble du foyer (CASF L262-3) : Caf, moyenne mensuelle des ressources des 3 mois précédant la demande ; MSA, trimestre précédant celui du versement ; déclaration trimestrielle préremplie : mois M-2 à M-4 (F19778) — barème non reproduit, jamais lu par ADA | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| nationality | être français, ou titulaire depuis au moins 5 ans d'un titre de séjour autorisant à travailler (CASF L262-4 2°) ; sans condition de durée : réfugiés, protection subsidiaire, apatrides, carte de résident ou titre conférant des droits équivalents ; personne ayant droit à la majoration pour isolement (CASF L262-9) : régularité du séjour (CSS L512-2) ; UE : droit au séjour et au moins 3 mois de présence, ou cas d'activité listés (F19778) — titre de séjour et nationalité ne sont jamais lus par ADA | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| activity | élèves, étudiants et stagiaires non rémunérés exclus ; congé parental, sabbatique, sans solde ou disponibilité exclus — ces deux exclusions ne s'appliquent pas à la personne ayant droit à la majoration pour isolement (parent isolé, femme isolée enceinte : CASF L262-4 3° et 4°, L262-9) ; F19778 ne cite cette exception que pour les études | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| activity_young | RSA jeune actif (CASF L262-7-1 : « dix-huit ans au moins et vingt-cinq ans au plus ») : activité d'au moins 3 214 heures (F286 : 2 ans à temps plein) au cours des 3 ans précédant la demande (CASF D262-25-1) ; une personne de moins de 25 ans qui assume la charge d'un enfant né ou à naître relève de la voie générale (CASF L262-4 1°), sans cette condition d'activité — F286 l'écrit « sauf si vous êtes parent isolé » | F286 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Pages complémentaires (information, G14) : https://www.service-public.gouv.fr/particuliers/vosdroits/F15553 (RSA parent isolé (enfant à charge, grossesse))

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : F19778, F286, F15553, https://solidarites.gouv.fr/revalorisation-annuelle-des-prestations-sociales-au-1er-avril-2026 ; CASF L262-4 (en vigueur depuis le 2016-01-01), CASF L262-7-1 (en vigueur depuis le 2010-01-01), CASF D262-25-1 (en vigueur depuis le 2017-01-01), CASF L262-9 (en vigueur depuis le 2016-01-01), CASF L262-3 (en vigueur depuis le 2019-09-01).

Ambiguïtés à trancher :
- Bornes d'âge du RSA jeune actif : F286 dit « 18 à 25 ans » puis « 16 à 25 ans » (« 16 à 24 ans » pour les étrangers relevant de la MSA), N19775 dit « 18 à 24 ans » ; CASF L262-7-1 (en vigueur depuis le 01/01/2010, relu le 22/11/2026) dit « dix-huit ans au moins et vingt-cinq ans au plus » : le texte du code prévaut-il, et les 16-17 ans ne relèvent-ils que de la voie « charge d'un enfant né ou à naître » (CASF L262-4 1°) ? — décision : ……
- Montant forfaitaire 651,69 € (personne seule) : en vigueur au 1er avril 2026 selon solidarites.gouv.fr (publication du 31/03/2026), revalorisé chaque 1er avril (CASF L262-3) ; F19778 ne le date pas — montant de calcul, jamais un montant dû, jamais utilisé par ADA — décision : ……
- Âge exact de 25 ans : F19778 dit « au moins 25 ans », CASF L262-4 1° dit « plus de vingt-cinq ans » : 25 ans révolus suffisent-ils (lecture actuelle : oui, selon F19778) ? — décision : ……

Cas de référence proposés (9) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| rsa-age-25 | {ageRange: [25, 25]} | {age: UNKNOWN} | {age: UNKNOWN} | F19778 « au moins 25 ans » : 25 ans inclus — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-age-24 | {ageRange: [24, 24]} | {age: UNKNOWN} | {age: UNKNOWN} | F19778 « au moins 25 ans » ; à 24 ans deux voies restent possibles : charge d'un enfant né ou à naître (CASF L262-4 1°) ou RSA jeune actif 18-25 ans (CASF L262-7-1) : non tranchable par l'âge seul | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-band-18-24 | {ageRange: [18, 24]} | {age: UNKNOWN} | {age: UNKNOWN} | tranche entièrement sous 25 ans : même cas que rsa-age-24 (voie « charge d'enfant » CASF L262-4 1° ou RSA jeune actif CASF L262-7-1) | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-band-25-59 | {ageRange: [25, 59]} | {age: UNKNOWN} | {age: UNKNOWN} | tranche entièrement à 25 ans ou plus — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-unread | {ageRange: [40, 40]} | {residence: UNKNOWN, resources: UNKNOWN, nationality: UNKNOWN, activity: UNKNOWN, activity_young: UNKNOWN} | {residence: UNKNOWN, resources: UNKNOWN, nationality: UNKNOWN, activity: UNKNOWN, activity_young: UNKNOWN} | conditions non lisibles à partir des réponses ADA : toujours inconnues | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-age-26 | {ageRange: [26, 26]} | {age: MET} | {age: MET} | F19778 « Vous pouvez demander le RSA si vous êtes âgé d'au moins 25 ans » : 26 ans, au-delà du seuil (FA-D6, archive DILA du 17/11/2026) | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-age-17 | {ageRange: [17, 17]} | {age: UNKNOWN} | {age: UNKNOWN} | CASF L262-4 1° : « assumer la charge d'un ou plusieurs enfants nés ou à naître » n'a pas d'âge minimum ; RSA jeune actif à partir de 18 ans (CASF L262-7-1) : âge seul non tranchable (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-age-25-unread | {ageRange: [25, 25]} | {age: UNKNOWN, residence: UNKNOWN, resources: UNKNOWN, nationality: UNKNOWN, activity: UNKNOWN} | {age: UNKNOWN, residence: UNKNOWN, resources: UNKNOWN, nationality: UNKNOWN, activity: UNKNOWN} | F19778 « au moins 25 ans » : l'âge seul est rempli, toutes les autres conditions restent inconnues — jamais un droit (G14) — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-age-26-band | {ageRange: [26, 59]} | {age: MET} | {age: MET} | F19778 « au moins 25 ans » : tranche entièrement au-dessus de 25 ans (la limite exacte de 25 ans reste à vérifier) (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

## Prime d'activité (`prime-activite`) — OWNER_VALIDATED

Décide : Caf / MSA

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F2882 | 2026-06-01 | 2026-10-21 |  |

Base légale citée : CSS L842-1 à L842-8 ; CSS R842-1 à R842-5 ; CSS R843-1, R843-2 ; CSS R844-1 à R844-5 ; CSS R845-1 à R845-3 ; CSS R846-1 à R846-9 ; CSS D843-1 à D843-3 ; CSS L845-1 à L845-5 ; CSS D846-2 ; Décret n°2026-222 du 30 mars 2026

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | 18 ans ou plus | F2882 | âge ≥ 18 ; en dessous : NOT_MET | ☐ accepter ☐ corriger ☐ rejeter |
| activity | exercer une activité professionnelle avec des revenus modestes ; travailleurs détachés exclus (F2882) ; étudiants, apprentis, stagiaires : revenu d'activité mensuel supérieur à 1 144,21 € (F33375, vérifiée le 01/06/2026, montant sans date d'effet sur la page : jamais lu par ADA), sauf personne vivant seule qui assume la charge d'un ou plusieurs enfants ; la gratification de stage n'est pas un revenu d'activité (F33375) | F2882 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| residence | résider en France de manière stable et effective | F2882 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| nationality | UE, EEE, Suisse : droit au séjour et au moins 3 mois de résidence au moment de la demande ; hors UE : titre de séjour permettant de travailler depuis au moins 5 ans, ou parent isolé avec un enfant à charge de moins de 3 ans et un titre de séjour, ou autres cas de la fiche (F2882) — liste propre à la prime d'activité, pas identique à celle du RSA ; jamais lu par ADA | F2882 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Pages complémentaires (information, G14) : https://www.service-public.gouv.fr/particuliers/vosdroits/F33375 (étudiant, stagiaire, apprenti)

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : F2882, F33375, https://solidarites.gouv.fr/revalorisation-annuelle-des-prestations-sociales-au-1er-avril-2026.

Ambiguïtés à trancher :
- Montant forfaitaire 638,28 € (personne seule) : en vigueur au 1er avril 2026 selon solidarites.gouv.fr (31/03/2026) ; 957,42 € (couple, tableau de F2882) sans date d'effet sur la page — montants de calcul, jamais un montant versé, jamais utilisés par ADA — décision : ……
- Étudiants, apprentis, stagiaires : F2882 n'en parle pas ; F33375 (vérifiée le 01/06/2026) indique un revenu d'activité mensuel supérieur à 1 144,21 €, sans date d'effet ni mois de référence sur la page : seuil à dater avant toute lecture automatique — décision : ……

Cas de référence proposés (4) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| prime-age-17 | {ageRange: [17, 17]} | {age: NOT_MET} | {age: NOT_MET} | F2882 « 18 ans ou plus » | ☐ accepter ☐ corriger ☐ rejeter |
| prime-age-18 | {ageRange: [18, 18]} | {age: MET} | {age: MET} | F2882 « 18 ans ou plus » : 18 inclus | ☐ accepter ☐ corriger ☐ rejeter |
| prime-band-under-18 | {ageRange: [0, 17]} | {age: NOT_MET} | {age: NOT_MET} | F2882 « Avoir 18 ans ou plus » : tranche entièrement sous 18 ans (FA-D6) | ☐ accepter ☐ corriger ☐ rejeter |
| prime-age-20-activity-unread | {ageRange: [20, 20]} | {age: MET, activity: UNKNOWN} | {age: MET, activity: UNKNOWN} | F2882 « 18 ans ou plus » ; F33375 seuil étudiant / apprenti 1 144,21 € sans date d'effet : condition d'activité jamais lue (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

## APL (aide personnalisée au logement) (`apl`) — OWNER_VALIDATED

Décide : Caf / MSA

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F12006 | 2026-07-01 | 2026-10-21 |  |

Base légale citée : CCH R831-1 à R831-3 ; CCH R832-23 à D832-28 ; CCH R822-3 à R822-17 ; CCH D832-1 à D832-4 ; CCH R822-23 à R822-25 ; CCH R823-1 à D823-9 ; CCH R823-10 à D823-15 ; Arrêté du 27 septembre 2019

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| housing.status | locataire ou colocataire ; sous-locataire déclaré au propriétaire, sous conditions (voir l'ambiguïté) ; résident d'un établissement conventionné (F12006) | F12006 | housing.status ∈ {tenant, tenant_hlm} : MET ; autre : UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| housing | résidence principale, logement décent et conventionné (« Votre propriétaire doit vous l'indiquer » ; la plupart des logements HLM le sont), en France (F12006) — APL seulement, pas l'ALS ni l'ALF | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| resources | ressources des 12 derniers mois, actualisées tous les 3 mois ; patrimoine pris en compte au-delà de 30 000 € (barème : arrêté du 27 septembre 2019, non reproduit sur la page) | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| nationality | étrangers : titre de séjour en cours de validité ; étudiants hors UE, EEE ou Suisse, depuis le 1er juillet 2026 : seulement avec une bourse sur critères sociaux, une activité professionnelle ou un contrat d'apprentissage / de professionnalisation (F12006) ; restent couverts les étudiants réfugiés, apatrides et les conjoints d'étudiants extracommunautaires (actualité Service-Public A18981 du 01/07/2026, décret n° 2026-552 du 27 juin 2026) | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| exclusion | pas d'aide si le propriétaire est un ascendant ou un descendant de vous-même, de votre conjoint ou partenaire de Pacs ; autres cas : détention de parts de propriété ou d'usufruit du logement (F12006) | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : F12006, A18981.

Ambiguïtés à trancher :
- Sous-location : le texte principal de F12006 (vérifiée le 01/07/2026) dit « à condition d'avoir moins de 30 ans » (ou d'être hébergé chez un accueillant familial) ; la question-réponse et l'infographie disent « moins de 30 ans ou plus de 60 ans ou être en situation de handicap » (règles non applicables à la sous-location de l'intégralité du logement) : texte réglementaire du CCH à identifier ; ADA ne lit jamais la sous-location — décision : ……
- Plafonds non publiés sur la page — décision : ……

Cas de référence proposés (5) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| apl-tenant | {housing: {status: tenant}} | {housing.status: MET} | {housing.status: MET} | F12006 « locataire » | ☐ accepter ☐ corriger ☐ rejeter |
| apl-owner | {housing: {status: owner}} | {housing.status: UNKNOWN} | {housing.status: UNKNOWN} | propriétaire : hors du champ de F12006 tel que relevé (APL accession non relevée) | ☐ accepter ☐ corriger ☐ rejeter |
| apl-tenant-hlm | {housing: {status: tenant_hlm}} | {housing.status: MET} | {housing.status: MET} | F12006 « La plupart des logements HLM » : locataire d'un logement HLM = locataire (conventionnement à vérifier) (FA-D6) | ☐ accepter ☐ corriger ☐ rejeter |
| apl-free-housed | {housing: {status: free}} | {housing.status: UNKNOWN, housing: UNKNOWN} | {housing.status: UNKNOWN, housing: UNKNOWN} | F12006 « locataire » : hébergé gratuitement, cas non couvert par la lecture (à vérifier) ; conventionnement jamais lu (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| apl-subtenant | {housing: {status: subtenant}} | {housing.status: UNKNOWN} | {housing.status: UNKNOWN} | F12006 : sous-location, texte et infographie divergents (moins de 30 ans / plus de 60 ans / handicap) : jamais lue automatiquement (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

## AAH (allocation aux adultes handicapés) (`aah`) — OWNER_VALIDATED

Décide : CDAPH de la MDPH (silence de 4 mois = rejet) ; versement Caf / MSA

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F12242 | 2026-09-14 | 2026-10-21 |  |

Base légale citée : CSS L821-1 à L821-8 ; CSS R821-1 à R821-9 ; CSS D821-1 à D821-11 ; CASF R241-33, annexe 2-4

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| disability | taux d'incapacité d'au moins 80 %, ou de 50 à 79 % avec restriction substantielle et durable d'accès à l'emploi (au moins 1 an) | F12242 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| age | au moins 20 ans (16 ans si plus à charge pour les prestations familiales) | F12242 | âge ≥ 20 (zone 16–19 : inconnu) ; en dessous : NOT_MET | ☐ accepter ☐ corriger ☐ rejeter |
| residence | France métropolitaine ou territoires d'outre-mer listés | F12242 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| resources | revenu net catégoriel de l'avis d'imposition N-2 ; ressources personnelles depuis le 1er octobre 2023 (conjugalisation appliquée par la Caf / MSA si plus favorable) ; plafonds annuels du cas général (hors Mayotte), sans conjugalisation : 12 499 € sans enfant, 18 749 € (1 enfant), 24 998 € (2), 31 248 € (3), 37 497 € (4) (F12242) ; soit 12 fois le montant de l'AAH, majoré de moitié par enfant à charge (CSS D821-2), montant de 1 041,59 € en vigueur au 1er avril 2026 (solidarites.gouv.fr) | F12242 | plafond annuel 0 enfant(s) : 12499 €, 1 enfant(s) : 18749 €, 2 enfant(s) : 24998 €, 3 enfant(s) : 31248 €, 4 enfant(s) : 37497 € ; au-delà : UNKNOWN ; autre nombre d'enfants : inconnu ; barème en vigueur à partir du 2026-04-01, à relire le 2027-04-01 (hors de cette période : inconnu) ; base de ressources exigée : revenu-net-categoriel-n-2 (autre base : inconnu) | ☐ accepter ☐ corriger ☐ rejeter |

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : F12242, https://solidarites.gouv.fr/revalorisation-annuelle-des-prestations-sociales-au-1er-avril-2026 ; CSS D821-2 (en vigueur depuis le 2023-10-01).

Ambiguïtés à trancher :
- Montant maximal 1 041,59 € en vigueur au 1er avril 2026 (solidarites.gouv.fr, 31/03/2026) ; F12242 (vérifiée le 14/09/2026) ne date ni ce montant ni les plafonds ; plafonds lus dans F12242 et cohérents avec CSS D821-2 (12 fois le montant, majoré de moitié par enfant) : date d'effet et arrondi à confirmer ; au-dessus du plafond, ADA ne conclut jamais (conjugalisation possible) — décision : ……

Cas de référence proposés (15) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| aah-age-15 | {ageRange: [15, 15]} | {age: NOT_MET} | {age: NOT_MET} | F12242 : au moins 20 ans, 16 ans si plus à charge : 15 ans exclu | ☐ accepter ☐ corriger ☐ rejeter |
| aah-age-17 | {ageRange: [17, 17]} | {age: UNKNOWN} | {age: UNKNOWN} | F12242 : 16-19 ans possible seulement si plus à charge pour les prestations familiales (non recueilli) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-age-20 | {ageRange: [20, 20]} | {age: MET} | {age: MET} | F12242 « au moins 20 ans » | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-at-ceiling | {annualResources: 12499, children: 0, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | F12242 plafond annuel 12 499 € sans enfant (en vigueur au 1er avril 2026, solidarites.gouv.fr) : égal au plafond = sous le plafond, revenu net catégoriel N-2 déclaré (à confirmer par l'expert : « jusqu'à » inclusif) — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-above | {annualResources: 12500, children: 0, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | F12242 : au-dessus de 12 499 € sans enfant ; « Depuis le 1er octobre 2023 » ressources personnelles, mais la conjugalisation est appliquée si plus favorable : jamais un refus, à vérifier | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-1child | {annualResources: 18000, children: 1, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: MET} | {resources: MET} | F12242 : 18 749 € avec 1 enfant (au 1er avril 2026), revenu net catégoriel N-2 déclaré | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-2children | {annualResources: 18000, children: 2, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: MET} | {resources: MET} | F12242 : 24 998 € avec 2 enfants (au 1er avril 2026 ; CSS D821-2 : plafond majoré de moitié par enfant), revenu net catégoriel N-2 déclaré | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-1child-above | {annualResources: 18750, children: 1, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | F12242 « Nombre d'enfants à charge au sens des prestations familiales » : 18 749 € avec 1 enfant ; 18 750 € est au-dessus du plafond de la personne seule, conjugalisation possible : à vérifier (FA-D6, G14) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-age-16 | {ageRange: [16, 16]} | {age: UNKNOWN} | {age: UNKNOWN} | F12242 « au moins 16 ans si vous n'êtes plus considéré à la charge de vos parents » : non recueilli (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-age-19 | {ageRange: [19, 19]} | {age: UNKNOWN} | {age: UNKNOWN} | F12242 : 16-19 ans possible seulement hors charge pour les prestations familiales (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-no-basis | {annualResources: 12000, children: 0, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | F12242 « revenu net catégoriel » N-2 : un montant sans cette base n'est pas comparable au plafond (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-before-date | {annualResources: 12000, children: 0, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-03-31} | {resources: UNKNOWN} | {resources: UNKNOWN} | plafonds en vigueur au 1er avril 2026 (solidarites.gouv.fr « Au 1er avril 2026 ») : une date antérieure n'est pas lue (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-4children | {annualResources: 37000, children: 4, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: MET} | {resources: MET} | F12242 : 37 497 € avec 4 enfants (au 1er avril 2026) ; 37 000 € est sous le plafond (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-5children | {annualResources: 20000, children: 5, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | F12242 : aucun plafond publié au-delà de 4 enfants : à vérifier (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-below | {annualResources: 12000, children: 0, resourcesBasis: revenu-net-categoriel-n-2, referenceDate: 2026-11-22} | {resources: MET} | {resources: MET} | F12242 : 12 000 € sous le plafond de 12 499 € sans enfant (au 1er avril 2026) (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

## APA à domicile (allocation personnalisée d'autonomie) (`apa`) — OWNER_VALIDATED

Décide : Département — dans le Bas-Rhin, la Collectivité européenne d'Alsace (adresse de la Direction de l'Autonomie non vérifiée sur alsace.eu)

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F10009 | 2026-06-01 | 2026-10-21 |  |

Base légale citée : CASF L232-1, L232-11 ; CASF R232-1 à R232-9 ; CASF L232-12 à L232-20 ; CASF D232-9-1, D232-9-2 ; CASF R232-10 à D232-11-1 ; CASF L232-22 à L232-28

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | 60 ans ou plus | F10009 | âge ≥ 60 ; en dessous : NOT_MET | ☐ accepter ☐ corriger ☐ rejeter |
| dependency | perte d'autonomie GIR 1 à 4 (grille AGGIR) | F10009 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| residence | à domicile : résidence stable et régulière en France ; étrangers : carte de résident ou titre de séjour ; en établissement : établissement situé en France hébergeant au moins 25 personnes âgées dépendantes, sinon APA à domicile (F10009) | F10009 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| exclusion | non cumulable notamment avec la PCH, la majoration pour aide constante d'une tierce personne, la PCRTP (choix possible entre les deux), l'allocation simple d'aide sociale, les aides des caisses de retraite et l'aide financière pour rémunérer une aide à domicile (F10009) | F10009 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : F10009.

Ambiguïtés à trancher :
- Montants mensuels maximum de l'APA à domicile selon F10009 (vérifiée le 01/06/2026) : GIR 1 2 080,33 €, GIR 2 1 682,30 €, GIR 3 1 215,99 €, GIR 4 811,52 €, sans date d'effet sur la page ; la page solidarites.gouv.fr de revalorisation au 1er avril 2026 n'en donne pas ; le chiffre divergent (GIR 1 1 914,04 €) n'est pas daté — aucun montant APA n'est utilisé par ADA (information seulement) ; APA en établissement : règles différentes — décision : ……
- Livret de la CeA de janvier 2023 : document historique, jamais une source d'autorité ; procédure 2026 de la Collectivité européenne d'Alsace non lue — décision : ……

Cas de référence proposés (5) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| apa-age-59 | {ageRange: [59, 59]} | {age: NOT_MET} | {age: NOT_MET} | F10009 « Vous devez être âgé d’au moins 60 ans » | ☐ accepter ☐ corriger ☐ rejeter |
| apa-age-60 | {ageRange: [60, 60]} | {age: MET} | {age: MET} | F10009 « Vous devez être âgé d’au moins 60 ans » | ☐ accepter ☐ corriger ☐ rejeter |
| apa-band-60plus | {ageRange: [60, 130]} | {age: MET, dependency: UNKNOWN} | {age: MET, dependency: UNKNOWN} | GIR 1 à 4 : évaluation par l'équipe médico-sociale du Département, jamais lisible par ADA | ☐ accepter ☐ corriger ☐ rejeter |
| apa-band-25-59 | {ageRange: [25, 59]} | {age: NOT_MET} | {age: NOT_MET} | F10009 « Vous devez être âgé d’au moins 60 ans » : tranche entièrement sous 60 ans (FA-D6) | ☐ accepter ☐ corriger ☐ rejeter |
| apa-age-60-unread | {ageRange: [60, 60]} | {age: MET, dependency: UNKNOWN, residence: UNKNOWN, exclusion: UNKNOWN} | {age: MET, dependency: UNKNOWN, residence: UNKNOWN, exclusion: UNKNOWN} | F10009 « au moins 60 ans » : GIR, résidence et non-cumul jamais lus — aucun montant de plan d'aide utilisé (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

## ARE (allocation d'aide au retour à l'emploi) (`are`) — OWNER_VALIDATED

Décide : France Travail

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F38881 | 2026-07-23 | 2026-10-21 | contrats terminés depuis le 1er avril 2025 (F14860 = ancien régime, ne pas utiliser) |

Base légale citée : Code du travail L5421-1 à L5421-4 ; Code du travail L5422-1 à L5422-2-2 ; Code du travail L5425-1 à L5425-2 ; Décrets 2019-797 et 2023-33 ; Arrêté du 19 décembre 2024 (convention d'assurance chômage du 15 novembre 2024)

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| employment_loss | perte involontaire d'emploi (licenciement, rupture conventionnelle, fin de CDD, démission légitime) | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| affiliation | 6 mois (130 jours ou 910 heures) sur 24 mois (36 mois à partir de 55 ans) (F38881) ; primo-entrants (pas d'indemnisation chômage depuis plus de 20 ans) dont le contrat prend fin à compter du 1er avril 2026 : 5 mois (F38881), soit 108 jours ou 758 heures selon l'Unédic (publication du 01/04/2026) | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| registration | inscription à France Travail dans les 12 mois suivant la fin du contrat, période qui « peut être prolongée » dans certaines situations (par exemple congé de maladie) ; recherche active d'emploi ; aptitude physique (F38881) | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| residence | résidence stable et régulière en France | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Pages complémentaires (information, G14) : https://www.unedic.org/publications/impact-de-la-mesure-relative-aux-demandeurs-demploi-primo-entrants (primo-entrants (à compter du 1er avril 2026))

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : F38881, https://www.unedic.org/publications/impact-de-la-mesure-relative-aux-demandeurs-demploi-primo-entrants.

Ambiguïtés à trancher :
- unedic.org relu le 22/11/2026 (publication du 01/04/2026) : primo-entrants = 108 jours ou 758 heures, fins de contrat à compter du 1er avril 2026 (règlement général annexé à la convention du 15 novembre 2024, art. 3 § 1er bis ; loi du 24 octobre 2025, art. 9 ; décret n° 2026-214) ; F38881 ne donne que « 5 mois » : textes de la convention et du décret non relus en direct — à confirmer — décision : ……

Cas de référence proposés (2) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| are-unread | {ageRange: [30, 30]} | {employment_loss: UNKNOWN, affiliation: UNKNOWN, registration: UNKNOWN, residence: UNKNOWN} | {employment_loss: UNKNOWN, affiliation: UNKNOWN, registration: UNKNOWN, residence: UNKNOWN} | ARE : aucune condition lisible à partir des réponses ADA (perte d'emploi, durée d'affiliation, inscription) : France Travail décide | ☐ accepter ☐ corriger ☐ rejeter |
| are-unread-60 | {ageRange: [60, 60]} | {employment_loss: UNKNOWN, affiliation: UNKNOWN, registration: UNKNOWN, residence: UNKNOWN} | {employment_loss: UNKNOWN, affiliation: UNKNOWN, registration: UNKNOWN, residence: UNKNOWN} | F38881 : 36 mois de référence à partir de 55 ans, primo-entrants 5 mois depuis le 1er avril 2026 : affiliation jamais lue (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

## C2S (complémentaire santé solidaire) (`c2s`) — OWNER_VALIDATED

Décide : CPAM (compte ameli ou cerfa 12504)

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F10027 | 2026-07-01 | 2026-10-21 |  |

Base légale citée : CSS L861-1 à L861-12 ; CSS R861-2 à R861-10 ; CSS R111-1 à R111-4 ; CSS R861-16 à R861-18 ; CSS D861-1 à D861-8

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| residence | Français : résider en France sans interruption depuis plus de 3 mois, ou autres situations de la fiche (activité, études…) ; étrangers : titre de séjour valide et résidence ininterrompue depuis plus de 3 mois ; situations particulières avant 3 mois (F10027) | F10027 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| resources | ressources du foyer sur 12 mois (cas général : du 13e au 2e mois civil avant la demande ; Alsace-Moselle : les 12 mois précédant la demande) (F10027) ; plafonds annuels au 1er avril 2026 (ameli.fr, page du 31/03/2026 ; mêmes montants dans F10027, cas général et Alsace-Moselle) — métropole : sans participation jusqu'à 10 421 € (1 personne), 15 632 € (2), 18 758 € (3), 21 885 € (4), + 4 169 € par personne en plus ; avec participation jusqu'à 14 069 €, 21 103 €, 25 324 €, 29 544 €, + 5 628 € ; outre-mer et Mayotte : 11 599 €, 17 398 €, 20 878 €, 24 358 €, + 4 640 € / 15 659 €, 23 488 €, 28 185 €, 32 883 €, + 6 263 € ; régime local d'Alsace-Moselle : participation pouvant être réduite (ameli.fr) | F10027 | metropole : 1 pers. ≤ 10421 € / ≤ 14069 €, 2 pers. ≤ 15632 € / ≤ 21103 €, 3 pers. ≤ 18758 € / ≤ 25324 €, 4 pers. ≤ 21885 € / ≤ 29544 €, + 4169 / 5628 € par personne en plus ; outre-mer : 1 pers. ≤ 11599 € / ≤ 15659 €, 2 pers. ≤ 17398 € / ≤ 23488 €, 3 pers. ≤ 20878 € / ≤ 28185 €, 4 pers. ≤ 24358 € / ≤ 32883 €, + 4640 / 6263 € par personne en plus (MET avec la note « sans participation » / « avec participation ») ; au-delà : NOT_MET ; barème en vigueur à partir du 2026-04-01, à relire le 2027-04-01 (hors de cette période : inconnu) ; base de ressources exigée : ressources-foyer-12-mois-c2s (autre base : inconnu) | ☐ accepter ☐ corriger ☐ rejeter |
| automatic | bénéficiaires du RSA : C2S gratuite automatique sauf opposition | F10027 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Pages complémentaires (information, G14) : https://www.ameli.fr/assure/droits-demarches/difficultes-acces-droits-soins/complementaire-sante/complementaire-sante-beneficiaires (plafonds de ressources au 1er avril 2026)

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : F10027, https://www.ameli.fr/assure/droits-demarches/difficultes-acces-droits-soins/complementaire-sante/complementaire-sante-beneficiaires.

Ambiguïtés à trancher :
- Plafonds datés « au 1er avril 2026 » par ameli.fr (page du 31/03/2026) ; F10027 (vérifiée le 01/07/2026) donne les mêmes montants sans date, sauf pour Mayotte (« à compter du 1er avril 2026 ») ; inclusion de la borne haute de la tranche « avec participation » (« compris dans la fourchette ») à confirmer ; régime local d'Alsace-Moselle : participation pouvant être réduite (montant non lu) — décision : ……

Cas de référence proposés (13) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| c2s-free | {annualResources: 10421, householdSize: 1, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | ameli.fr « au 1er avril 2026 » / F10027 : gratuite jusqu'à 10 421 € (1 personne, métropole) — seuil seulement — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-contribution | {annualResources: 12000, householdSize: 1, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: MET} | {resources: MET} | ameli.fr « au 1er avril 2026 » / F10027 : avec participation de 10 421 à 14 069 € (1 personne, métropole) — la note dit « avec participation financière » | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-above | {annualResources: 14070, householdSize: 1, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: NOT_MET} | {resources: NOT_MET} | ameli.fr « au 1er avril 2026 » / F10027 : au-dessus de 14 069 € (1 personne, métropole) — condition de ressources seulement | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-household-2 | {annualResources: 12000, householdSize: 2, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: MET} | {resources: MET} | ameli.fr « au 1er avril 2026 » / F10027 : 2 personnes, gratuite jusqu'à 15 632 € (métropole) ; 12 000 € est sous ce plafond | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-at-upper | {annualResources: 14069, householdSize: 1, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | F10027 « Entre 10 421 € et 14 069 € » : 14 069 € inclus dans la tranche avec participation (inclusion de la borne à confirmer par l'expert) (FA-D6) — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-household-2-contribution | {annualResources: 21103, householdSize: 2, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | ameli.fr « au 1er avril 2026 » : 2 personnes, avec participation jusqu'à 21 103 € (borne à confirmer) (G14) — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-household-3-above | {annualResources: 25325, householdSize: 3, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: NOT_MET} | {resources: NOT_MET} | ameli.fr « au 1er avril 2026 » : 3 personnes, au-dessus de 25 324 € (condition de ressources seulement) (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-household-5-free | {annualResources: 26054, householdSize: 5, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | ameli.fr : 4 personnes 21 885 € + 4 169 € par personne supplémentaire = 26 054 € sans participation pour 5 personnes (G14) — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-outre-mer-1 | {annualResources: 11599, householdSize: 1, area: outre-mer, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | ameli.fr « au 1er avril 2026 » : départements d'outre-mer et Mayotte, 11 599 € sans participation (1 personne) (G14) — décision du propriétaire 22/11, option prudente : limite exacte = UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-no-basis | {annualResources: 9000, householdSize: 1, area: metropole, referenceDate: 2026-11-22} | {resources: UNKNOWN} | {resources: UNKNOWN} | F10027 : ressources du foyer sur la période de 12 mois de la C2S ; un montant sans cette base n'est pas comparable (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-before-date | {annualResources: 9000, householdSize: 1, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-03-15} | {resources: UNKNOWN} | {resources: UNKNOWN} | ameli.fr : plafonds « au 1er avril 2026 » ; une date antérieure n'est pas lue (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-stale | {annualResources: 9000, householdSize: 1, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2027-04-01} | {resources: UNKNOWN} | {resources: UNKNOWN} | ameli.fr : barème « au 1er avril 2026 », à relire à la revalorisation suivante (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-free-below | {annualResources: 10000, householdSize: 1, area: metropole, resourcesBasis: ressources-foyer-12-mois-c2s, referenceDate: 2026-11-22} | {resources: MET} | {resources: MET} | ameli.fr « au 1er avril 2026 » : 10 000 € sous le plafond « sans participation » de 10 421 € (1 personne) (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

## FAJ — fonds d'aide aux jeunes (Eurométropole de Strasbourg) (`faj-strasbourg`) — OWNER_VALIDATED

Décide : Eurométropole de Strasbourg (géré par la Mission locale ; demande via une Mission locale, une association ou un service social)

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.strasbourg.eu/fr/fond-aide-jeunes | non indiqué | 2026-10-21 |  |

Base légale citée : aucune sur la page

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | 16 à 25 ans | strasbourg.eu | âge 16 à 25 ; 25 ans exactement : UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| territory | résider dans l'Eurométropole de Strasbourg (hors Eurométropole : règlement FAJ de la Collectivité européenne d'Alsace, texte non lu) | strasbourg.eu | hors département déclaré : NOT_MET ; dans le département : inconnu (communes non vérifiées) | ☐ accepter ☐ corriger ☐ rejeter |
| nature | aide ponctuelle, complémentaire des autres dispositifs ; ne constitue pas un revenu (information, pas une condition lue par ADA) ; ressources et résidence : à vérifier auprès de la Mission locale | strasbourg.eu | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Sources relues le 2026-11-22 par ADA engineering (pas une relecture d'expert) : https://www.strasbourg.eu/fond-aide-jeunes.

Ambiguïtés à trancher :
- Aucun plafond de ressources, règle de nationalité, barème ni article de loi sur la page ; date de mise à jour absente ; règlement du FAJ'EMS (Eurométropole, compétence transférée en 2017, gestion Mission locale) à obtenir avec sa version et sa date — décision : ……
- (sécurité de l'ingestion, hors relecture juridique — 2026-11-18) La page contenait un texte caché adressé à des agents automatiques : ignoré (donnée de page)
- (sécurité de l'ingestion, hors relecture juridique — 2026-11-22) HTML relu : aucun texte adressé à des agents automatiques retrouvé ; un seul élément caché (bouton technique « Caché » d'un formulaire Liferay). L'outil de lecture (résumé automatique) a signalé un texte caché adressé aux agents, non retrouvé dans le HTML : traité comme donnée, jamais comme instruction. Contrôle permanent : api/_services/verification/pages.js (quarantaine des instructions cachées ou visibles)

Cas de référence proposés (11) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| faj-age-15 | {ageRange: [15, 15]} | {age: NOT_MET} | {age: NOT_MET} | strasbourg.eu « 16 à 25 ans » | ☐ accepter ☐ corriger ☐ rejeter |
| faj-age-16 | {ageRange: [16, 16]} | {age: MET} | {age: MET} | strasbourg.eu « 16 à 25 ans » : tranche d'âge annoncée par la page (règlement non lu), condition d'âge seulement | ☐ accepter ☐ corriger ☐ rejeter |
| faj-age-25 | {ageRange: [25, 25]} | {age: UNKNOWN} | {age: UNKNOWN} | strasbourg.eu « 16 à 25 ans » : inclusion des 25 ans non précisée (ambiguïté à trancher par l'expert) | ☐ accepter ☐ corriger ☐ rejeter |
| faj-age-26 | {ageRange: [26, 26]} | {age: NOT_MET} | {age: NOT_MET} | au-delà de 25 ans | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-67000 | {territory: 67000} | {territory: UNKNOWN} | {territory: UNKNOWN} | code postal du Bas-Rhin : la liste des communes de l'Eurométropole n'est pas vérifiée | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-75011 | {territory: 75011} | {territory: NOT_MET} | {territory: NOT_MET} | hors Bas-Rhin, donc hors Eurométropole (le FAJ d'un autre territoire peut s'appliquer) | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-68100 | {territory: 68100} | {territory: NOT_MET} | {territory: NOT_MET} | Haut-Rhin (Alsace-Moselle, hors Bas-Rhin) : hors Eurométropole ; le FAJ de la Collectivité européenne d'Alsace peut s'appliquer (règlement non lu) (FA-D6, résidence) | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-57000 | {territory: 57000} | {territory: NOT_MET} | {territory: NOT_MET} | Moselle (Alsace-Moselle, hors Bas-Rhin) : hors Eurométropole ; un autre fonds d'aide aux jeunes peut exister (non lu) (FA-D6, résidence) | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-dept-67 | {territory: 67} | {territory: UNKNOWN} | {territory: UNKNOWN} | département 67 seul : la commune, donc l'appartenance à l'Eurométropole, reste à vérifier (FA-D6, résidence) | ☐ accepter ☐ corriger ☐ rejeter |
| faj-band-18-24 | {ageRange: [18, 24]} | {age: MET, nature: UNKNOWN} | {age: MET, nature: UNKNOWN} | strasbourg.eu « 16 à 25 ans » : tranche annoncée ; la nature de l'aide n'est pas une condition lue (G14) | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-none | {} | {territory: UNKNOWN, age: UNKNOWN} | {age: UNKNOWN, territory: UNKNOWN} | aucune réponse : tout reste inconnu, jamais une acceptation (G14) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED

