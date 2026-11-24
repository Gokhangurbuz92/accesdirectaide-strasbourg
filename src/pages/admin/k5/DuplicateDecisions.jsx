// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { reviewValue } from '@/components/admin/reviewValue.js';
import { useT, formatDateTime } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { ToneChip } from '@/components/ui/Tone';
import { structureTone } from '@/design/categoryTone';
import { DISTINCT, SAME } from './duplicatesModel.js';

/**
 * RA-05 — les décisions ENREGISTRÉES du registre des doublons (/admin/doublons, sous la liste des paires à examiner), y compris les décisions automatiques
 * de la veille (auteur « ada-veille-automatique ») : liste filtrée et paginée par le serveur, les deux fiches côte à côte avec la preuve et la note, et
 * « Revoir » qui permet à une personne de REMPLACER la décision en vigueur. Le remplacement part par le chemin de décision existant (session MFA, versions
 * lues, preuve officielle, journal) avec `expectedDecisionId` = la décision lue : si une autre décision a été enregistrée entre-temps, il est refusé.
 * La décision remplacée reste dans l'historique. L'écran dit ce qu'un remplacement fait et ne fait pas (aucune vérification accordée, rien de fusionné).
 * Lien direct : /admin/doublons?a=<id>&b=<id>.
 */
const AUTO = 'ada-veille-automatique';   // api/_services/duplicate-register.js AUTOMATIC_REVIEWER
const EMPTY = { decision: '', reviewer: '', status: 'active', from: '', to: '', q: '' };
const EMPTY_FORM = { decision: '', primaryId: '', evidenceUrl: '', note: '' };
const pairLink = (a, b) => `/admin/doublons?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
const formProblems = (f) => [!f.decision && 'DECISION', f.decision === SAME && !f.primaryId && 'PRIMARY', !/^https:\/\/\S+$/.test(f.evidenceUrl.trim()) && 'EVIDENCE', f.note.trim().length < 10 && 'NOTE'].filter(Boolean);

function RecordCell({ t, r, fr }) {
  const ids = [r.siret && `SIRET ${r.siret}`, r.numero_finess && `FINESS ${r.numero_finess}`, r.rna_id && `RNA ${r.rna_id}`].filter(Boolean).join(' · ');
  return (
    <div className="min-w-[12rem] space-y-0.5">
      <p className="font-semibold" {...fr}>{r.nom}</p>
      <p className="text-xs" {...fr}>{[r.adresse, [r.code_postal, r.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</p>
      <p className="text-xs">{r.type_structure ? <ToneChip tone={structureTone(r.type_structure)}><span {...fr}>{r.type_structure}</span></ToneChip> : <span {...fr}>—</span>}{ids ? ` · ${ids}` : ''}</p>
      <p className="text-xs">{r.publication_hold ? t('admin:k5.dupdec.rec_held', 'Mise de côté (hors annuaire public)') : r.verification_status === 'VERIFIED' ? t('admin:k5.dupdec.rec_verified', 'Vérifiée') : t('admin:k5.dupdec.rec_unverified', 'Non vérifiée')}</p>
      {(r.sources || []).length ? <ul className="text-xs">{r.sources.map((s) => <li key={s.url}><a className="break-all text-primary underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a></li>)}</ul> : null}
    </div>
  );
}

export default function DuplicateDecisions({ errorText }) {
  const { t } = useT('admin');
  const fr = useFrAttrs();
  const [filters, setFilters] = useState(EMPTY); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  const [data, setData] = useState({ loading: true, error: '', total: 0, pages: 1, decisions: [] });
  const [review, setReview] = useState(null);   // { a, b, detail, error }
  const [form, setForm] = useState(EMPTY_FORM); const [formError, setFormError] = useState(''); const [refused, setRefused] = useState(false); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const heading = useRef(null); const reviewHeading = useRef(null); const trigger = useRef(null); const reviewBox = useRef(null);

  const DECISION = (d) => (d === SAME ? t('admin:k5.dupdec.same', 'Même établissement') : t('admin:k5.dupdec.distinct', 'Établissements distincts'));
  const AUTHOR = (d) => ((d.automatic ?? d.reviewerId === AUTO) ? t('admin:k5.dupdec.author_auto', 'Automatique ({{id}})', { id: d.reviewerId }) : d.reviewerId);
  const PROBLEM = { DECISION: t('admin:k5.duplicates.problem.decision', 'choisissez une décision'), PRIMARY: t('admin:k5.duplicates.problem.primary', 'indiquez la fiche à conserver'),
    EVIDENCE: t('admin:k5.duplicates.problem.evidence', 'ajoutez la page officielle (https)'), NOTE: t('admin:k5.duplicates.problem.note', 'écrivez ce que la source établit (10 caractères au moins)') };

  const load = useCallback(async () => {
    setData((d) => ({ ...d, loading: true, error: '' }));
    try {
      const out = (await apiClient.admin.getDecidedDuplicates({ ...filters, page, pageSize: size })) || {};
      setData({ loading: false, error: '', total: out.total || 0, pages: out.pages || 1, decisions: out.decisions || [] });
    } catch (e) { setData({ loading: false, error: explain(e), total: 0, pages: 1, decisions: [] }); }
  }, [filters, page, size]);
  useEffect(() => { load(); }, [load]);

  const openReview = useCallback(async (a, b) => {
    setReview({ a, b, detail: null, error: '' }); setForm(EMPTY_FORM); setFormError(''); setRefused(false); setMsg('');
    try { const detail = await apiClient.admin.getDuplicates(a, b); setReview((r) => (r && r.a === a && r.b === b ? { ...r, detail } : r)); }
    catch (e) { setReview((r) => (r && r.a === a && r.b === b ? { ...r, error: explain(e) } : r)); }
  }, []);
  // lien direct ?a=&b= (la liste de revue du propriétaire pointe sur chaque paire)
  useEffect(() => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    if (p.get('a') && p.get('b')) openReview(p.get('a'), p.get('b'));
  }, [openReview]);
  useEffect(() => { if (review) reviewHeading.current?.focus(); }, [review?.a, review?.b]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const closeReview = (after) => { setReview(null); setTimeout(() => (after === 'saved' ? heading.current : trigger.current || heading.current)?.focus?.(), 0); };

  // Échap ferme la relecture sans rien changer (depuis la relecture seulement)
  const escape = useRef(null); escape.current = (e) => { if (e.key === 'Escape' && review && !busy && reviewBox.current?.contains(e.target)) closeReview(); };
  useEffect(() => { const h = (e) => escape.current(e); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, []);

  const detail = review?.detail; const active = detail?.decisions?.find((d) => !d.supersededAt) || null;
  const problems = formProblems(form);
  const submit = async (e) => {
    e.preventDefault(); setFormError(''); setRefused(false);
    if (problems.length || !active || busy) { if (problems.length) setFormError(t('admin:k5.duplicates.to_complete_short', 'À compléter : {{list}}.', { list: problems.map((c) => PROBLEM[c]).join(', ') })); return; }
    setBusy(true);
    try {
      const out = await apiClient.admin.decideDuplicates([{ a: detail.a.id, b: detail.b.id, decision: form.decision, ...(form.decision === SAME ? { primaryId: form.primaryId } : {}),
        evidenceUrl: form.evidenceUrl.trim(), note: form.note.trim(), versionA: detail.a.version, versionB: detail.b.version, expectedDecisionId: active.id }]);
      const r = (out.results || [])[0] || { ok: false };
      if (!r.ok) { setFormError(errorText ? errorText(r) : (r.message || r.code || '')); setRefused(['PAIR_ALREADY_DECIDED', 'STALE_REVIEW'].includes(r.code)); return; }
      const d = r.decision || {};
      setMsg(r.idempotent ? t('admin:k5.dupdec.saved_same', 'Décision identique à celle en vigueur : rien n’a été modifié.')
        : [t('admin:k5.dupdec.saved', 'Décision remplacée et journalisée ; la décision précédente reste dans l’historique.'),
          d.held ? t('admin:k5.dupdec.saved_held', 'Une fiche a été mise de côté (elle quitte l’annuaire public).') : '',
          (d.released || []).length ? t('admin:k5.dupdec.saved_released', 'Mise de côté « doublon » levée pour {{n}} fiche(s) : chacune retrouve son propre état de vérification.', { n: d.released.length }) : '',
          (d.restored || []).length ? t('admin:k5.dupdec.saved_restored', 'Mise de côté antérieure rétablie pour {{n}} fiche(s).', { n: d.restored.length }) : ''].filter(Boolean).join(' '));
      closeReview('saved'); await load();
    } catch (x) { setFormError(explain(x)); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="dupdec-title" data-testid="dup-decisions" data-dup-decisions>
      <h2 id="dupdec-title" ref={heading} tabIndex={-1} className="text-xl font-bold focus:outline-none">{t('admin:k5.dupdec.title', 'Décisions enregistrées')}</h2>
      <p className="text-sm">{t('admin:k5.dupdec.intro', 'Toutes les décisions du registre, y compris celles que la veille automatique a prises seule (même SIRET sans autre registre qui distingue les fiches). Une personne peut revoir chaque décision en vigueur et la remplacer ; la décision remplacée reste dans l’historique.')}</p>
      <div role="status" aria-live="polite" className="text-sm" data-testid="dupdec-status">{msg}</div>

      <form className="flex flex-wrap items-end gap-2 text-sm" aria-label={t('admin:k5.dupdec.filters', 'Filtrer les décisions enregistrées')} data-testid="dupdec-filters"
        onSubmit={(e) => { e.preventDefault(); setFilter('q', search.trim()); }}>
        <label className="flex flex-col">{t('admin:k5.dupdec.f_author', 'Auteur')}
          <select className="rounded border p-1" value={filters.reviewer} onChange={(e) => setFilter('reviewer', e.target.value)} data-testid="dupdec-filter-author">
            <option value="">{t('admin:k5.dupdec.f_all', 'tous')}</option><option value="auto">{t('admin:k5.dupdec.f_auto', 'décisions automatiques')}</option><option value="human">{t('admin:k5.dupdec.f_human', 'décisions d’une personne')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.dupdec.f_decision', 'Décision')}
          <select className="rounded border p-1" value={filters.decision} onChange={(e) => setFilter('decision', e.target.value)} data-testid="dupdec-filter-decision">
            <option value="">{t('admin:k5.dupdec.f_all_f', 'toutes')}</option><option value={SAME}>{DECISION(SAME)}</option><option value={DISTINCT}>{DECISION(DISTINCT)}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.dupdec.f_status', 'État')}
          <select className="rounded border p-1" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} data-testid="dupdec-filter-status">
            <option value="active">{t('admin:k5.dupdec.f_active', 'en vigueur')}</option><option value="superseded">{t('admin:k5.dupdec.f_superseded', 'remplacées (historique)')}</option><option value="all">{t('admin:k5.dupdec.f_all_f', 'toutes')}</option>
          </select></label>
        <label className="flex flex-col">{t('admin:k5.dupdec.f_from', 'Décidée du (jour UTC)')}
          <input type="date" className="rounded border p-1" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} data-testid="dupdec-filter-from" /></label>
        <label className="flex flex-col">{t('admin:k5.dupdec.f_to', 'au')}
          <input type="date" className="rounded border p-1" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} /></label>
        <label className="flex flex-col">{t('admin:k5.dupdec.f_search', 'Rechercher (nom, ville, adresse, SIRET, FINESS, note, auteur)')}
          <input type="search" className="rounded border p-1" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="dupdec-search" /></label>
        <Button size="sm" type="submit" variant="outline" data-testid="dupdec-apply">{t('admin:k5.dupdec.apply', 'Rechercher')}</Button>
        <label className="flex flex-col">{t('admin:k5.duplicates.page_size', 'Par page')}
          <select className="rounded border p-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </form>

      {data.error ? <p role="alert" className="text-sm text-destructive" data-testid="dupdec-problem">{data.error} <button type="button" className="underline" onClick={load}>{t('admin:k5.dupdec.retry', 'Réessayer')}</button></p> : null}

      {review ? (
        <section ref={reviewBox} className="space-y-3 rounded border border-primary p-3" aria-labelledby="dupdec-review-title" data-testid="dupdec-review">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 id="dupdec-review-title" ref={reviewHeading} tabIndex={-1} className="font-semibold focus:outline-none">{t('admin:k5.dupdec.review_title', 'Revoir la décision de cette paire')}</h3>
            <Button size="sm" variant="outline" onClick={() => closeReview()} data-testid="dupdec-review-close">{t('admin:k5.dupdec.close', 'Fermer sans rien changer')}</Button>
          </div>
          {review.error ? <p role="alert" className="text-sm text-destructive">{review.error}</p> : null}
          {!detail && !review.error ? <p role="status" className="text-sm">{t('admin:k5.duplicates.loading', 'Chargement…')}</p> : null}
          {detail ? (
            <>
              <div className="rounded border bg-muted p-2 text-sm" data-testid="dupdec-current">
                {active ? (
                  <>
                    <p className="font-medium">{t('admin:k5.dupdec.current', 'Décision en vigueur : {{decision}} — {{author}} — {{date}}', { decision: DECISION(active.decision), author: AUTHOR(active), date: formatDateTime(active.decidedAt) })}</p>
                    {active.decision === SAME ? <p>{t('admin:k5.dupdec.current_kept', 'Fiche conservée : {{nom}}', { nom: active.primaryId === detail.a.id ? detail.a.nom : detail.b.nom })}</p> : null}
                    <p>{t('admin:k5.dupdec.evidence', 'Preuve :')} <a className="break-all text-primary underline" href={active.evidenceUrl} target="_blank" rel="noreferrer noopener">{active.evidenceUrl}</a></p>
                    <p>{t('admin:k5.dupdec.note', 'Note :')} <span {...fr}>{active.note}</span></p>
                  </>
                ) : <p data-testid="dupdec-no-active">{t('admin:k5.dupdec.no_active', 'Cette paire n’a pas de décision en vigueur : elle se traite dans la liste des paires à examiner, plus haut.')}</p>}
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {[detail.a, detail.b].map((r, i) => (
                  <div key={r.id} className="space-y-1 rounded border p-2 text-sm" data-testid="dupdec-record">
                    <h4 className="font-semibold">{i === 0 ? t('admin:k5.duplicates.record1', 'Fiche 1') : t('admin:k5.duplicates.record2', 'Fiche 2')} : <span {...fr}>{r.nom}</span></h4>
                    <p className="text-xs">{t('admin:k5.duplicates.record_status', 'Statut : {{statut}} — vérification : {{verification}}', { statut: r.statut || '—', verification: r.verification || t('admin:k5.duplicates.none_f', 'aucune') })}{r.hold ? t('admin:k5.dupdec.record_hold', ' — mise de côté : {{hold}}', { hold: r.hold }) : ''}</p>
                    <dl className="space-y-1 text-xs">{(r.content || []).map((c) => <div key={c.field}><dt className="inline font-medium">{c.field} : </dt><dd className="inline whitespace-pre-wrap break-words" {...(c.field === 'accessibilite_pmr' ? {} : fr)}>{reviewValue(c.field, c.value)}</dd></div>)}</dl>
                  </div>
                ))}
              </div>

              {detail.decisions?.length ? (
                <div className="text-sm">
                  <h4 className="font-semibold">{t('admin:k5.dupdec.history', 'Historique des décisions de la paire')}</h4>
                  <ol className="list-decimal space-y-1 ps-5" data-testid="dupdec-history">
                    {detail.decisions.map((d) => (
                      <li key={d.id}>{formatDateTime(d.decidedAt)} — {DECISION(d.decision)} — {AUTHOR(d)} — {d.supersededAt ? t('admin:k5.dupdec.superseded_on', 'remplacée le {{date}}', { date: formatDateTime(d.supersededAt) }) : t('admin:k5.dupdec.in_force', 'en vigueur')}
                        <br /><a className="break-all text-primary underline" href={d.evidenceUrl} target="_blank" rel="noreferrer noopener">{d.evidenceUrl}</a> — <span {...fr}>{d.note}</span></li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {active ? (
                <form className="space-y-2 rounded border p-2 text-sm" onSubmit={submit} noValidate data-testid="dupdec-form">
                  <div className="rounded border p-2" data-testid="dupdec-effects">
                    <h4 className="font-semibold">{t('admin:k5.dupdec.effects_title', 'Ce qu’un remplacement fait, et ne fait pas')}</h4>
                    <ul className="list-disc space-y-1 ps-5">
                      <li>{t('admin:k5.dupdec.effect_history', 'La décision en vigueur n’est pas effacée : elle reste dans l’historique, marquée « remplacée ». La nouvelle décision est journalisée à votre nom.')}</li>
                      <li>{t('admin:k5.dupdec.effect_distinct', '« Établissements distincts » à la place de « même établissement » : la mise de côté « doublon » de la fiche écartée est levée. Cette fiche retrouve seulement son propre état : elle redevient visible dans l’annuaire public si elle était déjà vérifiée et qu’aucune autre mise de côté ne la retient ; sinon elle reste non publiée. Une mise de côté antérieure, posée pour une autre raison, est rétablie.')}</li>
                      <li>{t('admin:k5.dupdec.effect_same', '« Même établissement » : la fiche non conservée est mise de côté et quitte l’annuaire public.')}</li>
                      <li>{t('admin:k5.dupdec.effect_never', 'Ce qui ne se produit jamais : le remplacement n’accorde aucune vérification (une fiche non vérifiée n’est jamais publiée par ce biais), ne fusionne et ne supprime rien, et ne copie aucune information d’une fiche à l’autre.')}</li>
                      <li>{t('admin:k5.dupdec.effect_concurrency', 'Si une autre décision est enregistrée pour cette paire pendant votre lecture, ou si une fiche change, le remplacement est refusé : rechargez la paire.')}</li>
                    </ul>
                  </div>
                  <fieldset>
                    <legend className="font-medium">{t('admin:k5.dupdec.new_decision', 'Nouvelle décision')}</legend>
                    {[SAME, DISTINCT].map((v) => (
                      <label key={v} className="me-4 inline-flex items-center gap-1"><input type="radio" name="dupdec-decision" value={v} checked={form.decision === v} onChange={() => setForm((f) => ({ ...f, decision: v }))} data-testid={`dupdec-choose-${v}`} />{DECISION(v)}</label>
                    ))}
                  </fieldset>
                  {form.decision === SAME ? (
                    <div><label htmlFor="dupdec-primary" className="block">{t('admin:k5.duplicates.keep_label', 'Fiche à conserver (l’autre quitte l’annuaire public)')}</label>
                      <select id="dupdec-primary" className="rounded border p-1" value={form.primaryId} onChange={(e) => setForm((f) => ({ ...f, primaryId: e.target.value }))}>
                        <option value="">—</option><option value={detail.a.id}>{t('admin:k5.duplicates.option1', 'Fiche 1 : {{nom}}', { nom: detail.a.nom })}</option><option value={detail.b.id}>{t('admin:k5.duplicates.option2', 'Fiche 2 : {{nom}}', { nom: detail.b.nom })}</option>
                      </select></div>
                  ) : null}
                  <div><label htmlFor="dupdec-evidence" className="block">{t('admin:k5.duplicates.evidence_label', 'Preuve institutionnelle (page d’un registre officiel : annuaire des entreprises, FINESS, Journal officiel…)')}</label>
                    <input id="dupdec-evidence" type="url" className="w-full rounded border p-1" value={form.evidenceUrl} onChange={(e) => setForm((f) => ({ ...f, evidenceUrl: e.target.value }))} /></div>
                  <div><label htmlFor="dupdec-note" className="block">{t('admin:k5.duplicates.note_label', 'Ce que la source établit (conservé dans le registre)')}</label>
                    <textarea id="dupdec-note" className="w-full rounded border p-1" rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
                  {formError ? <p role="alert" className="text-destructive" data-testid="dupdec-form-error">{formError} {refused ? <button type="button" className="underline" onClick={() => openReview(review.a, review.b)} data-testid="dupdec-reload">{t('admin:k5.dupdec.reload_pair', 'Recharger la paire')}</button> : null}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={busy} data-testid="dupdec-submit">{busy ? t('admin:k5.duplicates.saving', 'Enregistrement…') : t('admin:k5.dupdec.submit', 'Remplacer la décision en vigueur')}</Button>
                    <a className="self-center text-xs text-primary underline" href={pairLink(detail.a.id, detail.b.id)} data-testid="dupdec-link">{t('admin:k5.dupdec.link', 'Lien direct vers cette paire')}</a>
                  </div>
                </form>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <p className="text-sm" data-testid="dupdec-count">{data.loading ? t('admin:k5.duplicates.loading', 'Chargement…') : t('admin:k5.dupdec.count', '{{total}} décision(s) pour ces filtres.', { total: data.total })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="dupdec-table">
          <caption className="sr-only">{t('admin:k5.dupdec.caption', 'Décisions enregistrées : décision, les deux fiches, auteur, preuve et note')}</caption>
          <thead><tr className="border-b text-start">
            <th scope="col" className="p-1 text-start">{t('admin:k5.dupdec.f_decision', 'Décision')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.duplicates.record1', 'Fiche 1')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.duplicates.record2', 'Fiche 2')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.dupdec.f_author', 'Auteur')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.dupdec.col_evidence', 'Preuve et note')}</th>
            <th scope="col" className="p-1 text-start">{t('admin:k5.dupdec.col_action', 'Action')}</th>
          </tr></thead>
          <tbody>
            {data.decisions.map((d) => (
              <tr key={d.id} className="border-b align-top" data-testid="dupdec-row" data-automatic={d.automatic ? 'true' : 'false'}>
                <td className="p-1">
                  <p className="font-medium">{DECISION(d.decision)}</p>
                  <p className="text-xs">{formatDateTime(d.decidedAt)}</p>
                  <p className="text-xs">{d.supersededAt ? t('admin:k5.dupdec.superseded_on', 'remplacée le {{date}}', { date: formatDateTime(d.supersededAt) }) : t('admin:k5.dupdec.in_force', 'en vigueur')}</p>
                  {d.decision === SAME ? <p className="text-xs">{t('admin:k5.dupdec.kept', 'Conservée : {{which}}', { which: d.primaryId === d.a ? t('admin:k5.duplicates.record1', 'Fiche 1') : t('admin:k5.duplicates.record2', 'Fiche 2') })}</p> : null}
                  {d.changedSince ? <p className="text-xs">{t('admin:k5.dupdec.changed', 'Une fiche a changé depuis cette décision.')}</p> : null}
                </td>
                <td className="p-1"><RecordCell t={t} r={d.A} fr={fr} /></td>
                <td className="p-1"><RecordCell t={t} r={d.B} fr={fr} /></td>
                <td className="p-1">{AUTHOR(d)}</td>
                <td className="p-1"><a className="break-all text-primary underline" href={d.evidenceUrl} target="_blank" rel="noreferrer noopener">{d.evidenceUrl}</a><p className="mt-1 whitespace-pre-wrap" {...fr}>{d.note}</p></td>
                <td className="p-1">
                  {d.supersededAt ? <span className="text-xs text-muted-foreground">{t('admin:k5.dupdec.history_only', 'Historique (lecture seule)')}</span> : (
                    <Button size="sm" variant="outline" data-testid="dupdec-review-open" aria-label={t('admin:k5.dupdec.review_label', 'Revoir la décision : {{a}} / {{b}}', { a: d.A.nom, b: d.B.nom })}
                      onClick={(e) => { trigger.current = e.currentTarget; openReview(d.a, d.b); }}>{t('admin:k5.dupdec.review', 'Revoir')}</Button>
                  )}
                </td>
              </tr>
            ))}
            {!data.loading && !data.decisions.length ? <tr><td colSpan={6} className="p-2">{t('admin:k5.dupdec.none', 'Aucune décision pour ces filtres.')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <nav aria-label={t('admin:k5.dupdec.pagination', 'Pages des décisions enregistrées')} className="flex flex-wrap items-center gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="dupdec-prev">{t('admin:k5.duplicates.prev_page', 'Page précédente')}</Button>
        <span data-testid="dupdec-page">{t('admin:k5.duplicates.page_of', 'Page {{page}} sur {{pages}}', { page, pages: data.pages })}</span>
        <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage(page + 1)} data-testid="dupdec-next">{t('admin:k5.duplicates.next_page', 'Page suivante')}</Button>
      </nav>
    </section>
  );
}
