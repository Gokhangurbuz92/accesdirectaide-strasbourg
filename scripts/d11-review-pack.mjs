#!/usr/bin/env node
/**
 * PKG-6 / D11 — renders the EXPERT REVIEW PACK (docs/rules/D11_EXPERT_REVIEW_PACK.md) from the research register and the proposed reference cases, so the
 * reviewer reads exactly what the product holds. Deterministic (no clock): re-run after any register change; tests/unit/pkg6-d11-rules-draft.test.js fails when the
 * committed pack is out of date. It records no decision: the reviewer fills the form, and only then may an engineer move a right to EXPERT_VALIDATED.
 *   node scripts/d11-review-pack.mjs            → writes the pack
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConditions } from '../api/lib/rulesDraft.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_PATH = 'docs/rules/D11_EXPERT_REVIEW_PACK.md';
const fmt = (v) => JSON.stringify(v).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': ');
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const reading = (c) => {
  const d = c.draftCheck; if (!d) return 'non lisible à partir des réponses ADA → toujours « inconnu »';
  if (d.kind === 'ageAtLeast') return `âge ≥ ${d.min}${d.softMin ? ` (zone ${d.softMin}–${d.min - 1} : inconnu)` : ''} ; en dessous : ${d.below}`;
  if (d.kind === 'ageBetween') return `âge ${d.min} à ${d.max} ; ${d.max} ans exactement : ${d.atMax}`;
  if (d.kind === 'territoryScope') return 'hors département déclaré : NOT_MET ; dans le département : inconnu (communes non vérifiées)';
  if (d.kind === 'oneOf') return `${d.fact} ∈ {${d.met.join(', ')}} : MET ; autre : ${d.otherwise}`;
  // G14: amount-bearing checks say their source-dated window and the resources basis they compare
  const dated = `${d.effectiveFrom ? ` ; barème en vigueur à partir du ${d.effectiveFrom}, à relire le ${d.staleAfter || '?'} (hors de cette période : inconnu)` : ''}${d.requiresBasis ? ` ; base de ressources exigée : ${d.requiresBasis} (autre base : inconnu)` : ''}`;
  if (d.kind === 'annualResourcesBands' && d.byArea) return `${Object.entries(d.byArea).map(([area, t]) => `${area} : ${Object.entries(t.bySize).map(([n, bs]) => `${n} pers. ${bs.map((b) => `≤ ${b.max} €`).join(' / ')}`).join(', ')}${t.perExtra ? `, + ${t.perExtra.join(' / ')} € par personne en plus` : ''}`).join(' ; ')} (MET avec la note « sans participation » / « avec participation ») ; au-delà : ${d.above}${dated}`;
  if (d.kind === 'annualResourcesBands') return `${d.householdSize} pers., ${d.area} : ${d.bands.map((b) => `≤ ${b.max} € ${b.result} (${b.note})`).join(' ; ')} ; au-delà : ${d.above}`;
  if (d.kind === 'annualResourcesCeiling') return `plafond annuel ${Object.entries(d.byChildren).map(([k, v]) => `${k} enfant(s) : ${v} €`).join(', ')} ; au-delà : ${d.above} ; autre nombre d'enfants : inconnu${dated}`;
  return d.kind;
};

/** @param {any} register @param {any} proposed @returns {string} */
export function renderReviewPack(register, proposed) {
  const L = [];
  L.push('# D11 — dossier de revue experte des règles de droits (ADA Strasbourg)', '');
  L.push(`Registre : data/rules/rights-rules.v1.json (consulté le ${register.consultedAt}). Cas proposés : data/rules/reference-cases.proposed.v1.json.`, '');
  // G14: the status line says what the register holds — no right expert-validated is not the same as no right approved by the owner
  const st = (s) => register.rights.filter((r) => r.status === s).map((r) => r.id);
  const statusLine = st('EXPERT_VALIDATED').length || st('OWNER_VALIDATED').length
    ? `**Statut : ${st('EXPERT_VALIDATED').length ? `relues par un expert : ${st('EXPERT_VALIDATED').join(', ')}` : 'aucune règle n\'est validée par un expert'}${st('OWNER_VALIDATED').length ? ` ; approuvées par le responsable du traitement (OWNER_VALIDATED, pas une validation d'expert indépendant) : ${st('OWNER_VALIDATED').join(', ')}` : ''}.**`
    : '**Statut : aucune règle n\'est validée.**';
  L.push(`${statusLine} Ce document est généré à partir des données du produit ; il ne contient aucune décision. Pour chaque droit,`,
    'l\'expert (nom, fonction, date) accepte, corrige ou rejette chaque condition, chaque lecture automatique et chaque cas proposé, et tranche les ambiguïtés.',
    st('OWNER_VALIDATED').length
      ? 'Une règle approuvée par le responsable du traitement n\'est lue que par l\'orientation dans le navigateur (« règle relue par l\'équipe ADA ; l\'organisme décide ») ; le serveur n\'applique que les règles relues par un expert. Les résultats restent « à faire vérifier » et l\'organisme compétent décide.'
      : 'Tant que ce n\'est pas fait, ADA n\'utilise pas ces règles pour orienter : les résultats restent « à faire vérifier » et l\'organisme compétent décide.', '');
  L.push('Légende des résultats : MET = condition remplie d\'après les réponses ; NOT_MET = non remplie ; UNKNOWN = ADA ne peut pas le dire.', '');
  for (const r of register.rights) {
    L.push(`## ${r.label} (\`${r.id}\`) — ${r.status}`, '');
    L.push(`Décide : ${r.decidedBy}`, '');
    L.push('| Source | Page « vérifiée le » | Consultée le | Portée |', '|---|---|---|---|');
    for (const s of r.sources) L.push(`| ${s.url} | ${s.pageVerifiedOn ?? 'non indiqué'} | ${s.consultedAt} | ${cell(s.scope || '')} |`);
    L.push('', `Base légale citée : ${r.legalBasis?.length ? r.legalBasis.join(' ; ') : 'aucune sur la page'}`, '');
    L.push('| Condition | Texte relevé | Source | Lecture automatique proposée | Décision expert |', '|---|---|---|---|---|');
    for (const c of r.conditions) L.push(`| ${c.fact} | ${cell(c.text)} | ${c.source} | ${cell(reading(c))} | ☐ accepter ☐ corriger ☐ rejeter |`);
    if (r.relatedSources?.length) L.push('', `Pages complémentaires (information, G14) : ${r.relatedSources.map((s) => `${s.url}${s.scope ? ` (${s.scope})` : ''}`).join(' ; ')}`, '');
    if (r.sourceRecheck) L.push(...(r.relatedSources?.length ? [] : ['']), `Sources relues le ${r.sourceRecheck.readAt} par ADA engineering (pas une relecture d'expert) : ${r.sourceRecheck.pages.map((p) => p.id || p.url).join(', ')}${r.sourceRecheck.legal.length ? ` ; ${r.sourceRecheck.legal.map((l) => `${l.num} (en vigueur depuis le ${l.inForceSince})`).join(', ')}` : ''}.`);
    L.push('', 'Ambiguïtés à trancher :');
    for (const a of r.ambiguities) L.push(`- ${a} — décision : ……`);
    // G14: a hidden text addressed to automated agents is a source-ingestion security matter, not a legal ambiguity: listed, never submitted to the expert
    for (const n of r.ingestionSecurityNotes || []) L.push(`- (sécurité de l'ingestion, hors relecture juridique — ${n.readAt}) ${n.note}`);
    const cases = proposed.cases.filter((c) => c.right === r.id);
    L.push('', `Cas de référence proposés (${cases.length}) :`, '');
    if (cases.length) {
      L.push('| Cas | Réponses | Attendu (proposé) | Lecture actuelle | Fondement | Décision expert |', '|---|---|---|---|---|---|');
      for (const c of cases) {
        const got = Object.fromEntries(readConditions(register, r.id, c.facts).conditions.filter((x) => x.fact in c.expected).map((x) => [x.fact, x.result]));
        L.push(`| ${c.id} | ${cell(fmt(c.facts))} | ${cell(fmt(c.expected))} | ${cell(fmt(got))} | ${cell(c.basis)} | ☐ accepter ☐ corriger ☐ rejeter |`);
      }
    } else L.push('Aucun.');
    L.push('', 'Signature de revue : nom …… fonction …… date …… — type : ☐ expert (EXPERT_VALIDATED) ☐ owner, responsable du traitement (OWNER_VALIDATED, pas une validation d\'expert indépendant) — statut décidé : ☐ validée ☐ à corriger ☐ SUPERSEDED', '');
  }
  return L.join('\n') + '\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rules/rights-rules.v1.json'), 'utf8'));
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rules/reference-cases.proposed.v1.json'), 'utf8'));
  fs.writeFileSync(path.join(ROOT, PACK_PATH), renderReviewPack(reg, cases));
  process.stdout.write(`${PACK_PATH} written\n`);
}
