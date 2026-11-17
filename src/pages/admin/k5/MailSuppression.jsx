// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { explain } from './helpers.js';
import { useT } from '@/i18n';

/**
 * RA-07 — levée d'une suppression d'envoi d'e-mails (R44-MAIL), sur la page Demandes d'aide : POST /api/admin/mail-suppressions (opération de plateforme :
 * session nominative avec MFA ET élévation temporaire ; motif de 10 à 500 caractères ; journalisée). L'adresse part seulement dans le corps de la requête,
 * n'est ni conservée ni affichée après la réponse ; le serveur ne la stocke que hachée.
 */
export default function MailSuppression() {
  const { t } = useT('admin');
  const REASON = { hard_bounce: t('admin:k5.mailsup.r_hard_bounce', 'adresse rejetée définitivement par le serveur de messagerie'), blocked: t('admin:k5.mailsup.r_blocked', 'envoi bloqué par le fournisseur'), spam: t('admin:k5.mailsup.r_spam', 'signalé comme indésirable par le destinataire') };
  const [email, setEmail] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState('');
  const reasonOk = reason.trim().length >= 10 && reason.trim().length <= 500;
  const call = async (action) => {
    setMsg(''); setProblem('');
    if (!email.trim()) { setProblem(t('admin:k5.mailsup.p_email', 'Indiquez l’adresse e-mail.')); return; }
    if (action === 'lift' && !reasonOk) { setProblem(t('admin:k5.mailsup.p_reason', 'Indiquez la raison de la levée (10 à 500 caractères).')); return; }
    setBusy(true);
    try {
      const out = await apiClient.admin.k5('mail-suppressions', action === 'lift' ? { action, email: email.trim(), reason: reason.trim() } : { action, email: email.trim() });
      if (action === 'status') setMsg(out?.suppressed ? t('admin:k5.mailsup.is_suppressed', 'Envois suspendus pour cette adresse : {{why}}.', { why: REASON[out.suppressed] || out.suppressed }) : t('admin:k5.mailsup.not_suppressed', 'Aucune suppression pour cette adresse : les e-mails lui sont envoyés normalement.'));
      else {
        setMsg(out?.lifted ? t('admin:k5.mailsup.lifted', 'Suppression levée ({{why}}) et journalisée. Les prochains e-mails seront de nouveau envoyés ; aucun e-mail passé n’est renvoyé.', { why: REASON[out.previous] || out.previous })
          : t('admin:k5.mailsup.nothing', 'Aucune suppression n’existait pour cette adresse : rien n’a été modifié.'));
        setEmail(''); setReason('');
      }
    } catch (e) { setProblem(explain(e)); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-2 rounded border p-3 text-sm" aria-labelledby="mailsup-title" data-testid="admin-mailsup">
      <h2 id="mailsup-title" className="font-semibold">{t('admin:k5.mailsup.title', 'Lever une suppression d’envoi d’e-mails')}</h2>
      <p>{t('admin:k5.mailsup.intro', 'Après un rejet définitif, un blocage ou un signalement d’indésirable, plus aucun e-mail n’est envoyé à l’adresse. Si la personne confirme que son adresse fonctionne, la suppression peut être levée. Opération de plateforme : session avec MFA et élévation temporaire ; le motif est journalisé, l’adresse n’est conservée que sous forme hachée.')} <Link className="text-primary underline" to="/admin/operations">{t('admin:k5.mailsup.elevation_link', 'Demander une élévation (page Opérations)')}</Link></p>
      <form className="space-y-2" noValidate onSubmit={(e) => { e.preventDefault(); call('lift'); }}>
        <div><label htmlFor="mailsup-email" className="block">{t('admin:k5.mailsup.email', 'Adresse e-mail concernée')}</label>
          <input id="mailsup-email" type="email" autoComplete="off" className="w-full rounded border p-2" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label htmlFor="mailsup-reason" className="block">{t('admin:k5.mailsup.reason', 'Motif de la levée (10 à 500 caractères, journalisé)')}</label>
          <textarea id="mailsup-reason" rows={2} className="w-full rounded border p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => call('status')} data-testid="admin-mailsup-status">{t('admin:k5.mailsup.check', 'Vérifier l’état')}</Button>
          <Button type="submit" size="sm" disabled={busy} data-testid="admin-mailsup-lift">{t('admin:k5.mailsup.lift', 'Lever la suppression')}</Button>
        </div>
      </form>
      {problem ? <p role="alert" className="text-destructive" data-testid="admin-mailsup-problem">{problem}</p> : null}
      <div role="status" aria-live="polite" data-testid="admin-mailsup-result">{msg}</div>
    </section>
  );
}
