import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Send, CheckCircle2 } from 'lucide-react';

import { getCsrfHeaders } from '@/lib/csrf';
/**
 * FeedbackButtons
 *
 * Inline feedback widget displayed after each AI response.
 * - Thumbs up → immediate positive feedback
 * - Thumbs down → prompts for optional comment, then submits
 *
 * @param {{ logId: string }} props
 */
export default function FeedbackButtons({ logId }) {
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
            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-500">
                <CheckCircle2 className="h-3 w-3" />
                Merci pour votre aide !
            </div>
        );
    }

    return (
        <div className="mt-3 space-y-2">
            {!voted ? (
                <div className="flex items-center gap-2">
                    <span className="mr-1 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                        Cette réponse vous aide ?
                    </span>
                    <button
                        type="button"
                        onClick={() => handleVote(1)}
                        className="rounded-lg bg-slate-100 p-1.5 text-slate-400 transition-all hover:bg-emerald-100 hover:text-emerald-600"
                        aria-label="Réponse utile"
                    >
                        <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => handleVote(-1)}
                        className="rounded-lg bg-slate-100 p-1.5 text-slate-400 transition-all hover:bg-red-100 hover:text-red-600"
                        aria-label="Réponse pas utile"
                    >
                        <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                </div>
            ) : showComment ? (
                <div className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none transition-all focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
                        placeholder="Qu'est-ce qui manquait ? (Optionnel)"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmitNegative()}
                        maxLength={500}
                    />
                    <button
                        type="button"
                        onClick={handleSubmitNegative}
                        className="rounded-xl bg-slate-900 p-2 text-white transition-all hover:bg-slate-800"
                        aria-label="Envoyer le commentaire"
                    >
                        <Send className="h-3.5 w-3.5" />
                    </button>
                </div>
            ) : null}
        </div>
    );
}
