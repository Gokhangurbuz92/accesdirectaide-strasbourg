// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import VerificationPanel from '@/components/admin/VerificationPanel';
import { reviewValue } from '@/components/admin/reviewValue.js';

const STATE_LABEL = {
  HUMAN_VERIFIED: 'Vérifié par une personne', PENDING_HUMAN_VERIFICATION: 'À vérifier', REJECTED: 'Refusé', ON_HOLD: 'En attente', NOT_IN_DATABASE: 'Absent de la base',
};
const FILTERS = ['ALL', 'PENDING_HUMAN_VERIFICATION', 'HUMAN_VERIFIED', 'ON_HOLD', 'REJECTED', 'NOT_IN_DATABASE'];
// owner LAB audit (2026-10-25): from a record of the queue, the editor where it is corrected (corrections come before a new decision)
const EDITOR = { aide: 'aides', demarche: 'demarches', structure: 'structures' };
const GROUPS = { A_PRET: 'Prêtes à comparer avec la source', D_IDENTITE: 'Structures : identité à confirmer', C_A_TRANCHER: 'Incohérence à trancher', E_BLOQUANT: 'À corriger d’abord', B_A_RECHERCHER: 'Source à trouver' };

/**
 * PKG-5 / WS2 — file de vérification humaine (/admin/ws2). Les 49 fiches du lancement, leur fiche en base et la dernière décision du registre de vérification.
 * Les recherches antérieures (source candidate, constats) sont une aide : seule une décision VERIFY enregistrée par une personne d'ADA avec MFA, avec une source
 * officielle, compte comme vérification. Aucune décision n'est déduite d'un fichier.
 */
export default function AdminWs2Queue() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  // owner LAB audit: the view opens on what still needs a person — « à vérifier » if any, else the records on hold, else everything (it used to open on an
  // empty « à vérifier » list once every record had a decision)
  const [filter, setFilter] = useState(null); const [group, setGroup] = useState('ALL');
  const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await apiClient.admin.getWs2Queue(); setState({ loading: false, error: '', data });
      setFilter((f) => f ?? (data?.totals?.pending ? 'PENDING_HUMAN_VERIFICATION' : data?.totals?.onHold ? 'ON_HOLD' : 'ALL'));
    }
    catch (e) { setState({ loading: false, error: e?.message || 'Chargement impossible.', data: null }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const key = (r) => `${r.dataset}:${r.slug}`;
  const done = async (ok) => { setProblem(''); setMsg(ok); await load(); };
  const t = state.data?.totals; const records = (state.data?.records || []).filter((r) => (!filter || filter === 'ALL' || r.state === filter) && (group === 'ALL' || r.preparation?.group === group));
  return (
    <div className="space-y-4 p-4" data-testid="admin-ws2">
      <h1 className="text-2xl font-bold">Vérification des contenus du lancement (WS2)</h1>
      <p className="text-sm text-slate-700">Contrôle historique WS2 : il comptait les fiches du lancement vérifiées par une personne d’ADA (session avec MFA). Depuis la décision D-5 v2, la publication suit la vérification automatique (page Veille) ; ce contrôle reste affiché comme trace. Les recherches préparatoires affichées ci-dessous ne valent pas vérification.</p>
      {state.error ? <p role="alert" className="text-red-800">{state.error}</p> : null}
      {problem ? <p role="alert" className="text-red-800" data-testid="admin-ws2-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" data-testid="admin-ws2-status">{msg}</div>
      {t ? (
        <p data-testid="admin-ws2-totals" className="text-sm">{t.records} fiches — {t.humanVerified} vérifiées, {t.pending} à vérifier, {t.onHold} en attente, {t.rejected} refusées, {t.notInDatabase} absentes de la base.</p>
      ) : null}
      <label htmlFor="ws2-filter" className="mr-2 text-sm">Afficher</label>
      <select id="ws2-filter" className="rounded border p-2" value={filter || 'ALL'} onChange={(e) => setFilter(e.target.value)}>
        {FILTERS.map((x) => <option key={x} value={x}>{x === 'ALL' ? 'Toutes' : STATE_LABEL[x]}</option>)}
      </select>
      <label htmlFor="ws2-group" className="ml-4 mr-2 text-sm">Groupe</label>
      <select id="ws2-group" className="rounded border p-2" value={group} onChange={(e) => setGroup(e.target.value)}>
        <option value="ALL">Tous</option>
        {Object.entries(GROUPS).map(([k, l]) => <option key={k} value={k}>{l}{state.data?.groups?.[k] ? ` (${state.data.groups[k]})` : ''}</option>)}
      </select>
      {state.loading ? <p role="status">Chargement…</p> : (
        <ul className="space-y-3">
          {records.length === 0 ? <li className="text-slate-700" data-testid="admin-ws2-empty">Aucune fiche dans ce filtre.</li> : null}
          {records.map((r) => (
            <li key={key(r)} className="space-y-2 rounded border p-3 text-sm" data-testid="admin-ws2-record">
              <p className="font-semibold">{r.title} <span className="font-normal text-slate-700">— {r.dataset}</span></p>
              <p data-testid="admin-ws2-state">{STATE_LABEL[r.state] || r.state}{r.decision ? ` — décision du ${new Date(r.decision.at).toLocaleDateString('fr-FR')}` : ''}</p>
              {r.hold ? <p className="text-slate-800" data-testid="admin-ws2-hold-reason">Motif de l’attente : {r.hold}</p> : null}
              {r.entityId && EDITOR[r.entityType] ? <p><Link className="text-blue-800 underline" to={`/admin/${EDITOR[r.entityType]}/${r.entityId}`}>Corriger la fiche dans l’éditeur</Link> <span className="text-slate-700">(une correction change la version : la décision se prend ensuite sur la fiche corrigée)</span></p> : null}
              {r.preparation && r.state !== 'HUMAN_VERIFIED' ? (
                <div className="rounded bg-slate-50 p-2" data-testid="admin-ws2-prep">
                  <p><span className="font-medium">{GROUPS[r.preparation.group]}</span> — {r.preparation.next}</p>
                  <ul className="list-disc pl-5">{r.preparation.check.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  {r.preparation.sourceUrl ? <p>Source à consulter : <a className="text-blue-800 underline" href={r.preparation.sourceUrl} target="_blank" rel="noreferrer noopener">{r.preparation.sourceUrl}</a>{r.preparation.sourceAccepted ? ' (acceptée)' : ' (non acceptée en l’état)'}</p> : null}
                  {r.current?.length ? (
                    <details data-testid="admin-ws2-current"><summary className="cursor-pointer text-blue-800">Contenu actuel de la fiche (à comparer)</summary>
                      <dl className="mt-1 space-y-1">{r.current.map((c) => <div key={c.field}><dt className="inline font-medium">{c.field} : </dt><dd className="inline whitespace-pre-wrap">{reviewValue(c.field, c.value)}</dd></div>)}</dl>
                    </details>
                  ) : null}
                  <p className="text-xs text-slate-700">Préparation automatique : elle aide, elle ne vaut pas vérification. La décision reste la vôtre.</p>
                </div>
              ) : null}
              <details>
                <summary className="cursor-pointer text-blue-800">Recherche préparatoire (aide, non probante)</summary>
                <dl className="mt-1 space-y-1">
                  <div><dt className="inline text-slate-700">Source candidate : </dt><dd className="inline">{r.research.officialSourceCandidate || '—'}</dd></div>
                  <div><dt className="inline text-slate-700">Constats : </dt><dd className="inline">{r.research.findings || '—'}</dd></div>
                  <div><dt className="inline text-slate-700">À contrôler : </dt><dd className="inline">{r.research.humanValidation || '—'}</dd></div>
                </dl>
              </details>
              {r.entityId ? (
                <details>
                  <summary className="cursor-pointer text-blue-800">Décider</summary>
                  <div className="mt-2">
                    {/* owner LAB audit: one form for every verification, bound to the content version shown above; the research candidate is never pre-filled */}
                    <VerificationPanel entityType={r.entityType} entityId={r.entityId} initial={{ content: r.current, version: r.version, hold: r.hold, editHold: r.editHold }}
                      candidateSource={r.preparation?.sourceUrl || null} showContent={r.state === 'HUMAN_VERIFIED'} testIdPrefix="admin-ws2" onDone={done} onProblem={setProblem} />
                  </div>
                </details>
              ) : <p className="text-slate-700">Pas de fiche correspondante en base : à importer ou retirer du lancement.</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
