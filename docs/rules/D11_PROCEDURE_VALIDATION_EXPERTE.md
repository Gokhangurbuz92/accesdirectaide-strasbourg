# Validation experte des règles de droits — procédure (D11 → D20 → P13)

**Statut au 31/10/2026 : aucune règle n'est validée.** Le diagnostic public reste une pré-orientation : chaque résultat dit « à faire vérifier » et
nomme l'organisme qui décide. Ce document explique à la personne experte ce qu'on lui demande, et ce que sa relecture change ou ne change pas dans le site.

## 1. Ce qu'il faut relire

| Document | Contenu |
|---|---|
| `docs/rules/D11_EXPERT_REVIEW_PACK.md` | pour chaque droit : sources officielles et leur date, base légale citée, conditions relevées, lecture automatique proposée, ambiguïtés, cas de référence proposés |
| `docs/rules/D11_REVIEW_FORM.csv` | le formulaire à remplir : une ligne par condition, par ambiguïté et par cas (76 lignes) |

Les huit pages Service-Public citées ont été relues le 31/10/2026 (`scripts/d11-source-check.mjs`) : leur date « Vérifié le » n'a pas changé depuis le
relevé du registre. La page du FAJ (strasbourg.eu) ne porte pas de date. À relancer juste avant la relecture.

| Droit | Qui décide | Source (date de la page) | Lu à partir des réponses | Jamais lisible par le site (toujours « à vérifier ») | Ambiguïtés | Cas proposés |
|---|---|---|---|---|---|---|
| RSA | Caf / MSA ; département | F19778, F286 (01/04/2026) | âge | résidence, ressources, nationalité, activité, activité des moins de 25 ans | 2 | 5 |
| Prime d'activité | Caf / MSA | F2882 (01/06/2026) | âge | activité, résidence, nationalité | 2 | 2 |
| APL | Caf / MSA | F12006 (01/07/2026) | statut d'occupation | logement, ressources, nationalité, exclusions | 2 | 2 |
| AAH | CDAPH (MDPH) ; versement Caf / MSA | F12242 (14/09/2026) | âge, ressources | handicap, résidence | 1 | 7 |
| APA à domicile | Collectivité européenne d'Alsace | F10009 (01/06/2026) | âge | perte d'autonomie, résidence, exclusions | 2 | 3 |
| ARE | France Travail | F38881 (23/07/2026) | — | perte d'emploi, affiliation, inscription, résidence | 1 | 1 |
| C2S | CPAM | F10027 (01/07/2026) | ressources | résidence, attribution automatique | 1 | 4 |
| FAJ (Eurométropole) | Eurométropole, via la Mission locale | strasbourg.eu (non datée) | âge, territoire | nature de la demande | 2 | 6 |

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
