import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Send, CheckCircle2 } from 'lucide-react';

import { getCsrfHeaders } from '@/lib/csrf';
import { useT } from '@/i18n';
/**
 * FeedbackButtons
 *
 * Inline feedback widget displayed after each AI response.
 * - Thumbs up → immediate positive feedback
 * - Thumbs down → prompts for optional comment, then submits
 *
 * R40: the texts are in the interface language (namespace `shared`).
 * @param {{ logId: string }} props
 */
export default function FeedbackButtons({ logId }) {
    const { t } = useT('shared');
    const [voted, setVoted] = useState(/** @type {1 | -1 | null} */ (null));
    const [showComment, setShowComment] = useState(false);
    const [comment, setComment] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const [failed, setFailed] = useState(false);
    /** R12: the thanks are shown only when the server recorded the feedback */
    const sendFeedback = async (/** @type {number} */ rating, /** @type {string} */ text) => {
        try {
            const res = await fetch('/api/assistant/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                body: JSON.stringify({ logId, rating, comment: text || undefined }),
            });
            if (!res.ok) throw new Error(String(res.status));
            setFailed(false); setSubmitted(true);
        } catch (err) {
            if (import.meta.env.DEV) console.error('[Feedback] Send error:', err);
            setFailed(true);
        }
    };

    const handleVote = (/** @type {1 | -1} */ rating) => {
        setVoted(rating);
        if (rating === 1) sendFeedback(1, '');
        else setShowComment(true);
    };

    const handleSubmitNegative = () => { sendFeedback(-1, comment); };

    if (!logId) return null;

    if (submitted) {
        return (
            <div role="status" className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {t('shared:chat.feedback_thanks', 'Merci pour votre aide !')}
            </div>
        );
    }

    return (
        <div className="mt-3 space-y-2">
            {!voted ? (
                <div className="flex items-center gap-2">
                    <span className="me-1 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                        {t('shared:chat.feedback_question', 'Cette réponse vous aide ?')}
                    </span>
                    <button
                        type="button"
                        onClick={() => handleVote(1)}
                        className="rounded-lg bg-slate-100 p-1.5 text-slate-400 transition-all hover:bg-emerald-100 hover:text-emerald-600"
                        aria-label={t('shared:chat.feedback_useful', 'Réponse utile')}
                    >
                        <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => handleVote(-1)}
                        className="rounded-lg bg-slate-100 p-1.5 text-slate-400 transition-all hover:bg-red-100 hover:text-red-600"
                        aria-label={t('shared:chat.feedback_not_useful', 'Réponse pas utile')}
                    >
                        <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                </div>
            ) : showComment ? (
                <div className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none transition-all focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
                        placeholder={t('shared:chat.feedback_comment', "Qu'est-ce qui manquait ? (Optionnel)")}
                        aria-label={t('shared:chat.feedback_comment', "Qu'est-ce qui manquait ? (Optionnel)")}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmitNegative()}
                        maxLength={500}
                    />
                    <button
                        type="button"
                        onClick={handleSubmitNegative}
                        className="rounded-xl bg-slate-900 p-2 text-white transition-all hover:bg-slate-800"
                        aria-label={t('shared:chat.feedback_send', 'Envoyer le commentaire')}
                    >
                        <Send className="h-3.5 w-3.5" />
                    </button>
                </div>
            ) : null}
            {/* R43 (strict lint finding: `failed` was set and never shown, so a feedback the server did not record was silent) */}
            {failed ? (
                <p role="alert" className="text-xs text-red-800" data-testid="feedback-failed">
                    {t('shared:chat.feedback_failed', 'Votre avis n’a pas pu être envoyé.')}{' '}
                    <button type="button" className="underline underline-offset-2" onClick={() => sendFeedback(voted === 1 ? 1 : -1, voted === 1 ? '' : comment)}>{t('shared:chat.feedback_retry', 'Réessayer')}</button>
                </p>
            ) : null}
        </div>
    );
}
