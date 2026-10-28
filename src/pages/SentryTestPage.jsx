import { useState, useEffect } from 'react';
import { frontendEnv } from '@/config/env';
export default function SentryTestPage() {
    const [dsnConfigured, setDsnConfigured] = useState(false);

    useEffect(() => {
        // Check if DSN is set (non-empty string)
        if (frontendEnv.sentry.dsn) {
            setDsnConfigured(true);
        }
    }, []);

    const throwError = () => {
        throw new Error("Frontend Sentry Test Error: Manual click (/__sentry_test)");
    };

    const triggerRateLimit = async () => {
        try {
            const res = await fetch('/api/ratelimit-test');
            const data = await res.json().catch(() => ({}));
            // R12: only a real answer of the limiter is a result (a missing endpoint used to show « SUCCÈS »)
            if (res.status === 429) {
                alert(`🔴 LIMIT ATTEINTE !\nBackend: ${data.message || 'Trop de tentatives'}`);
            } else if (res.ok) {
                alert(`🟢 SUCCÈS (Allowed)\nBackend Hint: ${data.backend_hint}`);
            } else {
                alert(`Test non disponible (réponse ${res.status}) : aucun résultat de limitation.`);
            }
        } catch {
            alert("Erreur appel API");
        }
    };

    return (
        <div style={{ padding: '50px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
            <h1 style={{ color: '#e11d48' }}>Test Suite (Staging)</h1>
            <p>Use this page to verify integrations without authentication.</p>

            <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', marginBottom: '20px' }}>
                <h3>1. Sentry</h3>
                <div style={{
                    padding: '15px',
                    background: dsnConfigured ? '#f0fdf4' : '#fef2f2',
                    border: '1px solid ' + (dsnConfigured ? '#86efac' : '#fecaca'),
                    borderRadius: '6px',
                    marginBottom: '20px'
                }}>
                    Status DSN: <strong>{dsnConfigured ? '✅ CONFIGURÉ' : '❌ MANQUANT'}</strong>
                </div>
                <button
                    onClick={throwError}
                    disabled={!dsnConfigured}
                    style={{
                        padding: '12px 24px',
                        background: dsnConfigured ? '#e11d48' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: dsnConfigured ? 'pointer' : 'not-allowed',
                        fontWeight: 'bold'
                    }}
                >
                    Déclencher une erreur Sentry
                </button>
            </div>

            <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
                <h3>2. Rate Limit (Vercel KV)</h3>
                <p>Click 4 times quickly to hit the limit (3/min).</p>
                <button
                    onClick={triggerRateLimit}
                    style={{
                        padding: '12px 24px',
                        background: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                    }}
                >
                    Test Rate Limit (Spam Me)
                </button>
            </div>
        </div>
    );
}
