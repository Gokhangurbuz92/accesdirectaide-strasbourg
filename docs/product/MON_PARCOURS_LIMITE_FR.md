# Mon Parcours — version limitée (G14) : liste positive des types d'étapes

> **APPROUVÉE — décision du responsable du traitement du 22/11/2026 (« G14 toplu onay », point 2).** Source de vérité : `data/reference/parcours-step-types.v1.json` (version `1.0.0`). Ce document en est la lecture humaine ; en cas d'écart, le fichier fait foi et les tests (`tests/unit/g14-parcours-limited.test.js`) échouent.

Contexte : analyse documentaire du responsable du 22/11/2026 (`CONTROL/master/completion/G8_MON_PARCOURS_ANALYSE_DOCUMENTAIRE_PROPRIETAIRE_2026-11-22.md`, non signée par un avocat) — Q2 : pas de titre ni d'organisme libres, liste positive d'étapes neutres, contrôle serveur ; Q10 : exclure les groupes A (art. 9), B (art. 10) et C (protection renforcée).

## Règles appliquées par le serveur

- Aucun intitulé libre : l'étape est un code de cette liste ; son intitulé est celui de la liste.
- Aucun type ne nomme ni ne laisse déduire une donnée de santé, de handicap, d'addiction, de vie sexuelle (groupe A, RGPD art. 9), une infraction ou une procédure pénale (groupe B, art. 10), ni une situation à protection renforcée (groupe C : droit au séjour, violences, aide sociale à l'enfance, protection juridique des majeurs, précarité extrême, hébergement d'urgence, certaines informations familiales).
- Organisme : seulement l'identifiant d'une Structure publiée dont le type figure dans structureKinds ET dans les structureKinds du type d'étape (jamais de texte libre).
- Échéance : une date ; sa source est obligatoirement l'une des fiches officielles du type d'étape.
- Ajouter, retirer ou renommer un type = nouvelle version de ce fichier, relue et approuvée (registre, AIPD), tests mis à jour.

Sources des fiches : DILA — fiches Service-Public « vosdroits » (Licence Ouverte 2.0), archive du Sun, 22 Nov 2026 01:54:09 GMT (sha256 `d4c162dec98473142446a034d5f2facbccf5b1204aa2334883cca4cae5f4dede`), lue le 2026-11-22. Les intitulés de fiche et dates de modification ci-dessous sont ceux de l'archive DILA ; aucune condition, aucun montant n'est repris : une étape n'affirme aucun droit.

## Les 28 types d'étapes

| # | Code | Intitulé (fr, canonique) | Domaine | Fiches officielles (Service-Public) | Lieux possibles (types de Structure) |
|---|---|---|---|---|---|
| 1 | `LOGEMENT_SOCIAL_DEMANDE` | Faire une demande de logement social | Logement | [F10007](https://www.service-public.gouv.fr/particuliers/vosdroits/F10007) Faire une demande de logement social (HLM) (modifiée 2026-09-11) | Mairie, CCAS, Maison des solidarités, Espace France Services |
| 2 | `LOGEMENT_SOCIAL_RENOUVELLEMENT` | Renouveler sa demande de logement social | Logement | [F10007](https://www.service-public.gouv.fr/particuliers/vosdroits/F10007) Faire une demande de logement social (HLM) (modifiée 2026-09-11) | Mairie, CCAS, Maison des solidarités, Espace France Services |
| 3 | `AIDE_LOGEMENT_DEMANDE` | Déposer un dossier d'aide au logement (APL, ALF, ALS) | Logement | [F12006](https://www.service-public.gouv.fr/particuliers/vosdroits/F12006) Aide personnalisée au logement (APL) (modifiée 2026-07-01)<br>[F13132](https://www.service-public.gouv.fr/particuliers/vosdroits/F13132) Allocation de logement familiale (ALF) (modifiée 2026-07-01)<br>[F1280](https://www.service-public.gouv.fr/particuliers/vosdroits/F1280) Allocation de logement sociale (ALS) (modifiée 2026-07-01) | Caf, Espace France Services, CCAS, Maison des solidarités |
| 4 | `FSL_DEMANDE` | Demander une aide du Fonds de solidarité pour le logement (FSL) | Logement | [F1334](https://www.service-public.gouv.fr/particuliers/vosdroits/F1334) Quelle aide apporte le Fonds de solidarité pour le logement (FSL) ? (modifiée 2025-12-12) | Maison des solidarités, CCAS, Espace France Services |
| 5 | `VISALE_DEMANDE` | Demander la garantie Visale | Logement | [F33453](https://www.service-public.gouv.fr/particuliers/vosdroits/F33453) Garantie Visale : caution pour le locataire (impayés et dégradations) (modifiée 2026-01-23) | Espace France Services |
| 6 | `CHEQUE_ENERGIE_UTILISER` | Utiliser son chèque énergie | Logement | [F33667](https://www.service-public.gouv.fr/particuliers/vosdroits/F33667) Chèque énergie (modifiée 2025-10-17) | CCAS, Espace France Services, Maison des solidarités |
| 7 | `RSA_DEMANDE` | Demander le RSA | Ressources | [N19775](https://www.service-public.gouv.fr/particuliers/vosdroits/N19775) Revenu de solidarité active (RSA) (modifiée 2025-07-10)<br>[F19778](https://www.service-public.gouv.fr/particuliers/vosdroits/F19778) RSA : demandeur de 25 ans et plus (modifiée 2026-04-01) | Caf, Maison des solidarités, CCAS, Espace France Services |
| 8 | `PRIME_ACTIVITE_DEMANDE` | Demander la prime d'activité | Ressources | [N31477](https://www.service-public.gouv.fr/particuliers/vosdroits/N31477) Prime d'activité (modifiée 2022-08-05)<br>[F2882](https://www.service-public.gouv.fr/particuliers/vosdroits/F2882) Prime d'activité : salarié ou fonctionnaire (modifiée 2026-06-01) | Caf, Espace France Services |
| 9 | `DECLARATION_TRIMESTRIELLE_RESSOURCES` | Faire sa déclaration trimestrielle de ressources (RSA, prime d'activité) | Ressources | [F19778](https://www.service-public.gouv.fr/particuliers/vosdroits/F19778) RSA : demandeur de 25 ans et plus (modifiée 2026-04-01)<br>[F2882](https://www.service-public.gouv.fr/particuliers/vosdroits/F2882) Prime d'activité : salarié ou fonctionnaire (modifiée 2026-06-01) | Caf, Espace France Services |
| 10 | `ALLOCATIONS_FAMILIALES_DEMANDE` | Demander les allocations familiales | Famille | [F13213](https://www.service-public.gouv.fr/particuliers/vosdroits/F13213) Allocations familiales (famille de 2 enfants ou plus) (modifiée 2026-06-01) | Caf, Espace France Services |
| 11 | `ALLOCATION_RENTREE_SCOLAIRE` | Vérifier l'allocation de rentrée scolaire (ARS) | Famille | [F1878](https://www.service-public.gouv.fr/particuliers/vosdroits/F1878) Allocation de rentrée scolaire (ARS) (modifiée 2026-08-04) | Caf, Espace France Services |
| 12 | `ASPA_DEMANDE` | Demander l'allocation de solidarité aux personnes âgées (Aspa) | Ressources | [F16871](https://www.service-public.gouv.fr/particuliers/vosdroits/F16871) Allocation de solidarité aux personnes âgées (Aspa) (modifiée 2026-06-23) | Espace France Services, CCAS |
| 13 | `FRANCE_TRAVAIL_INSCRIPTION` | S'inscrire à France Travail | Emploi | [F1636](https://www.service-public.gouv.fr/particuliers/vosdroits/F1636) Chômage : inscription à France Travail (anciennement Pôle emploi) (modifiée 2025-10-10) | France Travail, Espace France Services, Mission locale |
| 14 | `FRANCE_TRAVAIL_ACTUALISATION` | Faire son actualisation mensuelle France Travail | Emploi | [F1637](https://www.service-public.gouv.fr/particuliers/vosdroits/F1637) Actualisation mensuelle France Travail (anciennement Pôle emploi) (modifiée 2026-01-01) | France Travail, Espace France Services |
| 15 | `FRANCE_TRAVAIL_RENDEZ_VOUS` | Prendre rendez-vous à France Travail | Emploi | [N549](https://www.service-public.gouv.fr/particuliers/vosdroits/N549) Chômage : démarches auprès de France Travail (anciennement Pôle emploi) (modifiée 2025-01-16) | France Travail, Espace France Services |
| 16 | `ATTESTATION_EMPLOYEUR` | Obtenir son attestation employeur | Emploi | [F2867](https://www.service-public.gouv.fr/particuliers/vosdroits/F2867) Attestation employeur destinée à France Travail (anciennement Pôle emploi) (modifiée 2026-06-12) | France Travail, Espace France Services |
| 17 | `CONTRAT_ENGAGEMENT_JEUNE` | Demander un contrat d'engagement jeune | Emploi | [F32700](https://www.service-public.gouv.fr/particuliers/vosdroits/F32700) Contrat d'engagement jeune (accompagnement pour trouver un travail) (modifiée 2026-04-01) | Mission locale, France Travail |
| 18 | `SURENDETTEMENT_DOSSIER` | Déposer un dossier de surendettement | Budget | [F134](https://www.service-public.gouv.fr/particuliers/vosdroits/F134) Déposer un dossier de surendettement devant la commission de surendettement (modifiée 2025-01-07) | Espace France Services, Maison des solidarités, CCAS |
| 19 | `MICROCREDIT_DEMANDE` | Demander un microcrédit personnel | Budget | [F21375](https://www.service-public.gouv.fr/particuliers/vosdroits/F21375) Microcrédit personnel (modifiée 2026-04-10) | CCAS, Maison des solidarités, Espace France Services |
| 20 | `CARTE_IDENTITE_DEMANDE` | Demander une carte d'identité | Papiers | [N358](https://www.service-public.gouv.fr/particuliers/vosdroits/N358) Carte d'identité (modifiée 2026-04-09) | Mairie, Espace France Services |
| 21 | `PASSEPORT_DEMANDE` | Demander un passeport | Papiers | [N360](https://www.service-public.gouv.fr/particuliers/vosdroits/N360) Passeport (modifiée 2026-04-09) | Mairie, Espace France Services |
| 22 | `ACTE_NAISSANCE_DEMANDE` | Demander un acte de naissance | Papiers | [F1427](https://www.service-public.gouv.fr/particuliers/vosdroits/F1427) Acte de naissance : demande de copie intégrale ou d'extrait (modifiée 2026-08-14) | Mairie, Espace France Services |
| 23 | `BOURSE_COLLEGE_DEMANDE` | Demander une bourse de collège | Scolarité et jeunesse | [F984](https://www.service-public.gouv.fr/particuliers/vosdroits/F984) Bourse de collège (modifiée 2026-04-30) | CIO, Espace France Services |
| 24 | `BOURSE_LYCEE_DEMANDE` | Demander une bourse de lycée | Scolarité et jeunesse | [F616](https://www.service-public.gouv.fr/particuliers/vosdroits/F616) Bourse de lycée (modifiée 2026-04-30) | CIO, Espace France Services |
| 25 | `CANTINE_AIDE_DEMANDE` | Demander une aide pour la cantine scolaire | Scolarité et jeunesse | [F19294](https://www.service-public.gouv.fr/particuliers/vosdroits/F19294) Peut-on obtenir une aide financière pour la cantine scolaire ? (modifiée 2025-10-20) | Mairie, CCAS |
| 26 | `PASS_CULTURE` | Activer le pass Culture | Scolarité et jeunesse | [F34959](https://www.service-public.gouv.fr/particuliers/vosdroits/F34959) À quoi sert le pass Culture et comment en bénéficier ? (modifiée 2025-12-18) | Information jeunesse, Mission locale |
| 27 | `RETRAITE_DEMANDE` | Demander sa retraite | Retraite | [F13941](https://www.service-public.gouv.fr/particuliers/vosdroits/F13941) Comment faire sa demande de retraite lorsqu'on est salarié ? (modifiée 2025-09-01)<br>[F31541](https://www.service-public.gouv.fr/particuliers/vosdroits/F31541) Comment faire sa demande de retraite lorsqu'on est agent public ? (modifiée 2026-01-01) | Espace France Services |
| 28 | `RECOURS_ADMINISTRATIF` | Contester une décision par un recours administratif | Contester une décision | [F2474](https://www.service-public.gouv.fr/particuliers/vosdroits/F2474) Recours gracieux, recours hiérarchique et recours administratif préalable obligatoire (Rapo) (modifiée 2026-05-11) | Espace France Services |

## Types de lieux (Structure.type_structure acceptés, valeur exacte)

| Clé | Libellé | Valeurs `type_structure` |
|---|---|---|
| `mairie` | Mairie | Mairie |
| `ccas` | CCAS | CCAS (centre communal d'action sociale) ; CCAS |
| `france_services` | Espace France Services | Espace France Services |
| `maison_solidarites` | Maison des solidarités | Maison des solidarités (Espace Solidarités) |
| `mission_locale` | Mission locale | Mission locale (jeunes de 16 à 25 ans) ; Mission Locale |
| `france_travail` | France Travail | France Travail |
| `caf` | Caf | Caf (Caisse d'allocations familiales) ; CAF |
| `cio` | CIO | CIO (centre d'information et d'orientation) |
| `information_jeunesse` | Information jeunesse | Information jeunesse |

Tout autre type de lieu (association, centre de santé, CSAPA, CMP, MDPH, CADA, CHRS, résidence sociale, point-justice, sous-préfecture, mandataire judiciaire, PMI, CIDFF, EVARS, CPAM, « Service public », « Organisme »…) est refusé, même publié. Un lieu d'un type accepté dont le **nom** déclenche le filtre de mots sensibles (G8) est refusé aussi.

## Exclus de la liste (par groupe)

| Groupe | Thème | Exemples | Motif |
|---|---|---|---|
| A | Santé, handicap, perte d'autonomie, addiction, grossesse, vie sexuelle | AAH, PCH, AEEH, MDPH, Apa, prime à la naissance (Paje), consultations, CSAPA, centres de santé | donnée de santé ou relative à la vie sexuelle (RGPD art. 9) |
| A | Complémentaire santé solidaire, AME | C2S (faux positif possible : couverture, non donnée de santé) ; AME (aussi groupe C) | écarté de la première ouverture par prudence (analyse documentaire du responsable, Q10) |
| B | Infractions, condamnations, procédures pénales | SPIP, PJJ, aide juridictionnelle (peut révéler une procédure pénale), point-justice | RGPD art. 10 ; le consentement ne suffit pas |
| C | Droit au séjour, asile, naturalisation | titres de séjour, CADA, OFII, sous-préfecture | protection renforcée |
| C | Violences subies | violences conjugales ou intrafamiliales, ordonnance de protection, CIDFF | protection renforcée |
| C | Aide sociale à l'enfance, protection de l'enfance | ASE, PMI, centre parental | protection renforcée |
| C | Protection juridique des majeurs | tutelle, curatelle, mandataire judiciaire | protection renforcée |
| C | Précarité extrême, hébergement d'urgence | domiciliation (sans domicile stable), 115, CHRS, Dalo, résidence sociale, pension de famille, LHSS | protection renforcée |
| C | Certaines informations familiales | allocation de soutien familial (enfant non reconnu, orphelin, séparation), pension de réversion (décès), adoption | protection renforcée |

Choix approuvés avec la liste (22/11/2026) : le surendettement (`SURENDETTEMENT_DOSSIER`) et le microcrédit sont gardés (difficulté financière, ni art. 9 ni art. 10, ni « précarité extrême ») ; la C2S est écartée bien qu'elle soit un faux positif possible (Q10) ; la domiciliation et le Dalo sont écartés (groupe C : précarité extrême / hébergement).

## Révélation indirecte : ce qui est contrôlé

- **Code** : un code de la liste, rien d'autre (`api/lib/parcours-limited.js`, `api/lib/parcours-step-types.js`).
- **Lieu** : identifiant d'une Structure publiée, d'un type autorisé pour CE type d'étape (ex. « Demander le RSA » : Caf, Maison des solidarités, CCAS, France Services ; jamais une mairie), nom contrôlé.
- **Échéance** : une date ; la source est l'une des fiches du type (jamais une adresse libre : une adresse peut désigner une fiche « AAH »).
- **Combinaisons** : le test `tests/unit/g14-parcours-limited.test.js` parcourt toutes les combinaisons type × type de lieu × fiche et vérifie qu'aucune ne déclenche le filtre ; l'intégration (`tests/integration/g14-parcours-limited-db.test.js`) vérifie qu'un lieu sensible, masqué, d'un autre type ou au nom révélateur reçoit le même refus 422.
- **Aucun autre champ** : `title`, `records`, `planStep`, `sensitiveConsent`, `note` (tant que les notes sont fermées), toute métadonnée → 400 `FIELD_NOT_ALLOWED` avant tout accès à la base ; le message nomme le champ, jamais sa valeur.

## Modifier la liste

Nouvelle version du fichier JSON (nouveau `version`), relue par le responsable, avec mise à jour : registre (ligne T28), addendum d'AIPD, traductions (`src/i18n/locales/*/compte.json`, clés `parcours.type.<CODE>` ajoutées en fin de fichier), tests. Le serveur refuse de démarrer la liste si une entrée est mal formée ou si un intitulé déclenche le filtre de mots sensibles (fail-closed).
