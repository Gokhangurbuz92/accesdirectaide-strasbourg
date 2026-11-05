import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';

/**
 * R46 / R22 — SI-SIAO on the professional dossier page: an honest disconnected state (no official interface specification, no operator convention) and,
 * when the person allowed THIS organization to pass her housing request to the SIAO (PURP-07), a manual handover sheet in ADA's own format
 * (ada.siao-handover/1) to enter in the operator's tool. Nothing is ever sent by ADA.
 * @param {{ shareId: string, siaoAllowed: boolean }} props
 */
export default function SiaoHandoverCard({ shareId, siaoAllowed }) {
  const { t } = useT('pro');
  const [sheet, setSheet] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const prepare = async () => {
    setBusy(true); setProblem('');
    try {
      const token = localStorage.getItem('pro_token');
      const r = await fetch('/api/pro/interop-siao', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...getCsrfHeaders() }, body: JSON.stringify({ shareId }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 403 && d.status === 'purpose_required') { setProblem(t('pro:siao.not_allowed', 'La personne n’a pas autorisé votre structure à transmettre sa demande au SIAO.')); return; }
      if (r.status === 503 && d.code === 'CAPABILITY_NOT_OPEN') { setProblem(t('pro:siao.not_open', 'Cette fonction n’est pas encore ouverte.')); return; }
      if (!r.ok || !d.handover) { setProblem(t('pro:siao.failed', 'La fiche n’a pas pu être préparée. Réessayez.')); return; }
      setSheet(d.handover);
    } catch {
      setProblem(t('pro:siao.failed', 'La fiche n’a pas pu être préparée. Réessayez.'));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(sheet, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${sheet.request.reference}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const yesNo = (/** @type {boolean | null} */ v) => (v === null ? t('pro:siao.not_stated', 'non renseigné par la personne') : v ? t('pro:siao.yes', 'oui') : t('pro:siao.no', 'non'));

  return (
    <Card data-testid="pro-siao-card">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">{t('pro:siao.title', 'Transmission au SIAO')}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-800">
        <p className="text-xs text-slate-600" data-testid="pro-siao-status">{t('pro:siao.status', 'Liaison SI-SIAO : non connectée (aucune spécification officielle d’interface ni convention avec l’opérateur). Accès Direct Aide n’envoie rien : la fiche ci-dessous est à saisir par vous dans l’outil du SIAO.')}</p>
        {!siaoAllowed ? <p data-testid="pro-siao-not-allowed">{t('pro:siao.not_allowed', 'La personne n’a pas autorisé votre structure à transmettre sa demande au SIAO.')}</p> : null}
        {siaoAllowed && !sheet ? <Button type="button" variant="outline" className="w-full min-h-[44px]" disabled={busy} aria-busy={busy} onClick={prepare} data-testid="pro-siao-prepare">{t('pro:siao.prepare', 'Préparer la fiche de transmission')}</Button> : null}
        {problem ? <p role="alert" className="text-red-800" data-testid="pro-siao-problem">{problem}</p> : null}
        {sheet ? (
          <div className="space-y-2" data-testid="pro-siao-sheet">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="font-semibold">{t('pro:siao.reference', 'Référence')}</dt><dd className="font-mono break-all">{sheet.request.reference}</dd>
              <dt className="font-semibold">{t('pro:siao.pseudonym', 'Identifiant pseudonymisé')}</dt><dd className="font-mono break-all">{sheet.request.pseudonym}</dd>
              <dt className="font-semibold">{t('pro:siao.postal_code', 'Code postal')}</dt><dd>{sheet.request.postalCode || t('pro:siao.not_stated', 'non renseigné par la personne')}</dd>
              <dt className="font-semibold">{t('pro:siao.urgent', 'Urgence déclarée')}</dt><dd>{yesNo(sheet.request.urgent)}</dd>
            </dl>
            <p className="text-xs text-slate-600">{t('pro:siao.format_note', 'Format propre à Accès Direct Aide (ada.siao-handover/1), qui n’est pas le format national.')}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={download} data-testid="pro-siao-download">{t('pro:siao.download', 'Télécharger la fiche (JSON)')}</Button>
              <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={() => window.print()}>{t('pro:siao.print', 'Imprimer')}</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
