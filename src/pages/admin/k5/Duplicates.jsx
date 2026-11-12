// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { reviewValue } from '@/components/admin/reviewValue.js';
import { useT, formatDateTime } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { DISTINCT, SAME, batchItems, chunks, draftFor, draftProblems, filterPairs, paginate, reconcileDrafts, sortPairs, summary, wellDocumented } from './duplicatesModel.js';

/**
 * D13 — registre des doublons (/admin/doublons), revue en lot (owner LAB, 12/11/2026).
 * La détection propose des paires et l'aide à la preuve lit ce que les fiches tiennent déjà des registres officiels (FINESS, Annuaire de l'administration,
 * SIRENE) : c'est une suggestion, jamais une décision. Seule une personne d'ADA décide, paire par paire, sur une source officielle :
 *  - « Même établissement — doublon confirmé » : une fiche est conservée, l'autre est mise en attente (elle quitte l'annuaire public) ; rien n'est fusionné
 *    ni supprimé, la décision reste dans le registre et peut être remplacée ;
 *  - « Établissements distincts — conserver les deux fiches » : la paire n'est plus proposée.
 * Chaque décision part par le chemin de décision existant (session MFA, versions lues des deux fiches, preuve officielle, journal).
 */

const WHY = (t, d) => [d.sameSiret && t('admin:k5.duplicates.why.siret', 'même SIRET'), d.sameRna && t('admin:k5.duplicates.why.rna', 'même RNA'), d.sameFiness && t('admin:k5.duplicates.why.finess', 'même FINESS'),
  d.sameAddress && t('admin:k5.duplicates.why.address', 'même adresse'), Number(d.nameSimilarity) >= 0.6 && t('admin:k5.duplicates.why.names', 'noms proches ({{n}})', { n: d.nameSimilarity })].filter(Boolean).join(', ');

const FN = (t, code) => ({
  ccas: t('admin:k5.duplicates.fn.ccas', 'CCAS'), mairie: t('admin:k5.duplicates.fn.mairie', 'mairie'), france_services: t('admin:k5.duplicates.fn.france_services', 'France services'),
  point_justice: t('admin:k5.duplicates.fn.point_justice', 'point-justice'), mjd: t('admin:k5.duplicates.fn.mjd', 'maison de justice et du droit'), aide_victimes: t('admin:k5.duplicates.fn.aide_victimes', 'aide aux victimes'),
  espace_solidarites: t('admin:k5.duplicates.fn.espace_solidarites', 'Espace Solidarités'), cio: t('admin:k5.duplicates.fn.cio', 'CIO'), mission_locale: t('admin:k5.duplicates.fn.mission_locale', 'mission locale'),
  dentaire: t('admin:k5.duplicates.fn.dentaire', 'centre dentaire'), medical: t('admin:k5.duplicates.fn.medical', 'centre médical'),
}[code] || code);

const REASON = (t, r) => {
  const p = r.params || {};
  switch (r.code) {
    case 'FINESS_DIFFERENT': return t('admin:k5.duplicates.reason.finess_different', 'FINESS : deux établissements enregistrés séparément (n° {{a}} et n° {{b}}).', { a: p.a, b: p.b });
    case 'FINESS_SAME': return t('admin:k5.duplicates.reason.finess_same', 'FINESS : même n° d’établissement ({{id}}).', { id: p.id });
    case 'ANNUAIRE_DIFFERENT': return t('admin:k5.duplicates.reason.annuaire_different', 'Annuaire de l’administration : deux guichets publiés séparément.');
    case 'ANNUAIRE_SAME': return t('admin:k5.duplicates.reason.annuaire_same', 'Annuaire de l’administration : la même fiche officielle.');
    case 'SIRET_DIFFERENT': return t('admin:k5.duplicates.reason.siret_different', 'SIRENE : deux établissements différents (SIRET {{a}} / {{b}}).', { a: p.a, b: p.b });
    case 'SIRET_SAME_ONLY': return t('admin:k5.duplicates.reason.siret_same_only', 'SIRENE : même SIRET ({{siret}}), aucun autre registre ne les distingue.', { siret: p.siret });
    case 'SAME_SIRET': return t('admin:k5.duplicates.reason.same_siret', 'Même SIRET {{siret}} : même entité gestionnaire.', { siret: p.siret });
    case 'SAME_SIREN': return t('admin:k5.duplicates.reason.same_siren', 'Même SIREN {{siren}} : même entité juridique, établissements différents.', { siren: p.siren });
    case 'REGISTERS_DIFFERENT': return t('admin:k5.duplicates.reason.registers_different', 'Deux registres différents : {{a}} et {{b}}.', { a: p.a, b: p.b });
    case 'FUNCTIONS_DIFFER': return t('admin:k5.duplicates.reason.functions_differ', 'Fonctions distinctes : {{a}} / {{b}}.', { a: FN(t, p.a), b: FN(t, p.b) });
    case 'DENTAL_VS_MEDICAL': return t('admin:k5.duplicates.reason.dental_medical', 'Centre dentaire et centre médical : jamais réunis sur leur seule adresse.');
    default: return r.code;
  }
};
const WARNING = (t, w) => {
  switch (w.code) {
    case 'SAME_ADDRESS_NOT_PROOF': return t('admin:k5.duplicates.warn.same_address', 'Même adresse : ce n’est pas une preuve de doublon.');
    case 'NAME_TYPE_MISMATCH': return t('admin:k5.duplicates.warn.name_type', 'Le nom et le type d’une fiche ne disent pas la même fonction : vérifiez la fiche officielle.');
    case 'RECORD_ON_HOLD': return t('admin:k5.duplicates.warn.on_hold', 'Une fiche est déjà en attente.');
    case 'SAME_NAME': return t('admin:k5.duplicates.warn.same_name', 'Noms identiques : comparez les deux fiches officielles.');
    case 'DATA_CONFLICT': return t('admin:k5.duplicates.warn.data_conflict', 'Données contradictoires (identifiants ou adresse) : problème de qualité de données, pas un doublon.');
    case 'NO_OFFICIAL_URL': return t('admin:k5.duplicates.warn.no_url', 'Aucune page officielle enregistrée sur ces fiches.');
    default: return w.code;
  }
};
const PROBLEM = (t, code) => ({
  DECISION: t('admin:k5.duplicates.problem.decision', 'choisissez une décision'), PRIMARY: t('admin:k5.duplicates.problem.primary', 'indiquez la fiche à conserver'),
  EVIDENCE: t('admin:k5.duplicates.problem.evidence', 'ajoutez la page officielle (https)'), NOTE: t('admin:k5.duplicates.problem.note', 'écrivez ce que la source établit (10 caractères au moins)'),
  STALE: t('admin:k5.duplicates.problem.stale', 'une fiche a changé : relisez la paire'),
}[code] || code);
const ERROR = (t, r) => ({
  STALE_REVIEW: t('admin:k5.duplicates.error.stale', 'Une des fiches a changé depuis votre lecture : relisez la paire.'),
  PAIR_ALREADY_DECIDED: t('admin:k5.duplicates.error.already', 'Cette paire a reçu une autre décision entre-temps.'),
  EVIDENCE_URL_NOT_ALLOWED: t('admin:k5.duplicates.error.evidence', 'La preuve doit être une page https d’un registre ou d’un site officiel.'),
  NOTE_REQUIRED: t('admin:k5.duplicates.error.note', 'Indiquez ce que la source établit (au moins 10 caractères).'),
  PRIMARY_REQUIRED: t('admin:k5.duplicates.error.primary', 'Indiquez la fiche à conserver.'),
  not_found: t('admin:k5.duplicates.error.not_found', 'Fiche introuvable.'),
  DUPLICATE_IN_BATCH: t('admin:k5.duplicates.error.twice', 'Cette paire figure deux fois dans l’envoi.'),
}[r.code] || t('admin:k5.duplicates.error.other', 'La décision n’a pas pu être enregistrée.'));
const CONFIDENCE = (t, c) => (c === 'high' ? t('admin:k5.duplicates.conf.high', 'confiance haute') : c === 'medium' ? t('admin:k5.duplicates.conf.medium', 'confiance moyenne') : t('admin:k5.duplicates.conf.none', 'preuves insuffisantes'));
const SUGGESTION = (t, s) => (s === SAME ? t('admin:k5.duplicates.sug.same', 'Suggestion : même établissement') : s === DISTINCT ? t('admin:k5.duplicates.sug.distinct', 'Suggestion : établissements distincts') : t('admin:k5.duplicates.sug.none', 'Pas de suggestion : à examiner'));
const KIND = (t, k) => ({ FINESS: t('admin:k5.duplicates.src.finess', 'FINESS'), ANNUAIRE: t('admin:k5.duplicates.src.annuaire', 'Annuaire de l’administration'), SIRENE: t('admin:k5.duplicates.src.sirene', 'Annuaire des entreprises (SIRENE)') }[k] || t('admin:k5.duplicates.src.other', 'Source officielle'));
const RECORD_STATE = (t, r) => (r.verification_status === 'REJECTED' ? t('admin:k5.duplicates.state.rejected', ' — fiche refusée') : r.publication_hold ? t('admin:k5.duplicates.state.held', ' — fiche en attente') : r.verification_status === 'VERIFIED' ? t('admin:k5.duplicates.state.verified', ' — fiche vérifiée') : '');

const isTyping = (el) => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

function Sources({ t, list }) {
  if (!list?.length) return <span className="text-muted-foreground">{t('admin:k5.duplicates.no_source', 'aucune page officielle enregistrée')}</span>;
  return (
    <ul className="space-y-0.5">
      {list.map((s) => <li key={s.url}><a className="break-all text-primary underline" href={s.url} target="_blank" rel="noreferrer noopener">{KIND(t, s.kind)}</a></li>)}
    </ul>
  );
}

function RecordSummary({ t, r, fr, label }) {
  const ids = [r.siret && `SIRET ${r.siret}`, r.numero_finess && `FINESS ${r.numero_finess}`, r.rna_id && `RNA ${r.rna_id}`].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="font-semibold"><span className="sr-only">{label} : </span><span {...fr}>{r.nom}</span><span className="text-xs font-normal">{RECORD_STATE(t, r)}</span></p>
      <p className="text-xs" {...fr}>{[r.adresse, [r.code_postal, r.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</p>
      <p className="text-xs"><span {...fr}>{r.type_structure || '—'}</span>{ids ? ` · ${ids}` : ''}</p>
      <div className="text-xs"><Sources t={t} list={r.sources} /></div>
    </div>
  );
}

function DecisionButtons({ t, pairKey, value, onChoose, compact = false }) {
  const opt = (v, label, hint) => (
    <button type="button" aria-pressed={value === v} onClick={() => onChoose(value === v ? null : v)} data-testid={`dup-choose-${v}`}
      className={`rounded border px-2 py-1 text-start text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === v ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
      {label}{compact ? null : <span className="sr-only"> ({hint})</span>}
    </button>
  );
  return (
    <div role="group" aria-label={t('admin:k5.duplicates.decision_for', 'Décision pour cette paire')} className="flex flex-wrap gap-1" data-pair={pairKey}>
      {opt(SAME, t('admin:k5.duplicates.same', 'Même établissement — doublon confirmé'), t('admin:k5.duplicates.key_m', 'touche M'))}
      {opt(DISTINCT, t('admin:k5.duplicates.distinct', 'Établissements distincts — conserver les deux fiches'), t('admin:k5.duplicates.key_d', 'touche D'))}
      {value ? null : <span className="self-center text-xs text-muted-foreground" data-testid="dup-unreviewed">{t('admin:k5.duplicates.unreviewed', 'Non examiné')}</span>}
    </div>
  );
}

export default function AdminDuplicates() {
  const { t } = useT('admin');
  const fr = useFrAttrs();   // R47: the structures' names, towns and content stay French (lang="fr" outside French)
  const [data, setData] = useState({ loading: true, pairs: [], total: 0 });
  const [drafts, setDrafts] = useState({}); const [selected, setSelected] = useState(() => new Set());
  const [outcomes, setOutcomes] = useState({}); const [decidedCount, setDecidedCount] = useState(0);
  const [filters, setFilters] = useState({ q: '', suggestion: 'all', confidence: 'all', detection: 'all', warnings: 'all', state: 'all' });
  const [sort, setSort] = useState('detection'); const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  const [focusKey, setFocusKey] = useState(null); const [drawer, setDrawer] = useState(null);   // { key, detail }
  const [confirm, setConfirm] = useState(null); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [history, setHistory] = useState(null);
  const rowRefs = useRef({}); const rootRef = useRef(null); const drawerHeading = useRef(null); const confirmRef = useRef(null); const returnFocus = useRef(null);

  const load = useCallback(async ({ keepDrafts = true } = {}) => {
    try {
      const out = await apiClient.admin.getDuplicateRegister('register');
      const pairs = out.pairs || [];
      setData({ loading: false, pairs, total: out.total ?? pairs.length });
      if (keepDrafts) {
        setDrafts((cur) => {
          const { drafts: kept, stale } = reconcileDrafts(pairs, cur);
          if (stale.length) setOutcomes((o) => ({ ...o, ...Object.fromEntries(stale.map((k) => [k, { ok: false, code: 'STALE_REVIEW' }])) }));
          return kept;
        });
        setSelected((cur) => new Set([...cur].filter((k) => pairs.some((p) => p.key === k))));
      }
      return pairs;
    } catch (e) { setData({ loading: false, pairs: [], total: 0 }); setProblem(explain(e)); return []; }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => sortPairs(filterPairs(data.pairs, filters, drafts, outcomes), sort), [data.pairs, filters, drafts, outcomes, sort]);
  const paged = useMemo(() => paginate(visible, page, size), [visible, page, size]);
  const byKey = useMemo(() => new Map(data.pairs.map((p) => [p.key, p])), [data.pairs]);
  const ready = useMemo(() => batchItems(data.pairs, selected, drafts), [data.pairs, selected, drafts]);
  const incomplete = [...selected].filter((k) => byKey.get(k) && draftProblems(byKey.get(k), drafts[k]).length).length;
  const documented = useMemo(() => wellDocumented(data.pairs), [data.pairs]);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const choose = (p, decision) => {
    setOutcomes((o) => { const n = { ...o }; delete n[p.key]; return n; });
    if (!decision) { setDrafts((d) => { const n = { ...d }; delete n[p.key]; return n; }); setSelected((s) => { const n = new Set(s); n.delete(p.key); return n; }); return; }
    setDrafts((d) => ({ ...d, [p.key]: draftFor(p, decision) }));
    setSelected((s) => new Set(s).add(p.key));
  };
  const editDraft = (key, patch) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  const toggleSelected = (key) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else if (drafts[key]) n.add(key); return n; });
  const preselect = () => {
    const add = documented.filter((p) => !drafts[p.key]);
    setDrafts((d) => ({ ...d, ...Object.fromEntries(add.map((p) => [p.key, draftFor(p, p.assessment.suggestion)])) }));
    setSelected((s) => new Set([...s, ...add.map((p) => p.key)]));
    setMsg(t('admin:k5.duplicates.preselected', '{{n}} suggestions bien documentées présélectionnées : relisez-les, puis enregistrez.', { n: add.length }));
  };

  const openDrawer = async (p) => {
    returnFocus.current = rowRefs.current[p.key] || null;
    setFocusKey(p.key); setDrawer({ key: p.key, detail: null });
    try { const detail = await apiClient.admin.getDuplicates(p.a, p.b); setDrawer((d) => (d && d.key === p.key ? { key: p.key, detail } : d)); }
    catch (e) { setProblem(explain(e)); }
  };
  const closeDrawer = () => { setDrawer(null); setTimeout(() => returnFocus.current?.focus(), 0); };
  useEffect(() => { if (drawer) drawerHeading.current?.focus(); }, [drawer?.key]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (confirm) confirmRef.current?.focus(); }, [confirm]);

  const move = (delta, from = focusKey) => {
    const items = paged.items; if (!items.length) return;
    const i = Math.max(0, items.findIndex((p) => p.key === from));
    const next = items[Math.min(items.length - 1, Math.max(0, i + delta))];
    setFocusKey(next.key); rowRefs.current[next.key]?.focus();
    if (drawer) openDrawer(next);
  };
  const onKeyDown = (e) => {
    if (confirm) { if (e.key === 'Escape') { e.preventDefault(); setConfirm(null); } return; }
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target !== document.body && !rootRef.current?.contains(e.target)) return;   // the rest of the administration keeps its own keys
    const current = e.target?.closest?.('li[data-key]')?.getAttribute('data-key') || focusKey;   // the row the keys act on: the focused one, else the last one
    const p = byKey.get(current);
    const k = e.key;
    if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); move(1, current); }
    else if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); move(-1, current); }
    else if (k === 'Escape' && drawer) { e.preventDefault(); closeDrawer(); }
    else if (!p) return;
    else if (k === 'm' || k === 'M') { e.preventDefault(); choose(p, drafts[p.key]?.decision === SAME ? null : SAME); }
    else if (k === 'd' || k === 'D') { e.preventDefault(); choose(p, drafts[p.key]?.decision === DISTINCT ? null : DISTINCT); }
    else if (k === 'u' || k === 'U' || k === 'Delete') { e.preventDefault(); choose(p, null); }
    else if (k === 'x' || k === ' ') { if (e.target === rowRefs.current[p.key]) { e.preventDefault(); toggleSelected(p.key); } }
    else if (k === 'Enter' || k === 'c') { if (e.target === rowRefs.current[p.key] || k === 'c') { e.preventDefault(); openDrawer(p); } }
  };

  // the shortcuts work anywhere on the page (outside a text field); a ref keeps the listener on the latest state
  const keyHandler = useRef(onKeyDown); keyHandler.current = onKeyDown;
  useEffect(() => { const h = (e) => keyHandler.current(e); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, []);

  const askConfirm = () => { setProblem(''); if (ready.length) { returnFocus.current = document.activeElement; setConfirm({ items: ready, ...summary(data.pairs, ready) }); } };
  const save = async () => {
    const items = confirm.items; setConfirm(null); setBusy(true); setMsg(''); setProblem('');
    const results = {};
    try {
      for (const part of chunks(items)) {
        try {
          const out = await apiClient.admin.decideDuplicates(part);
          for (const r of out.results || []) results[r.key] = r;
        } catch (e) { for (const i of part) results[`${[i.a, i.b].sort().join('|')}`] = { ok: false, code: 'REQUEST_FAILED', message: explain(e) }; }
      }
      const okKeys = Object.entries(results).filter(([, r]) => r.ok).map(([k]) => k);
      const failed = Object.entries(results).filter(([, r]) => !r.ok);
      setOutcomes((o) => ({ ...Object.fromEntries(Object.entries(o).filter(([k]) => !okKeys.includes(k))), ...Object.fromEntries(failed) }));
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !okKeys.includes(k) && !failed.some(([fk, r]) => fk === k && ['STALE_REVIEW', 'PAIR_ALREADY_DECIDED'].includes(r.code)))));
      setSelected((s) => new Set([...s].filter((k) => !okKeys.includes(k))));
      setDecidedCount((n) => n + okKeys.length);
      const pairs = await load();   // no page reload: the decided pairs leave the queue, the others keep their drafts (unless a record changed)
      setMsg(t('admin:k5.duplicates.saved_batch', '{{ok}} décision(s) enregistrée(s), {{failed}} en échec. Paires restantes : {{left}}.', { ok: okKeys.length, failed: failed.length, left: pairs.length }));
      if (failed.length) setFilter('state', 'failed');
    } finally { setBusy(false); setTimeout(() => returnFocus.current?.focus?.(), 0); }
  };

  const showHistory = async () => {
    try { setHistory((await apiClient.admin.getDuplicateRegister('history')).decisions || []); } catch (e) { setProblem(explain(e)); }
  };

  const drawerPair = drawer ? byKey.get(drawer.key) : null;
  const drawerDraft = drawerPair ? drafts[drawerPair.key] : null;

  return (
    <div className="space-y-3 p-4 pb-28" data-testid="admin-duplicates" ref={rootRef}>
      <h1 className="text-2xl font-bold">{t('admin:k5.duplicates.title', 'Registre des doublons')}</h1>
      <p className="text-sm">{t('admin:k5.duplicates.intro_bulk', 'Les paires sont proposées automatiquement (même SIRET, RNA ou FINESS, même adresse, ou noms très proches) : ce n’est qu’une suggestion. L’aide à la preuve lit ce que les fiches tiennent des registres officiels (FINESS, Annuaire de l’administration, SIRENE) ; un score n’est jamais une décision. Rien n’est fusionné ni supprimé : « Même établissement » met seulement la fiche non conservée en attente (elle quitte l’annuaire public).')}</p>

      <details className="rounded border p-2 text-sm">
        <summary className="cursor-pointer font-medium">{t('admin:k5.duplicates.shortcuts', 'Raccourcis clavier')}</summary>
        <ul className="mt-1 grid gap-0.5 sm:grid-cols-2" data-testid="dup-shortcuts">
          <li><kbd>↓</kbd> / <kbd>J</kbd> — {t('admin:k5.duplicates.sc.next', 'paire suivante')}</li>
          <li><kbd>↑</kbd> / <kbd>K</kbd> — {t('admin:k5.duplicates.sc.prev', 'paire précédente')}</li>
          <li><kbd>M</kbd> — {t('admin:k5.duplicates.same', 'Même établissement — doublon confirmé')}</li>
          <li><kbd>D</kbd> — {t('admin:k5.duplicates.distinct', 'Établissements distincts — conserver les deux fiches')}</li>
          <li><kbd>U</kbd> — {t('admin:k5.duplicates.sc.clear', 'revenir à « Non examiné »')}</li>
          <li><kbd>X</kbd> / {t('admin:k5.duplicates.sc.space', 'Espace')} — {t('admin:k5.duplicates.sc.select', 'inclure ou retirer de l’envoi')}</li>
          <li><kbd>C</kbd> / {t('admin:k5.duplicates.sc.enter', 'Entrée')} — {t('admin:k5.duplicates.sc.compare', 'comparer les deux fiches')}</li>
          <li><kbd>{t('admin:k5.duplicates.sc.escape', 'Échap')}</kbd> — {t('admin:k5.duplicates.sc.close', 'fermer la comparaison')}</li>
        </ul>
      </details>

      <section aria-label={t('admin:k5.duplicates.filters', 'Filtres')} className="flex flex-wrap items-end gap-2 text-sm" data-testid="dup-filters">
        <label className="flex flex-col">{t('admin:k5.duplicates.search', 'Rechercher (nom, ville, adresse, SIRET, FINESS)')}
          <input type="search" className="rounded border p-1" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} data-testid="dup-search" /></label>
        <label className="flex flex-col">{t('admin:k5.duplicates.f.suggestion', 'Suggestion')}
          <select className="rounded border p-1" value={filters.suggestion} onChange={(e) => setFilter('suggestion', e.target.value)} data-testid="dup-filter-suggestion">
            <option value="all">{t('admin:k5.duplicates.f.all', 'toutes')}</option><option value={SAME}>{t('admin:k5.duplicates.f.same', 'même établissement')}</option>
            <option value={DISTINCT}>{t('admin:k5.duplicates.f.distinct', 'établissements distincts')}</option><option value="none">{t('admin:k5.duplicates.f.none', 'sans suggestion')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.duplicates.f.confidence', 'Confiance')}
          <select className="rounded border p-1" value={filters.confidence} onChange={(e) => setFilter('confidence', e.target.value)}>
            <option value="all">{t('admin:k5.duplicates.f.all', 'toutes')}</option><option value="high">{t('admin:k5.duplicates.f.high', 'haute')}</option>
            <option value="medium">{t('admin:k5.duplicates.f.medium', 'moyenne')}</option><option value="none">{t('admin:k5.duplicates.f.insufficient', 'preuves insuffisantes')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.duplicates.f.detection', 'Détection')}
          <select className="rounded border p-1" value={filters.detection} onChange={(e) => setFilter('detection', e.target.value)}>
            <option value="all">{t('admin:k5.duplicates.f.all', 'toutes')}</option><option value="identifier">{t('admin:k5.duplicates.f.identifier', 'même identifiant')}</option>
            <option value="address">{t('admin:k5.duplicates.f.address', 'même adresse')}</option><option value="names">{t('admin:k5.duplicates.f.names', 'noms proches')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.duplicates.f.warnings', 'Avertissements')}
          <select className="rounded border p-1" value={filters.warnings} onChange={(e) => setFilter('warnings', e.target.value)}>
            <option value="all">{t('admin:k5.duplicates.f.all', 'toutes')}</option><option value="with">{t('admin:k5.duplicates.f.with', 'avec avertissement')}</option><option value="without">{t('admin:k5.duplicates.f.without', 'sans avertissement')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.duplicates.f.state', 'État')}
          <select className="rounded border p-1" value={filters.state} onChange={(e) => setFilter('state', e.target.value)} data-testid="dup-filter-state">
            <option value="all">{t('admin:k5.duplicates.f.all', 'toutes')}</option><option value="todo">{t('admin:k5.duplicates.f.todo', 'non examinées')}</option>
            <option value="draft">{t('admin:k5.duplicates.f.draft', 'décision choisie')}</option><option value="failed">{t('admin:k5.duplicates.f.failed', 'en échec')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.duplicates.sort', 'Trier par')}
          <select className="rounded border p-1" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="detection">{t('admin:k5.duplicates.sort_detection', 'motif de détection')}</option><option value="confidence">{t('admin:k5.duplicates.sort_confidence', 'confiance')}</option>
            <option value="name">{t('admin:k5.duplicates.sort_name', 'nom')}</option><option value="city">{t('admin:k5.duplicates.sort_city', 'ville')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.duplicates.page_size', 'Par page')}
          <select className="rounded border p-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}>
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <Button size="sm" variant="outline" onClick={preselect} disabled={!documented.some((p) => !drafts[p.key])} data-testid="dup-preselect">
          {t('admin:k5.duplicates.preselect', 'Présélectionner les suggestions bien documentées ({{n}})', { n: documented.filter((p) => !drafts[p.key]).length })}</Button>
      </section>

      {problem ? <p role="alert" className="text-destructive" data-testid="admin-duplicates-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" className="text-sm" data-testid="admin-duplicates-status">{msg}</div>

      {data.loading ? <p role="status">{t('admin:k5.duplicates.loading', 'Chargement…')}</p> : (
        <>
          <p className="text-sm" data-testid="dup-counts">{t('admin:k5.duplicates.counts', '{{shown}} paire(s) affichée(s) sur {{total}} à examiner.', { shown: visible.length, total: data.pairs.length })}</p>
          <ul className="space-y-2" aria-label={t('admin:k5.duplicates.list', 'Paires proposées')} data-testid="dup-list">
            {paged.items.map((p) => {
              const s = p.assessment || {}; const d = drafts[p.key]; const o = outcomes[p.key]; const probs = d ? draftProblems(p, d) : [];
              return (
                <li key={p.key} ref={(el) => { rowRefs.current[p.key] = el; }} tabIndex={focusKey === p.key || (!focusKey && p === paged.items[0]) ? 0 : -1} onFocus={() => setFocusKey(p.key)}
                  aria-label={t('admin:k5.duplicates.row_label', 'Paire : {{a}} / {{b}}', { a: p.A.nom, b: p.B.nom })} data-testid="admin-duplicate-candidate" data-key={p.key}
                  className={`rounded border p-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${focusKey === p.key ? 'border-primary' : ''}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={selected.has(p.key)} disabled={!d} onChange={() => toggleSelected(p.key)} tabIndex={-1}
                      aria-label={t('admin:k5.duplicates.include', 'Inclure cette décision dans l’envoi')} data-testid="dup-select" />
                    <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
                      <RecordSummary t={t} r={p.A} fr={fr} label={t('admin:k5.duplicates.record1', 'Fiche 1')} />
                      <RecordSummary t={t} r={p.B} fr={fr} label={t('admin:k5.duplicates.record2', 'Fiche 2')} />
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 border-t pt-2">
                    <p className="text-xs">{t('admin:k5.duplicates.detected', 'Détection : {{why}}', { why: WHY(t, p.detection) })}</p>
                    <p className="font-medium" data-testid="dup-suggestion" data-suggestion={s.suggestion || 'none'} data-confidence={s.confidence || 'none'}>
                      {SUGGESTION(t, s.suggestion)} — {CONFIDENCE(t, s.confidence)}</p>
                    {s.reasons?.length ? <ul className="list-disc ps-5 text-xs">{s.reasons.map((r, i) => <li key={i}>{REASON(t, r)}</li>)}</ul> : null}
                    {s.warnings?.length ? <ul className="text-xs" data-testid="dup-warnings">{s.warnings.map((w, i) => <li key={i}>⚠ {WARNING(t, w)}</li>)}</ul> : null}
                    {s.evidenceUrl ? <p className="text-xs">{t('admin:k5.duplicates.evidence_used', 'Source retenue :')} <a className="break-all text-primary underline" href={s.evidenceUrl} target="_blank" rel="noreferrer noopener">{s.evidenceUrl}</a></p> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <DecisionButtons t={t} pairKey={p.key} value={d?.decision || null} onChoose={(v) => choose(p, v)} />
                      <Button size="sm" variant="outline" onClick={() => openDrawer(p)} data-testid="dup-compare">{t('admin:k5.duplicates.compare', 'Comparer')}</Button>
                    </div>
                    {d && probs.length ? <p className="text-xs" data-testid="dup-incomplete">{t('admin:k5.duplicates.to_complete', 'À compléter (bouton « Comparer ») : {{list}}.', { list: probs.map((c) => PROBLEM(t, c)).join(', ') })}</p> : null}
                    {o && !o.ok ? <p role="alert" className="text-xs text-destructive" data-testid="dup-row-error">{ERROR(t, o)}</p> : null}
                  </div>
                </li>
              );
            })}
            {!paged.items.length ? <li>{t('admin:k5.duplicates.none', 'Aucune paire à examiner.')}</li> : null}
          </ul>
          <nav aria-label={t('admin:k5.duplicates.pagination', 'Pagination')} className="flex items-center gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>{t('admin:k5.duplicates.prev_page', 'Page précédente')}</Button>
            <span>{t('admin:k5.duplicates.page_of', 'Page {{page}} sur {{pages}}', { page: paged.page, pages: paged.pages })}</span>
            <Button size="sm" variant="outline" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>{t('admin:k5.duplicates.next_page', 'Page suivante')}</Button>
          </nav>
          <div>
            <Button size="sm" variant="ghost" onClick={showHistory} data-testid="dup-history-open">{t('admin:k5.duplicates.history', 'Décisions récentes (historique)')}</Button>
            {history ? (
              <ul className="mt-1 space-y-0.5 text-xs" data-testid="dup-history">
                {history.map((h) => <li key={h.id}>{formatDateTime(h.decidedAt)} — <span {...fr}>{h.nomA}</span> / <span {...fr}>{h.nomB}</span> — {h.decision === SAME ? t('admin:k5.duplicates.prev_same', 'même établissement') : t('admin:k5.duplicates.prev_distinct', 'distincts')} — {h.reviewerId}{h.supersededAt ? t('admin:k5.duplicates.superseded', ' (remplacée)') : ''}</li>)}
                {!history.length ? <li>{t('admin:k5.duplicates.history_none', 'Aucune décision enregistrée.')}</li> : null}
              </ul>
            ) : null}
          </div>
        </>
      )}

      {drawerPair ? (
        <aside role="dialog" aria-modal="false" aria-labelledby="dup-drawer-title" data-testid="admin-duplicate-pair"
          className="fixed inset-x-0 top-0 bottom-16 z-40 overflow-y-auto border-s bg-background p-3 shadow-lg md:start-auto md:end-0 md:w-[42rem]">
          <div className="flex items-start justify-between gap-2">
            <h2 id="dup-drawer-title" ref={drawerHeading} tabIndex={-1} className="font-semibold focus:outline-none">{t('admin:k5.duplicates.compare_heading', 'Comparer les deux fiches')}</h2>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => move(-1)}>{t('admin:k5.duplicates.prev_pair', 'Paire précédente')}</Button>
              <Button size="sm" variant="outline" onClick={() => move(1)}>{t('admin:k5.duplicates.next_pair', 'Paire suivante')}</Button>
              <Button size="sm" variant="outline" onClick={closeDrawer} data-testid="dup-drawer-close">{t('admin:k5.duplicates.close', 'Fermer')}</Button>
            </div>
          </div>
          <p className="mt-1 text-sm font-medium">{SUGGESTION(t, drawerPair.assessment?.suggestion)} — {CONFIDENCE(t, drawerPair.assessment?.confidence)}</p>
          {drawerPair.assessment?.note ? <p className="text-xs" {...fr}>{drawerPair.assessment.note}</p> : null}
          <div className="my-2"><DecisionButtons t={t} pairKey={drawerPair.key} value={drawerDraft?.decision || null} onChoose={(v) => choose(drawerPair, v)} /></div>
          {drawerDraft ? (
            <div className="space-y-2 rounded border p-2 text-sm" data-testid="dup-draft-form">
              {drawerDraft.decision === SAME ? (
                <div><label htmlFor="dup-primary" className="block">{t('admin:k5.duplicates.keep_label', 'Fiche à conserver (l’autre quitte l’annuaire public)')}</label>
                  <select id="dup-primary" className="rounded border p-1" value={drawerDraft.primaryId} onChange={(e) => editDraft(drawerPair.key, { primaryId: e.target.value })}>
                    <option value="">—</option><option value={drawerPair.A.id}>{t('admin:k5.duplicates.option1', 'Fiche 1 : {{nom}}', { nom: drawerPair.A.nom })}</option><option value={drawerPair.B.id}>{t('admin:k5.duplicates.option2', 'Fiche 2 : {{nom}}', { nom: drawerPair.B.nom })}</option>
                  </select></div>
              ) : null}
              <label htmlFor="dup-evidence" className="block">{t('admin:k5.duplicates.evidence_label', 'Preuve institutionnelle (page d’un registre officiel : annuaire des entreprises, FINESS, Journal officiel…)')}</label>
              <input id="dup-evidence" type="url" className="w-full rounded border p-1" value={drawerDraft.evidenceUrl} onChange={(e) => editDraft(drawerPair.key, { evidenceUrl: e.target.value })} placeholder="https://…" />
              {drawerPair.assessment?.evidence?.length ? (
                <div className="flex flex-wrap gap-1 text-xs"><span>{t('admin:k5.duplicates.use_source', 'Utiliser :')}</span>
                  {drawerPair.assessment.evidence.map((ev) => <button type="button" key={`${ev.recordId}${ev.url}`} className="rounded border px-1 underline" onClick={() => editDraft(drawerPair.key, { evidenceUrl: ev.url })}>{KIND(t, ev.kind)} ({ev.recordId === drawerPair.A.id ? t('admin:k5.duplicates.record1', 'Fiche 1') : t('admin:k5.duplicates.record2', 'Fiche 2')})</button>)}
                </div>
              ) : null}
              <label htmlFor="dup-note" className="block">{t('admin:k5.duplicates.note_label', 'Ce que la source établit (conservé dans le registre)')}</label>
              <textarea id="dup-note" className="w-full rounded border p-1" rows={3} value={drawerDraft.note} onChange={(e) => editDraft(drawerPair.key, { note: e.target.value })} />
              {draftProblems(drawerPair, drawerDraft).length ? <p className="text-xs">{t('admin:k5.duplicates.to_complete_short', 'À compléter : {{list}}.', { list: draftProblems(drawerPair, drawerDraft).map((c) => PROBLEM(t, c)).join(', ') })}</p>
                : <p className="text-xs" data-testid="dup-draft-ready">{t('admin:k5.duplicates.draft_ready', 'Prête : elle partira avec « Enregistrer les décisions sélectionnées ».')}</p>}
            </div>
          ) : null}
          {drawer.detail ? (
            <>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {[drawer.detail.a, drawer.detail.b].map((r, i) => (
                  <div key={r.id} className="space-y-1 rounded border p-2" data-testid="admin-duplicate-record">
                    <p className="font-semibold">{i === 0 ? t('admin:k5.duplicates.record1', 'Fiche 1') : t('admin:k5.duplicates.record2', 'Fiche 2')} : <span {...fr}>{r.nom}</span></p>
                    <p className="text-xs">{t('admin:k5.duplicates.record_status', 'Statut : {{statut}} — vérification : {{verification}}', { statut: r.statut || '—', verification: r.verification || t('admin:k5.duplicates.none_f', 'aucune') })}{r.hold ? t('admin:k5.duplicates.record_hold', ' — en attente : {{hold}}', { hold: r.hold }) : ''}</p>
                    <dl className="space-y-1 text-xs">{r.content.map((c) => <div key={c.field}><dt className="inline font-medium">{c.field} : </dt><dd className="inline whitespace-pre-wrap break-words" {...(c.field === 'accessibilite_pmr' ? {} : fr)}>{reviewValue(c.field, c.value)}</dd></div>)}</dl>
                  </div>
                ))}
              </div>
              {drawer.detail.decisions?.length ? (
                <details className="mt-2"><summary className="cursor-pointer text-primary">{t('admin:k5.duplicates.previous', 'Décisions précédentes pour cette paire')}</summary>
                  <ul className="text-sm">{drawer.detail.decisions.map((d) => <li key={d.id}>{formatDateTime(d.decidedAt)} — {d.decision === SAME ? t('admin:k5.duplicates.prev_same', 'même établissement') : t('admin:k5.duplicates.prev_distinct', 'distincts')} — {d.reviewerId}{d.supersededAt ? t('admin:k5.duplicates.superseded', ' (remplacée)') : ''}</li>)}</ul>
                </details>
              ) : null}
            </>
          ) : <p role="status" className="mt-2 text-sm">{t('admin:k5.duplicates.loading', 'Chargement…')}</p>}
        </aside>
      ) : null}

      {confirm ? (
        <div role="dialog" aria-modal="true" aria-labelledby="dup-confirm-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="dup-confirm">
          <div className="max-h-full w-full max-w-lg overflow-y-auto rounded bg-background p-4 shadow-lg">
            <h2 id="dup-confirm-title" ref={confirmRef} tabIndex={-1} className="font-semibold focus:outline-none">{t('admin:k5.duplicates.confirm_title', 'Confirmer {{n}} décision(s)', { n: confirm.items.length })}</h2>
            <ul className="my-2 list-disc ps-5 text-sm">
              <li>{t('admin:k5.duplicates.confirm_distinct', 'Établissements distincts (les deux fiches sont conservées) : {{n}}', { n: confirm.distinct })}</li>
              <li>{t('admin:k5.duplicates.confirm_same', 'Même établissement (une fiche quitte l’annuaire public, mise en attente) : {{n}}', { n: confirm.same })}</li>
            </ul>
            {confirm.held.length ? (
              <><p className="text-sm font-medium">{t('admin:k5.duplicates.confirm_held', 'Fiches qui quitteront l’annuaire public :')}</p>
                <ul className="list-disc ps-5 text-sm" data-testid="dup-confirm-held">{confirm.held.map((h) => <li key={h.leaveId}><span {...fr}>{h.leave}</span> ({t('admin:k5.duplicates.confirm_kept', 'conservée : {{nom}}', { nom: h.keep })})</li>)}</ul></>
            ) : null}
            {incomplete ? <p className="text-sm">{t('admin:k5.duplicates.confirm_incomplete', '{{n}} décision(s) sélectionnée(s) incomplète(s) ne partiront pas.', { n: incomplete })}</p> : null}
            <p className="mt-2 text-xs">{t('admin:k5.duplicates.confirm_note', 'Chaque décision est enregistrée séparément, avec sa propre source et son explication, et journalisée. Rien n’est fusionné ni supprimé.')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>{t('admin:k5.duplicates.cancel', 'Annuler')}</Button>
              <Button onClick={save} data-testid="dup-confirm-save">{t('admin:k5.duplicates.confirm_save', 'Enregistrer')}</Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-2 text-sm shadow" role="region" aria-label={t('admin:k5.duplicates.toolbar', 'Envoi des décisions')} data-testid="dup-toolbar">
        <span aria-live="polite" data-testid="dup-toolbar-counts">{t('admin:k5.duplicates.toolbar_counts', '{{ready}} prête(s) · {{incomplete}} incomplète(s) · {{left}} paire(s) restante(s) · {{done}} décidée(s) ici', { ready: ready.length, incomplete, left: data.pairs.length, done: decidedCount })}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!selected.size || busy} onClick={() => setSelected(new Set())}>{t('admin:k5.duplicates.clear_selection', 'Vider la sélection')}</Button>
          <Button size="sm" disabled={!ready.length || busy} onClick={askConfirm} data-testid="admin-duplicate-decide">{busy ? t('admin:k5.duplicates.saving', 'Enregistrement…') : t('admin:k5.duplicates.save_selected', 'Enregistrer les décisions sélectionnées ({{n}})', { n: ready.length })}</Button>
        </div>
      </div>
    </div>
  );
}
