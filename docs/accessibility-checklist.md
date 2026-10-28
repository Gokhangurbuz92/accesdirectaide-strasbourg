# Checklist Accessibilité RGAA — Accès Direct Aide

> Dernière vérification : Mars 2026

## Navigation clavier
- [x] Tab navigue dans l'ordre logique
- [x] Shift+Tab navigue en arrière
- [x] Enter active boutons et liens
- [x] Escape ferme les modals (Dialog/Sheet composants)
- [x] Focus toujours visible (`focus-visible:ring-2` sur tous les interactifs)
- [x] `tabIndex={-1}` sur `<main>` pour skip link focus

## Structure
- [x] Skip link présent (`Layout.jsx` ligne 225-228)
- [x] Un seul h1 par page (vérifié sur Home, Aides, Demarches, AideDetail)
- [x] Hiérarchie headings correcte (h1 > h2 > h3, pas de saut)
- [x] Landmarks présents :
  - `<header role="banner">` ✓
  - `<nav aria-label="Navigation principale">` ✓
  - `<main id="main-content">` ✓
  - `<footer role="contentinfo">` ✓

## Images
- [x] Toutes les images ont un `alt` (informatif ou `alt=""` si décoratif)
- [x] Images décoratives marquées `aria-hidden="true"` (HeroBackground, icônes Lucide)

## Formulaires
- [x] Tous les champs majeurs ont un label :
  - HeroSearch : `<label htmlFor="hero-search" className="sr-only">`
  - AidesSearchForm : `<label htmlFor>` sur chaque champ
  - FilterPanel : `<label htmlFor>` + `<fieldset>` + `<legend>`
  - Demarches filtres : 5 selects avec `<label htmlFor>`
  - ChatWindow : `aria-label` sur textarea + boutons
  - ProServices : `<label>` wrappant les inputs
  - Ressources : `aria-label` sur select
- [x] Champs obligatoires signalés (formulaire contact, RDV)
- [x] Zone `aria-live="polite"` pour les résultats dynamiques

## Liens
- [x] Liens externes (`target="_blank"`) ont `rel="noopener noreferrer"`
- [x] Intitulés explicites (pas de « cliquez ici »)
- [x] `aria-current="page"` sur navigation active

## ARIA et rôles
- [x] `aria-expanded` sur boutons qui ouvrent des panneaux (filtres)
- [x] `role="log"` + `aria-live="polite"` sur ChatWindow
- [x] `role="status"` sur compteurs de résultats
- [x] `role="alert"` sur messages d'erreur
- [x] Icônes décoratives marquées `aria-hidden="true"`
