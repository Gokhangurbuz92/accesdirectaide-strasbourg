// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, ArrowLeft, Calendar, User, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import ChatWindow from '@/components/Messaging/ChatWindow';
import VisioTrigger from '@/components/pro/VisioTrigger';

import { getCsrfHeaders } from '@/lib/csrf';
import { noticeLine } from '@/lib/proLabels.js';
export default function ProAppointmentDetail() {
    const { id } = useParams();
    const [appointment, setAppointment] = useState(null);
    const [messages, setMessages] = useState([]);
    const [loadingAppt, setLoadingAppt] = useState(true);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [activeTab, setActiveTab] = useState('details'); // 'details' | 'messages'
    // R14: a refused or failed load is said (it used to read « Rendez-vous introuvable » / an empty conversation)
    const [loadError, setLoadError] = useState(null);
    const [msgError, setMsgError] = useState(null);
    const [sendError, setSendError] = useState(null);

    const token = localStorage.getItem('pro_token');

    const [reloadKey, setReloadKey] = useState(0);
    // Fetch Appointment
    useEffect(() => {
        setLoadError(null);
        fetch(`/api/pro/appointments?id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(async (res) => {
                if (res.status === 404) return {};
                if (!res.ok) throw Object.assign(new Error('load'), { status: res.status });
                return res.json();
            })
            .then(data => {
                if (Array.isArray(data?.items) && data.items.length > 0) {
                    setAppointment(data.items[0]);
                } else if (Array.isArray(data) && data.length > 0) {
                    setAppointment(data[0]);
                }
            })
            .catch(e => { setLoadError(e?.status === 401 ? 'Votre session a expiré : reconnectez-vous.' : e?.status === 429 ? 'Trop de demandes : réessayez dans un instant.' : 'Le rendez-vous n’a pas pu être chargé.'); if (import.meta.env.DEV) console.error(e); })
            .finally(() => setLoadingAppt(false));
    }, [id, token, reloadKey]);

    const fetchMessages = useCallback(() => {
        setLoadingMsgs(true); setMsgError(null);
        fetch(`/api/pro/messages?appointmentId=${id}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(async (res) => { if (!res.ok) throw new Error('messages'); return res.json(); })
            .then(data => setMessages(data.messages || []))
            .catch(e => { setMsgError('Les messages n’ont pas pu être chargés.'); if (import.meta.env.DEV) console.error(e); })
            .finally(() => setLoadingMsgs(false));
    }, [id, token]);

    // Fetch Messages when tab active (PKG-3: declared after fetchMessages — the effect read it before its initialisation and the page crashed on every load)
    useEffect(() => {
        if (activeTab === 'messages' && appointment) {
            fetchMessages();
        }
    }, [activeTab, appointment, fetchMessages]);


    const handleSendMessage = async (content) => {
        try {
            const res = await fetch(`/api/pro/messages?appointmentId=${id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...getCsrfHeaders(),
                },
                body: JSON.stringify({ content })
            });
            if (res.ok) {
                setSendError(null);
                fetchMessages();
            } else {
                const body = await res.json().catch(() => ({}));
                setSendError(body?.code === 'NO_CITIZEN_ACCOUNT' ? 'Cette personne n’a pas de compte : aucun message ne peut lui être envoyé ici.' : (body?.message || 'Le message n’a pas été envoyé.'));
            }
        } catch {
            setSendError('Le message n’a pas été envoyé (réseau).');
        }
    };

    // Attachments: intentionally not offered here. The legacy /api/upload endpoint no longer exists and the old client code posted unauthenticated
    // uploads; pro document exchange goes through the dossier vault (/api/pro/dossier/upload-secure). Re-enable only with an authenticated, scanned storage flow.

    if (loadingAppt) return <SkeletonList count={3} variant="card" />;
    if (loadError) return (
        <div role="alert" data-testid="pro-appointment-load-error" className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-900">
            <p className="font-semibold">{loadError}</p>
            <Button className="mt-4" variant="outline" onClick={() => { setLoadingAppt(true); setReloadKey((k) => k + 1); }}>Réessayer</Button>
        </div>
    );
    if (!appointment) return <div className="text-center p-10"><h1 className="text-xl font-bold text-slate-900">Rendez-vous introuvable</h1></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" asChild>
                    <Link to="/pro/rdv/agenda"><ArrowLeft className="mr-2 h-4 w-4" /> Retour</Link>
                </Button>
                <h1 className="text-xl font-bold">Rendez-vous avec {appointment.beneficiary.firstName}</h1>
            </div>

            {/* Tabs */}
            <div className="flex space-x-4 border-b border-slate-200">
                <button
                    onClick={() => setActiveTab('details')}
                    className={`pb-2 px-4 font-medium ${activeTab === 'details' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-700'}`}
                >
                    Détails
                </button>
                <button
                    onClick={() => setActiveTab('messages')}
                    className={`pb-2 px-4 font-medium ${activeTab === 'messages' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-700'}`}
                >
                    Messages
                </button>
            </div>

            {activeTab === 'details' && (
                <div className="bg-white p-6 rounded-lg shadow border border-slate-200 space-y-4">
                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <h3 className="font-semibold text-slate-900 mb-2">Informations</h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-slate-700" /> {format(new Date(appointment.start_at), 'PPP à HH:mm', { locale: fr })}</div>
                                <div className="flex items-center gap-2"><Video className="h-4 w-4 text-slate-700" /> <span data-testid="pro-appt-mode">{appointment.modeLabel || appointment.mode}</span></div>
                                {appointment.rescheduleCount ? <div className="text-sm text-amber-900" data-testid="pro-appt-rescheduled">Déplacé {appointment.rescheduleCount} fois par la personne{appointment.rescheduledAt ? ` (dernière fois le ${format(new Date(appointment.rescheduledAt), 'PPP à HH:mm', { locale: fr })})` : ''}</div> : null}
                                {Array.isArray(appointment.notices) && appointment.notices.length ? (
                                    <ul className="text-xs text-slate-600" data-testid="pro-appt-notices">{appointment.notices.map((n, i) => <li key={i}>{noticeLine(n)}</li>)}</ul>
                                ) : null}
                                <div className="flex items-center gap-2"><User className="h-4 w-4 text-slate-700" /> {appointment.serviceName}</div>
                            </div>
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-900 mb-2">Bénéficiaire</h3>
                            <div className="space-y-2 text-sm">
                                <p>Nom : {appointment.beneficiary.firstName || 'Masqué'}</p>
                                <p>Contact : {appointment.beneficiary.contactMasked}</p>
                            </div>
                        </div>
                    </div>

                    {/* Visio */}
                    {appointment.status !== 'cancelled' && appointment.mode === 'VIDEO' && (
                        <div className="border-t border-slate-200 pt-4">
                            <h3 className="font-semibold text-slate-900 mb-3">Visioconférence</h3>
                            <VisioTrigger appointment={appointment} onChange={() => setReloadKey((k) => k + 1)} />
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'messages' && (msgError || sendError) && (
                <div role="alert" data-testid="pro-appointment-messages-error" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <span>{msgError || sendError}</span>
                    {msgError && <Button size="sm" variant="outline" onClick={fetchMessages}>Réessayer</Button>}
                </div>
            )}
            {activeTab === 'messages' && !msgError && (
                <ChatWindow
                    messages={messages}
                    loading={loadingMsgs}
                    onSendMessage={handleSendMessage}
                    isPro={true}
                />
            )}
        </div>
    );
}
