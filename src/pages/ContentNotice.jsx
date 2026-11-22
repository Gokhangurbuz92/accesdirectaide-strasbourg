// @ts-nocheck
/**
 * G14 / DSA art. 16 — « Signaler un contenu » (/signaler-un-contenu): anyone, without an account, can report a testimonial, a story, a job listing or an
 * Entraide behaviour they consider illegal or contrary to the rules. The four elements of art. 16(2): why (explanation), where (exact address), who (name and
 * e-mail — optional only for a child-safety notice), and the good-faith statement. An acknowledgement goes to the address given (16(4)); the decision follows
 * with the redress (16(5)). A second form lets the notifier contest the decision within six months with the reference and the code of the acknowledgement.
 * Emergency numbers (Service-Public fiche F33954, read 20/11/2026) are shown first. Closed by default: 503 → « not open yet ».
 */
import { useEffect, useId, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useT } from '@/i18n';
import { NOTICE_CATEGORIES, NOTICE_CONTENT_TYPES, categoryLabel, contentTypeLabel } from '@/lib/moderation';

const input = 'mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm';

function AppealForm() {
  const { t } = useT('moderation');
  const id = useId();
  const [v, setV] = useState({ noticeId: '', code: '', body: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = v.noticeId.trim() && v.code.trim() && v.body.trim().length >= 10 && !busy;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setMsg('');
    try { await apiClient.notices.appeal({ noticeId: v.noticeId.trim(), code: v.code.trim(), body: v.body.trim() }); setMsg(t('moderation:appeal.sent', 'Votre contestation est enregistrée. Une personne la réexaminera et vous répondra par e-mail.')); setV({ noticeId: '', code: '', body: '' }); }
    catch (err) { setMsg(err?.message || t('moderation:failed', 'Envoi refusé.')); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="text-lg font-semibold text-slate-900">{t('moderation:appeal.title', 'Contester la décision prise sur votre signalement')}</h2>
      <p className="text-sm text-slate-700">{t('moderation:appeal.intro', 'Pendant six mois après la décision, gratuitement. Indiquez la référence et le code reçus dans l’accusé de réception.')}</p>
      <div>
        <label htmlFor={`${id}-ref`} className="block text-sm font-semibold text-slate-900">{t('moderation:appeal.ref', 'Référence du signalement')}</label>
        <input id={`${id}-ref`} className={input} dir="ltr" autoComplete="off" value={v.noticeId} onChange={(e) => setV({ ...v, noticeId: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${id}-code`} className="block text-sm font-semibold text-slate-900">{t('moderation:appeal.code', 'Code de l’accusé de réception')}</label>
        <input id={`${id}-code`} className={input} dir="ltr" autoComplete="off" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${id}-body`} className="block text-sm font-semibold text-slate-900">{t('moderation:appeal.body', 'Pourquoi la décision devrait-elle être revue ?')}</label>
        <textarea id={`${id}-body`} rows={4} maxLength={2000} className={input} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
      </div>
      <div aria-live="polite" role="status">{msg && <p className="text-sm text-slate-900">{msg}</p>}</div>
      <Button type="submit" disabled={!ready}>{t('moderation:appeal.submit', 'Envoyer la contestation')}</Button>
    </form>
  );
}

export default function ContentNotice() {
  const { t } = useT('moderation');
  const id = useId();
  const [state, setState] = useState(null);   // null = loading, 'closed', 'unstaffed', 'open'
  const [v, setV] = useState({ contentType: '', category: '', contentRef: '', explanation: '', notifierName: '', notifierEmail: '', goodFaith: false, declaredTrustedFlagger: false });
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiClient.notices.status().then((r) => setState(r?.available && r?.staffed ? 'open' : 'unstaffed')).catch(() => setState('closed'));
  }, []);
  const identityOptional = v.category === 'CHILD_SAFETY';
  const ready = v.contentType && v.category && v.contentRef.trim().length >= 3 && v.explanation.trim().length >= 20 && v.goodFaith && !busy
    && (identityOptional || (v.notifierName.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.notifierEmail.trim())));
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setMsg('');
    try {
      const out = await apiClient.notices.submit({ ...v, contentRef: v.contentRef.trim(), explanation: v.explanation.trim(), notifierName: v.notifierName.trim() || undefined, notifierEmail: v.notifierEmail.trim() || undefined });
      setSent(out?.id || '');
    } catch (err) { setMsg(err?.message || t('moderation:failed', 'Envoi refusé.')); } finally { setBusy(false); }
  };
  const title = t('moderation:notice.title', 'Signaler un contenu');
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <SEO title={title} path="/signaler-un-contenu" />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-700">{t('moderation:notice.intro', 'Vous pensez qu’un témoignage, une histoire, une offre d’emploi ou le comportement d’un membre de l’entraide est illicite ou contraire aux règles du site ? Signalez-le ici, avec ou sans compte. Une personne de l’équipe de modération l’examine ; aucun contenu n’est retiré automatiquement.')}</p>
      <aside className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950" aria-labelledby={`${id}-urgent`}>
        <h2 id={`${id}-urgent`} className="font-semibold">{t('moderation:notice.urgent_title', 'En cas de danger immédiat, n’attendez pas la modération')}</h2>
        <ul className="mt-1 list-disc ps-5">
          <li>{t('moderation:notice.urgent_112', '112 : numéro d’urgence européen, gratuit, 24 h/24')}</li>
          <li>{t('moderation:notice.urgent_17', '17 : police secours')}</li>
          <li>{t('moderation:notice.urgent_114', '114 : personnes sourdes, malentendantes ou aphasiques (visio, tchat, SMS), gratuit, 24 h/24')}</li>
          <li>{t('moderation:notice.urgent_119', '119 : enfant en danger, appel gratuit et confidentiel, 24 h/24')}</li>
          <li>{t('moderation:notice.urgent_3919', '3919 : violences faites aux femmes, écoute gratuite 24 h/24 (ce n’est pas un numéro d’urgence : en cas de danger, 17 ou 112)')}</li>
        </ul>
      </aside>
      {state === null && <p role="status">{t('moderation:loading', 'Chargement…')}</p>}
      {state === 'closed' && <p role="status" data-testid="notice-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('moderation:notice.closed', 'Ce formulaire n’est pas encore ouvert : aucun contenu publié par les utilisateurs n’est en ligne. Pour toute question, utilisez l’adresse de contact des mentions légales.')}</p>}
      {state === 'unstaffed' && <p role="status" data-testid="notice-unstaffed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">{t('moderation:notice.unstaffed', 'Le formulaire est momentanément indisponible. Vous pouvez écrire à l’adresse de contact indiquée dans les mentions légales.')}</p>}
      {state === 'open' && (sent !== null ? (
        <p role="status" data-testid="notice-sent" className="rounded-md border border-emerald-400 bg-emerald-50 p-3 text-sm text-emerald-950">
          {t('moderation:notice.sent', 'Merci. Votre signalement est enregistré (référence {{id}}). Si vous avez indiqué une adresse, un accusé de réception vous est envoyé avec un code à garder.', { id: sent })}
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="notice-form">
          <div>
            <label htmlFor={`${id}-type`} className="block text-sm font-semibold text-slate-900">{t('moderation:notice.type', 'Type de contenu')}</label>
            <select id={`${id}-type`} className={input} value={v.contentType} onChange={set('contentType')}>
              <option value="">{t('moderation:choose', 'Choisir')}</option>
              {NOTICE_CONTENT_TYPES.map((c) => <option key={c} value={c}>{contentTypeLabel(c, t)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-ref`} className="block text-sm font-semibold text-slate-900">{t('moderation:notice.ref', 'Adresse exacte de la page (ou description précise du contenu)')}</label>
            <input id={`${id}-ref`} className={input} dir="ltr" maxLength={500} value={v.contentRef} onChange={set('contentRef')} />
          </div>
          <div>
            <label htmlFor={`${id}-cat`} className="block text-sm font-semibold text-slate-900">{t('moderation:notice.category', 'Quel est le problème ?')}</label>
            <select id={`${id}-cat`} className={input} value={v.category} onChange={set('category')}>
              <option value="">{t('moderation:choose', 'Choisir')}</option>
              {NOTICE_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c, t)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-exp`} className="block text-sm font-semibold text-slate-900">{t('moderation:notice.explanation', 'Expliquez pourquoi ce contenu pose problème')}</label>
            <p id={`${id}-exp-help`} className="text-xs text-slate-700">{t('moderation:notice.explanation_help', 'Au moins 20 caractères. Si vous pensez qu’il est illicite, dites pourquoi (par exemple : injure, menace, discrimination, atteinte à la vie privée).')}</p>
            <textarea id={`${id}-exp`} rows={5} maxLength={3000} aria-describedby={`${id}-exp-help`} className={input} value={v.explanation} onChange={set('explanation')} />
          </div>
          <div>
            <label htmlFor={`${id}-name`} className="block text-sm font-semibold text-slate-900">{t('moderation:notice.name', 'Votre nom')}</label>
            <input id={`${id}-name`} className={input} autoComplete="name" maxLength={120} value={v.notifierName} onChange={set('notifierName')} aria-describedby={`${id}-identity-help`} />
          </div>
          <div>
            <label htmlFor={`${id}-email`} className="block text-sm font-semibold text-slate-900">{t('moderation:notice.email', 'Votre adresse e-mail')}</label>
            <input id={`${id}-email`} type="email" className={input} dir="ltr" autoComplete="email" maxLength={254} value={v.notifierEmail} onChange={set('notifierEmail')} aria-describedby={`${id}-identity-help`} />
            <p id={`${id}-identity-help`} className="text-xs text-slate-700">{identityOptional
              ? t('moderation:notice.identity_optional', 'Pour un contenu mettant en danger un enfant, votre nom et votre adresse sont facultatifs.')
              : t('moderation:notice.identity_help', 'Utilisés seulement pour l’accusé de réception, la décision et une éventuelle contestation. L’auteur du contenu ne les voit jamais.')}</p>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-900">
            <input type="checkbox" className="mt-1" checked={v.goodFaith} onChange={set('goodFaith')} />
            <span>{t('moderation:notice.good_faith', 'Je déclare de bonne foi que les informations et les explications de ce signalement sont exactes et complètes.')}</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-900">
            <input type="checkbox" className="mt-1" checked={v.declaredTrustedFlagger} onChange={set('declaredTrustedFlagger')} />
            <span>{t('moderation:notice.trusted', 'J’écris pour une organisation désignée « signaleur de confiance » par l’Arcom (facultatif ; vérifié par la modération).')}</span>
          </label>
          <div aria-live="polite" role="status">{msg && <p className="text-sm text-red-800">{msg}</p>}</div>
          <Button type="submit" disabled={!ready}>{t('moderation:notice.submit', 'Envoyer le signalement')}</Button>
        </form>
      ))}
      {state === 'open' && <AppealForm />}
    </div>
  );
}
