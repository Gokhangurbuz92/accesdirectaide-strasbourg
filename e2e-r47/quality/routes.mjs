/**
 * R47 quality — every route of src/pages/index.jsx, read from the router source itself (so a new route is crawled without editing this file), with the role
 * whose session opens it and a concrete address (parameters filled with the seeded synthetic records, or a deliberately unknown value: the not-found /
 * invalid-link state is then what is checked). Redirect-only routes (Navigate, legacy link components) are listed apart: checked once, not per language.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REDIRECT = /element=\{<(Navigate|Legacy\w*|AideLegacyLink|RetiredGuestBookingLink|\w*Redirect\w*)\b/;

/** @param {Record<string, string | null>} seed the slugs written by seed.mjs */
export function allRoutes(seed) {
  const src = fs.readFileSync(path.join(ROOT, 'src/pages/index.jsx'), 'utf8').split('\n');
  /** @type {{ pattern: string, path: string, role: string, redirect: boolean, section: string }[]} */ const out = [];
  /** @type {string[]} */ const stack = [];   // the parent route paths (a <Route …> that is not self-closing opens one, </Route> closes it)
  const fill = (/** @type {string} */ p) => p
    .replace(/^\/admin\/(aides)\/:id$/, '/admin/$1/r47q-aide-1').replace(/^\/admin\/structures\/:id$/, '/admin/structures/r47q-str-0001')
    .replace(/^\/admin\/demarches\/:id$/, '/admin/demarches/r47q-dem-1').replace(/^\/admin\/dispositifs\/:id$/, '/admin/dispositifs/r47q-disp-1')
    .replace(/^\/admin\/guides\/:id$/, '/admin/guides/r47q-guide-1').replace(/^\/pro\/appointments\/:id$/, '/pro/appointments/r47q-pa-1')
    .replace(/^\/(aides|aide)\/:slug$/, `/$1/${seed.aide}`).replace(/^\/(structures|annuaire)\/:slug$/, `/$1/${seed.structure}`)
    .replace(/^\/demarches\/:slug$/, `/demarches/${seed.demarche}`).replace(/^\/dispositifs\/:slug$/, `/dispositifs/${seed.dispositif}`)
    .replace(/^\/actualites\/:slug$/, `/actualites/${seed.actualite}`).replace(/:structureSlug/, String(seed.pilot || seed.bookable))
    .replace(/:categorySlug/, 'logement').replace(/:territorySlug/, 'strasbourg').replace(/^\/categories\/:slug$/, '/categories/logement')
    .replace(/^\/situations\/:slug$/, '/situations/famille')
    .replace(/:[A-Za-z]+/g, 'r47q-inconnu');
  for (const line of src) {
    if (/^\s*<\/Route>/.test(line)) { stack.pop(); continue; }
    const m = line.match(/<Route path="([^"]+)"/); if (!m) continue;
    const p = m[1];
    const abs = p.startsWith('/') ? p : `${stack[stack.length - 1] || ''}/${p}`;
    if (!/\/>\s*$/.test(line)) stack.push(abs);
    if (p === '*' || p === '/__sentry_test' || p === '/sentry-test' || abs === '/admin' || abs === '/pro') continue;
    const under = (/** @type {string} */ b) => abs === b || abs.startsWith(`${b}/`);
    const section = under('/admin') ? 'admin' : under('/pro') ? 'pro' : under('/compte') ? 'compte' : under('/institution') ? 'institution' : 'public';
    let role = { admin: 'admin', pro: 'structureAdmin', compte: 'citizen', institution: 'institution', public: 'anonymous' }[section];
    if (['/admin/login', '/pro/login', '/pro/register', '/pro/register-invite', '/pro/forgot-password', '/pro/reset-password', '/institution/mot-de-passe-oublie', '/institution/reinitialiser'].includes(abs)) role = 'anonymous';
    if (/^\/rdv\/:structureSlug\/booking$/.test(abs)) role = 'citizen';
    out.push({ pattern: abs, path: fill(abs), role, redirect: REDIRECT.test(line), section });
  }
  // the professional (non-administrator) member sees every professional page too: the administrator-only ones must explain the refusal
  const extra = out.filter((r) => r.section === 'pro' && r.role === 'structureAdmin' && !r.redirect).map((r) => ({ ...r, role: 'pro' }));
  const seen = new Set();
  return [...out, ...extra].filter((r) => { const k = `${r.path}|${r.role}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** pages opened WITHOUT the right session: each must say why (sign-in needed / not allowed), never a blank page */
export const ACCESS_DENIED = [
  { path: '/compte', role: 'anonymous' }, { path: '/compte/rendez-vous', role: 'anonymous' }, { path: '/compte/coffre', role: 'anonymous' },
  { path: '/pro/dashboard', role: 'anonymous' }, { path: '/pro/rdv/agenda', role: 'anonymous' }, { path: '/admin/dashboard', role: 'anonymous' },
  { path: '/admin/dashboard', role: 'citizen' }, { path: '/admin/dashboard', role: 'pro' }, { path: '/institution', role: 'anonymous' },
  { path: '/pro/team', role: 'pro' }, { path: '/pro/audit', role: 'pro' }, { path: '/pro/structure', role: 'pro' }, { path: '/pro/rdv/disponibilites', role: 'pro' },
];
