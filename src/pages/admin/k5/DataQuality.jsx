// @ts-nocheck
import { useK5 } from './helpers.js';
import { Status } from './ui.jsx';
import { useT } from '@/i18n';

/** PKG-5 / A08 — data-quality dashboard (/admin/data-quality): WS2 workflow state, review-queue age, public reports. Measured counts only. */
export default function AdminDataQuality() {
  const { t } = useT('admin');
  const STATE = { HUMAN_VERIFIED: t('admin:k5.data_quality.state.verified', 'vérifiées'), PENDING_HUMAN_VERIFICATION: t('admin:k5.data_quality.state.pending', 'à vérifier'), REJECTED: t('admin:k5.data_quality.state.rejected', 'refusées'), ON_HOLD: t('admin:k5.data_quality.state.on_hold', 'en attente'), NOT_IN_DATABASE: t('admin:k5.data_quality.state.not_in_db', 'absentes de la base') };
  const k = useK5('data-quality'); const d = k.data;
  return (
    <div className="space-y-4 p-4" data-testid="admin-dq">
      <h1 className="text-2xl font-bold">{t('admin:k5.data_quality.title', 'Qualité des données')}</h1>
      <Status msg="" problem={k.error} id="admin-dq" />
      {d ? (
        <>
          <section className="rounded border p-3" aria-labelledby="dq-ws2">
            <h2 id="dq-ws2" className="font-semibold">{t('admin:k5.data_quality.ws2_heading', 'Fiches du lancement (WS2)')}</h2>
            <p data-testid="admin-dq-ws2">{t('admin:k5.data_quality.ws2_totals', '{{records}} fiches : {{verified}} vérifiées par une personne, {{pending}} à vérifier, {{onHold}} en attente, {{rejected}} refusées, {{notInDb}} absentes de la base.', { records: d.ws2.totals.records, verified: d.ws2.totals.humanVerified, pending: d.ws2.totals.pending, onHold: d.ws2.totals.onHold, rejected: d.ws2.totals.rejected, notInDb: d.ws2.totals.notInDatabase })}</p>
            <table className="mt-2 text-sm"><caption className="sr-only">{t('admin:k5.data_quality.caption', 'Fiches par jeu de données et état')}</caption>
              <thead><tr><th scope="col" className="pr-4 text-left">{t('admin:k5.data_quality.dataset', 'Jeu')}</th>{Object.values(STATE).map((s) => <th key={s} scope="col" className="pr-4 text-left">{s}</th>)}</tr></thead>
              <tbody>{Object.entries(d.ws2.byDataset).map(([ds, m]) => <tr key={ds}><th scope="row" className="pr-4 text-left">{ds}</th>{Object.keys(STATE).map((s) => <td key={s} className="pr-4">{m[s] || 0}</td>)}</tr>)}</tbody>
            </table>
            <p className="mt-1 text-xs text-slate-700">{t('admin:k5.data_quality.ws2_rule', 'Règle du contrôle historique WS2 : seule une vérification enregistrée par une personne d’ADA avec MFA y compte. La publication courante suit la vérification automatique D-5 v2 (page Veille).')}</p>
          </section>
          <section className="rounded border p-3" aria-labelledby="dq-q">
            <h2 id="dq-q" className="font-semibold">{t('admin:k5.data_quality.queue_heading', 'File de revue (ouverte)')}</h2>
            <ul className="text-sm">{d.reviewQueue.map((q) => <li key={q.reason}>{t('admin:k5.data_quality.queue_line', '{{reason}} : {{n}} (dont {{d7}} de plus de 7 jours, {{d30}} de plus de 30 jours)', { reason: q.reason, n: q.n, d7: q.olderThan7d, d30: q.olderThan30d })}</li>)}{!d.reviewQueue.length ? <li>{t('admin:k5.data_quality.empty', 'Vide.')}</li> : null}</ul>
          </section>
          <section className="rounded border p-3" aria-labelledby="dq-pub">
            <h2 id="dq-pub" className="font-semibold">{t('admin:k5.data_quality.public_heading', 'Signalements et suggestions du public')}</h2>
            <p className="text-sm">{t('admin:k5.data_quality.public_line', 'Signalements : {{reports}} — suggestions de structures : {{suggestions}}', { reports: d.contentReports.map((r) => `${r.status} ${r.n}`).join(', ') || t('admin:k5.data_quality.none_m', 'aucun'), suggestions: d.structureSuggestions.map((r) => `${r.status} ${r.n}`).join(', ') || t('admin:k5.data_quality.none_f', 'aucune') })}</p>
          </section>
        </>
      ) : k.error ? null : <p role="status">{t('admin:k5.data_quality.loading', 'Chargement…')}</p>}   {/* R7: no endless « Chargement… » under the error */}
    </div>
  );
}
