// @ts-nocheck
/**
 * R3 — « Signaler » a message of the other party, inside an appointment conversation (citizen and ADA Pro threads).
 * The existing content-report flow receives a category from a closed list; the message text is never sent with the report.
 * RGAA: a real <button> whose accessible name names the message (date), aria-expanded / aria-controls on the disclosure, a <fieldset> with a <legend>
 * for the categories, focus moved into the form when it opens and back to the button when it closes, the outcome announced in a polite live region.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { messagingErrorText } from '@/api/rdv-messaging-client';
import { REPORT_CATEGORIES } from '@/lib/messageReport';

/** @param {{ messageId: string, when: string, onReport: (category: string) => Promise<unknown>, testid?: string }} props */
export default function MessageReportButton({ messageId, when, onReport, testid = 'message-report' }) {
  const { t } = useT('messaging');
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState('');
  const uid = useId();
  const formId = `report-${uid}`;
  const buttonRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const legendRef = useRef(/** @type {HTMLLegendElement | null} */ (null));
  const labels = {
    ABUSIVE: t('messaging:report.cat_abusive', 'Propos injurieux, menaçants ou discriminatoires'),
    SPAM: t('messaging:report.cat_spam', 'Publicité, message répété ou sans rapport avec un service'),
    HEALTH_DATA: t('messaging:report.cat_health', 'Le message contient des informations de santé qui n’ont pas leur place ici'),
    NOT_RELATED: t('messaging:report.cat_not_related', 'Le message ne concerne pas le rendez-vous'),
    OTHER: t('messaging:report.cat_other', 'Autre problème'),
  };

  useEffect(() => { if (open) legendRef.current?.focus(); }, [open]);

  const close = () => { setOpen(false); setCategory(''); buttonRef.current?.focus(); };
  const submit = async (/** @type {import('react').FormEvent} */ e) => {
    e.preventDefault();
    if (!category || busy) return;
    setBusy(true); setStatus('');
    try {
      await onReport(category);
      setDone(true); setOpen(false);
      setStatus(t('messaging:report.done', 'Merci : le message a été signalé à l’équipe d’AccesDirectAide. Le texte du message ne lui est pas transmis ; elle peut vous recontacter par cette conversation.'));
    } catch (err) {
      setStatus(messagingErrorText(err, t('messaging:report.failed', 'Le signalement n’a pas pu être envoyé. Réessayez plus tard.')));
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2" data-testid={testid} data-message-id={messageId}>
      {done ? null : (
        <button
          ref={buttonRef}
          type="button"
          className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {t('messaging:report.button', 'Signaler')}
          <span className="sr-only"> {t('messaging:report.button_sr', 'le message du {{when}}', { when })}</span>
        </button>
      )}
      {open ? (
        <form id={formId} onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-slate-300 bg-white p-3">
          <fieldset className="space-y-1">
            <legend ref={legendRef} tabIndex={-1} className="text-sm font-semibold text-slate-900 focus-visible:outline-none">
              {t('messaging:report.legend', 'Pourquoi signalez-vous ce message ?')}
            </legend>
            <p className="text-xs text-slate-700">{t('messaging:report.privacy', 'Seuls la catégorie choisie et les références de la conversation sont envoyés ; le texte du message ne l’est pas.')}</p>
            {REPORT_CATEGORIES.map((c) => (
              <div key={c} className="flex items-start gap-2">
                <input id={`${formId}-${c}`} type="radio" name={`${formId}-category`} value={c} checked={category === c} onChange={() => setCategory(c)} className="mt-1" />
                <label htmlFor={`${formId}-${c}`} className="text-sm text-slate-800">{labels[c]}</label>
              </div>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={!category || busy} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {busy ? t('messaging:report.sending', 'Envoi…') : t('messaging:report.submit', 'Envoyer le signalement')}
            </button>
            <button type="button" onClick={close} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {t('messaging:report.cancel', 'Annuler')}
            </button>
          </div>
        </form>
      ) : null}
      <p className="text-xs text-slate-700" role="status" aria-live="polite">{status}</p>
    </div>
  );
}
