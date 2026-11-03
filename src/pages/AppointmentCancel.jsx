// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';

import { getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';
/**
 * AppointmentCancel — Citizen cancellation via secure token link
 *
 * Route: /appointments/cancel/:token
 * Calls POST /api/appointments/cancel with { token, reason }
 */
export default function AppointmentCancel() {
  const { t } = useT('booking');
  const [token] = useState(() => {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const value = params.get('token') || '';
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        return value;
    });
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');

  const handleCancel = async () => {
    if (!token) {
      setStatus('error');
      setErrorMsg(t('booking:cancel.lien_d_annulation_invalide', "Lien d'annulation invalide."));
      return;
    }

    setStatus('loading');
    try {
      const res = await fetch('/api/appointments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({ token, reason: reason.trim() || undefined }),
      });

      if (res.ok) {
        setStatus('success');
      } else {
        const data = await res.json().catch(() => ({}));
        setStatus('error');
        setErrorMsg(data.error || t('booking:cancel.le_lien_est_invalide_ou', "Le lien est invalide ou a déjà été utilisé."));
      }
    } catch {
      setStatus('error');
      setErrorMsg(t('booking:cancel.erreur_de_connexion_veuillez_reessayer', "Erreur de connexion. Veuillez réessayer."));
    }
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <SEO title={t('booking:cancel.rendez_vous_annule', "Rendez-vous annulé")} noindex />
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg text-center p-8 border border-slate-100">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-emerald-500" size={32} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">{t('booking:cancel.rendez_vous_annule', "Rendez-vous annulé")}</h1>
          <p className="text-sm text-slate-500 mb-8">
            {t('booking:cancel.votre_demande_a_ete_prise', "Votre demande a été prise en compte. L'agent a été informé.")}
          </p>
          <Button onClick={() => navigate('/')} className="w-full">
            {t('booking:cancel.retour_a_l_accueil', "Retour à l'accueil")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <
// @ts-ignore
      SEO title={t('booking:cancel.annuler_mon_rendez_vous', "Annuler mon rendez-vous")} noindex />
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-r from-red-600 to-rose-500 text-white p-8 text-center">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={24} />
          </div>
          <h1 className="text-lg font-bold">{t('booking:cancel.annuler_mon_rendez_vous', "Annuler mon rendez-vous")}</h1>
          <p className="text-xs opacity-80 mt-1">AccesDirectAide</p>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {t('booking:cancel.motif_de_l_annulation_optionnel', "Motif de l'annulation (optionnel)")}
            </span>
            <textarea
              placeholder={t('booking:cancel.ex_empechement_probleme_de_transport', "Ex : Empêchement, problème de transport…")}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm focus:border-red-400 focus:bg-white outline-none transition-all min-h-[120px] resize-none text-slate-700 placeholder:text-slate-400"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {status === 'error' && (
            <div className="p-3 bg-red-50 border border-red-100 text-red-700 rounded-xl flex items-center gap-2 text-xs font-medium">
              <AlertCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-3">
            <Button
              onClick={handleCancel}
              disabled={status === 'loading'}
              variant="destructive"
              className="w-full"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={16} />
                  {t('booking:cancel.traitement', "Traitement…")}
                </>
              ) : (
                t('booking:cancel.confirmer_l_annulation', "Confirmer l'annulation")
              )}
            </Button>

            <Button
              onClick={() => navigate(-1)}
              disabled={status === 'loading'}
              variant="ghost"
              className="w-full"
            >
              {t('booking:cancel.conserver_mon_rendez_vous', "Conserver mon rendez-vous")}
            </Button>
          </div>
        </div>

        <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-400">
            {t('booking:cancel.action_irreversible_accesdirectaide', "Action irréversible · AccesDirectAide")}
          </p>
        </div>
      </div>
    </div>
  );
}
