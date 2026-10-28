// @ts-nocheck
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCsrfHeaders } from '@/lib/csrf';
import { OWNER_HEADER } from '@/lib/shareOwner';
import {
    Smartphone,
    BellRing,
    CheckCircle2,
    Loader2,
    ShieldCheck,
} from 'lucide-react';

/**
 * SmsToggle — Opt-in SMS reminder for appointments
 *
 * Props:
 * - appointmentId: string
 * - initialPhone?: string (pre-filled)
 * - shareId / ownerSecret: the dossier proof of the passport page (the appointment id alone is not a credential)
 */

const FRENCH_PHONE_RE = /^(?:(?:\+|00)33|0)\s*[1-9](?:[\s.\-]*\d{2}){4}$/;

export default function SmsToggle({ appointmentId, initialPhone = '', shareId, ownerSecret }) {
    const [phone, setPhone] = useState(initialPhone);
    const [status, setStatus] = useState('idle'); // idle | loading | done | error
    const [errorMsg, setErrorMsg] = useState('');
    const [doneMsg, setDoneMsg] = useState('');
    const [configured, setConfigured] = useState(false);

    const subscribe = async () => {
        setErrorMsg('');

        if (!FRENCH_PHONE_RE.test(phone)) {
            setStatus('error');
            setErrorMsg('Numéro invalide. Format : 06 12 34 56 78');
            return;
        }

        setStatus('loading');
        try {
            const res = await fetch('/api/public/sms-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrfHeaders(), ...(ownerSecret ? { [OWNER_HEADER]: ownerSecret } : {}) },
                body: JSON.stringify({ appointmentId, phoneNumber: phone, action: 'subscribe', shareId }),
            });

            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.message || d.error || 'Erreur');

            // PKG-11 audit pass 2: the server says whether an SMS can actually leave; the screen repeats it instead of promising one
            setConfigured(d.smsConfigured === true); setDoneMsg(String(d.message || ''));
            setStatus('done');
        } catch (err) {
            setStatus('error');
            setErrorMsg(err.message || 'Échec de l\'activation.');
        }
    };

    if (status === 'done') {
        return (
            <Card>
                <CardContent className="p-4 text-center">
                    <CheckCircle2 className="text-emerald-600 mx-auto mb-2" size={22} aria-hidden="true" />
                    <p className="text-xs font-semibold text-emerald-800" data-testid="sms-subscribed">
                        {configured ? 'Rappel SMS enregistré' : 'Accord enregistré — SMS pas encore actifs'}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                        {doneMsg} Vous pouvez retirer votre accord dans votre profil.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                    <Smartphone size={14} className="text-indigo-500" />
                    <p className="text-xs font-semibold text-slate-900">Rappel par SMS</p>
                </div>

                <div className="flex gap-2">
                    <input
                        type="tel"
                        placeholder="06 12 34 56 78"
                        value={phone}
                        onChange={(e) => {
                            setPhone(e.target.value);
                            if (status === 'error') setStatus('idle');
                        }}
                        aria-label="Numéro de téléphone pour le rappel SMS"
                        className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <Button
                        size="sm"
                        onClick={subscribe}
                        disabled={status === 'loading' || !phone}
                        aria-label="J'accepte de recevoir un rappel par SMS pour ce rendez-vous"
                        data-testid="sms-subscribe"
                    >
                        {status === 'loading' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <BellRing className="h-3.5 w-3.5" />
                        )}
                    </Button>
                </div>

                {status === 'error' && errorMsg && (
                    <p role="alert" className="text-xs text-red-700 font-medium">{errorMsg}</p>
                )}

                <p className="text-xs text-slate-600 flex items-center gap-1">
                    <ShieldCheck size={12} className="shrink-0" aria-hidden="true" />
                    Numéro utilisé uniquement pour les rappels de ce rendez-vous. Votre accord est enregistré ; vous pouvez le retirer à tout moment dans votre profil.
                </p>
            </CardContent>
        </Card>
    );
}
