// @ts-nocheck
/**
 * Registre des doublons — evidence assistance for a proposed pair (owner LAB request, 12/11/2026).
 *
 * A pure reading of what the two records ALREADY hold from the official registers the verification chain consults (api/_services/verification/:
 * FINESS — finess.js, Annuaire de l'administration — offices.js, SIRENE / annuaire-entreprises — registries.js), i.e. the identifiers stored on the record
 * (numero_finess, source_annuaire, siret) and the source pages recorded by the last check (auto_check.sources, source_url). Nothing is fetched here and no
 * evidence is invented: a URL is offered only when the record itself carries it and it is an allowed official page (evidenceUrlAllowed).
 *
 * The result is a SUGGESTION shown to the administrator, never a decision: only a human records a decision, through duplicate-register.decide().
 *
 * Rules (the owner's, in this order):
 *  - two different FINESS numbers → two establishments registered separately (likely distinct), even at one address or under one manager;
 *  - two different entries of the Annuaire de l'administration → two distinct public offices (mairie, CCAS, France services… are distinct functions);
 *  - two different SIRET → two establishments in SIRENE;
 *  - the same FINESS number / Annuaire entry / SIRET → a candidate duplicate ONLY on that stable identifier, and only when the addresses agree;
 *  - conflicting identifiers or addresses → a data-quality issue, not a duplicate (no suggestion);
 *  - the same address, or the same name, alone is never evidence; neither is a similarity score;
 *  - a medical and a dental centre are never treated as one establishment on their address;
 *  - insufficient evidence → no suggestion (the row stays « non examiné »).
 * Legal entity (SIREN), managing organisation, establishment (SIRET / FINESS ET) and service are distinguished in the explanation codes.
 */
import { evidenceUrlAllowed } from './content-verification.js';

const squash = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const addrKey = (r) => `${squash(r.adresse).replace(/[^a-z0-9]+/g, '')}|${String(r.code_postal || '').trim()}`;
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const alnum = (s) => String(s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/** the public function a name or a kind describes (the functions the owner listed as distinct at one address) */
const FUNCTIONS = [
  // the most specific first: « Point-justice en France services » is a point-justice hosted by a France services
  ['point_justice', /point.justice|acces au droit/],
  ['mjd', /maison de (la )?justice et du droit/],
  ['aide_victimes', /aide aux victimes/],
  ['ccas', /\bccas\b|centre communal d.action sociale/],
  ['mairie', /\bmairie\b|hotel de ville/],
  ['france_services', /\bfrance services?\b|espace france services/],
  ['espace_solidarites', /espace solidarit|maison des solidarit/],
  ['cio', /\bcio\b|centre d.information et d.orientation/],
  ['mission_locale', /mission locale/],
  ['dentaire', /dentaire|dentiste|soins dentaires/],
  ['medical', /soins medicaux|centre medical|medecine generale|\bmedecins?\b/],
];
export function functionOf(text) {
  const s = squash(text).replace(/[’']/g, "'");
  for (const [code, re] of FUNCTIONS) if (re.test(s)) return code;
  return null;
}

/** what a record holds from the registers: identifiers and the official pages recorded by its last check */
export function identityOf(r, env = process.env, trustedDomains = []) {
  const sources = [];
  const seen = new Set();
  const add = (kind, url) => { const u = String(url || '').trim(); if (!u || seen.has(u) || !evidenceUrlAllowed(u, env, trustedDomains)) return; seen.add(u); sources.push({ kind, url: u }); };
  for (const s of Array.isArray(r?.auto_check?.sources) ? r.auto_check.sources : []) add(String(s?.kind || 'SOURCE').toUpperCase(), s?.url);
  const su = String(r?.source_url || '');
  add(su.startsWith('https://finess.esante.gouv.fr/') ? 'FINESS' : su.includes('lannuaire.service-public') ? 'ANNUAIRE' : su.includes('annuaire-entreprises') ? 'SIRENE' : 'SOURCE', su);
  const siret = digits(r?.siret);
  const nameFn = functionOf(r?.nom); const typeFn = functionOf(r?.type_structure);
  return {
    finess: alnum(r?.numero_finess) || null,
    annuaireId: String(r?.source_annuaire || '').trim() || null,
    siret: siret.length === 14 ? siret : null,
    siren: siret.length === 14 ? siret.slice(0, 9) : null,
    rna: alnum(r?.rna_id) || null,
    fn: nameFn || typeFn,
    fnMismatch: Boolean(nameFn && typeFn && nameFn !== typeFn),
    sources,
    url: (kind) => sources.find((s) => s.kind === kind)?.url || null,
    anyUrl: sources[0]?.url || null,
    held: Boolean(r?.publication_hold),
  };
}

const FN_FR = { ccas: 'CCAS', mairie: 'mairie', france_services: 'France services', point_justice: 'point-justice', mjd: 'maison de justice et du droit', aide_victimes: 'aide aux victimes',
  espace_solidarites: 'Espace Solidarités', cio: 'CIO', mission_locale: 'mission locale', dentaire: 'centre dentaire', medical: 'centre médical' };
const filled = (r) => ['telephone', 'email', 'site_web', 'horaires', 'description_courte', 'siret', 'numero_finess'].filter((k) => r?.[k]).length;

/** the record to keep when the two are the same establishment: not on hold, verified, the most complete (the verification chain's own preference) */
export function suggestedPrimary(a, b) {
  const score = (r) => (r.publication_hold ? 0 : 1000) + (r.verification_status === 'VERIFIED' ? 100 : 0) + filled(r);
  const sa = score(a); const sb = score(b);
  if (sa !== sb) return sa > sb ? a.id : b.id;
  return String(a.id) < String(b.id) ? a.id : b.id;
}

/**
 * @param {Record<string, any>} a record (to_jsonb row) @param {Record<string, any>} b record
 * @returns {{ suggestion: 'SAME_ENTITY' | 'DISTINCT' | null, confidence: 'high' | 'medium' | null, basis: string, reasons: {code: string, params?: any}[],
 *   warnings: {code: string, params?: any}[], evidence: {kind: string, url: string, recordId: string}[], evidenceUrl: string | null, note: string | null,
 *   primaryId: string | null, wellDocumented: boolean }}
 */
export function assessPair(a, b, { env = process.env, trustedDomains = [] } = {}) {
  const A = identityOf(a, env, trustedDomains); const B = identityOf(b, env, trustedDomains);
  const reasons = []; const warnings = [];
  const evidence = [...A.sources.map((s) => ({ ...s, recordId: a.id })), ...B.sources.map((s) => ({ ...s, recordId: b.id }))];
  const sameAddress = addrKey(a) === addrKey(b) && Boolean(squash(a.adresse).trim());
  const both = (k) => A[k] && B[k];
  const cmp = (k) => (both(k) ? (A[k] === B[k] ? 'same' : 'diff') : null);
  const finess = cmp('finess'); const annuaire = cmp('annuaireId'); const siret = cmp('siret');

  if (sameAddress) warnings.push({ code: 'SAME_ADDRESS_NOT_PROOF' });
  if (A.fnMismatch || B.fnMismatch) warnings.push({ code: 'NAME_TYPE_MISMATCH', params: { records: [A.fnMismatch && a.id, B.fnMismatch && b.id].filter(Boolean) } });
  if (A.held || B.held) warnings.push({ code: 'RECORD_ON_HOLD', params: { records: [A.held && a.id, B.held && b.id].filter(Boolean) } });
  if (squash(a.nom).trim() === squash(b.nom).trim()) warnings.push({ code: 'SAME_NAME' });
  if (A.fn && B.fn && A.fn !== B.fn) reasons.push({ code: 'FUNCTIONS_DIFFER', params: { a: A.fn, b: B.fn } });
  if ((A.fn === 'dentaire' && B.fn === 'medical') || (A.fn === 'medical' && B.fn === 'dentaire')) reasons.push({ code: 'DENTAL_VS_MEDICAL' });
  if (siret === 'same') reasons.push({ code: 'SAME_SIRET', params: { siret: A.siret } });
  else if (A.siren && B.siren && A.siren === B.siren) reasons.push({ code: 'SAME_SIREN', params: { siren: A.siren } });   // one legal entity / manager, two establishments

  const out = (suggestion, confidence, basis, evidenceUrl, note, primaryId = null) => {
    const ok = Boolean(evidenceUrl) && evidenceUrlAllowed(evidenceUrl, env, trustedDomains);
    const conf = ok ? confidence : null;
    const sug = ok ? suggestion : null;
    if (!ok && suggestion) warnings.push({ code: 'NO_OFFICIAL_URL' });
    const blocking = warnings.some((w) => ['NAME_TYPE_MISMATCH', 'RECORD_ON_HOLD', 'SAME_NAME'].includes(w.code));
    const finalConf = sug && conf === 'high' && blocking ? 'medium' : conf;
    return { suggestion: sug, confidence: sug ? finalConf : null, basis: sug ? basis : (basis === 'DATA_CONFLICT' ? basis : 'INSUFFICIENT'), reasons, warnings,
      evidence, evidenceUrl: sug ? evidenceUrl : null, note: sug ? String(note).slice(0, 1000) : null, primaryId: sug === 'SAME_ENTITY' ? primaryId : null,
      wellDocumented: Boolean(sug && finalConf === 'high') };
  };
  const urls = (kind) => [A.url(kind), B.url(kind)].filter(Boolean);
  const srcLine = (list) => (list.length ? ` Sources : ${[...new Set(list)].join(' ; ')}.` : '');

  // a same stable identifier contradicted by another one, or by the address: a data-quality issue, not a duplicate
  const strongSame = [finess === 'same' && 'FINESS', annuaire === 'same' && 'ANNUAIRE'].filter(Boolean);
  const strongDiff = [finess === 'diff' && 'FINESS', annuaire === 'diff' && 'ANNUAIRE'].filter(Boolean);
  if ((strongSame.length && (strongDiff.length || siret === 'diff')) || (siret === 'same' && strongDiff.length === 0 && !sameAddress) || (strongSame.length && !sameAddress)) {
    warnings.push({ code: 'DATA_CONFLICT', params: { same: [...strongSame, siret === 'same' && 'SIRET'].filter(Boolean), diff: [...strongDiff, siret === 'diff' && 'SIRET'].filter(Boolean), address: !sameAddress } });
    return out(null, null, 'DATA_CONFLICT', null, null);
  }

  if (finess === 'diff') {
    const u = urls('FINESS');
    reasons.unshift({ code: 'FINESS_DIFFERENT', params: { a: A.finess, b: B.finess } });
    const mgr = siret === 'same' || (A.siren && A.siren === B.siren) ? ' Même entité gestionnaire (SIRET/SIREN), mais deux établissements distincts au sens de FINESS.' : '';
    return out('DISTINCT', u.length === 2 ? 'high' : 'medium', 'FINESS_DIFFERENT', u[0] || A.anyUrl || B.anyUrl,
      `Répertoire FINESS : deux établissements enregistrés séparément (n° ${A.finess} et n° ${B.finess}).${mgr} Établissements distincts : conserver les deux fiches.${srcLine(u.length ? u : [A.anyUrl, B.anyUrl].filter(Boolean))}`);
  }
  if (annuaire === 'diff') {
    const u = urls('ANNUAIRE');
    reasons.unshift({ code: 'ANNUAIRE_DIFFERENT' });
    const fns = A.fn && B.fn && A.fn !== B.fn ? ` Fonctions distinctes (${FN_FR[A.fn]} / ${FN_FR[B.fn]}).` : '';
    return out('DISTINCT', u.length === 2 ? 'high' : 'medium', 'ANNUAIRE_DIFFERENT', u[0] || A.anyUrl || B.anyUrl,
      `Annuaire de l’administration : deux guichets publiés séparément (deux fiches distinctes).${fns} Le partage d’une adresse ne fait pas un doublon : conserver les deux fiches.${srcLine(u)}`);
  }
  if (finess === 'same' || annuaire === 'same') {
    const kind = finess === 'same' ? 'FINESS' : 'ANNUAIRE';
    const u = urls(kind);
    reasons.unshift({ code: kind === 'FINESS' ? 'FINESS_SAME' : 'ANNUAIRE_SAME', params: { id: kind === 'FINESS' ? A.finess : A.annuaireId } });
    return out('SAME_ENTITY', 'high', `${kind}_SAME`, u[0] || A.anyUrl || B.anyUrl,
      kind === 'FINESS' ? `Répertoire FINESS : les deux fiches portent le même n° d’établissement ${A.finess} à la même adresse : même établissement, doublon confirmé.${srcLine(u)}`
        : `Annuaire de l’administration : les deux fiches renvoient à la même fiche officielle (${A.annuaireId}) à la même adresse : même guichet, doublon confirmé.${srcLine(u)}`,
      suggestedPrimary(a, b));
  }
  // one establishment of the FINESS register and one public office of the Annuaire: two registers, two functions
  const reg = (I) => (I.finess && I.url('FINESS') ? 'FINESS' : I.annuaireId && I.url('ANNUAIRE') ? 'ANNUAIRE' : null);
  const ra = reg(A); const rb = reg(B);
  if (siret === 'diff') {
    const u = [A.url('SIRENE') || A.url(ra) || A.anyUrl, B.url('SIRENE') || B.url(rb) || B.anyUrl].filter(Boolean);
    reasons.unshift({ code: 'SIRET_DIFFERENT', params: { a: A.siret, b: B.siret } });
    return out('DISTINCT', u.length === 2 ? 'high' : 'medium', 'SIRET_DIFFERENT', u[0],
      `Répertoire SIRENE : deux établissements différents (SIRET ${A.siret} et ${B.siret}).${A.siren === B.siren ? ' Même entité juridique (SIREN), établissements distincts.' : ' Entités juridiques différentes.'} Conserver les deux fiches.${srcLine(u)}`);
  }
  if (ra && rb && ra !== rb) {
    const u = [A.url(ra), B.url(rb)];
    reasons.unshift({ code: 'REGISTERS_DIFFERENT', params: { a: ra, b: rb } });
    return out('DISTINCT', 'medium', 'REGISTERS_DIFFERENT', u[0],
      `Deux registres officiels différents décrivent ces lieux (${ra === 'FINESS' ? 'un établissement FINESS' : 'un guichet de l’Annuaire'} et ${rb === 'FINESS' ? 'un établissement FINESS' : 'un guichet de l’Annuaire'}) : fonctions distinctes à vérifier, conserver les deux fiches.${srcLine(u)}`);
  }
  if (siret === 'same') {
    const u = urls('SIRENE');
    reasons.unshift({ code: 'SIRET_SAME_ONLY', params: { siret: A.siret } });
    // the same SIRET with no other register to tell them apart: one establishment in SIRENE — a candidate duplicate, still to be read (services may differ)
    return out('SAME_ENTITY', u.length ? 'medium' : null, 'SIRET_SAME', u[0] || null,
      `Répertoire SIRENE : les deux fiches portent le même SIRET ${A.siret} à la même adresse : même établissement.${srcLine(u)}`, suggestedPrimary(a, b));
  }
  if (A.fn && B.fn && A.fn !== B.fn && A.anyUrl && B.anyUrl) {
    return out('DISTINCT', 'medium', 'FUNCTIONS_DIFFER', A.anyUrl,
      `Fonctions publiques distinctes (${FN_FR[A.fn]} / ${FN_FR[B.fn]}) : l’adresse commune ne fait pas un doublon, conserver les deux fiches.${srcLine([A.anyUrl, B.anyUrl])}`);
  }
  return out(null, null, 'INSUFFICIENT', null, null);
}
