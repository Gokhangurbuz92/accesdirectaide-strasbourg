# Refonte Interfaces — Résumé Technique

## Contexte
Audit de sécurité ayant identifié : ProGuard faillible (localStorage only), 22 pages admin inaccessibles (pas de menu), aucune page paramètres sur les 3 interfaces.

## Changements (mars 2025)

### Sécurité
- **ProGuard.jsx** : Réécrit en "early guard" — vérifie `pro_token` en localStorage pour éviter le flash de contenu. La vraie validation reste dans `ProLayout.jsx` (GET /api/pro/me). Ajout meta `noindex/nofollow`.
- **AdminLayout.jsx** : Nouveau layout avec auth serveur (`apiClient.auth.getUser()`), même pattern que ProLayout.

### Navigation
- **AdminLayout sidebar** : 22 pages dans 7 catégories (Dashboard, Contenu, RDV & Messages, Validation, IA & Orchestration, Système, Sync avancé)
- **ProLayout** : lien "Paramètres" ajouté dans la sidebar
- **AuthHeaderActions** : détecte l'état connecté via `rdvMessagingClient.authMe()`, affiche avatar dropdown (Messages, Paramètres, Déconnexion)

### Pages Paramètres
| Page | Fichier | Onglets |
|---|---|---|
| `/compte/parametres` | `CompteParametres.jsx` | Profil, Notifications, Sécurité, Accessibilité, Données (RGPD) |
| `/pro/parametres` | `pro/ProParametres.jsx` | Structure, Équipe, RDV, Notifications, Sécurité, Intégrations |
| `/admin/parametres` | `admin/AdminParametres.jsx` | Profil, Notifications, Sécurité |

### Routes
- Admin routes extraites du Layout public, nested dans AdminLayout (26 AdminGuard wrappers supprimés)
- `/mon-assistant` → redirect vers `/orientation`
- ProLayout redirect aligné sur `/pro/login`

## Architecture des préférences
- **Serveur** : données lues depuis `/api/auth/me` (citoyen) et `/api/pro/me` (pro)
- **Local** : préférences stockées en `localStorage` (clés : `ada_citizen_prefs`, `ada_pro_prefs`, `ada_admin_prefs`)
- **TODO** : créer endpoints PATCH pour synchroniser les préférences côté serveur

## Fichiers modifiés
```
src/components/ProGuard.jsx              (rewritten, 55 lines)
src/components/auth/AuthHeaderActions.jsx (rewritten, 245 lines)
src/pages/index.jsx                      (3 new routes + restructured)
src/pages/CompteParametres.jsx           (NEW, 380 lines)
src/pages/admin/AdminLayout.jsx          (NEW, 310 lines)
src/pages/admin/AdminParametres.jsx      (NEW, 265 lines)
src/pages/pro/ProLayout.jsx              (modified, +5 lines)
src/pages/pro/ProParametres.jsx          (NEW, 420 lines)
```

## Comment tester
1. **Non connecté** : visiter `/compte/parametres`, `/pro/parametres`, `/admin/parametres` → redirect vers login
2. **Particulier connecté** : header montre avatar dropdown → cliquer "Paramètres"
3. **Pro connecté** : sidebar montre lien "Paramètres" en bas
4. **Admin connecté** : sidebar montre lien "Paramètres" avant le footer
