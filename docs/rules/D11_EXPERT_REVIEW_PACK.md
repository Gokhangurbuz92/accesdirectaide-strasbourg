# D11 — dossier de revue experte des règles de droits (ADA Strasbourg)

Registre : data/rules/rights-rules.v1.json (consulté le 2026-10-21). Cas proposés : data/rules/reference-cases.proposed.v1.json.

**Statut : aucune règle n'est validée.** Ce document est généré à partir des données du produit ; il ne contient aucune décision. Pour chaque droit,
l'expert (nom, fonction, date) accepte, corrige ou rejette chaque condition, chaque lecture automatique et chaque cas proposé, et tranche les ambiguïtés.
Tant que ce n'est pas fait, ADA n'utilise pas ces règles pour orienter : les résultats restent « à faire vérifier » et l'organisme compétent décide.

Légende des résultats : MET = condition remplie d'après les réponses ; NOT_MET = non remplie ; UNKNOWN = ADA ne peut pas le dire.

## RSA (revenu de solidarité active) (`rsa`) — RESEARCHED_UNVALIDATED

Décide : Caf (MSA pour les exploitants agricoles), sur dossier ; département

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F19778 | 2026-04-01 | 2026-10-21 |  |
| https://www.service-public.gouv.fr/particuliers/vosdroits/F286 | 2026-04-01 | 2026-10-21 | RSA jeune actif (moins de 25 ans) |

Base légale citée : CASF L262-2 à L262-12 ; CASF L262-27 à L262-39 ; CASF R262-32 à R262-42 ; CASF R262-43 à R262-49 ; CASF L262-45 à L262-49 ; CASF D262-25-1 à D262-25-4 (RSA jeune actif) ; Décret n°2025-293 du 29 mars 2025

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | au moins 25 ans (moins de 25 ans : RSA jeune actif, conditions d'activité) | F19778 | âge ≥ 25 ; en dessous : UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| residence | résider en France de manière stable et effective | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| resources | moyenne mensuelle des ressources des 3 mois précédant la demande (barème non reproduit ici) | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| nationality | UE : droit au séjour et au moins 3 mois de présence (ou cas d'activité listés) ; autres : titre de séjour autorisant à travailler depuis au moins 5 ans (hors Algériens), carte de résident, réfugié, apatride ou protection subsidiaire | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| activity | étudiants et stagiaires non rémunérés exclus (sauf parent isolé) ; congé parental, sabbatique, sans solde ou disponibilité exclus | F19778 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| activity_young | RSA jeune actif : au moins 2 ans à temps plein (au moins 3 214 heures) au cours des 3 ans précédant la demande ; dispense pour parent isolé | F286 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- F286 donne des bornes d'âge incohérentes (18-25 / 16-25 / 16-24 selon la section ; la page N19775 dit 18-24) : à trancher par l'expert — décision : ……
- Montant 651,69 € (personne seule) sans date d'effet sur la page — décision : ……

Cas de référence proposés (5) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| rsa-age-25 | {ageRange: [25, 25]} | {age: MET} | {age: MET} | F19778 « au moins 25 ans » : 25 ans inclus | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-age-24 | {ageRange: [24, 24]} | {age: UNKNOWN} | {age: UNKNOWN} | F19778/F286 : moins de 25 ans, seule la voie RSA jeune actif (activité) reste ouverte : non tranchable par l'âge seul | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-band-18-24 | {ageRange: [18, 24]} | {age: UNKNOWN} | {age: UNKNOWN} | tranche entièrement sous 25 ans : même cas que rsa-age-24 | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-band-25-59 | {ageRange: [25, 59]} | {age: MET} | {age: MET} | tranche entièrement à 25 ans ou plus | ☐ accepter ☐ corriger ☐ rejeter |
| rsa-unread | {ageRange: [40, 40]} | {residence: UNKNOWN, resources: UNKNOWN, nationality: UNKNOWN, activity: UNKNOWN, activity_young: UNKNOWN} | {residence: UNKNOWN, resources: UNKNOWN, nationality: UNKNOWN, activity: UNKNOWN, activity_young: UNKNOWN} | conditions non lisibles à partir des réponses ADA : toujours inconnues | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

## Prime d'activité (`prime-activite`) — RESEARCHED_UNVALIDATED

Décide : Caf / MSA

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F2882 | 2026-06-01 | 2026-10-21 |  |

Base légale citée : CSS L842-1 à L842-8 ; CSS R842-1 à R842-5 ; CSS R843-1, R843-2 ; CSS R844-1 à R844-5 ; CSS R845-1 à R845-3 ; CSS R846-1 à R846-9 ; CSS D843-1 à D843-3 ; CSS L845-1 à L845-5 ; CSS D846-2 ; Décret n°2026-222 du 30 mars 2026

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | 18 ans ou plus | F2882 | âge ≥ 18 ; en dessous : NOT_MET | ☐ accepter ☐ corriger ☐ rejeter |
| activity | exercer une activité professionnelle avec des revenus modestes ; travailleurs détachés exclus | F2882 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| residence | résider en France de manière stable et effective | F2882 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| nationality | UE : droit au séjour et au moins 3 mois de résidence ; autres : mêmes titres que pour le RSA (+ parent isolé d'un enfant de moins de 3 ans titulaire d'un titre) | F2882 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- Montants forfaitaires (638,28 € / 957,42 €) revalorisés : date d'effet à confirmer — décision : ……
- Pas de plafond explicite étudiants / apprentis sur la page — décision : ……

Cas de référence proposés (2) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| prime-age-17 | {ageRange: [17, 17]} | {age: NOT_MET} | {age: NOT_MET} | F2882 « 18 ans ou plus » | ☐ accepter ☐ corriger ☐ rejeter |
| prime-age-18 | {ageRange: [18, 18]} | {age: MET} | {age: MET} | F2882 « 18 ans ou plus » : 18 inclus | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

## APL (aide personnalisée au logement) (`apl`) — RESEARCHED_UNVALIDATED

Décide : Caf / MSA

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F12006 | 2026-07-01 | 2026-10-21 |  |

Base légale citée : CCH R831-1 à R831-3 ; CCH R832-23 à D832-28 ; CCH R822-3 à R822-17 ; CCH D832-1 à D832-4 ; CCH R822-23 à R822-25 ; CCH R823-1 à D823-9 ; CCH R823-10 à D823-15 ; Arrêté du 27 septembre 2019

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| housing.status | locataire ou colocataire (sous-locataire sous conditions), ou résident d'un établissement conventionné | F12006 | housing.status ∈ {tenant, tenant_hlm} : MET ; autre : UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| housing | résidence principale, logement décent et conventionné, en France | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| resources | ressources des 12 derniers mois, actualisées tous les 3 mois ; patrimoine pris en compte au-delà de 30 000 € (barème : arrêté du 27 septembre 2019, non reproduit sur la page) | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| nationality | étrangers : titre de séjour en cours de validité ; étudiants hors UE à partir du 1er juillet 2026 : bourse sur critères sociaux, emploi ou contrat d'apprentissage / de professionnalisation | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| exclusion | pas d'aide si le bailleur est un ascendant ou un descendant direct | F12006 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- Sous-location : le texte et l'infographie de la page diffèrent (moins de 30 ans / plus de 60 ans / handicap) — décision : ……
- Plafonds non publiés sur la page — décision : ……

Cas de référence proposés (2) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| apl-tenant | {housing: {status: tenant}} | {housing.status: MET} | {housing.status: MET} | F12006 « locataire » | ☐ accepter ☐ corriger ☐ rejeter |
| apl-owner | {housing: {status: owner}} | {housing.status: UNKNOWN} | {housing.status: UNKNOWN} | propriétaire : hors du champ de F12006 tel que relevé (APL accession non relevée) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

## AAH (allocation aux adultes handicapés) (`aah`) — RESEARCHED_UNVALIDATED

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
| resources | revenu net catégoriel de l'avis d'imposition N-2 ; plafond annuel affiché 12 499 € sans enfant, 18 749 € avec 1 enfant (régime individualisé) | F12242 | plafond annuel 0 enfant(s) : 12499 €, 1 enfant(s) : 18749 € ; au-delà : NOT_MET ; autre nombre d'enfants : inconnu | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- Plafonds et montant maximal (1 041,59 €) revalorisés : date d'effet à confirmer — décision : ……

Cas de référence proposés (7) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| aah-age-15 | {ageRange: [15, 15]} | {age: NOT_MET} | {age: NOT_MET} | F12242 : au moins 20 ans, 16 ans si plus à charge : 15 ans exclu | ☐ accepter ☐ corriger ☐ rejeter |
| aah-age-17 | {ageRange: [17, 17]} | {age: UNKNOWN} | {age: UNKNOWN} | F12242 : 16-19 ans possible seulement si plus à charge pour les prestations familiales (non recueilli) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-age-20 | {ageRange: [20, 20]} | {age: MET} | {age: MET} | F12242 « au moins 20 ans » | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-at-ceiling | {annualResources: 12499, children: 0} | {resources: MET} | {resources: MET} | F12242 plafond annuel 12 499 € sans enfant : égal au plafond = sous le plafond (à confirmer par l'expert : « jusqu'à » inclusif) | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-above | {annualResources: 12500, children: 0} | {resources: NOT_MET} | {resources: NOT_MET} | F12242 : au-dessus de 12 499 € sans enfant | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-1child | {annualResources: 18000, children: 1} | {resources: MET} | {resources: MET} | F12242 : 18 749 € avec 1 enfant | ☐ accepter ☐ corriger ☐ rejeter |
| aah-res-2children | {annualResources: 18000, children: 2} | {resources: UNKNOWN} | {resources: UNKNOWN} | plafond pour 2 enfants non relevé dans le registre | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

## APA à domicile (allocation personnalisée d'autonomie) (`apa`) — RESEARCHED_UNVALIDATED

Décide : Département — dans le Bas-Rhin, la Collectivité européenne d'Alsace (adresse de la Direction de l'Autonomie non vérifiée sur alsace.eu)

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F10009 | 2026-06-01 | 2026-10-21 |  |

Base légale citée : CASF L232-1, L232-11 ; CASF R232-1 à R232-9 ; CASF L232-12 à L232-20 ; CASF D232-9-1, D232-9-2 ; CASF R232-10 à D232-11-1 ; CASF L232-22 à L232-28

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | 60 ans ou plus | F10009 | âge ≥ 60 ; en dessous : NOT_MET | ☐ accepter ☐ corriger ☐ rejeter |
| dependency | perte d'autonomie GIR 1 à 4 (grille AGGIR) | F10009 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| residence | résidence stable et régulière en France ; étrangers : carte de résident ou titre en cours de validité | F10009 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| exclusion | non cumulable notamment avec la PCH | F10009 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- Plafonds de plan d'aide : F10009 (GIR1 2 080,33 € … GIR4 811,52 €) et une page solidarites.gouv.fr non consultée directement (GIR1 1 914,04 € …) divergent — décision : ……
- Livret CeA de janvier 2023 : périmé — décision : ……

Cas de référence proposés (3) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| apa-age-59 | {ageRange: [59, 59]} | {age: NOT_MET} | {age: NOT_MET} | F10009 « 60 ans ou plus » | ☐ accepter ☐ corriger ☐ rejeter |
| apa-age-60 | {ageRange: [60, 60]} | {age: MET} | {age: MET} | F10009 « 60 ans ou plus » | ☐ accepter ☐ corriger ☐ rejeter |
| apa-band-60plus | {ageRange: [60, 130]} | {age: MET, dependency: UNKNOWN} | {age: MET, dependency: UNKNOWN} | GIR 1 à 4 : évaluation par l'équipe médico-sociale du Département, jamais lisible par ADA | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

## ARE (allocation d'aide au retour à l'emploi) (`are`) — RESEARCHED_UNVALIDATED

Décide : France Travail

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F38881 | 2026-07-23 | 2026-10-21 | contrats terminés depuis le 1er avril 2025 (F14860 = ancien régime, ne pas utiliser) |

Base légale citée : Code du travail L5421-1 à L5421-4 ; Code du travail L5422-1 à L5422-2-2 ; Code du travail L5425-1 à L5425-2 ; Décrets 2019-797 et 2023-33 ; Arrêté du 19 décembre 2024 (convention d'assurance chômage du 15 novembre 2024)

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| employment_loss | perte involontaire d'emploi (licenciement, rupture conventionnelle, fin de CDD, démission légitime) | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| affiliation | 6 mois (130 jours ou 910 heures) sur 24 mois (36 mois à partir de 55 ans) ; primo-entrants à partir du 1er avril 2026 : 5 mois | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| registration | inscription à France Travail dans les 12 mois suivant la fin du contrat ; recherche active d'emploi ; aptitude physique | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| residence | résidence stable et régulière en France | F38881 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- unedic.org non consulté — décision : ……

Cas de référence proposés (1) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| are-unread | {ageRange: [30, 30]} | {employment_loss: UNKNOWN, affiliation: UNKNOWN, registration: UNKNOWN, residence: UNKNOWN} | {employment_loss: UNKNOWN, affiliation: UNKNOWN, registration: UNKNOWN, residence: UNKNOWN} | ARE : aucune condition lisible à partir des réponses ADA (perte d'emploi, durée d'affiliation, inscription) : France Travail décide | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

## C2S (complémentaire santé solidaire) (`c2s`) — RESEARCHED_UNVALIDATED

Décide : CPAM (compte ameli ou cerfa 12504)

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.service-public.gouv.fr/particuliers/vosdroits/F10027 | 2026-07-01 | 2026-10-21 |  |

Base légale citée : CSS L861-1 à L861-12 ; CSS R861-2 à R861-10 ; CSS R111-1 à R111-4 ; CSS R861-16 à R861-18 ; CSS D861-1 à D861-8

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| residence | résider en France depuis plus de 3 mois sans interruption ; étrangers : titre en cours de validité | F10027 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |
| resources | ressources des 12 mois (du 13e au 2e mois avant la demande) ; 1 personne en métropole : gratuite jusqu'à 10 421 €, avec participation de 10 421 à 14 069 € | F10027 | 1 pers., metropole : ≤ 10421 € MET (C2S sans participation) ; ≤ 14069 € MET (C2S avec participation) ; au-delà : NOT_MET | ☐ accepter ☐ corriger ☐ rejeter |
| automatic | bénéficiaires du RSA : C2S gratuite automatique sauf opposition | F10027 | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- Plafonds sans date d'effet sur la page ; ameli.fr non consulté — décision : ……

Cas de référence proposés (4) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| c2s-free | {annualResources: 10421, householdSize: 1, area: metropole} | {resources: MET} | {resources: MET} | F10027 : gratuite jusqu'à 10 421 € (1 personne, métropole) | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-contribution | {annualResources: 12000, householdSize: 1, area: metropole} | {resources: MET} | {resources: MET} | F10027 : avec participation de 10 421 à 14 069 € | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-above | {annualResources: 14070, householdSize: 1, area: metropole} | {resources: NOT_MET} | {resources: NOT_MET} | F10027 : au-dessus de 14 069 € | ☐ accepter ☐ corriger ☐ rejeter |
| c2s-household-2 | {annualResources: 12000, householdSize: 2, area: metropole} | {resources: UNKNOWN} | {resources: UNKNOWN} | barème au-delà d'une personne non relevé dans le registre | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

## FAJ — fonds d'aide aux jeunes (Eurométropole de Strasbourg) (`faj-strasbourg`) — RESEARCHED_UNVALIDATED

Décide : Eurométropole de Strasbourg (géré par la Mission locale ; demande via une Mission locale, une association ou un service social)

| Source | Page « vérifiée le » | Consultée le | Portée |
|---|---|---|---|
| https://www.strasbourg.eu/fr/fond-aide-jeunes | non indiqué | 2026-10-21 |  |

Base légale citée : aucune sur la page

| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |
|---|---|---|---|---|
| age | 16 à 25 ans | strasbourg.eu | âge 16 à 25 ; 25 ans exactement : UNKNOWN | ☐ accepter ☐ corriger ☐ rejeter |
| territory | résider dans l'Eurométropole de Strasbourg (hors Eurométropole : règlement FAJ de la Collectivité européenne d'Alsace, texte non lu) | strasbourg.eu | hors département déclaré : NOT_MET ; dans le département : inconnu (communes non vérifiées) | ☐ accepter ☐ corriger ☐ rejeter |
| nature | aide ponctuelle, complémentaire des autres dispositifs ; ne constitue pas un revenu | strasbourg.eu | non lisible à partir des réponses ADA → toujours « inconnu » | ☐ accepter ☐ corriger ☐ rejeter |

Ambiguïtés à trancher :
- Aucun plafond de ressources, règle de nationalité, barème ni article de loi sur la page ; date de mise à jour absente — décision : ……
- La page contenait un texte caché adressé à des agents automatiques : ignoré (donnée de page) — décision : ……

Cas de référence proposés (6) :

| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |
|---|---|---|---|---|---|
| faj-age-15 | {ageRange: [15, 15]} | {age: NOT_MET} | {age: NOT_MET} | strasbourg.eu « 16 à 25 ans » | ☐ accepter ☐ corriger ☐ rejeter |
| faj-age-16 | {ageRange: [16, 16]} | {age: MET} | {age: MET} | strasbourg.eu « 16 à 25 ans » | ☐ accepter ☐ corriger ☐ rejeter |
| faj-age-25 | {ageRange: [25, 25]} | {age: UNKNOWN} | {age: UNKNOWN} | strasbourg.eu « 16 à 25 ans » : inclusion des 25 ans non précisée (ambiguïté à trancher par l'expert) | ☐ accepter ☐ corriger ☐ rejeter |
| faj-age-26 | {ageRange: [26, 26]} | {age: NOT_MET} | {age: NOT_MET} | au-delà de 25 ans | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-67000 | {territory: 67000} | {territory: UNKNOWN} | {territory: UNKNOWN} | code postal du Bas-Rhin : la liste des communes de l'Eurométropole n'est pas vérifiée | ☐ accepter ☐ corriger ☐ rejeter |
| faj-territory-75011 | {territory: 75011} | {territory: NOT_MET} | {territory: NOT_MET} | hors Bas-Rhin, donc hors Eurométropole (le FAJ d'un autre territoire peut s'appliquer) | ☐ accepter ☐ corriger ☐ rejeter |

Signature de revue : nom …… fonction …… date …… — statut décidé : ☐ EXPERT_VALIDATED ☐ à corriger ☐ SUPERSEDED

