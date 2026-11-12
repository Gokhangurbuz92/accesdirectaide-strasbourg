// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { explain } from '@/pages/admin/k5/helpers.js';
import i18n, { useT } from '@/i18n';
import { DATE_SHORT, formatDate } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

/**
 * PKG-11 / A02 — administrator list of one catalogue kind (aide, démarche, structure) through /api/admin/content: drafts, unverified and archived records
 * included (before: the public API, which hides them), with publish / unpublish and archive. Publication on the public site still needs the D-5 verification,
 * which this screen states and never sets.
 */
const STATE = () => ({ brouillon: i18n.t('admin:catalogue_list.state.draft', 'Brouillon'), publie: i18n.t('admin:catalogue_list.state.published', 'Publié'), actif: i18n.t('admin:catalogue_list.state.published', 'Publié'), archive: i18n.t('admin:catalogue_list.state.archived', 'Archivé') });
// owner LAB audit (2026-10-25): the label says what was really decided — a reviewer's hold, a change made after a verification, a refusal, a verification —
// instead of « en attente de revérification » for every hold and « non vérifiée » for refused records
const verification = (r) => (r.publication_hold ? (r.holdKind === 'EDIT' ? i18n.t('admin:catalogue_list.verif.edited', 'Modifiée depuis la vérification : à revérifier') : i18n.t('admin:catalogue_list.verif.hold', 'En attente (décision d’une personne)'))
  : r.verification_status === 'VERIFIED' ? i18n.t('admin:catalogue_list.verif.verified', 'Vérifiée') : r.verification_status === 'REJECTED' ? i18n.t('admin:catalogue_list.verif.rejected', 'Refusée') : i18n.t('admin:catalogue_list.verif.never', 'Non vérifiée'));
const statusOf = (r) => (r.publication_hold ? (r.holdKind === 'EDIT' ? 'edit' : 'hold') : r.verification_status === 'VERIFIED' ? 'verified' : r.verification_status === 'REJECTED' ? 'rejected' : 'never');
const FILTERS = () => [['all', i18n.t('admin:catalogue_list.filter.all', 'Toutes')], ['never', i18n.t('admin:catalogue_list.filter.never', 'Non vérifiées')], ['hold', i18n.t('admin:catalogue_list.filter.hold', 'En attente (décision)')], ['edit', i18n.t('admin:catalogue_list.filter.edit', 'Modifiées depuis la vérification')], ['rejected', i18n.t('admin:catalogue_list.filter.rejected', 'Refusées')], ['verified', i18n.t('admin:catalogue_list.filter.verified', 'Vérifiées')]];

export default function CatalogueList({ kind, title, published, newPath, editPath, createLabel, verifiable = true }) {
  const { t } = useT('admin');
  const fr = useFrAttrs();   // R47: the record's own words (name, category, town) stay French: lang="fr" outside French
  const filters = FILTERS(); const states = STATE();
  const [q, setQ] = useState(''); const [items, setItems] = useState(null); const [error, setError] = useState('');
  const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const [show, setShow] = useState('all');
  // UX ecosystem (2026-11-12): a sort (recently changed first, or by name) and the number of records shown; the filter label stays beside its control
  const [sort, setSort] = useState('recent');
  const shown = (items || []).filter((r) => show === 'all' || statusOf(r) === show)
    .sort(sort === 'name' ? (a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'fr', { sensitivity: 'base' })
      : (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  // UX ecosystem (2026-11-12): the server stops at 500 records; it now says how many match (total) and counts each status over the whole catalogue,
  // and the status filter is applied by the server — a record beyond the first 500 is reachable by the filter, not only by its name
  const [meta, setMeta] = useState(/** @type {{ total?: number, limit?: number, counts?: Record<string, number> } | null} */ (null));
  const load = useCallback(async (query = '', status = 'all') => {
    // R7: a failed load keeps the list unknown (it showed « Aucune fiche. » under the error, as if the catalogue were empty)
    try { const r = await apiClient.admin.content.list(kind, query, status); setItems(r.items || []); setMeta({ total: r.total, limit: r.limit, counts: r.counts }); setError(''); } catch (e) { setError(t('admin:catalogue_list.load_error', 'La liste n’a pas pu être chargée : {{reason}}', { reason: explain(e) })); setItems(null); }
  }, [kind]);   // eslint-disable-line react-hooks/exhaustive-deps -- the message follows the language at load time
  useEffect(() => { load(q, show); }, [load, show]);   // eslint-disable-line react-hooks/exhaustive-deps -- the search is applied on submit
  const act = async (fn, ok) => {
    setBusy(true); setMsg(''); setProblem('');
    try { await fn(); setMsg(ok); await load(q, show); } catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };
  const countOf = (k) => (meta?.counts ? (meta.counts[k] || 0) : (items || []).filter((r) => statusOf(r) === k).length);
  const allCount = meta?.counts ? Object.values(meta.counts).reduce((a, b) => a + b, 0) : (items || []).length;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid={`admin-catalogue-${kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <Button asChild className="min-h-11"><Link to={newPath}>{createLabel}</Link></Button>
      </div>
      <p className="text-sm text-slate-700">{verifiable
        ? t('admin:catalogue_list.help_verifiable', 'Une fiche créée est un brouillon. « Publier » la rend publiable ; elle n’apparaît sur le site qu’une fois vérifiée (registre de vérification). Modifier une fiche vérifiée la met en attente de revérification. Archiver ne supprime rien.')
        : t('admin:catalogue_list.help_editorial', 'Un contenu créé est un brouillon. « Publier » le met en ligne aussitôt (contenu éditorial d’ADA, sans registre de vérification) ; « Dépublier » le retire. Chaque modification garde la version précédente. Archiver ne supprime rien.')}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(q, show); }}>
        <label htmlFor={`admin-catalogue-q-${kind}`} className="sr-only">{t('admin:catalogue_list.search', 'Rechercher')}</label>
        <Input id={`admin-catalogue-q-${kind}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin:catalogue_list.search_placeholder', 'Rechercher par nom ou identifiant')} />
        <Button type="submit" variant="outline" className="min-h-11">{t('admin:catalogue_list.search', 'Rechercher')}</Button>
      </form>
      <p role="status" aria-live="polite" data-testid="admin-catalogue-status" className={msg ? 'sticky top-20 z-10 rounded border border-green-300 bg-green-50 p-2 text-sm text-green-900 md:top-0' : 'text-sm text-slate-900'}>{msg}</p>
      {problem ? <p role="alert" data-testid="admin-catalogue-problem" className="text-sm text-rose-800">{problem}</p> : null}
      {error ? <p role="alert" data-testid="admin-catalogue-load-error" className="text-sm text-rose-800">{error}</p> : null}
      {verifiable && (items?.length || show !== 'all') ? (
        <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="admin-catalogue-summary">
          <span>{t('admin:catalogue_list.summary', '{{n}} fiches : {{detail}}', { n: allCount, detail: filters.slice(1).map(([k, l]) => `${countOf(k)} ${l.toLowerCase()}`).join(' · ') })}</span>
          <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <label htmlFor={`admin-catalogue-show-${kind}`}>{t('admin:catalogue_list.show', 'Afficher')}</label>
            <select id={`admin-catalogue-show-${kind}`} className="min-h-11 rounded border border-slate-300 px-2" value={show} onChange={(e) => setShow(e.target.value)}>
              {filters.map(([k, l]) => <option key={k} value={k}>{`${l} (${k === 'all' ? allCount : countOf(k)})`}</option>)}
            </select>
          </span>
        </div>
      ) : null}
      {items?.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={`admin-catalogue-sort-${kind}`}>{t('admin:catalogue_list.sort', 'Trier')}</label>
          <select id={`admin-catalogue-sort-${kind}`} className="min-h-11 rounded border border-slate-300 px-2" value={sort} onChange={(e) => setSort(e.target.value)} data-testid="admin-catalogue-sort">
            <option value="recent">{t('admin:catalogue_list.sort_recent', 'Modifiées récemment')}</option>
            <option value="name">{t('admin:catalogue_list.sort_name', 'Par nom (A → Z)')}</option>
          </select>
          <span className="text-slate-700" data-testid="admin-catalogue-count">{t('admin:catalogue_list.shown', '{{count}} fiche(s) affichée(s)', { count: shown.length })}</span>
        </div>
      ) : null}
      {meta?.total > (items?.length || 0) ? <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950" data-testid="admin-catalogue-truncated">{t('admin:catalogue_list.truncated', 'Seules les {{shown}} fiches les plus récemment modifiées sur {{total}} sont affichées : recherchez par nom ou filtrez par état pour atteindre les autres.', { shown: items?.length || 0, total: meta.total })}</p> : null}
      {items === null ? (error ? null : <p role="status">{t('admin:catalogue_list.loading', 'Chargement…')}</p>) : shown.length === 0 ? <p data-testid="admin-catalogue-empty">{t('admin:catalogue_list.empty', 'Aucune fiche.')}</p> : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-300 bg-white p-3" data-testid="admin-catalogue-row" data-id={r.id}>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900" {...fr}>{r.label}</p>
                <p className="text-xs text-slate-700">{(r.categorie || r.ville || r.departement) ? <span {...fr}>{r.categorie || r.ville || r.departement}</span> : null}{(r.categorie || r.ville || r.departement) && r.updatedAt ? ' — ' : null}{r.updatedAt ? t('admin:catalogue_list.modified_on', 'modifiée le {{date}}', { date: formatDate(r.updatedAt, DATE_SHORT) }) : null}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge variant="secondary" data-testid="admin-catalogue-state">{states[r.statut] || r.statut}</Badge>
                  {verifiable ? <Badge variant="outline" data-testid="admin-catalogue-verification">{verification(r)}</Badge> : null}
                </div>
                {verifiable && r.publication_hold ? <p className="mt-1 max-w-2xl text-xs text-slate-700" data-testid="admin-catalogue-hold">{t('admin:catalogue_list.hold_reason', 'Motif : {{reason}}', { reason: String(r.publication_hold).slice(0, 160) })}{String(r.publication_hold).length > 160 ? '…' : ''}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="min-h-11"><Link to={editPath(r.id)}>{t('admin:catalogue_list.edit', 'Modifier')}</Link></Button>
                {r.statut !== 'archive' && r.statut !== published && (kind !== 'structure' || r.statut === 'brouillon') ? <Button size="sm" className="min-h-11" disabled={busy} onClick={() => act(() => apiClient.admin.content.update(kind, r.id, { statut: published }), t('admin:catalogue_list.done.published', 'Fiche marquée publiée.'))}>{t('admin:catalogue_list.publish', 'Publier')}</Button> : null}
                {r.statut === published ? <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => act(() => apiClient.admin.content.update(kind, r.id, { statut: 'brouillon' }), t('admin:catalogue_list.done.unpublished', 'Fiche repassée en brouillon.'))}>{t('admin:catalogue_list.unpublish', 'Dépublier')}</Button> : null}
                {r.statut !== 'archive' ? <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => { if (window.confirm(t('admin:catalogue_list.confirm_archive', 'Archiver cette fiche ? Elle disparaît du site ; une version est conservée.'))) act(() => apiClient.admin.content.archive(kind, r.id), t('admin:catalogue_list.done.archived', 'Fiche archivée.')); }}>{t('admin:catalogue_list.archive', 'Archiver')}</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
