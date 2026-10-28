// @ts-nocheck
import { useK5 } from './helpers.js';
import { Status } from './ui.jsx';

const STATE = { HUMAN_VERIFIED: 'vérifiées', PENDING_HUMAN_VERIFICATION: 'à vérifier', REJECTED: 'refusées', ON_HOLD: 'en attente', NOT_IN_DATABASE: 'absentes de la base' };

/** PKG-5 / A08 — data-quality dashboard (/admin/data-quality): WS2 workflow state, review-queue age, public reports. Measured counts only. */
export default function AdminDataQuality() {
  const k = useK5('data-quality'); const d = k.data;
  return (
    <div className="space-y-4 p-4" data-testid="admin-dq">
      <h1 className="text-2xl font-bold">Qualité des données</h1>
      <Status msg="" problem={k.error} id="admin-dq" />
      {d ? (
        <>
          <section className="rounded border p-3" aria-labelledby="dq-ws2">
            <h2 id="dq-ws2" className="font-semibold">Fiches du lancement (WS2)</h2>
            <p data-testid="admin-dq-ws2">{d.ws2.totals.records} fiches : {d.ws2.totals.humanVerified} vérifiées par une personne, {d.ws2.totals.pending} à vérifier, {d.ws2.totals.onHold} en attente, {d.ws2.totals.rejected} refusées, {d.ws2.totals.notInDatabase} absentes de la base.</p>
            <table className="mt-2 text-sm"><caption className="sr-only">Fiches par jeu de données et état</caption>
              <thead><tr><th scope="col" className="pr-4 text-left">Jeu</th>{Object.values(STATE).map((s) => <th key={s} scope="col" className="pr-4 text-left">{s}</th>)}</tr></thead>
              <tbody>{Object.entries(d.ws2.byDataset).map(([ds, m]) => <tr key={ds}><th scope="row" className="pr-4 text-left">{ds}</th>{Object.keys(STATE).map((s) => <td key={s} className="pr-4">{m[s] || 0}</td>)}</tr>)}</tbody>
            </table>
            <p className="mt-1 text-xs text-slate-700">Règle du contrôle historique WS2 : seule une vérification enregistrée par une personne d’ADA avec MFA y compte. La publication courante suit la vérification automatique D-5 v2 (page Veille).</p>
          </section>
          <section className="rounded border p-3" aria-labelledby="dq-q">
            <h2 id="dq-q" className="font-semibold">File de revue (ouverte)</h2>
            <ul className="text-sm">{d.reviewQueue.map((q) => <li key={q.reason}>{q.reason} : {q.n} (dont {q.olderThan7d} de plus de 7 jours, {q.olderThan30d} de plus de 30 jours)</li>)}{!d.reviewQueue.length ? <li>Vide.</li> : null}</ul>
          </section>
          <section className="rounded border p-3" aria-labelledby="dq-pub">
            <h2 id="dq-pub" className="font-semibold">Signalements et suggestions du public</h2>
            <p className="text-sm">Signalements : {d.contentReports.map((r) => `${r.status} ${r.n}`).join(', ') || 'aucun'} — suggestions de structures : {d.structureSuggestions.map((r) => `${r.status} ${r.n}`).join(', ') || 'aucune'}</p>
          </section>
        </>
      ) : k.error ? null : <p role="status">Chargement…</p>}   {/* R7: no endless « Chargement… » under the error */}
    </div>
  );
}
