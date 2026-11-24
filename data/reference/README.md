# data/reference — référentiels versionnés

## `life-situations.v1.json` (page « Ma situation », `/situation`)

Chaque situation de vie renvoie à un ou plusieurs sous-domaines du catalogue `social-domains.v1.json` (20 domaines, 86 sous-domaines).
Le test `tests/unit/g14-rg-situation.test.jsx` vérifie que chaque sous-domaine est couvert par au moins une situation, ou figure dans
la liste `uncovered` avec sa raison.

**Exclusion volontaire (une seule) : `transversal/coordination-pro`** — « Coordination des professionnels ». Ce n'est pas un événement de vie
d'une personne : aucune situation vraie ne s'y rattache sans inventer un besoin. Ce sous-domaine relève d'ADA Pro (orientations entre
professionnels, référent de parcours), pas de la page publique. Revu le 24/11/2026 (release 3) : exclusion maintenue.
