// @ts-nocheck
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { useT, formatDateTime } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';
import { needName } from '@/lib/socialNeeds';

/**
 * G14 release 3 — revue des pages de rendez-vous propres aux structures (« Rendez-vous sur leur site ») : /admin/rdv-externes.
 * POST /api/admin/external-booking { action: 'list' | 'review' } — une décision demande une session nominative avec MFA et un motif (journalisé).
 * Approuver n'affiche rien tant que l'affichage public (ADA_EXTERNAL_BOOKING) est fermé. L'adresse est montrée comme texte : elle n'est pas ouverte ici.
 */
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

export default function AdminExternalBooking() {
  const { t } = useT('admin');
  const fr = useFrAttrs();
  const STATUS = { PENDING: t('admin:k5.extbooking.s_pending', 'En attente'), APPROVED: t('admin:k5.extbooking.s_approved', 'Approuvées'), REJECTED: t('admin:k5.extbooking.s_rejected', 'Refusées') };
  const SOURCE = { PRO: t('admin:k5.extbooking.src_pro', 'la structure (ADA Pro)'), ADMIN: t('admin:k5.extbooking.src_admin', 'un administrateur'), IMPORT: t('admin:k5.extbooking.src_import', 'import open data (à vérifier)') };
  const [status, setStatus] = useState('PENDING');
  const [data, setData] = useState(null); const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  const load = async (st = status, { keepMsg = false } = {}) => {
    setProblem(''); if (!keepMsg) setMsg(''); setBusy(true);
    try { setData(await apiClient.admin.k5('external-booking', { action: 'list', status: st })); }
    catch (e) { setData(null); setProblem(e?.status === 503 ? t('admin:k5.extbooking.not_installed', 'Fonction non installée sur ce serveur (migration 0063).') : explain(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(status); }, [status]);   // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (item, decision) => {
    const note = (notes[item.structureId] || '').trim();
    setMsg(''); setProblem('');
    if (note.length < 10 || note.length > 500) { setProblem(t('admin:k5.extbooking.p_note', 'Indiquez un motif pour « {{name}} » (10 à 500 caractères).', { name: item.nom })); return; }
    setBusy(true);
    try {
      await apiClient.admin.k5('external-booking', { action: 'review', structureId: item.structureId, decision, note });
      setNotes((x) => ({ ...x, [item.structureId]: '' }));
      await load(status, { keepMsg: true });
      setMsg(decision === 'APPROVE' ? t('admin:k5.extbooking.approved', '« {{name}} » : page approuvée. Décision journalisée.', { name: item.nom }) : t('admin:k5.extbooking.rejected', '« {{name}} » : page refusée. Décision journalisée.', { name: item.nom }));
    } catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 p-4" data-testid="admin-extbooking">
      <h1 className="text-2xl font-bold">{t('admin:k5.extbooking.title', 'Pages de rendez-vous propres aux structures')}</h1>
      <p className="text-sm">{t('admin:k5.extbooking.intro', 'Une structure qui prend ses rendez-vous sur son propre système peut indiquer l’adresse de cette page. Vérifiez que la page appartient bien à la structure (même domaine que son site, ou plateforme publique reconnue), qu’elle sert à prendre rendez-vous et qu’elle ne demande rien d’abusif. Une page approuvée est affichée « Rendez-vous sur leur site » seulement quand l’affichage public est ouvert. Ce n’est jamais une prise de rendez-vous sur AccesDirectAide.')}</p>
      <p className="text-sm" data-testid="admin-extbooking-display">{data?.publicDisplay === 'open' ? t('admin:k5.extbooking.display_open', 'Affichage public : ouvert.')
        : data?.publicDisplay === 'platforms' ? t('admin:k5.extbooking.display_platforms', 'Affichage public : plateformes reconnues seulement.') : t('admin:k5.extbooking.display_closed', 'Affichage public : fermé (rien n’est montré au public).')}</p>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label htmlFor="extbooking-status" className="block">{t('admin:k5.extbooking.status', 'État')}</label>
        <select id="extbooking-status" className="rounded border p-2" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
        </select>
      </div>
      {problem ? <p role="alert" className="text-sm text-destructive" data-testid="admin-extbooking-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" className="text-sm" data-testid="admin-extbooking-status">{msg}</div>
      {data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="admin-extbooking-table">
            <caption className="sr-only">{t('admin:k5.extbooking.caption', 'Pages de rendez-vous : structure, adresse, origine, contrôles et décision')}</caption>
            <thead><tr className="border-b">
              <th scope="col" className="p-1 text-start">{t('admin:k5.extbooking.col_structure', 'Structure')}</th>
              <th scope="col" className="p-1 text-start">{t('admin:k5.extbooking.col_url', 'Adresse (non ouverte ici)')}</th>
              <th scope="col" className="p-1 text-start">{t('admin:k5.extbooking.col_checks', 'Contrôles')}</th>
              <th scope="col" className="p-1 text-start">{t('admin:k5.extbooking.col_decision', 'Décision')}</th>
            </tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.structureId} className="border-b align-top" data-testid="admin-extbooking-row">
                  <th scope="row" className="p-1 text-start font-normal"><span {...fr}>{i.nom}</span>
                    <p className="text-xs">{t('admin:k5.extbooking.source', 'Proposée par {{source}}, {{date}}', { source: SOURCE[i.source] || i.source, date: formatDateTime(i.submittedAt) })}</p></th>
                  <td className="p-1"><code dir="ltr" className="break-all">{i.url}</code>
                    {Array.isArray(i.subdomains) && i.subdomains.length ? <p className="text-xs">{t('admin:k5.extbooking.needs', 'Besoins : {{needs}}', { needs: i.subdomains.map((id) => needName(t, id)).join(', ') })}</p> : null}</td>
                  <td className="p-1 text-xs">
                    <p>{i.platform !== 'other' ? t('admin:k5.extbooking.platform', 'Plateforme publique reconnue ({{id}})', { id: i.platform }) : t('admin:k5.extbooking.own_site', 'Site propre (non reconnu comme plateforme)')}</p>
                    <p>{i.sameHostAsWebsite === true ? t('admin:k5.extbooking.same_host', 'Même domaine que le site de la fiche.') : i.sameHostAsWebsite === false ? t('admin:k5.extbooking.other_host', 'Domaine différent du site de la fiche : à vérifier.') : t('admin:k5.extbooking.no_site', 'Pas de site sur la fiche.')}</p>
                    {i.urlValid ? null : <p className="text-destructive">{t('admin:k5.extbooking.invalid', 'L’adresse ne respecte plus les règles.')}</p>}
                    {i.reviewedAt ? <p>{t('admin:k5.extbooking.reviewed', 'Revue : {{who}}, {{date}}', { who: i.reviewedBy, date: formatDateTime(i.reviewedAt) })}</p> : null}
                  </td>
                  <td className="space-y-1 p-1">
                    <label htmlFor={`extbooking-note-${i.structureId}`} className="block text-xs">{t('admin:k5.extbooking.note', 'Motif (10 à 500 caractères, journalisé)')}</label>
                    <textarea id={`extbooking-note-${i.structureId}`} rows={2} className="w-full rounded border p-1" value={notes[i.structureId] || ''} onChange={(e) => setNotes((x) => ({ ...x, [i.structureId]: e.target.value }))} />
                    <div className="flex flex-wrap gap-1">
                      {i.status !== 'APPROVED' ? <Button size="sm" disabled={busy || !i.urlValid} onClick={() => decide(i, 'APPROVE')} data-testid="admin-extbooking-approve">{t('admin:k5.extbooking.approve', 'Approuver')}</Button> : null}
                      {i.status !== 'REJECTED' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(i, 'REJECT')} data-testid="admin-extbooking-reject">{i.status === 'APPROVED' ? t('admin:k5.extbooking.withdraw', 'Retirer l’approbation') : t('admin:k5.extbooking.reject', 'Refuser')}</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!data.items.length ? <tr><td colSpan={4} className="p-2">{t('admin:k5.extbooking.none', 'Aucune page dans cet état.')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
