// @ts-nocheck
/**
 * X01 (expansion) — Mes histoires (/compte/histoires). Step 1, JOIN: the person chooses a PSEUDONYM (never prefilled — not the e-mail, not the profile; it
 * cannot be changed afterwards; it is the only name ever shown). Step 2, WRITE a story (adult accounts; moderated before publication): a title, the text with
 * a warning next to it (no health or disability detail, nothing about other people — children in particular), the explicit consent box — never pre-ticked,
 * sent with the version of its wording. Text only: no image, no file, no link, no contact (the server refuses them). The person sees each story's state and
 * can withdraw it at any time (it leaves public view at once and its text is erased), or leave the community (every story withdrawn, the pseudonym deleted).
 * Closed by default: 503 → « not open yet ».
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { citizenApi } from '@/lib/citizenApi';
import { formatDate, useLanguage, useT } from '@/i18n';
import { BODY_MAX, BODY_MIN, problemLabel, reasonLabel, statusLabel, STORY_CONSENT_VERSION, STORY_LANGS, TITLE_MAX, TITLE_MIN, textAttrs } from '@/lib/communityStories';

const field = 'mt-1 w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm';

/** @param {{ onDone: (text: string, error?: boolean) => void }} props */
function JoinForm({ onDone }) {
  const { t } = useT('stories');
  const [pseudonym, setPseudonym] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pseudonym.trim().length < 3 || busy) return;
    setBusy(true);
    try { await citizenApi.storyAction({ action: 'join', pseudonym: pseudonym.trim() }); onDone(t('stories:join.done', 'Votre pseudonyme est enregistré. Vous pouvez maintenant raconter votre histoire.')); }
    catch (err) { onDone(problemLabel(err.code, t) || err.message, true); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="story-join-form" noValidate>
      <h2 className="text-lg font-semibold text-slate-900">{t('stories:join.title', 'Choisir un pseudonyme')}</h2>
      <label htmlFor="story-pseudonym" className="block text-sm font-semibold text-slate-900">{t('stories:join.label', 'Pseudonyme')}</label>
      <p id="story-pseudonym-help" className="text-sm text-slate-700">{t('stories:join.help', 'C’est le seul nom affiché à côté de vos histoires. N’utilisez ni votre nom, ni votre adresse e-mail, ni un numéro. 3 à 24 lettres ou chiffres, « - » ou « _ », sans espace. Il ne pourra pas être modifié.')}</p>
      <input id="story-pseudonym" type="text" autoComplete="off" maxLength={24} value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} aria-describedby="story-pseudonym-help"
        className={`${field} max-w-sm`} />
      <Button type="submit" disabled={pseudonym.trim().length < 3 || busy}>{t('stories:join.submit', 'Rejoindre la communauté')}</Button>
    </form>
  );
}

/** @param {{ onDone: (text: string, error?: boolean) => void }} props */
function StoryForm({ onDone }) {
  const { t } = useT('stories');
  const { code } = useLanguage();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const lang = STORY_LANGS.includes(code) ? code : 'fr';
  const ready = title.trim().length >= TITLE_MIN && body.trim().length >= BODY_MIN && consent && !busy;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await citizenApi.storyAction({ action: 'submit', title: title.trim(), body: body.trim(), lang, consent: true, consentVersion: STORY_CONSENT_VERSION });
      setTitle(''); setBody(''); setConsent(false);
      onDone(t('stories:form.sent', 'Merci. Votre histoire sera relue avant d’être publiée. Vous pouvez la retirer à tout moment.'));
    } catch (err) { onDone(problemLabel(err.code, t) || err.message, true); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="story-form" noValidate>
      <h2 className="text-lg font-semibold text-slate-900">{t('stories:form.title', 'Raconter une histoire')}</h2>
      <div>
        <label htmlFor="story-title" className="block text-sm font-semibold text-slate-900">{t('stories:form.story_title', 'Titre')}</label>
        <input id="story-title" type="text" autoComplete="off" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} {...textAttrs(lang)} className={field} />
      </div>
      <div>
        <label htmlFor="story-body" className="block text-sm font-semibold text-slate-900">{t('stories:form.body', 'Votre histoire')}</label>
        <p id="story-health-warning" data-testid="story-health-warning" className="mt-1 rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-950">
          {t('stories:form.health_warning', 'Ne donnez aucun détail sur votre santé, un handicap ou un traitement, ni d’information qui permettrait de reconnaître une autre personne, en particulier un enfant (nom, adresse, école, téléphone). Ce n’est pas nécessaire : une histoire qui en contient n’est pas publiée.')}
        </p>
        <textarea id="story-body" rows={8} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} aria-describedby="story-health-warning story-text-only story-count" {...textAttrs(lang)}
          className={`${field} mt-2`} />
        <p id="story-count" className="text-xs text-slate-700">{t('stories:form.count', '{{n}} caractères sur {{max}} (au moins {{min}})', { n: body.length, max: BODY_MAX, min: BODY_MIN })}</p>
      </div>
      <p id="story-text-only" className="text-sm text-slate-700">{t('stories:form.text_only', 'Du texte seulement : pas de photo, de fichier, de lien, d’adresse e-mail, de numéro de téléphone ni de compte de réseau social. Seuls le titre, le texte et votre pseudonyme sont publiés.')}</p>
      <label className="flex items-start gap-2 text-sm text-slate-900" data-testid="story-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>{t('stories:form.consent', 'J’accepte que cette histoire soit publiée sur le site sous mon pseudonyme, après relecture. Je peux retirer mon accord à tout moment : l’histoire est alors retirée du site et son texte effacé.')}</span>
      </label>
      <Button type="submit" disabled={!ready}>{t('stories:form.submit', 'Envoyer pour relecture')}</Button>
    </form>
  );
}

export default function CompteHistoires() {
  const { t } = useT('stories');
  const [state, setState] = useState({ loading: true, error: '', closed: false, member: null, stories: [], canSubmit: false });
  const [message, setMessage] = useState({ text: '', error: false });
  const [confirmLeave, setConfirmLeave] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await citizenApi.myStories();
      setState({ loading: false, error: '', closed: r.available === false, member: r.member || null, stories: r.stories || [], canSubmit: r.canSubmit === true });
    } catch (err) {
      setState({ loading: false, closed: err.status === 503, error: err.status === 401 ? t('stories:mine.login_required', 'Connectez-vous pour rejoindre la communauté ou retirer une histoire.') : err.status === 503 ? '' : err.message, member: null, stories: [], canSubmit: false });
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- loaded once; a message follows the language at load time
  useEffect(() => { load(); }, [load]);
  const done = (text, error = false) => { setMessage({ text, error }); load(); };
  const title = t('stories:mine.title', 'Mes histoires');
  if (state.loading) return <div className="container mx-auto max-w-3xl px-4 py-8" role="status">{t('stories:loading', 'Chargement…')}</div>;
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="compte-histoires">
      <SEO title={title} noindex />
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {state.closed && <p role="status" data-testid="stories-closed" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-950">{t('stories:closed', 'Cette fonction n’est pas encore ouverte. Elle le sera après la validation de son analyse d’impact sur la protection des données.')}</p>}
      {state.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{state.error}</p>}
      <div aria-live="polite" role="status">{message.text && <p className={`rounded-md border p-3 ${message.error ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{message.text}</p>}</div>
      {!state.closed && !state.error && (
        <>
          <p className="text-sm text-slate-700">{t('stories:mine.intro', 'Les histoires sont publiées sous un pseudonyme, après relecture. La communauté est réservée aux comptes de personnes de 18 ans ou plus. Vous pouvez retirer une histoire à tout moment.')} <Link className="font-medium text-blue-800 underline" to="/histoires">{t('stories:mine.to_public', 'Lire les histoires publiées')}</Link></p>
          {!state.member ? <JoinForm onDone={done} /> : (
            <>
              <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="story-member">
                <h2 id="story-member" className="text-lg font-semibold text-slate-900">{t('stories:member.title', 'Votre pseudonyme')}</h2>
                <p className="text-slate-900" data-testid="story-pseudonym">{state.member.pseudonym}</p>
                <p className="text-sm text-slate-700">{t('stories:member.leave_help', 'Quitter la communauté retire toutes vos histoires (leur texte est effacé) et supprime votre pseudonyme.')}</p>
                {!confirmLeave ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmLeave(true)}>{t('stories:member.leave', 'Quitter la communauté')}</Button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="destructive" onClick={async () => {
                      setConfirmLeave(false);
                      try { await citizenApi.storyAction({ action: 'leave' }); done(t('stories:member.left', 'Vous avez quitté la communauté : vos histoires sont retirées et votre pseudonyme supprimé.')); }
                      catch (e) { done(e.message, true); }
                    }}>{t('stories:member.leave_confirm', 'Confirmer : quitter et tout retirer')}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>{t('stories:report.cancel', 'Annuler')}</Button>
                  </div>
                )}
              </section>
              {state.stories.length > 0 && (
                <ul className="space-y-4" data-testid="mine-stories">
                  {state.stories.map((x) => (
                    <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900" data-testid="mine-story-status">{statusLabel(x.status, t)} — <time dateTime={x.submittedAt}>{formatDate(x.submittedAt, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>
                      {x.moderationReason && <p className="text-sm text-slate-800">{t('stories:mine.reason', 'Motif : {{reason}}', { reason: reasonLabel(x.moderationReason, t) })}</p>}
                      {x.title && <h3 className="mt-2 font-semibold text-slate-900" {...textAttrs(x.lang)}>{x.title}</h3>}
                      {x.body && <div className="mt-1 whitespace-pre-line text-slate-900" {...textAttrs(x.lang)}>{x.body}</div>}
                      {!x.body && <p className="text-sm text-slate-700">{t('stories:mine.erased', 'Le texte de cette histoire a été effacé.')}</p>}
                      {['pending', 'published'].includes(x.status) && (
                        <div className="mt-3 space-y-1">
                          <p className="text-sm text-slate-700">{t('stories:mine.withdraw_help', 'Le retrait est immédiat : l’histoire n’est plus visible et son texte est effacé.')}</p>
                          <Button type="button" size="sm" variant="destructive" onClick={async () => {
                            try { await citizenApi.storyAction({ action: 'withdraw', id: x.id }); done(t('stories:mine.withdrawn', 'Votre histoire est retirée et son texte effacé.')); }
                            catch (e) { done(e.message, true); }
                          }}>{t('stories:mine.withdraw', 'Retirer cette histoire')}</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {state.canSubmit ? <StoryForm onDone={done} /> : <p className="text-sm text-slate-700" data-testid="story-pending-max">{t('stories:mine.pending_max', 'Vous avez déjà plusieurs histoires en attente de relecture. Vous pourrez en envoyer une autre après la décision.')}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
