// @ts-nocheck
import { useRef, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getCsrfHeaders } from '@/lib/csrf';
import {
    Scale,
    PenTool,
    CheckCircle2,
    RotateCcw,
    Loader2,
    ShieldCheck,
} from 'lucide-react';

/**
 * ConsentPad — Signature électronique RGPD
 *
 * L'usager signe avec le doigt (mobile) ou la souris (desktop)
 * avant que son dossier ne soit ouvert par l'accompagnateur.
 *
 * Props:
 * - shareId: ID du dossier partagé
 * - onSigned: callback après signature validée
 */
// @ts-ignore
export default function ConsentPad({ shareId, onSigned }) {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [isEmpty, setIsEmpty] = useState(true);
    const [status, setStatus] = useState('idle'); // idle | sending | done | error

    const getPos = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
        const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
        // Scale for CSS vs canvas pixel mismatch
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY,
        };
    }, []);

    const startDrawing = useCallback(
        (/** @type {{ preventDefault: () => void; }} */ e) => {
            e.preventDefault();
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const { x, y } = getPos(e);
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#1e293b';
            ctx.beginPath();
            ctx.moveTo(x, y);
            setIsDrawing(true);
            setIsEmpty(false);
        },
        [getPos]
    );

    const draw = useCallback(
        (/** @type {{ preventDefault: () => void; }} */ e) => {
            if (!isDrawing) return;
            e.preventDefault();
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const { x, y } = getPos(e);
            ctx.lineTo(x, y);
            ctx.stroke();
        },
        [isDrawing, getPos]
    );

    const stopDrawing = useCallback(() => {
        setIsDrawing(false);
    }, []);

    const clear = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setIsEmpty(true);
        setStatus('idle');
    };

    const submit = async () => {
        if (isEmpty || !canvasRef.current) return;
        setStatus('sending');

        try {
            const signatureData = canvasRef.current.toDataURL('image/png');

            const res = await fetch('/api/pro/consent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                body: JSON.stringify({ shareId, signatureData }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Échec');
            }

            setStatus('done');
            setTimeout(() => onSigned?.(), 1500);
        } catch {
            setStatus('error');
        }
    };

    return (
        <div
            className="fixed inset-0 z-[150] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Signature de consentement RGPD"
        >
            <Card className="w-full max-w-md shadow-2xl">
                <CardContent className="p-6 space-y-5">
                    {/* Header */}
                    <div className="text-center">
                        <div className="inline-flex p-3 bg-indigo-50 rounded-xl mb-3">
                            <Scale size={24} className="text-indigo-600" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">
                            Accord de partage
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                            En signant, vous autorisez l&apos;accompagnateur à consulter votre
                            dossier pour une durée de 30 jours.
                        </p>
                    </div>

                    {/* Signature canvas */}
                    <div className="relative">
                        <canvas
                            ref={canvasRef}
                            width={400}
                            height={180}
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                            className="w-full h-40 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl cursor-crosshair touch-none"
                        />
                        <button
                            onClick={clear}
                            className="absolute top-2 right-2 p-1.5 bg-white text-slate-400 hover:text-red-500 rounded-lg shadow-sm border border-slate-100 transition-colors"
                            aria-label="Effacer la signature"
                            type="button"
                        >
                            <RotateCcw size={14} />
                        </button>
                        {isEmpty && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <p className="text-xs text-slate-300 flex items-center gap-1.5">
                                    <PenTool size={12} /> Signez ici
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Trust notice */}
                    <div className="flex items-start gap-2 p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                        <ShieldCheck className="text-emerald-600 shrink-0 mt-0.5" size={14} />
                        <p className="text-[10px] text-emerald-700 leading-relaxed">
                            Votre signature est horodatée et protégée par un hash
                            cryptographique SHA-256 infalsifiable. Elle constitue votre preuve
                            de consentement RGPD.
                        </p>
                    </div>

                    {/* Submit */}
                    <Button
                        onClick={submit}
                        disabled={isEmpty || status === 'sending' || status === 'done'}
                        className={`w-full ${status === 'done' ? 'bg-emerald-500 hover:bg-emerald-500' : ''
                            }`}
                    >
                        {status === 'sending' && (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Sécurisation...
                            </>
                        )}
                        {status === 'done' && (
                            <>
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Consentement enregistré
                            </>
                        )}
                        {(status === 'idle' || status === 'error') && (
                            <>
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Valider et partager
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
