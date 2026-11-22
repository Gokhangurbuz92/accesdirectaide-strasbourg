#!/usr/bin/env node
/**
 * D11 (R31) — the expert review form of the rights rules, and the only way a right becomes EXPERT_VALIDATED.
 *   node scripts/d11-review.mjs form                    → prints the blank form (CSV, one row per condition, ambiguity and proposed case)
 *   node scripts/d11-review.mjs apply <filled.csv>      → dry run: says, right by right, what the filled form allows and what stays open
 *   node scripts/d11-review.mjs apply <filled.csv> --write → writes data/rules/rights-rules.v1.json accordingly
 *   node scripts/d11-review.mjs status                  → (R46) the gate, right by right, with its reasons (exit 0; JSON with --json)
 *   --register <file>  (R46) reads / writes another copy of the register (rehearsal of the workflow on a copy; the default is the committed register)
 *
 * A right is validated only when, in the form, ONE named reviewer (name, role, date) accepted EVERY condition as written, decided EVERY ambiguity, and accepted
 * (or corrected) at least one reference case — and every accepted case gives its expected result with the register's reading (api/lib/rulesDraft.js).
 * A corrected or rejected condition never validates anything: the register must first be corrected by an engineer and a new form filled.
 * The script records what the reviewer wrote; it never decides in the reviewer's place.
 * G14 (22/11/2026): a form row signed by an AI or a system, or carrying AI-review columns (ai_review_status…), is refused (exit 3, nothing written).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConditions } from '../api/lib/rulesDraft.js';
import { gateStatus, validatedRight, nonHumanReviewer, OWNER_REVIEW_BASIS } from '../api/lib/validatedRules.js';
import { isMainModule } from './lib/is-main.mjs';

const REGISTER = new URL('../data/rules/rights-rules.v1.json', import.meta.url);
const PROPOSED = new URL('../data/rules/reference-cases.proposed.v1.json', import.meta.url);
// G14: validation_kind = '' or 'expert' (named qualified reviewer → EXPERT_VALIDATED) | 'owner' (the data controller → OWNER_VALIDATED, never EXPERT_VALIDATED)
export const COLUMNS = ['right', 'item_type', 'item_id', 'text', 'proposed', 'decision', 'correction_or_decision', 'reviewer_name', 'reviewer_role', 'review_date', 'validation_kind'];
export const VALIDATION_KINDS = Object.freeze(['', 'expert', 'owner']);
const q = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** @returns {string} the blank form */
export function renderForm(register, proposed) {
  const rows = [COLUMNS.join(',')];
  for (const r of register.rights) {
    for (const c of r.conditions) rows.push([r.id, 'condition', c.fact, `${c.text} (${c.source})`, c.draftCheck ? JSON.stringify(c.draftCheck) : 'non lisible : toujours inconnu', '', '', '', '', '', ''].map(q).join(','));
    (r.ambiguities || []).forEach((a, i) => rows.push([r.id, 'ambiguity', String(i + 1), a, '', '', '', '', '', '', ''].map(q).join(',')));
    for (const c of proposed.cases.filter((x) => x.right === r.id)) rows.push([r.id, 'case', c.id, `${JSON.stringify(c.facts)} — ${c.basis}`, JSON.stringify(c.expected), '', '', '', '', '', ''].map(q).join(','));
  }
  return `${rows.join('\n')}\n`;
}

/** a small RFC 4180 reader (quoted fields, doubled quotes, CRLF tolerated) */
export function parseCsv(text) {
  const out = []; let row = []; let f = ''; let inQ = false;
  const s = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');   // G14: a UTF-8 BOM (spreadsheet export) must not hide the « right » column
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQ) { if (ch === '"' && s[i + 1] === '"') { f += '"'; i += 1; } else if (ch === '"') inQ = false; else f += ch; continue; }
    if (ch === '"') inQ = true; else if (ch === ',') { row.push(f); f = ''; } else if (ch === '\n') { row.push(f); out.push(row); row = []; f = ''; } else f += ch;
  }
  if (f || row.length) { row.push(f); out.push(row); }
  const [head, ...body] = out;
  return body.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** What the filled form allows, right by right (pure). */
export function evaluateForm(register, proposed, rows) {
  const results = [];
  for (const r of register.rights) {
    const mine = rows.filter((x) => x.right === r.id);
    const open = [];
    const reviewers = new Set(mine.map((x) => `${x.reviewer_name}|${x.reviewer_role}|${x.review_date}`));
    const [name, role, date] = [...reviewers][0]?.split('|') || [];
    if (!mine.length) open.push('aucune ligne remplie');
    // G14: an AI / automated review is an engineering input, never the human approval — the whole right is refused
    if (mine.some((x) => nonHumanReviewer(x))) open.push('relecteur non humain (IA, système automatique ou avis IA non signé) : refusé — seule une personne qualifiée nommée peut relire');
    // G14: the kind of validation is explicit and the same on every row of the right; « owner » can only ever give OWNER_VALIDATED
    const kinds = new Set(mine.map((x) => String(x.validation_kind ?? '').trim().toLowerCase()));
    if ([...kinds].some((k) => !VALIDATION_KINDS.includes(k))) open.push(`type de validation inconnu (${[...kinds].filter((k) => !VALIDATION_KINDS.includes(k)).join(', ')}) : « expert » ou « owner »`);
    if (kinds.size > 1) open.push('type de validation différent selon les lignes : une relecture = un seul type (expert ou owner)');
    const kind = kinds.has('owner') ? 'owner' : 'expert';
    if (reviewers.size > 1) open.push('plusieurs relecteurs ou dates : une relecture = une personne, une date');
    if (!name || !role || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) open.push('nom, fonction ou date (AAAA-MM-JJ) du relecteur manquant');
    // R46: the reviewer must have read the page as it is now — a page revised after the review date needs a new review
    else for (const src of r.sources || []) if (/^\d{4}-\d{2}-\d{2}$/.test(String(src.pageVerifiedOn || '')) && src.pageVerifiedOn > date) open.push(`page officielle ${src.url} révisée le ${src.pageVerifiedOn}, après la relecture : relire la page actuelle`);
    for (const c of r.conditions) {
      const row = mine.find((x) => x.item_type === 'condition' && x.item_id === c.fact);
      if (!row || !row.decision) open.push(`condition « ${c.fact} » non décidée`);
      else if (row.decision !== 'ACCEPT') open.push(`condition « ${c.fact} » ${row.decision === 'CORRECT' ? 'à corriger' : 'rejetée'} : ${row.correction_or_decision || 'sans précision'} (le registre doit être corrigé, puis un nouveau formulaire rempli)`);
    }
    const ambiguityDecisions = [];
    (r.ambiguities || []).forEach((a, i) => {
      const row = mine.find((x) => x.item_type === 'ambiguity' && x.item_id === String(i + 1));
      if (!row || row.decision !== 'DECIDED' || !row.correction_or_decision) open.push(`ambiguïté ${i + 1} non tranchée`);
      else ambiguityDecisions.push({ ambiguity: a, decision: row.correction_or_decision });
    });
    const accepted = [];
    for (const c of proposed.cases.filter((x) => x.right === r.id)) {
      const row = mine.find((x) => x.item_type === 'case' && x.item_id === c.id);
      if (!row || !['ACCEPT', 'CORRECT'].includes(row.decision)) continue;
      let expected = c.expected;
      if (row.decision === 'CORRECT') { try { expected = JSON.parse(row.correction_or_decision); } catch { open.push(`cas ${c.id} : résultat corrigé illisible (JSON attendu)`); continue; } }
      const reading = readConditions(register, r.id, c.facts);
      const mismatch = Object.entries(expected).filter(([fact, want]) => reading.conditions.find((x) => x.fact === fact)?.result !== want);
      if (mismatch.length) open.push(`cas ${c.id} : la lecture du registre ne donne pas le résultat accepté (${mismatch.map(([f, w]) => `${f} attendu ${w}`).join(', ')}) — la lecture doit être corrigée`);
      accepted.push({ id: c.id, facts: c.facts, expected, basis: c.basis, acceptedBy: { name, role, date }, decision: row.decision });
    }
    if (!accepted.length) open.push('aucun cas de référence accepté');
    results.push({ right: r.id, validated: open.length === 0, kind, status: kind === 'owner' ? 'OWNER_VALIDATED' : 'EXPERT_VALIDATED', open, review: name ? { name, role, date } : null, ambiguityDecisions, accepted });
  }
  return results;
}

/** the register after the form: validated rights get status, review and cases; others keep their status and receive nothing */
export function applyForm(register, results) {
  const next = JSON.parse(JSON.stringify(register));
  for (const res of results) {
    if (!res.validated) continue;
    const r = next.rights.find((x) => x.id === res.right);
    if (res.kind === 'owner') {
      // G14: the data controller's approval — its own status and record; expertReview stays null, so the expert status is unreachable this way
      r.status = 'OWNER_VALIDATED';
      r.expertReview = null;
      r.ownerReview = { ...res.review, kind: 'owner', basis: OWNER_REVIEW_BASIS, ambiguityDecisions: res.ambiguityDecisions };
    } else {
      r.status = 'EXPERT_VALIDATED';
      r.expertReview = { ...res.review, ambiguityDecisions: res.ambiguityDecisions };
      // G14: an expert review supersedes an earlier owner approval; the owner's record is kept for history, outside the gate
      if (r.ownerReview) { r.supersededOwnerReview = r.ownerReview; delete r.ownerReview; }
    }
    r.referenceCases = res.accepted.map(({ decision, ...c }) => c);
    if (!validatedRight(next, r.id)) throw new Error(`gate refused ${r.id} after apply`);   // belt and braces: the product's own gate must agree
  }
  return next;
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--register');
  const target = at >= 0 && args[at + 1] ? pathToFileURL(path.resolve(args[at + 1])) : REGISTER;
  const [cmd, file] = args.filter((a, i) => !a.startsWith('--') && (at < 0 || (i !== at + 1)));
  const register = JSON.parse(fs.readFileSync(target, 'utf8'));
  const proposed = JSON.parse(fs.readFileSync(PROPOSED, 'utf8'));
  if (cmd === 'form') { process.stdout.write(renderForm(register, proposed)); return; }
  if (cmd === 'status') {
    const gate = register.rights.map((r) => ({ right: r.id, status: r.status, ...gateStatus(register, r.id) }));
    const passing = (st) => gate.filter((g) => g.passes && g.status === st).map((g) => g.right);   // G14: the two kinds are listed apart
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ register: target.pathname.split('/').pop(), validated: gate.filter((g) => g.passes).map((g) => g.right),
      expertValidated: passing('EXPERT_VALIDATED'), ownerValidated: passing('OWNER_VALIDATED'), gate }, null, 1)}\n`);
    else for (const g of gate) console.log(`${g.right}: ${g.passes ? `PASSES THE GATE (${g.status})` : `closed (${g.reasons.join(', ')})`}`);
    return;
  }
  if (cmd === 'apply' && file) {
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    if (rows.some((x) => nonHumanReviewer(x))) {
      // G14: a file that contains an AI / system review is never imported, not even partly, and --write is refused
      console.error('refusé : ce formulaire contient un avis IA ou un relecteur non humain (colonnes ai_* ou nom / fonction d\'un système). Rien n\'est écrit.');
      process.exitCode = 3;
      return;
    }
    const results = evaluateForm(register, proposed, rows);
    for (const r of results) console.log(`${r.right}: ${r.validated ? `VALIDABLE (${r.status})` : 'reste non validée'}${r.open.length ? `\n  - ${r.open.join('\n  - ')}` : ''}`);
    if (args.includes('--write')) { fs.writeFileSync(target, `${JSON.stringify(applyForm(register, results), null, 2)}\n`); console.log('registre écrit ; relancer node scripts/d11-review-pack.mjs'); }
    return;
  }
  console.error('usage: node scripts/d11-review.mjs form | status [--json] | apply <filled.csv> [--write]  [--register <file>]');
  process.exitCode = 2;
}

if (isMainModule(import.meta.url)) main();
