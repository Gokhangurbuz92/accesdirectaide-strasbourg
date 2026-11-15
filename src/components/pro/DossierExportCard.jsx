import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDateTime, useT } from '@/i18n';

/**
 * A14 (R15) — export of a shared dossier from the professional dossier page. Before: /api/pro/dossier/export (JSON, CSV) and /api/pro/dossier/views had no
 * caller in the interface. JSON and CSV are downloaded from the API (each export is journalised and visible to the person); PDF is the existing printable,
 * unsigned recap (/pro/attestation/:shareId — printed or saved as PDF by the browser): no server-side PDF of a dossier exists and none is claimed.
 * « Accès de votre structure » lists what the caller's own organisation did with the dossier (consultations, exports, status changes) — never another
 * organisation's trail, never an e-mail address.
 * @param {{ shareId: string, userId?: string }} props
 */
export default function DossierExportCard({ shareId, userId }) {
  const { t } = useT('pro');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  const [views, setViews] = useState(/** @type {any[] | null} */ (null));
  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('pro_token')}` });
  const refusal = (/** @type {number} */ status) => (status === 429 ? t('pro:dossier_export.too_many', 'Trop d’exports en peu de temps. Patientez un instant avant de réessayer.')
    : status === 404 || status === 410 ? t('pro:dossier_export.not_shared', 'Ce dossier n’est plus partagé avec votre structure ou a expiré : rien n’a été exporté.')
      : t('pro:dossier_export.failed', 'L’export n’a pas pu être fait. Réessayez.'));

  const download = async (/** @type {'json' | 'csv'} */ format) => {
    setBusy(format); setProblem(''); setDone('');
    try {
      const r = await fetch(`/api/pro/dossier/export?shareId=${encodeURIComponent(shareId)}&format=${format}`, { headers: auth() });
      if (!r.ok) { setProblem(refusal(r.status)); return; }
      const blob = format === 'csv' ? await r.blob() : new Blob([JSON.stringify((await r.json()).export, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dossier-${String(shareId).slice(0, 8).toUpperCase()}.${format}`; a.click(); URL.revokeObjectURL(a.href);
      setDone(t('pro:dossier_export.done', 'Export téléchargé. Il est inscrit au journal et visible par la personne.'));
      if (views) loadViews();
    } catch {
      setProblem(t('pro:dossier_export.failed', 'L’export n’a pas pu être fait. Réessayez.'));
    } finally {
      setBusy('');
    }
  };
  const loadViews = async () => {
    setBusy((b) => b || 'views'); setProblem('');
    try {
      const r = await fetch(`/api/pro/dossier/views?shareId=${encodeURIComponent(shareId)}`, { headers: auth() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setProblem(r.status === 429 ? t('pro:dossier_export.too_many_reads', 'Trop de demandes en peu de temps. Patientez un instant.') : t('pro:dossier_export.views_failed', 'Le journal des accès n’a pas pu être lu.')); return; }
      setViews(Array.isArray(d.views) ? d.views : []);
    } catch {
      setProblem(t('pro:dossier_export.views_failed', 'Le journal des accès n’a pas pu être lu.'));
    } finally {
      setBusy((b) => (b === 'views' ? '' : b));
    }
  };
  const ACTIONS = {
    DOSSIER_VIEWED: t('pro:dossier_export.action_viewed', 'Consultation'),
    DOSSIER_EXPORTED: t('pro:dossier_export.action_exported', 'Export'),
    DOSSIER_STATUS_UPDATED: t('pro:dossier_export.action_status', 'Statut du suivi modifié'),
  };

  return (
    <Card data-testid="pro-dossier-export-card">
      <CardHeader className="pb-2"><CardTitle as="h2" className="text-sm font-bold">{t('pro:dossier_export.title', 'Exporter le dossier')}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-800">
        <p className="text-xs text-slate-600">{t('pro:dossier_export.intro', 'Situation déclarée et pistes d’orientation, sans les documents ni les messages. Chaque export est inscrit au journal et visible par la personne.')}</p>
        <div className="flex flex-wrap gap-2" aria-busy={busy === 'json' || busy === 'csv' || undefined}>
          <Button type="button" variant="outline" className="min-h-[44px] flex-1" disabled={Boolean(busy)} onClick={() => download('json')} data-testid="pro-dossier-export-json">{t('pro:dossier_export.json', 'Télécharger (JSON)')}</Button>
          <Button type="button" variant="outline" className="min-h-[44px] flex-1" disabled={Boolean(busy)} onClick={() => download('csv')} data-testid="pro-dossier-export-csv">{t('pro:dossier_export.csv', 'Télécharger (CSV)')}</Button>
        </div>
        <p>
          <Link to={`/pro/attestation/${encodeURIComponent(String(shareId))}`} className="font-semibold text-blue-800 underline" data-testid="pro-dossier-export-pdf">{t('pro:dossier_export.pdf', 'PDF : ouvrir le récapitulatif à imprimer')}</Link>
          <span className="block text-xs text-slate-600">{t('pro:dossier_export.pdf_note', 'Le PDF s’obtient en imprimant le récapitulatif (« Enregistrer au format PDF »). Il n’est pas signé et n’a pas valeur d’attestation officielle.')}</span>
        </p>
        <div role="status" aria-live="polite" data-testid="pro-dossier-export-status">{done ? <p className="text-xs text-emerald-800">{done}</p> : null}</div>
        {problem ? <p role="alert" className="text-red-800" data-testid="pro-dossier-export-problem">{problem}</p> : null}
        <div className="border-t border-slate-200 pt-3">
          {views === null ? (
            <Button type="button" variant="outline" className="min-h-[44px] w-full" disabled={Boolean(busy)} onClick={loadViews} data-testid="pro-dossier-views-load">{t('pro:dossier_export.views_load', 'Voir les accès de votre structure à ce dossier')}</Button>
          ) : (
            <div data-testid="pro-dossier-views">
              <h3 className="text-xs font-bold text-slate-800">{t('pro:dossier_export.views_title', 'Accès de votre structure à ce dossier')}</h3>
              {views.length ? (
                <ul className="mt-1 space-y-1 text-xs text-slate-800">
                  {views.map((v) => (
                    <li key={v.id} data-testid="pro-dossier-view">
                      {formatDateTime(v.at)} — {ACTIONS[/** @type {keyof typeof ACTIONS} */ (v.action)] || v.action}{' '}
                      <span className="text-slate-600">({v.actorId && v.actorId === userId ? t('pro:dossier_export.by_you', 'vous') : t('pro:dossier_export.by_colleague', 'un membre de votre équipe')})</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-xs text-slate-600">{t('pro:dossier_export.views_empty', 'Aucun accès enregistré.')}</p>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
