// @ts-nocheck
import { useState } from 'react';
import SEO from '@/components/SEO';
import { csrfFetch } from '@/lib/csrf';
import { Button } from '@/components/ui/button';

import { useT } from '@/i18n';
// the category values sent to the server; their labels are in the interface language (R40, namespace `contact`)
const CATS = ['ACCOUNT', 'BOOKING', 'CONTENT', 'PRIVACY', 'ACCESSIBILITY', 'OTHER'];

/** PKG-5 / A19 — public help request (/demande-aide). Stored for the ADA support team; no account needed; never asks for documents or dossier content. */
export default function DemandeAide() {
  const { t } = useT('contact');
  const CAT_LABELS = {
    ACCOUNT: t('contact:request.cat_account', 'Mon compte'), BOOKING: t('contact:request.cat_booking', 'Un rendez-vous'),
    CONTENT: t('contact:request.cat_content', 'Une information du site'), PRIVACY: t('contact:request.cat_privacy', 'Mes données personnelles'),
    ACCESSIBILITY: t('contact:request.cat_accessibility', 'L’accessibilité du site'), OTHER: t('contact:request.cat_other', 'Autre chose'),
  };
  const [cat, setCat] = useState(''); const [message, setMessage] = useState(''); const [contact, setContact] = useState(''); const [website, setWebsite] = useState('');
  const [done, setDone] = useState(null); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setProblem(''); setBusy(true);
    try {
      const r = await csrfFetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: cat, message, contact, website }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setProblem(body.message || t('contact:request.envoi_impossible_pour_le_moment', "Envoi impossible pour le moment. Réessayez plus tard.")); return; }
      setDone(body);
    } catch { setProblem(t('contact:request.envoi_impossible_pour_le_moment', "Envoi impossible pour le moment. Réessayez plus tard.")); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <SEO title={t('contact:request.demander_de_l_aide', "Demander de l’aide")} description={t('contact:request.meta_description', 'Écrire à l’équipe d’Accès Direct Aide')} path="/demande-aide" />
      <h1 className="text-2xl font-bold">{t('contact:request.demander_de_l_aide', "Demander de l’aide")}</h1>
      <p>{t('contact:request.l_equipe_d_acces_direct', "L’équipe d’Accès Direct Aide lit votre message. N’écrivez pas d’informations médicales et n’envoyez pas de documents : nous n’en avons pas besoin pour vous répondre.")}</p>
      {done ? (
        <div role="status" className="rounded border border-green-300 bg-green-50 p-3" data-testid="support-done">
          <p>{done.reference ? t('contact:request.saved_with_reference', 'Votre demande est enregistrée (référence {{reference}}).', { reference: done.reference }) : t('contact:request.saved', 'Votre demande est enregistrée.')}</p>
          {done.privacy ? <p>{t('contact:request.elle_est_transmise_a_la', "Elle est transmise à la personne chargée de la protection des données.")}</p> : null}
          <p>{t('contact:request.nous_repondons_seulement_si_vous', "Nous répondons seulement si vous avez laissé un moyen de vous joindre.")}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          {problem ? <p role="alert" data-testid="support-problem" className="text-red-800">{problem}</p> : null}
          <div className="space-y-1">
            <label htmlFor="sup-cat" className="block font-medium">{t('contact:request.c_est_a_propos_de', "C’est à propos de")}</label>
            <select id="sup-cat" required className="w-full rounded border p-2" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">{t('contact:request.choisir', "Choisir")}</option>{CATS.map((v) => <option key={v} value={v}>{CAT_LABELS[v]}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="sup-msg" className="block font-medium">{t('contact:request.votre_message', "Votre message")}</label>
            <textarea id="sup-msg" required rows={6} maxLength={4000} className="w-full rounded border p-2" value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby="sup-msg-help" />
            <p id="sup-msg-help" className="text-sm text-slate-700">{t('contact:request.entre_10_et_4000_caracteres', "Entre 10 et 4000 caractères.")}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="sup-contact" className="block font-medium">{t('contact:request.comment_vous_repondre_facultatif', "Comment vous répondre (facultatif)")}</label>
            <input id="sup-contact" className="w-full rounded border p-2" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t('contact:request.adresse_e_mail_ou_telephone', "adresse e-mail ou téléphone")} />
          </div>
          <div aria-hidden="true" className="hidden"><label htmlFor="sup-website">{t('contact:request.ne_pas_remplir', "Ne pas remplir")}</label><input id="sup-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
          <Button type="submit" disabled={busy || !cat || message.trim().length < 10}>{t('contact:request.envoyer', "Envoyer")}</Button>
        </form>
      )}
    </div>
  );
}
