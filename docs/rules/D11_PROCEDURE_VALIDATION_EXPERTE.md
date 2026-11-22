# Validation experte des règles de droits — procédure (D11 → D20 → P13)

**Statut au 31/10/2026 : aucune règle n'est validée.** Le diagnostic public reste une pré-orientation : chaque résultat dit « à faire vérifier » et
nomme l'organisme qui décide. Ce document explique à la personne experte ce qu'on lui demande, et ce que sa relecture change ou ne change pas dans le site.

## 1. Ce qu'il faut relire

| Document | Contenu |
|---|---|
| `docs/rules/D11_EXPERT_REVIEW_PACK.md` | pour chaque droit : sources officielles et leur date, base légale citée, conditions relevées, lecture automatique proposée, ambiguïtés, cas de référence proposés |
| `docs/rules/D11_REVIEW_FORM.csv` | le formulaire à remplir : une ligne par condition, par ambiguïté et par cas (107 lignes depuis le 22/11/2026 : 33 conditions, 13 ambiguïtés, 61 cas) |

Les huit pages Service-Public citées ont été relues le 31/10/2026 (`scripts/d11-source-check.mjs`) : leur date « Vérifié le » n'a pas changé depuis le
relevé du registre. La page du FAJ (strasbourg.eu) ne porte pas de date. À relancer juste avant la relecture.
Contrôle de sources du 18/11/2026 (FA-D6, `sourceCheck` de chaque droit dans `data/rules/rights-rules.v1.json`) : les neuf pages relues en direct et
dans l'archive DILA du 17/11/2026, la base légale relue dans le jeu LEGI ; résultat `SOURCE_CHECKED` (contrôle indépendant, pas une validation) et statut
de relecture `EXPERT_REVIEW_PENDING` : une personne experte nommée reste nécessaire.

| Droit | Qui décide | Source (date de la page) | Lu à partir des réponses | Jamais lisible par le site (toujours « à vérifier ») | Ambiguïtés | Cas proposés |
|---|---|---|---|---|---|---|
| RSA | Caf / MSA ; département | F19778, F286 (01/04/2026) | âge | résidence, ressources, nationalité, activité, activité des moins de 25 ans | 2 | 6 |
| Prime d'activité | Caf / MSA | F2882 (01/06/2026) | âge | activité, résidence, nationalité | 2 | 3 |
| APL | Caf / MSA | F12006 (01/07/2026) | statut d'occupation | logement, ressources, nationalité, exclusions | 2 | 3 |
| AAH | CDAPH (MDPH) ; versement Caf / MSA | F12242 (14/09/2026) | âge, ressources | handicap, résidence | 1 | 8 |
| APA à domicile | Collectivité européenne d'Alsace | F10009 (01/06/2026) | âge | perte d'autonomie, résidence, exclusions | 2 | 4 |
| ARE | France Travail | F38881 (23/07/2026) | — | perte d'emploi, affiliation, inscription, résidence | 1 | 1 |
| C2S | CPAM | F10027 (01/07/2026) | ressources | résidence, attribution automatique | 1 | 5 |
| FAJ (Eurométropole) | Eurométropole, via la Mission locale | strasbourg.eu (non datée) | âge, territoire | nature de la demande | 2 | 9 |

## 2. Comment remplir le formulaire

- Colonnes `reviewer_name`, `reviewer_role`, `review_date` (AAAA-MM-JJ) : les mêmes sur toutes les lignes d'un droit (une relecture = une personne, une date).
- Condition : `ACCEPT` (la condition et sa lecture automatique sont justes), `CORRECT` (dire quoi dans `correction_or_decision`), `REJECT`.
- Ambiguïté : `DECIDED`, avec la décision écrite dans `correction_or_decision`.
- Cas de référence : `ACCEPT`, `CORRECT` (écrire le résultat attendu corrigé, par exemple `{"age":"MET"}`) ou `REJECT`.
- Un droit peut être relu sans les autres.

## 3. Ce que la relecture déclenche (et rien d'autre)

`node scripts/d11-review.mjs apply <formulaire rempli.csv>` dit, droit par droit, ce que le formulaire permet ; avec `--write`, il l'inscrit dans le
registre. Un droit n'est validé que si :
- toutes ses conditions sont acceptées telles quelles ;
- toutes ses ambiguïtés sont tranchées ;
- au moins un cas de référence est accepté ;
- chaque cas accepté donne le résultat attendu avec la lecture du registre.
Une seule correction suffit pour qu'il reste non validé : le registre est d'abord corrigé, puis un nouveau formulaire est rempli. Le site vérifie lui-même ces conditions à chaque diagnostic (`api/lib/validatedRules.js`) : si une condition est modifiée plus tard et qu'un cas accepté ne passe plus, la règle cesse de s'appliquer.

Pour un droit validé, le résultat du diagnostic :
- reste « Piste à vérifier » ou « À faire vérifier », jamais « éligible » ni « non applicable » ;
- ne donne jamais de montant ;
- dit désormais quelle règle relue a été utilisée (« relue par [fonction] le [date] ») et quelle page officielle l'appuie, avec sa date ;
- dit quelles conditions les réponses remplissent, ne remplissent pas ou ne permettent pas de vérifier ;
- continue de nommer l'organisme qui décide.

## 4. Cas qui demandent toujours la confirmation de l'organisme

Toutes les conditions de la colonne « jamais lisible » du tableau : le site ne pose pas ces questions, ou ne peut pas les vérifier (titre de séjour,
reconnaissance du handicap, perte d'autonomie, affiliation, ressources détaillées). Aucune relecture ne les rend automatiques ; elles restent « à vérifier »
dans chaque résultat.

## 5. Ce qui reste hors de cette procédure

- Les montants et barèmes (non affichés tant qu'aucun moteur officiel n'est branché, D10).
- La mention d'information du diagnostic : relecture juridique (P13, mention légale).

## 6. Corrections du 22/11/2026 (G14) et avis IA

- Un avis documentaire assisté par IA (85 lignes, `AI_ONLY_UNVERIFIED_BY_HUMAN`) a servi d'**entrée technique** : chaque correction n'a été faite qu'après
  relecture, le même jour, de la source officielle (Service-Public, Légifrance, solidarites.gouv.fr, ameli.fr, Unédic, strasbourg.eu), consignée dans
  `sourceRecheck` de chaque droit. Cet avis **n'est pas une relecture d'expert** : il ne remplit pas le formulaire et ne valide aucun droit.
- `scripts/d11-review.mjs apply` refuse tout formulaire dont un relecteur est une IA ou un système, ou qui porte des colonnes d'avis IA (`ai_review_status`,
  `ai_confidence`…) : sortie 3, rien n'est écrit. Le site refuse de même une règle dont la relecture nomme une IA (`NON_HUMAN_REVIEWER`).
- Les montants (plafonds AAH, C2S) ne sont lus que dans la période que la source date (« au 1er avril 2026 ») et sur la base de ressources qu'elle nomme ;
  hors de cette période ou sur une autre base : « inconnu ». Les montants sans date dans la source (APA, prime d'activité étudiants) restent du texte.
- Le texte caché adressé à des agents automatiques (page FAJ) n'est plus une ambiguïté juridique : c'est un contrôle de sécurité de l'ingestion
  (`ingestionSecurityNotes`, quarantaine dans `api/_services/verification/pages.js`).
- Le formulaire a été régénéré ; un formulaire rempli sur l'ancienne version (85 lignes) doit être refait.

## 7. Approbation par le responsable du traitement (décision du propriétaire du 22/11/2026)

- Statut distinct **`OWNER_VALIDATED`** : « relu et approuvé par le responsable du traitement, sur la base d'une analyse documentaire assistée par IA ; pas
  une validation d'expert indépendant ». Il n'est **jamais** `EXPERT_VALIDATED`.
- Il n'est inscrit que par `node scripts/d11-review.mjs apply <formulaire> --write`, quand toutes les lignes d'un droit portent `validation_kind=owner`
  et le nom, la fonction et la date d'une personne réelle (la règle du § 3 s'applique pareillement : conditions acceptées, ambiguïtés tranchées, un cas accepté).
  Sans `validation_kind`, la relecture est traitée comme une relecture d'expert ; une valeur inconnue ou des types mélangés ne valident rien.
- Une IA ou un système n'est jamais relecteur, quel que soit le type (sortie 3, rien n'est écrit).
- Le registre garde la relecture dans `ownerReview` (`expertReview` reste vide) ; le site refuse une règle dont le statut d'expert reposerait sur une relecture du
  propriétaire (`OWNER_REVIEW_IS_NOT_EXPERT`).
- Texte public : « règle relue par l'équipe ADA … ; l'organisme décide » — jamais « validé par un expert », jamais « vous avez droit ».
- Un formulaire prérempli avec les décisions appliquées le 22/11/2026, identité vide, est fourni hors dépôt
  (`CONTROL/master/d11_ai_review/D11_FORMULAIRE_PROPRIETAIRE_PREREMPLI.csv`).

## 8. Décision du propriétaire du 22/11/2026 — option prudente (A) pour les neuf questions

Règle générale : quand les sources se contredisent ou qu'une condition juridique ne peut pas être établie, le site affiche « À vérifier auprès de
l'organisme compétent » ; les informations vérifiées sont présentées avec leur source ; une information incertaine ne devient jamais une décision
d'éligibilité ou d'inéligibilité ; aucune règle n'est marquée `EXPERT_VALIDATED`.

| # | Question | Traitement |
|---|---|---|
| 1 | RSA jeune actif (18–25 / 16–25 / 16–24) | condition jamais lue ; moins de 25 ans, dont 16–17 ans : « inconnu » |
| 2 | RSA, 25 ans exactement | « inconnu » (`atBoundary`) ; 26 ans et plus : âge rempli |
| 3 | APL, sous-location | toujours « inconnu » |
| 4 | AAH, ressources égales au plafond | « inconnu » ; plafonds datés du 1er avril 2026 affichés comme information |
| 5 | C2S, ressources égales à une limite de tranche | « inconnu » ; Alsace-Moselle : note d'information seulement |
| 6 | ARE, primo-entrants | aucune lecture ; F38881 et Unédic affichés ; France Travail décide |
| 7 | Prime d'activité, étudiants / apprentis | seuil en information seulement, jamais évalué |
| 8 | FAJ'EMS | 25 ans exactement : « inconnu » ; ressources et résidence à vérifier auprès de la Mission locale |
| 9 | Neuf fiches associations (droit local) | restent non publiées |

Inscrit dans le registre (`ownerDecision`). Le formulaire du propriétaire (`D11_FORMULAIRE_PROPRIETAIRE_PREREMPLI.csv`, hors dépôt) porte ces décisions,
`validation_kind=owner` et une identité vide : la signature et l'import (`apply --write`) restent un acte du propriétaire.
