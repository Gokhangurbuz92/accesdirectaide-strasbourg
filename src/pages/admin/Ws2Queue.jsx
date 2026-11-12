// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import VerificationPanel from '@/components/admin/VerificationPanel';
import { reviewValue } from '@/components/admin/reviewValue.js';
import i18n, { useT } from '@/i18n';
import { DATE_SHORT, formatDate } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

const STATE_LABEL = () => ({
  HUMAN_VERIFIED: i18n.t('admin:ws2.state.human_verified', 'Vérifié par une personne'), PENDING_HUMAN_VERIFICATION: i18n.t('admin:ws2.state.pending', 'À vérifier'), REJECTED: i18n.t('admin:ws2.state.rejected', 'Refusé'), ON_HOLD: i18n.t('admin:ws2.state.on_hold', 'En attente'), NOT_IN_DATABASE: i18n.t('admin:ws2.state.not_in_database', 'Absent de la base'),
});
const FILTERS = ['ALL', 'PENDING_HUMAN_VERIFICATION', 'HUMAN_VERIFIED', 'ON_HOLD', 'REJECTED', 'NOT_IN_DATABASE'];
// owner LAB audit (2026-10-25): from a record of the queue, the editor where it is corrected (corrections come before a new decision)
const EDITOR = { aide: 'aides', demarche: 'demarches', structure: 'structures' };
const GROUPS = () => ({ A_PRET: i18n.t('admin:ws2.group.ready', 'Prêtes à comparer avec la source'), D_IDENTITE: i18n.t('admin:ws2.group.identity', 'Structures : identité à confirmer'), C_A_TRANCHER: i18n.t('admin:ws2.group.to_decide', 'Incohérence à trancher'), E_BLOQUANT: i18n.t('admin:ws2.group.blocking', 'À corriger d’abord'), B_A_RECHERCHER: i18n.t('admin:ws2.group.find_source', 'Source à trouver') });

/**
 * PKG-5 / WS2 — file de vérification humaine (/admin/ws2). Les 49 fiches du lancement, leur fiche en base et la dernière décision du registre de vérification.
 * Les recherches antérieures (source candidate, constats) sont une aide : seule une décision VERIFY enregistrée par une personne d'ADA avec MFA, avec une source
 * officielle, compte comme vérification. Aucune décision n'est déduite d'un fichier.
 */
export default function AdminWs2Queue() {
  const { t } = useT('admin');
  // R47: the record's title and content, and the server's preparation notes (French), stay French: lang="fr" outside French; the earlier research
  // notes of the evidence matrix are written in English (codes and an English sentence): lang="en"
  const fr = useFrAttrs();
  const stateLabel = STATE_LABEL(); const groups = GROUPS();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  // owner LAB audit: the view opens on what still needs a person — « à vérifier » if any, else the records on hold, else everything (it used to open on an
  // empty « à vérifier » list once every record had a decision)
  const [filter, setFilter] = useState(null); const [group, setGroup] = useState('ALL');
  const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  // UX ecosystem (2026-11-12): ONE disclosure per record, « Comparer et décider », shows the content to compare, the source and the decision form side by side
  // (it took three separate disclosures and scrolling between them); the first record of the view opens by itself, and after a decision the next record of the
  // view opens and takes the focus — no re-entry, no scrolling back. A text search narrows the 49 records. Nothing is decided automatically.
  const [query, setQuery] = useState(''); const [openKey, setOpenKey] = useState(null);
  const nextFocus = useRef(null);
  const load = useCallback(async () => {
    try {
      const data = await apiClient.admin.getWs2Queue(); setState({ loading: false, error: '', data });
      setFilter((f) => f ?? (data?.totals?.pending ? 'PENDING_HUMAN_VERIFICATION' : data?.totals?.onHold ? 'ON_HOLD' : 'ALL'));
    }
    catch (e) { setState({ loading: false, error: e?.message || t('admin:ws2.load_impossible', 'Chargement impossible.'), data: null }); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; the message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const key = (r) => `${r.dataset}:${r.slug}`;
  const tot = state.data?.totals;
  const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const records = (state.data?.records || []).filter((r) => (!filter || filter === 'ALL' || r.state === filter) && (group === 'ALL' || r.preparation?.group === group)
    && (!query.trim() || norm(`${r.title} ${r.slug} ${r.dataset}`).includes(norm(query.trim()))));
  const visibleKeys = records.map(key).join('|');
  // the first record of the view is open (unless the person closed every record on purpose: openKey === '')
  useEffect(() => { if (openKey === null || (openKey && !visibleKeys.split('|').includes(openKey))) setOpenKey(visibleKeys.split('|')[0] || null); }, [visibleKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (nextFocus.current && openKey === nextFocus.current) { document.getElementById(`ws2-rec-${openKey}`)?.focus(); nextFocus.current = null; } }, [openKey]);
  const done = async (ok, r) => {
    setProblem(''); setMsg(ok);
    const i = records.findIndex((x) => key(x) === key(r)); const next = records[i + 1] || null;
    await load();
    if (next) { nextFocus.current = key(next); setOpenKey(key(next)); }
  };
  return (
    <div className="space-y-4 p-4" data-testid="admin-ws2">
      <h1 className="text-2xl font-bold">{t('admin:ws2.title', 'Vérification des contenus du lancement (WS2)')}</h1>
      <p className="text-sm text-slate-700">{t('admin:ws2.intro', 'Contrôle historique WS2 : il comptait les fiches du lancement vérifiées par une personne d’ADA (session avec MFA). Depuis la décision D-5 v2, la publication suit la vérification automatique (page Veille) ; ce contrôle reste affiché comme trace. Les recherches préparatoires affichées ci-dessous ne valent pas vérification.')}</p>
      {state.error ? <div role="alert" className="text-red-800"><p>{state.error}</p><button type="button" className="mt-1 rounded border px-3 py-1 text-sm underline" data-testid="admin-ws2-retry" onClick={() => { setState((s) => ({ ...s, loading: true })); load(); }}>{t('admin:ws2.retry', 'Réessayer')}</button></div> : null}
      {problem ? <p role="alert" className="text-red-800" data-testid="admin-ws2-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" data-testid="admin-ws2-status" className={msg ? 'sticky top-20 z-10 rounded border border-green-300 bg-green-50 p-2 text-sm text-green-900 md:top-0' : ''}>{msg}</div>
      {tot ? (
        <p data-testid="admin-ws2-totals" className="text-sm">{t('admin:ws2.totals', '{{records}} fiches — {{humanVerified}} vérifiées, {{pending}} à vérifier, {{onHold}} en attente, {{rejected}} refusées, {{notInDatabase}} absentes de la base.', { records: tot.records, humanVerified: tot.humanVerified, pending: tot.pending, onHold: tot.onHold, rejected: tot.rejected, notInDatabase: tot.notInDatabase })}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <label htmlFor="ws2-filter" className="text-sm">{t('admin:ws2.show', 'Afficher')}</label>
      <select id="ws2-filter" className="rounded border p-2" value={filter || 'ALL'} onChange={(e) => setFilter(e.target.value)}>
        {FILTERS.map((x) => <option key={x} value={x}>{x === 'ALL' ? t('admin:ws2.all_records', 'Toutes') : stateLabel[x]}</option>)}
      </select>
      <label htmlFor="ws2-group" className="text-sm sm:ml-2">{t('admin:ws2.group', 'Groupe')}</label>
      <select id="ws2-group" className="rounded border p-2" value={group} onChange={(e) => setGroup(e.target.value)}>
        <option value="ALL">{t('admin:ws2.all_groups', 'Tous')}</option>
        {Object.entries(groups).map(([k, l]) => <option key={k} value={k}>{l}{state.data?.groups?.[k] ? ` (${state.data.groups[k]})` : ''}</option>)}
      </select>
      <label htmlFor="ws2-search" className="text-sm sm:ml-2">{t('admin:ws2.search', 'Rechercher')}</label>
      <input id="ws2-search" type="search" className="rounded border p-2" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="admin-ws2-search" />
      </div>
      {state.data ? <p className="text-sm text-slate-700" aria-live="polite" data-testid="admin-ws2-count">{t('admin:ws2.shown', '{{count}} fiche(s) affichée(s)', { count: records.length })}</p> : null}
      {state.error && !state.data ? null : state.loading ? <p role="status">{t('admin:ws2.loading', 'Chargement…')}</p> : (
        <ul className="space-y-3">
          {records.length === 0 ? <li className="text-slate-700" data-testid="admin-ws2-empty">{t('admin:ws2.empty', 'Aucune fiche dans ce filtre.')}</li> : null}
          {records.map((r) => (
            <li key={key(r)} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-ws2-record">
              <p className="font-semibold"><span {...fr}>{r.title}</span> <span className="font-normal text-slate-700">— {r.dataset}</span></p>
              <p data-testid="admin-ws2-state">{stateLabel[r.state] || r.state}{r.decision ? t('admin:ws2.decision_of', ' — décision du {{date}}', { date: formatDate(r.decision.at, DATE_SHORT) }) : ''}</p>
              {r.hold ? <p className="text-slate-800" data-testid="admin-ws2-hold-reason">{t('admin:ws2.hold_reason', 'Motif de l’attente : {{reason}}', { reason: r.hold })}</p> : null}
              {r.entityId && EDITOR[r.entityType] ? <p><Link className="text-blue-800 underline" to={`/admin/${EDITOR[r.entityType]}/${r.entityId}`}>{t('admin:ws2.fix_in_editor', 'Corriger la fiche dans l’éditeur')}</Link> <span className="text-slate-700">{t('admin:ws2.fix_changes_version', '(une correction change la version : la décision se prend ensuite sur la fiche corrigée)')}</span></p> : null}
              {r.preparation && r.state !== 'HUMAN_VERIFIED' ? <p data-testid="admin-ws2-prep-summary"><span className="font-medium">{groups[r.preparation.group]}</span> — <span {...fr}>{r.preparation.next}</span></p> : null}
              {/* 'toggle' is dispatched asynchronously (a queued task) for EVERY change of `open`, ours included; an event whose state equals what this render
                  already shows is the echo of our own change, not the person's. Applying it could undo a newer choice queued meanwhile (after a decision, the
                  late echo of the first record's auto-open re-opened it over the next record — flaky ws2 test, CI 43241511517). */}
              <details open={openKey === key(r)} onToggle={(e) => { const o = e.currentTarget.open; if (o === (openKey === key(r))) return; setOpenKey((k) => (o ? key(r) : k === key(r) ? '' : k)); }} data-testid="admin-ws2-review">
                <summary id={`ws2-rec-${key(r)}`} tabIndex={-1} className="cursor-pointer font-medium text-blue-800">{r.entityId ? (r.state === 'HUMAN_VERIFIED' ? t('admin:ws2.review_verified', 'Revoir la fiche et la décision') : t('admin:ws2.compare_decide', 'Comparer et décider')) : t('admin:ws2.research', 'Recherche préparatoire (aide, non probante)')}</summary>
                <div className="mt-2 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    {r.preparation && r.state !== 'HUMAN_VERIFIED' ? (
                      <div className="rounded bg-slate-50 p-2" data-testid="admin-ws2-prep">
                        <ul className="list-disc pl-5">{r.preparation.check.map((c, i) => <li key={i} {...fr}>{c}</li>)}</ul>
                        {r.preparation.sourceUrl ? <p>{t('admin:ws2.source_to_check', 'Source à consulter :')} <a className="break-all text-blue-800 underline" href={r.preparation.sourceUrl} target="_blank" rel="noreferrer noopener">{r.preparation.sourceUrl}</a>{r.preparation.sourceAccepted ? t('admin:ws2.source_accepted', ' (acceptée)') : t('admin:ws2.source_not_accepted', ' (non acceptée en l’état)')}</p> : null}
                        <p className="text-xs text-slate-700">{t('admin:ws2.prep_note', 'Préparation automatique : elle aide, elle ne vaut pas vérification. La décision reste la vôtre.')}</p>
                      </div>
                    ) : null}
                    {r.current?.length && r.state !== 'HUMAN_VERIFIED' ? (
                      <section data-testid="admin-ws2-current" aria-label={t('admin:ws2.current_content', 'Contenu actuel de la fiche (à comparer)')}>
                        <h2 className="font-medium">{t('admin:ws2.current_content', 'Contenu actuel de la fiche (à comparer)')}</h2>
                        <dl className="mt-1 space-y-1">{r.current.map((c) => <div key={c.field}><dt className="inline font-medium">{c.field} : </dt><dd className="inline whitespace-pre-wrap" {...(c.field === 'accessibilite_pmr' ? {} : fr)}>{reviewValue(c.field, c.value)}</dd></div>)}</dl>
                      </section>
                    ) : null}
                    <section aria-label={t('admin:ws2.research', 'Recherche préparatoire (aide, non probante)')}>
                      {r.entityId ? <h2 className="font-medium">{t('admin:ws2.research', 'Recherche préparatoire (aide, non probante)')}</h2> : null}
                      <dl className="mt-1 space-y-1">
                        <div><dt className="inline text-slate-700">{t('admin:ws2.candidate_source', 'Source candidate :')} </dt><dd className="inline break-all">{r.research.officialSourceCandidate || '—'}</dd></div>
                        <div><dt className="inline text-slate-700">{t('admin:ws2.findings', 'Constats :')} </dt><dd className="inline" lang="en" dir="ltr">{r.research.findings || '—'}</dd></div>
                        <div><dt className="inline text-slate-700">{t('admin:ws2.to_check', 'À contrôler :')} </dt><dd className="inline" lang="en" dir="ltr">{r.research.humanValidation || '—'}</dd></div>
                      </dl>
                    </section>
                  </div>
                  {r.entityId ? (
                    <div className="self-start rounded border bg-white p-3 lg:sticky lg:top-4" data-testid="admin-ws2-decide">
                      <h2 className="mb-2 font-medium">{t('admin:ws2.decide', 'Décider')}</h2>
                      {/* owner LAB audit: one form for every verification, bound to the content version shown beside it; the research candidate is never pre-filled */}
                      <VerificationPanel entityType={r.entityType} entityId={r.entityId} initial={{ content: r.current, version: r.version, hold: r.hold, editHold: r.editHold }}
                        candidateSource={r.preparation?.sourceUrl || null} showContent={r.state === 'HUMAN_VERIFIED'} testIdPrefix="admin-ws2" onDone={(ok) => done(ok, r)} onProblem={setProblem} />
                    </div>
                  ) : <p className="text-slate-700">{t('admin:ws2.no_record', 'Pas de fiche correspondante en base : à importer ou retirer du lancement.')}</p>}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
