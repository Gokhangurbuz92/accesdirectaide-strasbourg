// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { ensureCsrfHeaders, getCsrfHeaders } from '@/lib/csrf';
export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState({ type: '', message: '' });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
        setLoading(true);
        setStatus({ type: '', message: '' });

        try {
            const res = await fetch('/api/pro/auth/forgot-password', {
                method: 'POST',
                // R7: a first visit has no __csrf cookie yet — ask the server for one first (it was refused « Forbidden »)
                headers: { 'Content-Type': 'application/json', ...((await ensureCsrfHeaders()) || getCsrfHeaders()) },
                body: JSON.stringify({ email })
            });
            const data = await res.json();

            if (!res.ok) {
                // Rate limit or other error
                throw new Error(data.error || "Une erreur est survenue.");
            }

            setStatus({
                type: 'success',
                message: data.message
            });
        } catch (err) {
            setStatus({ type: 'error', message: err.message });
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <SEO title="Mot de passe oublié - Pro" noindex={true} />
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle as="h1">Mot de passe oublié</CardTitle>
                    <CardDescription>Recevez un lien de réinitialisation.</CardDescription>
                </CardHeader>
                <CardContent>
                    {status.message && (
                        <Alert variant={status.type === 'error' ? "destructive" : "default"} className={`mb-4 ${status.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' : ''}`}>
                            {status.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                            <AlertDescription>{status.message}</AlertDescription>
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? <Loader2 className="animate-spin h-4 w-4" /> : "Envoyer le lien"}
                        </Button>
                        <div className="text-center text-sm">
                            <Link to="/pro/login" className="text-blue-600 hover:underline">Retour à la connexion</Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </main>
    );
}
