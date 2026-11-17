// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { citizenApi } from '@/lib/citizenApi';
import { cryptoE2EE } from '@/lib/crypto-messaging.js';
import { useT, formatDateTime } from '@/i18n';
import { useFrAttrs } from '@/lib/recordLang';

const MAX_MESSAGE = 4000;

/**
 * A-17 — the person's side of the conversations organisations opened on their shared dossier: read each thread, answer it.
 * Ownership is checked by the server on every call: the account session (Mon Espace, `ownerSecret` empty) or the private owner link (passport page).
 * Only organisations can open a thread; a thread whose organisation lost its access stays readable and takes no new message.
 * The browser-side layer uses the same key derivation as the professional screen (SecureChat): it is protection in transit and at rest, NOT end-to-end
 * encryption (the platform can read the messages) — the text shown to the person never claims more.
 * @param {{ shareId: string, ownerSecret?: string }} props
 */
export default function DossierThreads({ shareId, ownerSecret = '' }) {
  const { t } = useT('messaging');
  const fr = useFrAttrs();   // the organisations' names and what they wrote stay French (lang="fr" outside French)
  const [state, setState] = useState({ loading: true, failed: false, threads: [] });
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState({ threadId: '', text: '' });
  const [sentIn, setSentIn] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const problemText = useCallback((err) => {
    const status = err && err.status;
    if (status === 409) return t('messaging:threads.err_closed', 'Cette structure n’a plus accès à votre dossier : elle ne pourrait pas lire votre message.');
    if (status === 410) return t('messaging:threads.err_expired', 'Ce dossier a expiré : la conversation est terminée.');
    if (status === 413) return t('messaging:threads.err_too_long', 'Ce message est trop long. Raccourcissez-le, puis réessayez.');
    if (status === 429) return t('messaging:threads.err_too_many', 'Trop de messages en peu de temps. Patientez une minute, puis réessayez.');
    if (status === 404 || status === 401) return t('messaging:threads.err_not_found', 'Cette conversation n’est plus accessible.');
    return t('messaging:threads.err_generic', 'Le message n’a pas pu être envoyé. Réessayez dans un instant.');
  }, [t]);

  const load = useCallback(async () => {
    try {
      const { threads = [] } = await citizenApi.dossierThreads(shareId, ownerSecret);
      const full = await Promise.all(threads.map(async (th) => {
        try {
          const { items = [] } = await citizenApi.dossierThreadMessages(shareId, th.id, ownerSecret);
          const messages = await Promise.all(items.map(async (m) => {
            try { return { ...m, text: await cryptoE2EE.decrypt(m.encryptedContent, shareId), unreadable: false }; } catch { return { ...m, text: '', unreadable: true }; }
          }));
          return { ...th, messages, failed: false };
        } catch { return { ...th, messages: [], failed: true }; }   // a thread that could not be read is said, never shown as empty
      }));
      if (alive.current) setState({ loading: false, failed: false, threads: full });
    } catch (err) {
      // 404 on an account page = the dossier is not this account's (the sharing panel above already says so): no second alarm, no thread
      if (alive.current) setState({ loading: false, failed: !(err && err.status === 404), threads: [] });
    }
  }, [shareId, ownerSecret]);
  useEffect(() => { load(); }, [load]);

  const send = async (thread) => {
    const text = String(drafts[thread.id] || '').trim();
    if (!text || busy) return;
    setBusy(thread.id); setProblem({ threadId: '', text: '' }); setSentIn('');
    try {
      const encryptedContent = await cryptoE2EE.encrypt(text, shareId);
      await citizenApi.sendDossierThreadMessage(shareId, thread.id, encryptedContent, ownerSecret);
      if (!alive.current) return;
      setDrafts((d) => ({ ...d, [thread.id]: '' })); setSentIn(thread.id);
      await load();
    } catch (err) {
      if (alive.current) { setProblem({ threadId: thread.id, text: problemText(err) }); if (err && err.status === 409) load(); }
    } finally { if (alive.current) setBusy(''); }
  };

  return (
    <Card data-testid="dossier-threads">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{t('messaging:threads.title', 'Messages des structures')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-700">{t('messaging:threads.intro', 'Une structure qui a accès à ce dossier peut vous écrire ici. Vous pouvez lui répondre. Seule cette structure lit votre réponse.')}</p>
        {state.loading ? <p role="status" className="text-sm text-slate-700">{t('messaging:threads.loading', 'Chargement des messages…')}</p> : null}
        {state.failed ? (
          <div role="alert" data-testid="threads-failed" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p>{t('messaging:threads.load_failed', 'Les messages n’ont pas pu être lus. Cela ne veut pas dire qu’il n’y en a pas.')}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2 min-h-[44px]" onClick={() => { setState((s) => ({ ...s, loading: true, failed: false })); load(); }}>{t('messaging:threads.retry', 'Réessayer')}</Button>
          </div>
        ) : null}
        {!state.loading && !state.failed && state.threads.length === 0 ? <p data-testid="threads-empty" className="text-sm text-slate-700">{t('messaging:threads.empty', 'Aucune structure ne vous a écrit pour ce dossier.')}</p> : null}
        {state.threads.map((th) => {
          const inputId = `thread-reply-${th.id}`;
          const draft = drafts[th.id] || '';
          return (
            <section key={th.id} data-testid="dossier-thread" aria-labelledby={`thread-title-${th.id}`} className="rounded-lg border border-slate-200 p-3">
              <h3 id={`thread-title-${th.id}`} className="font-semibold text-slate-900" {...fr}>{th.structureName}</h3>
              {th.failed ? <p role="alert" className="mt-2 text-sm text-red-900">{t('messaging:threads.thread_failed', 'Cette conversation n’a pas pu être lue.')}</p> : (
                <ol className="mt-2 space-y-2" aria-label={t('messaging:threads.log_label', 'Messages échangés avec {{name}}', { name: th.structureName })} data-testid="thread-messages">
                  {th.messages.map((m) => {
                    const mine = m.sender !== 'PRO';
                    return (
                      <li key={m.id} data-testid={mine ? 'thread-message-mine' : 'thread-message-pro'} className={`rounded-md border p-2 text-sm ${mine ? 'ms-6 border-indigo-200 bg-indigo-50' : 'me-6 border-slate-200 bg-slate-50'}`}>
                        <p className="text-xs font-semibold text-slate-700">
                          {mine ? t('messaging:threads.from_me', 'Vous') : <span {...fr}>{th.structureName}</span>}
                          <span className="font-normal"> · <time dateTime={new Date(m.createdAt).toISOString()}>{formatDateTime(m.createdAt)}</time></span>
                        </p>
                        {m.unreadable
                          ? <p className="text-slate-700">{t('messaging:threads.unreadable', 'Ce message n’a pas pu être affiché.')}</p>
                          : <p className="whitespace-pre-wrap break-words text-slate-900" dir="auto" {...(mine ? {} : { lang: fr.lang })}>{m.text}</p>}
                      </li>
                    );
                  })}
                </ol>
              )}
              {th.closed ? (
                <p data-testid="thread-closed" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">{t('messaging:threads.closed', 'Cette structure n’a plus accès à votre dossier. Vous pouvez relire ces messages, mais plus lui écrire ici.')}</p>
              ) : th.failed ? null : (
                <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); send(th); }}>
                  <label htmlFor={inputId} className="block text-sm font-medium text-slate-800">{t('messaging:threads.reply_label', 'Votre réponse à {{name}}', { name: th.structureName })}</label>
                  <textarea id={inputId} data-testid="thread-reply" rows={3} maxLength={MAX_MESSAGE} value={draft} dir="auto"
                    aria-describedby={`${inputId}-help`} disabled={busy === th.id}
                    onChange={(e) => setDrafts((d) => ({ ...d, [th.id]: e.target.value }))}
                    className="w-full rounded-md border border-slate-300 p-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600" />
                  <p id={`${inputId}-help`} className="text-xs text-slate-700">{t('messaging:threads.reply_help', 'N’écrivez pas d’informations médicales. Les messages sont enregistrés sous forme chiffrée ; ce n’est pas un chiffrement de bout en bout.')}</p>
                  <Button type="submit" className="min-h-[44px]" data-testid="thread-send" disabled={busy === th.id || !draft.trim()}>{busy === th.id ? t('messaging:threads.sending', 'Envoi…') : t('messaging:threads.send', 'Envoyer')}</Button>
                </form>
              )}
              <div aria-live="polite" role="status">{sentIn === th.id ? <p data-testid="thread-sent" className="mt-2 text-sm text-emerald-900">{t('messaging:threads.sent', 'Message envoyé.')}</p> : null}</div>
              {problem.threadId === th.id ? <p role="alert" data-testid="thread-problem" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900">{problem.text}</p> : null}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
