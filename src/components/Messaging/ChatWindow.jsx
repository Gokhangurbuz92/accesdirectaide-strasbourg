// @ts-nocheck

import { useState, useEffect, useRef } from 'react';
import HealthDocumentNotice from '@/components/HealthDocumentNotice';

// Simplified FALC-compatible Chat Window
// @ts-ignore
export default function ChatWindow({ messages, onSendMessage, onUploadFile, loading, error, isPro = false }) {
    // Attachments are offered only when the host page wires a real upload handler (no dead paperclip).
    const canAttach = typeof onUploadFile === 'function';
    const [newMessage, setNewMessage] = useState("");
    const [file, setFile] = useState(null);
    const messagesEndRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = () => {
        if (!newMessage.trim() && !file) return;
        if (file && canAttach) {
            onUploadFile(file);
            setFile(null);
        }
        if (newMessage.trim()) {
            onSendMessage(newMessage);
            setNewMessage("");
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    return (
        <div className="flex flex-col h-[600px] border border-gray-300 rounded-lg bg-gray-50 font-sans">
            {/* Header */}
            <div className="bg-white p-4 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-800">
                    {isPro ? "Conversation avec le bénéficiaire" : "Vos messages avec le professionnel"}
                </h2>
                {error && <div className="text-red-600 font-bold mt-2 bg-red-100 p-2 rounded">{error}</div>}
            </div>

            {/* Messages List — RGAA: aria-live for screen reader announcements */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4" aria-live="polite" role="log" aria-label="Messages de la conversation">
                {loading && <p className="text-gray-500 italic">Chargement des messages...</p>}
                {!loading && messages.length === 0 && (
                    <p className="text-gray-500 text-center mt-10">Aucun message pour le moment.</p>
                )}
                {messages.map((/** @type {{ sender: string; id: any; content: any; attachments: any[]; accessToken: any; createdAt: string | number | Date; }} */ msg) => {
                    const isMe = isPro ? msg.sender === 'PRO' : msg.sender === 'BENEFICIARY';
                    return (
                        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] p-3 rounded-lg text-lg ${isMe ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-800 shadow-sm'
                                }`}>
                                {/* a message stored in the former browser-encrypted format is read in the conversation view, which holds its key */}
                                <div className="whitespace-pre-wrap">{String(msg.content || '').startsWith('E2EE:') ? 'Message dans un ancien format : ouvrez la conversation depuis la messagerie pour le lire.' : msg.content}</div>
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="mt-2 border-t border-white/20 pt-2">
                                        {msg.attachments.map(att => (
                                            <div key={att.id} className="flex items-center space-x-2 bg-black/10 p-1 rounded mb-1">
                                                <span aria-hidden="true">📎</span> <span>Fichier reçu</span>
                                                <a
                                                    href={`/api/download?id=${att.id}&token=${msg.accessToken || ''}`}
                                                    // Note: Token injection depends on context. 
                                                    // For Beneficiary, we pull token from URL usually. 
                                                    // For Pro, we rely on session/download endpoint logic? 
                                                    // Actually, secure download needs token or session.
                                                    // We'll handle 'onClick' to use proper download logic from parent if needed.
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="underline font-bold"
                                                >
                                                    Télécharger
                                                </a>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className={`text-xs mt-1 ${isMe ? 'text-blue-100' : 'text-gray-500'}`}>
                                    {new Date(msg.createdAt).toLocaleString('fr-FR', {
                                        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                                    })}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-white p-4 border-t border-gray-200">
                <div className="flex flex-col space-y-3">
                    {/* File Preview */}
                    {file && (
                        <div className="flex items-center justify-between bg-blue-50 p-2 rounded">
                            <span className="truncate font-medium">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                            <button onClick={() => setFile(null)} className="text-red-500 font-bold px-2">X</button>
                        </div>
                    )}

                    {canAttach ? <div className="mb-2"><HealthDocumentNotice testid="chat-health-notice" /></div> : null}
                    <div className="flex items-end space-x-3">
                        {/* File Button — only when an upload handler is wired */}
                        {canAttach && (
                        <label className="cursor-pointer p-3 text-gray-500 hover:bg-gray-100 rounded-full border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2" aria-label="Joindre un fichier">
                            <span aria-hidden="true">📎</span>
                            <input type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.jpg,.jpeg,.png" />
                        </label>
                        )}

                        {/* Text Input */}
                        <textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Écrivez votre message ici..."
                            className="flex-1 p-3 border border-gray-300 rounded-lg text-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                            rows="2"
                            aria-label="Écrivez votre message"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                        />

                        {/* Send Button */}
                        <button
                            onClick={handleSend}
                            disabled={!newMessage.trim() && !file}
                            className={`p-3 rounded-lg font-bold text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${(!newMessage.trim() && !file) ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                            aria-label="Envoyer le message"
                        >
                            Envoyer
                        </button>
                    </div>
                    <p className="text-sm text-gray-500">Formats acceptés : PDF, JPG, PNG (max 10 Mo).</p>
                </div>
            </div>
        </div>
    );
}
