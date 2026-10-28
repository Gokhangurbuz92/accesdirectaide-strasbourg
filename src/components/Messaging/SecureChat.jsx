// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ShieldCheck, Lock, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { cryptoE2EE } from '@/lib/crypto-messaging.js';
import { Button } from '@/components/ui/button';

import { getCsrfHeaders } from '@/lib/csrf';
/**
 * SecureChat
 * Messagerie asynchrone chiffrée côté navigateur.
 *
 * SECURITY NOTE (RC5_SEC1): this is NOT end-to-end encryption. The key is derived (PBKDF2) from `shareId`, an identifier the server stores and that every
 * recipient structure receives, so the platform (and anyone holding the identifier) can derive the same key. Real E2EE requires a client-held secret
 * (the share capability) that never reaches the server — see docs/release/RC4_SECURITY_REVIEW.md.
 *
 * Les messages sont :
 *   1. Chiffrés dans le navigateur de l'expéditeur
 *   2. Stockés sous forme de blob chiffré dans PostgreSQL (puis enveloppés côté serveur)
 *   3. Déchiffrés dans le navigateur du destinataire
 * @param {string} shareId - Identifiant du dossier (dérivation de clé ; connu du serveur)
 */
export default function SecureChat({ shareId, senderId, receiverId, authToken }) {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);
    const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    // AI Assist state


    const fetchMessages = useCallback(async () => {
        if (!shareId) return;
        try {
            const res = await fetch(`/api/secure-messages?shareId=${encodeURIComponent(shareId)}`, {
                headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            });
            if (!res.ok) throw new Error('Impossible de récupérer les messages.');

            const encryptedLogs = await res.json();

            // Déchiffrement local de chaque message
            const decrypted = await Promise.all(
                (encryptedLogs.items || []).map(async (/** @type {{ encryptedContent: string; }} */ msg) => {
                    try {
                        return {
                            ...msg,
                            content: await cryptoE2EE.decrypt(msg.encryptedContent, shareId),
                        };
                    } catch {
                        return { ...msg, content: '🔒 [Erreur de déchiffrement]' };
                    }
                })
            );

            setMessages(decrypted);
        } catch (err) {
            if (import.meta.env.DEV) console.error('[SecureChat] Erreur:', err.message);
        }
    }, [shareId, authToken]);

    useEffect(() => {
        if (!shareId) return;
        fetchMessages();
        const interval = setInterval(fetchMessages, 5000);
        return () => clearInterval(interval);
    }, [shareId, fetchMessages]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || isProcessing) return;

        setIsProcessing(true);
        setError(null);
        try {
            // 1. Chiffrement côté client (Zero-Knowledge)
            const encryptedBlob = await cryptoE2EE.encrypt(newMessage, shareId);

            // 2. Envoi du blob chiffré au serveur
            const res = await fetch('/api/secure-messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrfHeaders(), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
                body: JSON.stringify({
                    shareId,
                    senderId,
                    receiverId,
                    encryptedContent: encryptedBlob,
                }),
            });

            if (!res.ok) throw new Error("Échec de l'envoi au serveur.");

            setNewMessage('');
            fetchMessages();
        } catch (err) {
            setError('Erreur : ' + err.message);
        } finally {
            setIsProcessing(false);
        }
    };


    return (
        <div className="flex flex-col h-full min-h-[500px] bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden font-sans relative">
            {/* En-tête de sécurité */}
            <header className="bg-slate-900 p-5 text-white flex justify-between items-center z-10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="bg-emerald-500/20 p-2 rounded-xl">
                        <ShieldCheck className="text-emerald-400" size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-sm leading-tight">
                            Conversation Souveraine
                        </h3>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                            Messages chiffrés
                        </p>
                    </div>
                </div>
                <Lock size={16} className="text-slate-600" />
            </header>

            {/* Zone des messages */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 scroll-smooth z-0 relative"
                role="log"
                aria-label="Messages de la conversation sécurisée"
                aria-live="polite"
            >
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-700 text-center px-10">
                        <div className="p-4 bg-white rounded-full border border-slate-100 shadow-sm mb-4">
                            <Lock size={24} className="opacity-20" />
                        </div>
                        <p className="text-sm font-medium">
                            Aucun message pour l&apos;instant.
                        </p>
                        <p className="text-[11px] mt-2 leading-relaxed">
                            Les messages sont chiffrés avant l&apos;envoi et stockés sous forme chiffrée.
                            Ce n&apos;est pas encore un chiffrement de bout en bout.
                        </p>
                    </div>
                ) : (
                    messages.map((msg, i) => (
                        <div
                            key={msg.id || i}
                            className={`flex ${msg.senderId === senderId ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[85%] p-3 sm:p-4 rounded-2xl shadow-sm ${msg.senderId === senderId
                                    ? 'bg-indigo-600 text-white rounded-tr-none shadow-indigo-200'
                                    : 'bg-white text-slate-800 rounded-tl-none border border-slate-100'
                                    }`}
                            >
                                <p className="text-[13px] sm:text-sm leading-relaxed whitespace-pre-wrap">
                                    {msg.content}
                                </p>
                                <div className={`text-[9px] mt-2 flex items-center gap-1 font-bold uppercase tracking-tight ${msg.senderId === senderId ? 'text-indigo-200' : 'text-slate-400'}`}>
                                    <Clock size={10} />
                                    {new Date(msg.createdAt).toLocaleTimeString('fr-FR', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* PKG-6 / D22 (found in the M04 sweep, 2026-10-22): an « IA Gemini » panel used to let the PROFESSIONAL « authorize » the analysis of the citizen's
                decrypted messages (« résumé psychologique », urgency, reply suggestions) — without the citizen's consent (PURP-05), by an external model the AI policy
                refuses, through an endpoint that does not exist (pro/ai/assist, unrouted: every click failed). Removed. The consented, local, human-reviewed
                path is the dossier synthesis (R17, ExpertTools). */}
            {/* Feedback d'erreur général */}
            {error && (
                <div
                    className="mx-4 mb-2 p-3 bg-red-50 text-red-600 text-[11px] rounded-xl flex items-center justify-between gap-2 font-bold border border-red-100 z-10 shrink-0"
                    role="alert"
                >
                    <div className="flex items-center gap-2">
                        <AlertCircle size={14} /> {error}
                    </div>
                    <button onClick={() => setError(null)}>&times;</button>
                </div>
            )}

            {/* Barre de saisie */}
            <form
                onSubmit={handleSendMessage}
                className="p-3 sm:p-4 bg-white border-t border-slate-100 flex gap-2 sm:gap-3 z-10 shrink-0"
            >
                <label htmlFor="secure-chat-input" className="sr-only">
                    Votre message protégé
                </label>
                <textarea
                    id="secure-chat-input"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage(e);
                        }
                    }}
                    placeholder="Votre message protégé..."
                    disabled={isProcessing}
                    rows={1}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 pt-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50 resize-none min-h-[40px] max-h-[120px]"
                />
                <button
                    type="submit"
                    disabled={isProcessing || !newMessage.trim()}
                    className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-30 flex items-center justify-center min-w-[45px] self-end h-[44px]"
                    aria-label="Envoyer le message"
                >
                    {isProcessing ? (
                        <Loader2 size={18} className="animate-spin" />
                    ) : (
                        <Send size={18} className="ml-1" />
                    )}
                </button>
            </form>
        </div>
    );
}
