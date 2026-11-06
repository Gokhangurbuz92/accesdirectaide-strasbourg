#!/usr/bin/env node
/**
 * R35 (P2): generates the variable reference tables of the owner activation guide (French) from config/activation-manifest.json, so the guide and
 * the readiness doctor cannot drift apart. Names and classifications only, never values.
 *   node scripts/activation-guide-tables.mjs [--presence names.json] > tables.md
 *   node scripts/activation-guide-tables.mjs --check <guide.md>      exit 1 if the guide misses a manifest variable
 */
import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/is-main.mjs';

const CLASS_FR = {
  required: 'OBLIGATOIRE', required_outside_beta: 'OBLIGATOIRE hors bêta', conditional: 'SI LA FONCTION EST ACTIVÉE', optional: 'OPTIONNELLE',
  approval: 'FEU VERT (décision)', decision: 'DÉCISION propriétaire', lab: 'LAB / poste seulement — ne pas créer sur Vercel',
  forbidden: 'INTERDITE en Production', forbidden_warn: 'À SUPPRIMER', forbidden_value: 'INTERDITE avec la valeur indiquée', alias: 'ANCIEN NOM — ne pas créer',
  dead: 'SANS EFFET — ne pas créer', owner_deferred: 'REPORTÉE par le propriétaire',
};
const NATURE_FR = { secret: 'SECRET serveur (cocher « Sensitive »)', config: 'réglage serveur', public: 'PUBLIC (écrit dans le JavaScript, jamais de secret)' };

/** @param {any} manifest @param {Record<string, string[]> | null} presence names present on Vercel -> targets */
export function renderTables(manifest, presence) {
  const moduleOf = /** @type {Record<string, string[]>} */ ({});
  for (const m of manifest.modules) for (const n of [...(m.requires || []), ...(m.optional || []), ...(m.approval ? [m.approval] : [])]) (moduleOf[n] ||= []).push(m.id);
  const rows = Object.entries(manifest.variables).sort(([a], [b]) => a.localeCompare(b));
  const lines = ['| Variable | Statut | Nature | Environnements | Format attendu | Fournisseur | Modules | Présente sur Vercel (02/11) |', '|---|---|---|---|---|---|---|---|'];
  for (const [n, v] of rows) {
    const vv = /** @type {any} */ (v);
    const pres = presence ? (presence[n] ? presence[n].join(', ') : 'absente') : 'UNVERIFIABLE';
    const fmt = vv.format ? `\`${vv.format}\`` : vv.forbidden ? `interdit : \`${vv.forbidden}\`` : vv.canonical ? `→ \`${vv.canonical}\`` : '—';
    const prov = vv.provider ? (manifest.providers[vv.provider]?.label || vv.provider) : '—';
    lines.push(`| \`${n}\` | ${CLASS_FR[/** @type {keyof typeof CLASS_FR} */ (vv.class)] || vv.class} | ${NATURE_FR[/** @type {keyof typeof NATURE_FR} */ (vv.nature)] || vv.nature} | ${(vv.scope || []).join(', ') || '—'} | ${fmt} | ${prov} | ${(moduleOf[n] || []).join(', ') || '—'} | ${pres} |`);
  }
  return lines.join('\n');
}

/** @param {any} manifest @param {string | null} guideText null = check the generated tables themselves */
export function guideMissingNames(manifest, guideText) {
  const text = guideText ?? renderTables(manifest, null);
  return Object.keys(manifest.variables).filter((n) => !text.includes(`\`${n}\``));
}

if (isMainModule(import.meta.url)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'activation-manifest.json'), 'utf8'));
  const arg = (/** @type {string} */ k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
  if (arg('--check')) {
    const missing = guideMissingNames(manifest, fs.readFileSync(String(arg('--check')), 'utf8'));
    process.stdout.write(missing.length ? `guide misses ${missing.length}: ${missing.join(', ')}\n` : 'guide names every manifest variable\n');
    process.exit(missing.length ? 1 : 0);
  }
  const presence = arg('--presence') ? JSON.parse(fs.readFileSync(String(arg('--presence')), 'utf8')) : null;
  process.stdout.write(`${renderTables(manifest, presence)}\n`);
}
