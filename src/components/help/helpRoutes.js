/**
 * FAQ and user guide (24/11/2026) — the pages the help texts point to, with their name in the interface language. Every path here is a real route of
 * src/pages/index.jsx (tests/unit/faq-guide-2026-11-24.test.jsx checks it). One explicit t() call per label so scripts/i18n-check.mjs sees each key.
 */
import { frontendEnv } from '@/config/env';
import { openLinks } from '@/lib/publicBeta';

/** @typedef {(key: string, fallback: string, options?: Record<string, unknown>) => string} TFunction */

/** @type {Record<string, (t: TFunction) => string>} */
const LABELS = {
  '/recherche': (t) => t('help:route.recherche', 'Recherche'),
  '/besoins': (t) => t('help:route.besoins', 'Trouver par besoin'),
  '/situation': (t) => t('help:route.situation', 'Ma situation'),
  '/aides': (t) => t('help:route.aides', 'Aides'),
  '/demarches': (t) => t('help:route.demarches', 'Démarches'),
  '/structures': (t) => t('help:route.structures', 'Annuaire des structures'),
  '/droits': (t) => t('help:route.droits', 'Explorer les droits par besoin'),
  '/bonnes-pratiques': (t) => t('help:route.guides', 'Bonnes pratiques'),
  '/outils': (t) => t('help:route.outils', 'Outils'),
  '/glossaire': (t) => t('help:route.glossaire', 'Glossaire'),
  '/actualites': (t) => t('help:route.actualites', 'Actualités'),
  '/sourcesmethode': (t) => t('help:route.sources', 'Sources et méthode'),
  '/a-propos': (t) => t('help:route.about', 'À propos'),
  '/mentions-legales': (t) => t('help:route.legal', 'Mentions légales'),
  '/territoire': (t) => t('help:route.territory', 'Territoire couvert'),
  '/accessibilite': (t) => t('help:route.accessibility', 'Accessibilité'),
  '/politique-confidentialite': (t) => t('help:route.privacy', 'Politique de confidentialité'),
  '/cookies': (t) => t('help:route.cookies', 'Cookies'),
  '/securite-et-rgpd': (t) => t('help:route.security', 'Sécurité et RGPD'),
  '/contact': (t) => t('help:route.contact', 'Contact'),
  '/pro/register': (t) => t('help:route.pro_register', 'Inscription d’une structure (ADA Pro)'),
  '/auth/signup': (t) => t('help:route.signup', 'Créer un compte'),
  '/auth/forgot': (t) => t('help:route.forgot', 'Mot de passe oublié'),
  '/compte': (t) => t('help:route.space', 'Mon Espace'),
  '/compte/favoris': (t) => t('help:route.favoris', 'Mes favoris'),
  '/compte/parcours': (t) => t('help:route.parcours', 'Mon Parcours'),
  '/compte/coffre': (t) => t('help:route.coffre', 'Mon Coffre'),
  '/compte/rendez-vous': (t) => t('help:route.rdv', 'Mes rendez-vous'),
  '/compte/messages': (t) => t('help:route.messages', 'Mes messages'),
  '/compte/profil': (t) => t('help:route.profil', 'Mon profil et mes dossiers'),
  '/compte/orientations': (t) => t('help:route.orientations', 'Mes orientations'),
  '/compte/delegations': (t) => t('help:route.delegations', 'Personnes de confiance'),
  '/compte/accompagnement': (t) => t('help:route.accompagnement', 'Mode accompagnant'),
  '/compte/historique': (t) => t('help:route.historique', 'Mon historique'),
  '/compte/protection-juridique': (t) => t('help:route.protection', 'Protection juridique'),
  '/compte/parametres': (t) => t('help:route.parametres', 'Paramètres du compte'),
  '/questions-frequentes': (t) => t('help:route.faq', 'Questions fréquentes'),
  '/guide': (t) => t('help:route.guide', 'Guide d’utilisation'),
};

/** every path the help pages may link to */
export const HELP_ROUTES = Object.freeze(Object.keys(LABELS));

/**
 * The links of a help entry, named in the interface language. During the public beta, a link to a screen this build keeps closed is not offered
 * (src/lib/publicBeta.js openLinks), exactly like the footer.
 * @param {any} t (the i18next t of the page) @param {string[] | undefined} paths @param {boolean} [beta]
 * @returns {{ to: string, label: string }[]}
 */
export function helpLinks(t, paths, beta = frontendEnv.flags.publicBeta) {
  const links = (paths || []).filter((p) => LABELS[p]).map((to) => ({ to, label: LABELS[to](t) }));
  return openLinks(links, beta, (l) => l.to);
}

/** accents and case folded, for the client-side search @param {unknown} s */
export const foldText = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
