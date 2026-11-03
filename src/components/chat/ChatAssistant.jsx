// @ts-nocheck
import { useEffect, useRef, useState, useCallback } from 'react';
import { Compass, Send, X, Loader2, RefreshCw, ExternalLink, MapPin, Sparkles, ShieldCheck } from 'lucide-react';
import FeedbackButtons from '@/components/assistant/FeedbackButtons';
import { ensureCsrfHeaders } from '@/lib/csrf';
import { ASSISTANT_OPEN_EVENT } from '@/lib/assistantBridge';
import i18n, { useLanguage, useT } from '@/i18n';
import { Trans } from 'react-i18next';

/** French text inside any interface language: the assistant answers, cites and is asked in French (context.lang = 'fr') */
const FR = { lang: 'fr', dir: 'ltr' };

// PKG-11: the first message of a page that has not called the API yet carried no CSRF token and was refused (403); the token is bootstrapped first
const csrfHeaders = async () => (await ensureCsrfHeaders().catch(() => null)) || {};

/**
 * ChatAssistant v2 — La Boussole Sociale
 *
 * Widget flottant (FAB) d'orientation contextuelle et territoriale.
 * Rebrandé du chatbot technique vers un assistant empathique.
 *
 * @param {{ embedded?: boolean }} props
 *   - embedded: if true, renders inline (for Orientation page); default false = floating widget
 * R40: the frame is in the interface language (namespace `shared`, `chat.*`). The assistant itself works in French: its answers, sources,
 * suggestions and the example questions (sent as they are) stay French (lang="fr"), and outside French the panel says so.
 */

const INITIAL_PROMPTS = [
  "J'ai besoin d'aide pour mon loyer",
  "Je suis en situation de handicap",
  "Où trouver une aide alimentaire ?",
];

// the greeting is ADA's own text (translated at render); `greeting: true` marks it, everything else the assistant says is French
const BOUSSOLE_GREETING = { id: 1, role: 'assistant', greeting: true, content: '' };

export default function ChatAssistant({ embedded = false }) {
  const { t } = useT('shared');
  const [isOpen, setIsOpen] = useState(embedded);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(/** @type {{ text: string, fr?: boolean } | null} */(null));
  const [messages, setMessages] = useState([BOUSSOLE_GREETING]);
  // PKG-11 / P07: the server's canonical territory id is sent back (never a code, which a postal code can collide with), its official name is shown
  const [territory, setTerritory] = useState(/** @type {{ text: string, fr?: boolean } | null} */(null));
  const [territoryLabel, setTerritoryLabel] = useState(/** @type {{ text: string, fr?: boolean } | null} */(null));
  const [pendingQuestion, setPendingQuestion] = useState(/** @type {{ text: string, fr?: boolean } | null} */(null));
  // R13 (D17): the pistes of the result page, attached on the person's request (read-only on the server, removable here, never stored)
  const [assessment, setAssessment] = useState(/** @type {Array<{ rightId: string, state: string }> | null} */(null));
  const [rgpdDismissed, setRgpdDismissed] = useState(() => typeof window !== 'undefined' && !!localStorage.getItem('ada_chatbot_rgpd_dismissed'));
  const endOfMessagesRef = useRef(null);
  const inputRef = useRef(null);
  const fabRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const dialogRef = useRef(null);
  /** @type {import('react').MutableRefObject<AbortController | null>} */
  const abortRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, isLoading]);

  // R14: « Retirer » unmounted the focused button and focus fell out of the modal dialog (trap and Escape lost): focus goes back to the input and the removal is announced
  const [removedNotice, setRemovedNotice] = useState('');
  const removeAssessment = useCallback(() => { setAssessment(null); setRemovedNotice(t('shared:chat.assessment_removed', 'Pistes retirées : vos prochaines questions ne les contiennent plus.')); requestAnimationFrame(() => inputRef.current?.focus()); }, [t]);
  useEffect(() => {
    /** @param {CustomEvent} e */
    const onOpen = (e) => {
      const list = Array.isArray(e.detail?.assessment) ? e.detail.assessment : [];
      setAssessment(list.length ? list : null); setRemovedNotice('');
      setIsOpen(true);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, []);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /** Send a message to the local grounded assistant endpoint */
  const handleSubmit = useCallback(
    async (/** @type {{ preventDefault: () => void; }} */ event) => {
      if (event) event.preventDefault();
      const trimmedValue = typeof event === 'string' ? event : inputValue.trim();
      if (!trimmedValue || isLoading) return;

      setError(null);
      setInputValue('');

      const userMessageId = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: 'user', content: trimmedValue },
      ]);

      setIsLoading(true);

      // Abort any previous in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const questionForServer = pendingQuestion && !territory ? pendingQuestion : trimmedValue;
        const territoryForServer = pendingQuestion && !territory ? trimmedValue : territory;
        const res = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await csrfHeaders()) },
          body: JSON.stringify({
            message: questionForServer,
            context: { lang: 'fr', ...(territoryForServer ? { territory: territoryForServer } : {}), ...(assessment ? { assessment } : {}) },
          }),
          signal: controller.signal,
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.message ? { text: data.message, fr: true } : { text: t('shared:chat.error', 'Une erreur est survenue.') });
          return;
        }

        // Keep only the canonical territory returned by the local resolver.
        if (data.meta?.territoryId) {
          setTerritory(data.meta.territoryId);
          setTerritoryLabel(data.meta.territoryLabel || null);
          setPendingQuestion(null);
        } else if (['territory_required', 'territory_not_resolved', 'territory_ambiguous', 'territory_historical_only', 'territory_outside_service', 'territory_too_broad', 'territory_postal_code'].includes(data.meta?.reason)) {
          setPendingQuestion(questionForServer);
        }

        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: 'assistant',
            content: data.answer,
            links: (data.citations || []).map((/** @type {{ entityType: string | number | boolean | null | undefined, sourceId: string | number | boolean | null | undefined, sourceUrl: string | number | boolean | null | undefined, title: string | number | boolean | null | undefined }} */ citation) => ({
              title: citation.title || citation.sourceId || 'Source officielle',
              url: citation.sourceUrl,
              type: citation.entityType || 'source',
            })).filter((/** @type {{ url: string | number | boolean | null | undefined }} */ link) => link.url),
            suggestions: [],
            logId: null,
          },
        ]);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError({ text: t('shared:chat.error_unexpected', 'Une erreur inattendue est survenue. Veuillez réessayer.') });
      } finally {
        setIsLoading(false);
      }
    },
    [inputValue, isLoading, territory, pendingQuestion, assessment, t],
  );

  /** Send a pre-defined prompt */
  const handlePromptClick = useCallback(
    (/** @type {string} */ prompt) => {
      if (isLoading) return;
      setInputValue('');
      // Build a fake event to reuse handleSubmit
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), role: 'user', content: prompt },
      ]);
      setIsLoading(true);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const questionForServer = pendingQuestion && !territory ? pendingQuestion : prompt;
      const territoryForServer = pendingQuestion && !territory ? prompt : territory;
      csrfHeaders()
        .then((csrf) => fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrf },
          body: JSON.stringify({
            message: questionForServer,
            context: { lang: 'fr', ...(territoryForServer ? { territory: territoryForServer } : {}), ...(assessment ? { assessment } : {}) },
          }),
          signal: controller.signal,
        }))
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'assistant_error');
          return data;
        })
        .then((data) => {
          if (data.meta?.territoryId) {
            setTerritory(data.meta.territoryId);
            setTerritoryLabel(data.meta.territoryLabel || null);
            setPendingQuestion(null);
          } else if (['territory_required', 'territory_not_resolved', 'territory_ambiguous', 'territory_historical_only', 'territory_outside_service', 'territory_too_broad', 'territory_postal_code'].includes(data.meta?.reason)) {
            setPendingQuestion(questionForServer);
          }
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now(),
              role: 'assistant',
              content: data.answer,
              links: (data.citations || []).map((/** @type {{ entityType: string | number | boolean | null | undefined, sourceId: string | number | boolean | null | undefined, sourceUrl: string | number | boolean | null | undefined, title: string | number | boolean | null | undefined }} */ citation) => ({
                title: citation.title || citation.sourceId || 'Source officielle',
                url: citation.sourceUrl,
                type: citation.entityType || 'source',
              })).filter((/** @type {{ url: string | number | boolean | null | undefined }} */ link) => link.url),
              suggestions: [],
              logId: null,
            },
          ]);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setError({ text: t('shared:chat.error_network', 'Erreur de connexion. Réessayez.') });
        })
        .finally(() => setIsLoading(false));
    },
    [isLoading, territory, pendingQuestion, assessment, t],
  );

  const handleRetry = useCallback(() => {
    setError(null);
    inputRef.current?.focus();
  }, []);

  // Auto-focus input when chat opens + restore focus to FAB on close (R33: only after a real close — on page load the focus stays at the top,
  // otherwise the skip link is no longer the first Tab stop)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!embedded) {
      if (isOpen) {
        requestAnimationFrame(() => inputRef.current?.focus());
      } else if (wasOpen.current) {
        fabRef.current?.focus();
      }
    }
    wasOpen.current = isOpen;
  }, [isOpen, embedded]);

  // Focus trap + Esc handler for floating widget
  useEffect(() => {
    if (!isOpen || embedded) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    /** @param {KeyboardEvent} e */
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = dialog.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, embedded]);

  // --- Embedded mode: render inline, no FAB ---
  if (embedded) {
    return (
      <section
        className="flex h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        aria-label={t('shared:chat.region', 'Discussion avec la Boussole Sociale')}
      >
        <CompassHeader />
        <CompassMessages
          messages={messages}
          isLoading={isLoading}
          error={error}
          onRetry={handleRetry}
          onPromptClick={handlePromptClick}
          endOfMessagesRef={endOfMessagesRef}
          territory={territory}
          rgpdDismissed={rgpdDismissed}
          onDismissRgpd={() => { localStorage.setItem('ada_chatbot_rgpd_dismissed', new Date().toISOString()); setRgpdDismissed(true); }}
        />
        <AssessmentAttached count={assessment?.length || 0} onRemove={removeAssessment} notice={removedNotice} />
        <CompassInput
          inputValue={inputValue}
          setInputValue={setInputValue}
          isLoading={isLoading}
          onSubmit={handleSubmit}
          inputRef={inputRef}
        />
      </section>
    );
  }

  // --- Floating widget mode ---
  return (
    <>
      <button
        ref={fabRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-[calc(1.5rem+var(--cookie-banner-offset,0px))] right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg transition-[background-color,transform] hover:bg-teal-800 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 group"
        aria-label={isOpen ? t('shared:chat.close', 'Fermer la Boussole Sociale') : t('shared:chat.open', 'Ouvrir la Boussole Sociale')}
      >
        {isOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Compass className="h-6 w-6 group-hover:rotate-45 transition-transform duration-500" />
        )}
      </button>

      {isOpen && (
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('shared:chat.dialog', 'Fenêtre de discussion avec la Boussole Sociale')}
          className="fixed bottom-[calc(6rem+var(--cookie-banner-offset,0px))] right-0 z-50 flex h-[540px] w-full max-h-[calc(100dvh-7rem-var(--cookie-banner-offset,0px))] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:right-6 sm:w-[400px] sm:rounded-2xl safe-area-bottom"
        >
          <CompassHeader onClose={() => setIsOpen(false)} territory={territoryLabel} />
          <CompassMessages
            messages={messages}
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
            onPromptClick={handlePromptClick}
            endOfMessagesRef={endOfMessagesRef}
            territory={territory}
            rgpdDismissed={rgpdDismissed}
            onDismissRgpd={() => { localStorage.setItem('ada_chatbot_rgpd_dismissed', new Date().toISOString()); setRgpdDismissed(true); }}
          />
          <AssessmentAttached count={assessment?.length || 0} onRemove={removeAssessment} notice={removedNotice} />
          <CompassInput
            inputValue={inputValue}
            setInputValue={setInputValue}
            isLoading={isLoading}
            onSubmit={handleSubmit}
            inputRef={inputRef}
          />
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — Boussole Sociale Branding
// ---------------------------------------------------------------------------

// @ts-ignore
function CompassHeader({ onClose, territory }) {
  const { t } = useT('shared');
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-teal-700 px-4 py-3 text-white">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-white/20 p-1.5">
          <Compass className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold" lang="fr">Boussole Sociale</h2>
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-[10px] font-medium text-teal-100">
              {territory ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {t('shared:chat.territory', 'Territoire')} <span {...FR}>{territory}</span>
                </span>
              ) : (
                t('shared:chat.subtitle', 'Assistant (réponses sourcées)')
              )}
            </span>
          </div>
        </div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          aria-label={t('shared:chat.close', 'Fermer la Boussole Sociale')}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </header>
  );
}

// @ts-ignore
function CompassMessages({ messages, isLoading, error, onRetry, onPromptClick, endOfMessagesRef, territory, rgpdDismissed, onDismissRgpd }) {
  const { t } = useT('shared');
  const { isSource } = useLanguage();
  const showInitialPrompts = messages.length <= 1 && !isLoading;

  return (
    <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" role="log" aria-live="polite">
      {messages.map((/** @type {{ id: any; role: string; content: any; links: any[]; suggestions: (string | number | boolean | null | undefined)[]; logId: string; }} */ message) => (
        <div
          key={message.id}
          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${message.role === 'user'
                ? 'bg-teal-700 text-white'
                : 'border border-slate-200 bg-white text-slate-700'
              }`}
          >
            {message.greeting ? (
              <>
                <p className="leading-relaxed">{t('shared:chat.greeting', 'Bonjour 👋 Je suis la Boussole Sociale. Je peux vous orienter vers les aides et les structures adaptées à votre situation. Posez-moi votre question !')}</p>
                {isSource ? null : <p className="mt-1 text-xs text-slate-600" data-testid="chat-french-only">{t('shared:chat.french_only', 'La Boussole Sociale répond en français.')}</p>}
              </>
            ) : (
              <p className="leading-relaxed" {...(message.role === 'assistant' ? FR : {})}>{message.content}</p>
            )}

            {/* Smart Links */}
            {message.links && message.links.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2">
                {message.links.map((link, /** @type {string | number} */ j) => (
                  <a
                    key={j}
                    href={link.url}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-50"
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {link.type === 'structure' ? (
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                      ) : (
                        <Sparkles className="h-3 w-3 flex-shrink-0" />
                      )}
                      <span {...FR}>{link.title}</span>
                    </span>
                    <ExternalLink className="h-3 w-3 flex-shrink-0 ms-1" aria-hidden="true" />
                  </a>
                ))}
              </div>
            )}

            {/* Suggested follow-up questions */}
            {message.suggestions && message.suggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                {message.suggestions.map((/** @type {string | number | boolean | null | undefined} */ s, /** @type {string | number} */ j) => (
                  <button
                    key={j}
                    type="button"
                    onClick={() => onPromptClick(s)}
                    className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700 transition-colors hover:bg-teal-100"
                  >
                    <span {...FR}>{s}</span>
                  </button>
                ))}
              </div>
            )}

            {message.role === 'assistant' && message.logId && (
              <FeedbackButtons logId={message.logId} />
            )}
          </div>
        </div>
      ))}

      {/* RGPD notice — shown only before first interaction and if not dismissed */}
      {showInitialPrompts && !rgpdDismissed && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-400" aria-hidden="true" />
            <div className="flex-1">
              <p>
                <Trans i18n={i18n} i18nKey="shared:chat.privacy" defaults="Vos messages sont traités par l’assistant local pour produire la réponse et ne sont pas enregistrés dans un journal de conversation.<0> Ne communiquez aucune donnée personnelle</0> (n° sécu, IBAN, etc.)." components={[<strong key="b" className="text-slate-600" />]} />
                {' '}<a href="/confidentialite" className="font-medium text-blue-600 hover:underline">{t('shared:chat.privacy_link', 'Politique de confidentialité')}</a>
              </p>
            </div>
            <button
              type="button"
              onClick={onDismissRgpd}
              className="ms-1 mt-0.5 rounded p-0.5 text-slate-400 hover:text-slate-600 hover:bg-blue-100 transition-colors"
              aria-label={t('shared:chat.privacy_close', 'Fermer la notice RGPD')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Initial suggested prompts */}
      {showInitialPrompts && (
        <div className="space-y-2 pt-2">
          <p className="text-center text-xs font-medium text-slate-400">
            {t('shared:chat.prompts_title', 'Comment puis-je vous guider ?')}
          </p>
          {INITIAL_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPromptClick(prompt)}
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-start text-xs font-medium text-slate-600 shadow-sm transition-all hover:border-teal-300 hover:text-teal-700"
            >
              <span {...FR}>{prompt}</span>
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="flex justify-start">
          <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
            <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" />
            <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-500 [animation-delay:0.15s]" />
            <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-600 [animation-delay:0.3s]" />
            <span className="ms-1">{t('shared:chat.loading', 'Orientation en cours…')}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex justify-start" data-testid="chat-error">
          <div className="flex max-w-[85%] flex-col gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <p {...(error.fr ? FR : {})}>{error.text}</p>
            <div className="flex flex-wrap gap-2">
              {error.fr && error.text.includes('indisponible') && (
                <a
                  href="/orientation"
                  className="inline-flex items-center gap-1 self-start rounded-md bg-teal-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-teal-700"
                >
                  {t('shared:chat.go_diagnostic', 'Aller au diagnostic')}
                </a>
              )}
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 self-start rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                {t('shared:chat.retry', 'Réessayer')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={endOfMessagesRef} />
    </div>
  );
}

// @ts-ignore
function CompassInput({ inputValue, setInputValue, isLoading, onSubmit, inputRef }) {
  const { t } = useT('shared');
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-slate-200 bg-white p-3">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        placeholder={t('shared:chat.input_placeholder', 'Décrivez votre situation…')}
        maxLength={800}
        disabled={isLoading}
        className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={t('shared:chat.input_label', 'Message utilisateur')}
      />
      <button
        type="submit"
        disabled={!inputValue.trim() || isLoading}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={t('shared:chat.send', 'Envoyer le message')}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </form>
  );
}

/** R13 (D17): what the person attached, and how to take it back. */
function AssessmentAttached({ count, onRemove, notice = '' }) {
  const { t } = useT('shared');
  if (!count) return notice ? <p role="status" data-testid="assistant-assessment-removed" className="sr-only">{notice}</p> : null;
  return (
    <div data-testid="assistant-assessment-attached" className="flex items-start gap-2 border-t border-teal-100 bg-teal-50 px-4 py-2 text-xs text-teal-900">
      <p className="flex-1">
        {t('shared:chat.assessment_attached', { count, defaultValue_one: 'Votre piste de simulation est jointe à vos questions, en lecture seule. La Boussole les explique, elle ne décide pas.', defaultValue_other: 'Vos {{count}} pistes de simulation sont jointes à vos questions, en lecture seule. La Boussole les explique, elle ne décide pas.' })}
      </p>
      <button type="button" data-testid="assistant-assessment-remove" onClick={onRemove}
        className="min-h-8 rounded border border-teal-300 bg-white px-2 font-semibold text-teal-900 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
        {t('shared:chat.assessment_remove', 'Retirer')}
      </button>
    </div>
  );
}
