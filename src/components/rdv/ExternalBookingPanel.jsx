// @ts-nocheck
import { useEffect, useId, useState } from 'react';
import { ExternalLink, Loader2, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { proRdvClient } from '@/api/pro-rdv-client';
import NeedPicker from '@/components/needs/NeedPicker';
import { useT } from '@/i18n';

/**
 * G14 release 3 — ADA Pro: « Nous prenons nos rendez-vous sur notre propre système ». The structure records the https page of its own booking system and
 * the needs it serves; AccesDirectAide shows it (« Rendez-vous sur leur site ») only after an administrator approved it and only while the public switch is
 * open. Hidden when the server does not have the feature (503: migration 0063 absent). Members read; structure administrators edit.
 * @param {{ canEdit: boolean }} props
 */
export default function ExternalBookingPanel({ canEdit }) {
  const { t } = useT('pro');
  const uid = useId();
  const [state, setState] = useState({ loading: true, available: true, data: null });
  const [url, setUrl] = useState('');
  const [needs, setNeeds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const hydrate = (data) => {
    setState({ loading: false, available: true, data });
    setUrl(data?.record?.url || '');
    setNeeds(Array.isArray(data?.record?.subdomains) ? data.record.subdomains : []);
  };
  useEffect(() => {
    let alive = true;
    proRdvClient.externalBooking.get()
      .then((d) => { if (alive) hydrate(d); })
      .catch((e) => { if (alive) setState({ loading: false, available: e?.status !== 503 && e?.status !== 404, data: null }); });
    return () => { alive = false; };
  }, []);

  if (state.loading || !state.available) return null;
  const record = state.data?.record || null;
  const STATUS = {
    PENDING: t('pro:external.status_pending', 'En attente de vérification par AccesDirectAide : elle n’est pas encore affichée.'),
    APPROVED: state.data?.shownPublicly
      ? t('pro:external.status_approved_shown', 'Vérifiée et affichée sur votre fiche publique (« Rendez-vous sur leur site »).')
      : t('pro:external.status_approved_hidden', 'Vérifiée. Elle sera affichée quand AccesDirectAide ouvrira cet affichage.'),
    REJECTED: t('pro:external.status_rejected', 'Non retenue par AccesDirectAide.'),
  };
  const ERR = {
    HTTPS_REQUIRED: t('pro:external.err_https', 'L’adresse doit commencer par https://.'),
    CREDENTIALS_IN_URL: t('pro:external.err_credentials', 'L’adresse ne doit contenir ni identifiant ni mot de passe.'),
    HOST_NOT_PUBLIC: t('pro:external.err_host', 'L’adresse doit être celle d’un site public.'),
    PERSONAL_DATA_IN_URL: t('pro:external.err_personal', 'L’adresse ne doit contenir aucune donnée personnelle (e-mail, nom, téléphone, jeton…).'),
  };

  const save = async (e) => {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      const out = await proRdvClient.externalBooking.save({ url: url.trim(), subdomains: needs });
      hydrate({ ...(state.data || {}), record: out.record, shownPublicly: out.record?.status === 'APPROVED' && state.data?.shownPublicly });
      setNotice(out.changed ? t('pro:external.saved', 'Enregistré. AccesDirectAide vérifie la page avant de l’afficher.') : t('pro:external.unchanged', 'Aucun changement.'));
    } catch (err) {
      setError(ERR[err?.payload?.code] || t('pro:external.err_invalid', 'Adresse refusée. Indiquez l’adresse https de la page où vous prenez vos rendez-vous.'));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(t('pro:external.remove_confirm', 'Retirer votre page de rendez-vous ?'))) return;
    setError(''); setNotice(''); setBusy(true);
    try { await proRdvClient.externalBooking.remove(); hydrate({ ...(state.data || {}), record: null, shownPublicly: false }); setNotice(t('pro:external.removed', 'Page retirée.')); }
    catch { setError(t('pro:external.err_remove', 'Impossible de retirer la page.')); } finally { setBusy(false); }
  };

  return (
    <Card data-testid="pro-external-booking">
      <CardHeader>
        <CardTitle as="h2">{t('pro:external.title', 'Vous prenez vos rendez-vous sur votre propre système ?')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-800">
        <p>{t('pro:external.intro', 'Indiquez l’adresse de la page où les personnes prennent rendez-vous chez vous (votre site, ou une plateforme publique comme RDV Solidarités). Après vérification, votre fiche affichera « Rendez-vous sur leur site » avec un lien vers cette page. Ce n’est pas une prise de rendez-vous sur AccesDirectAide.')}</p>
        {record ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2" role="status" data-testid="pro-external-booking-status">
            {STATUS[record.status] || record.status}
            {record.status === 'REJECTED' && record.reviewNote ? <span className="block text-xs text-slate-700" lang="fr">{t('pro:external.note', 'Motif : {{note}}', { note: record.reviewNote })}</span> : null}
          </p>
        ) : null}
        {error ? <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800" data-testid="pro-external-booking-error">{error}</p> : null}
        {notice ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">{notice}</p> : null}
        {canEdit ? (
          <form className="space-y-4" onSubmit={save}>
            <div className="space-y-1">
              <label htmlFor={`${uid}-url`} className="font-medium text-slate-900">{t('pro:external.url', 'Adresse de votre page de rendez-vous (https://…)')}</label>
              <Input id={`${uid}-url`} type="url" inputMode="url" dir="ltr" autoComplete="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-describedby={`${uid}-url-hint`} data-testid="pro-external-booking-url" />
              <p id={`${uid}-url-hint`} className="text-xs text-slate-700">{t('pro:external.url_hint', 'Adresse publique en https, sans identifiant, sans mot de passe et sans donnée personnelle. Un lien de RDV Solidarités ou de RDV Service Public (lien « /org/… » ou « /motif/… ») est reconnu comme plateforme publique.')}</p>
            </div>
            <NeedPicker value={needs} onChange={setNeeds} disabled={busy} testId="pro-external-booking-needs" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy} data-testid="pro-external-booking-save">
                {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="me-2 h-4 w-4" aria-hidden="true" />}
                {t('pro:external.save', 'Envoyer pour vérification')}
              </Button>
              {record ? (
                <Button type="button" variant="outline" disabled={busy} onClick={remove} data-testid="pro-external-booking-remove">
                  <Trash2 className="me-2 h-4 w-4" aria-hidden="true" />{t('pro:external.remove', 'Retirer la page')}
                </Button>
              ) : null}
            </div>
          </form>
        ) : record ? (
          <p><a href={record.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" dir="ltr" className="inline-flex items-center gap-1 text-indigo-700 underline">
            {record.url}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">{t('pro:external.new_window', ' (nouvelle fenêtre)')}</span></a></p>
        ) : null}
      </CardContent>
    </Card>
  );
}
