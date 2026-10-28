// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
    Calendar as CalendarIcon,
    Clock,
    User,
    Video,
    MapPin,
    ChevronRight,
    CheckCircle2,
    ShieldCheck,
    ArrowLeft,
    CalendarCheck,
    Loader2,
    AlertCircle,
} from 'lucide-react';
import { track } from '@vercel/analytics';
import SEO from '@/components/SEO';

import { csrfFetch, ensureCsrfHeaders, getCsrfHeaders } from '@/lib/csrf';
import { normalizeNextPath } from '@/lib/rdvRouting';
/**
 * PublicBooking
 *
 * Interface de prise de RDV côté usager — Design avancé avec tunnel
 * en 4 étapes : Conseiller → Créneau → Mode → Confirmation.
 *
 * Se connecte aux API existantes :
 *   - GET  /api/rdv/structures/:slug/services
 *   - GET  /api/rdv/structures/:slug/slots
 *   - POST /api/rdv/appointments
 */
export default function PublicBooking() {
    const { structureSlug } = useParams();
    const [searchParams] = useSearchParams();
    const nextPath = normalizeNextPath(searchParams.get('next') || '', '');
    const journeyAideSlug = String(searchParams.get('aide') || '').trim();
    const appointmentId = String(searchParams.get('appointment') || '').trim();

    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [slotsError, setSlotsError] = useState('');

    // Booking state
    const [services, setServices] = useState([]);
    const [selectedService, setSelectedService] = useState(null);
    const [slots, setSlots] = useState([]);
    const [selectedSlot, setSelectedSlot] = useState(null);
    // owner usefulness pass (2026-10-25): in person by default, only the modes the chosen service really offers, and the explicit agreement the server
    // requires for a video appointment. Before, VIDEO was pre-selected and no agreement was sent: a booking with the defaults was always refused
    // (409 MODE_UNAVAILABLE when video is off — the default — or 400 VIDEO_CONSENT_REQUIRED) and the raw code was shown.
    const [bookingMode, setBookingMode] = useState('IN_PERSON'); // VIDEO or IN_PERSON
    const [videoConsent, setVideoConsent] = useState(false);
    const offeredKey = (Array.isArray(selectedService?.modes) && selectedService.modes.length ? selectedService.modes : ['IN_PERSON']).join(',');
    const offeredModes = offeredKey.split(',');
    useEffect(() => { const modes = offeredKey.split(','); if (!modes.includes(bookingMode)) setBookingMode(modes[0]); }, [offeredKey, bookingMode]);
    const [confirmation, setConfirmation] = useState(null);
    const [manageCapability, setManageCapability] = useState(null);
    const [cancelState, setCancelState] = useState('idle');   // R12 (B04): idle | confirm | sending | failed
    const fragmentResolvedRef = useRef(false);

    useLayoutEffect(() => {
        if (fragmentResolvedRef.current || typeof window === 'undefined') return;
        fragmentResolvedRef.current = true;
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const value = params.get('token') || '';
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        setManageCapability(value);
    }, []);

    // Fetch services for the structure
    const fetchServices = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const token = getToken();
            const res = await fetch(
                `/api/rdv/structures/${encodeURIComponent(structureSlug)}/services`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {} }
            );
            // owner usefulness pass: 404 « RDV indisponible » means this structure takes no booking online — the honest empty state, not a loading error
            if (res.status === 404) { setServices([]); return; }
            if (!res.ok) throw new Error('Impossible de charger les services.');
            const data = await res.json();
            setServices(data.items || []);
            // Tracker le début du flow si on a réussi à charger la page structure
            track('start_booking_flow', { structure: structureSlug });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [structureSlug]);

    // Fetch available slots for selected service
    const fetchSlots = useCallback(async (/** @type {string | number | boolean} */ serviceId) => {
        setLoading(true);
        setSlotsError('');
        try {
            const token = getToken();
            const from = new Date().toISOString().slice(0, 10);
            // R7: 14 days INCLUDING today (the server counts the last day to its end: today + 14 was 15 days, always refused with 400 — no slot ever loaded)
            const to = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
            const res = await fetch(
                `/api/rdv/structures/${encodeURIComponent(structureSlug)}/slots?serviceId=${encodeURIComponent(serviceId)}&from=${from}&to=${to}`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {} }
            );
            if (!res.ok) throw new Error('Impossible de charger les créneaux.');
            const data = await res.json();

            // Flatten days → slots
            const flatSlots = (data.days || []).flatMap((day) =>
                (day.slots || []).map((/** @type {{ startAt: string | number | Date; }} */ s) => ({
                    ...s,
                    date: day.date,
                    displayTime: new Date(s.startAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                    }),
                    displayDate: new Date(s.startAt).toLocaleDateString('fr-FR', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                    }),
                }))
            );
            setSlots(flatSlots);
        } catch (err) {
            setSlotsError(err.message);   // R7: its own state — a refused booking (409) no longer reads as « the slots could not be loaded »
        } finally {
            setLoading(false);
        }
    }, [structureSlug]);

    // Book the appointment
    const confirmBooking = useCallback(async () => {
        if (!selectedService || !selectedSlot) return;
        setLoading(true);
        setError('');
        try {
            const token = getToken();
            const idempotencyKey = createIdempotencyKey();
            // R7: a first visit has no __csrf cookie yet: ask the server for one before the protected POST (it was refused with 403)
            const csrf = (await ensureCsrfHeaders()) || getCsrfHeaders();
            const res = await fetch('/api/rdv/appointments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...csrf,
                },
                body: JSON.stringify({
                    structureSlug,
                    serviceId: selectedService.id,
                    startAt: selectedSlot.startAt,
                    mode: bookingMode,
                    ...(bookingMode === 'VIDEO' ? { videoConsent } : {}),
                    idempotencyKey,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                if (res.status === 409) {
                    await fetchSlots(selectedService.id);
                    setStep(2);
                    throw new Error(
                        errData.message || 'Ce créneau vient d’être réservé. Choisissez un autre horaire.'
                    );
                }
                throw new Error(errData.message || 'Impossible de confirmer le rendez-vous.');
            }

            const data = await res.json();
            track('booking_confirm_success', { structure: structureSlug, mode: bookingMode });
            setConfirmation(data);
            setStep(4);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [selectedService, selectedSlot, bookingMode, videoConsent, structureSlug, fetchSlots]);

    // Handle service selection
    const handleSelectService = (service) => {
        track('booking_select_service', { structure: structureSlug, service: service.name });
        setSelectedService(service);
        fetchSlots(service.id);
        setStep(2);
    };

    // Handle slot selection
    const handleSelectSlot = (/** @type {import("react").SetStateAction<null>} */ slot) => {
        setSelectedSlot(slot);
        setStep(3);
    };

    // Load services only for a fresh booking, never for a capability manage link.
    useEffect(() => {
        if (!appointmentId) fetchServices();
    }, [appointmentId, fetchServices]);

    // Resolve appointment manage links without ever moving the raw capability
    // into URL query/path. The fragment was scrubbed synchronously above.
    useEffect(() => {
        if (!appointmentId || manageCapability === null) return;
        if (!manageCapability) {
            setError('Lien de gestion du rendez-vous invalide ou incomplet.');
            return;
        }

        let cancelled = false;
        const loadManagedAppointment = async () => {
            setLoading(true);
            setError('');
            try {
                // R12B: the link of the e-mail is usually opened in a browser that has no CSRF cookie yet — csrfFetch obtains it first (a plain fetch was
                // refused 403 on that first visit, and the page showed nothing)
                const res = await csrfFetch(
                    `/api/rdv/appointments/${encodeURIComponent(appointmentId)}/confirmation`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: manageCapability }),
                    },
                );
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Lien de gestion invalide ou expiré.');
                if (!cancelled) {
                    setConfirmation(data);
                    setStep(4);
                }
            } catch (err) {
                if (!cancelled) setError(err.message || 'Lien de gestion invalide ou expiré.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadManagedAppointment();
        return () => {
            cancelled = true;
        };
    }, [appointmentId, manageCapability]);

    const downloadCalendar = useCallback(() => {
        const calendar = confirmation?.calendar;
        if (!calendar?.content || typeof window === 'undefined') return;

        const blob = new Blob([calendar.content], {
            type: calendar.contentType || 'text/calendar; charset=utf-8',
        });
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = calendar.filename || 'acces-direct-aide-rendez-vous.ics';
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(objectUrl);
    }, [confirmation]);

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <SEO
                title="Prendre rendez-vous"
                description="Réservez un créneau avec un conseiller ADA"
                noindex
            />

            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="inline-flex p-3 bg-indigo-100 rounded-2xl mb-4">
                        <CalendarCheck className="text-indigo-600" size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                        Prendre rendez-vous
                    </h1>
                    <p className="text-slate-500 mt-2">
                        Service Accès Direct Aide
                    </p>
                </div>

                {/* Progress bar */}
                <div className="flex justify-between items-center mb-12 px-6">
                    <StepIndicator current={step} target={1} label="Service" />
                    <div className="flex-1 h-px bg-slate-200 mx-3" />
                    <StepIndicator current={step} target={2} label="Créneau" />
                    <div className="flex-1 h-px bg-slate-200 mx-3" />
                    <StepIndicator current={step} target={3} label="Mode" />
                    <div className="flex-1 h-px bg-slate-200 mx-3" />
                    <StepIndicator current={step} target={4} label="Confirmé" />
                </div>

                {/* Error feedback */}
                {error && (
                    <div
                        className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2"
                        role="alert"
                    >
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                {/* Step 1: Choose Service */}
                {step === 1 && (
                    <div className="space-y-4">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-4">
                            Choisissez un service
                        </h2>

                        {loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : error ? (
                            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center" data-testid="booking-services-error">
                                <p className="text-sm text-slate-700">
                                    Les services n&apos;ont pas pu être chargés. Ce n&apos;est pas une absence de service : réessayez, ou contactez la structure directement.
                                </p>
                                <button
                                    type="button"
                                    data-testid="booking-services-retry"
                                    onClick={fetchServices}
                                    className="mt-3 inline-block rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                                >
                                    Réessayer
                                </button>
                                <Link
                                    to={`/structures/${encodeURIComponent(structureSlug)}`}
                                    className="block text-indigo-600 text-sm font-medium mt-3 hover:underline"
                                >
                                    Revenir à la fiche de la structure
                                </Link>
                            </div>
                        ) : services.length === 0 ? (
                            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center" data-testid="booking-services-empty">
                                <CalendarIcon className="mx-auto text-slate-600 mb-3" size={40} />
                                <p className="text-sm text-slate-600">
                                    Aucun service n&apos;est proposé en ligne pour cette structure. Cela ne dit rien de ce qu&apos;elle propose par ailleurs : consultez sa fiche pour ses coordonnées.
                                </p>
                                <Link
                                    to={`/structures/${encodeURIComponent(structureSlug)}`}
                                    className="block text-indigo-600 text-sm font-medium mt-3 hover:underline"
                                >
                                    Revenir à la fiche de la structure
                                </Link>
                                <Link
                                    to="/structures"
                                    className="text-indigo-600 text-sm font-medium mt-3 inline-block hover:underline"
                                >
                                    Retour à l&apos;annuaire
                                </Link>
                            </div>
                        ) : (
                            services.map((/** @type {{ durationMinutes: string | number, id: string | number, name: string | number }} */ service) => (
                                <button
                                    type="button"
                                    key={service.id}
                                    data-testid={`booking-service-${service.id}`}
                                    onClick={() => handleSelectService(service)}
                                    className="w-full bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-400 hover:shadow-md transition-all flex items-center justify-between group text-left"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center">
                                            <CalendarIcon className="text-indigo-600" size={20} />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900">
                                                {service.name}
                                            </p>
                                            <p className="text-xs text-slate-600">
                                                {service.durationMinutes || 30} min
                                            </p>
                                        </div>
                                    </div>
                                    <ChevronRight className="text-slate-600 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                                </button>
                            ))
                        )}
                    </div>
                )}

                {/* Step 2: Choose Slot */}
                {step === 2 && (
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-lg">
                        <button
                            type="button"
                            onClick={() => setStep(1)}
                            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600 mb-6"
                        >
                            <ArrowLeft size={14} /> Retour aux services
                        </button>

                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
                                <CalendarIcon className="text-white" size={18} />
                            </div>
                            <div>
                                <p className="font-bold text-slate-900">
                                    {selectedService?.name}
                                </p>
                                <p className="text-[10px] text-emerald-700 font-bold uppercase flex items-center gap-1">
                                    <ShieldCheck size={10} /> Créneaux en temps réel
                                </p>
                            </div>
                        </div>

                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-4">
                            Créneaux disponibles
                        </h3>

                        {loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : slotsError ? (
                            <div className="py-8 text-center" data-testid="booking-slots-error">
                                <p className="text-sm text-slate-700">
                                    Les créneaux n&apos;ont pas pu être chargés. Ce n&apos;est pas une absence de créneau.
                                </p>
                                <button
                                    type="button"
                                    data-testid="booking-slots-retry"
                                    onClick={() => fetchSlots(selectedService?.id)}
                                    className="mt-3 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                                >
                                    Réessayer
                                </button>
                            </div>
                        ) : slots.length === 0 ? (
                            <p className="text-sm text-slate-600 py-8 text-center" data-testid="booking-slots-empty">
                                Aucun créneau disponible sur les 14 prochains jours. Choisissez un autre service ou contactez la structure.
                            </p>
                        ) : (
                            <div className="space-y-4 max-h-[400px] overflow-y-auto">
                                {/* Group by date */}
                                {Object.entries(
                                    slots.reduce((acc, slot) => {
                                        const key = slot.displayDate;
                                        if (!acc[key]) acc[key] = [];
                                        acc[key].push(slot);
                                        return acc;
                                    }, {})
                                ).map(([date, dateSlots]) => (
                                    <div key={date}>
                                        <p className="text-xs font-bold text-slate-500 mb-2 uppercase">
                                            {date}
                                        </p>
                                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                            {dateSlots.map((slot) => (
                                                <button
                                                    type="button"
                                                    key={slot.startAt}
                                                    data-testid="booking-slot"
                                                    onClick={() => handleSelectSlot(slot)}
                                                    className="py-2.5 px-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-semibold text-slate-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all"
                                                >
                                                    {slot.displayTime}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Step 3: Choose Mode + Confirm */}
                {step === 3 && (
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-lg">
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600 mb-6"
                        >
                            <ArrowLeft size={14} /> Retour
                        </button>

                        <h2 className="text-xl font-bold text-slate-900 mb-2">
                            Récapitulatif
                        </h2>
                        <p className="text-slate-500 text-sm mb-8">
                            Vérifiez les informations puis confirmez.
                        </p>

                        {/* Summary */}
                        <div className="space-y-4 mb-8">
                            <SummaryRow
                                icon={<CalendarIcon className="text-indigo-600" size={18} />}
                                label="Service"
                                value={selectedService?.name}
                            />
                            <SummaryRow
                                icon={<Clock className="text-indigo-600" size={18} />}
                                label="Date et heure"
                                value={`${selectedSlot?.displayDate} à ${selectedSlot?.displayTime}`}
                            />
                        </div>

                        {/* Mode selector */}
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3">
                            Type de rendez-vous
                        </h3>
                        <div className="grid grid-cols-2 gap-3 mb-8">
                            {offeredModes.includes('VIDEO') ? (
                            <button
                                type="button"
                                onClick={() => setBookingMode('VIDEO')}
                                className={`p-4 rounded-xl border-2 text-left transition-all ${bookingMode === 'VIDEO'
                                    ? 'border-indigo-500 bg-indigo-50'
                                    : 'border-slate-200 hover:border-slate-300'
                                    }`}
                            >
                                <Video
                                    className={bookingMode === 'VIDEO' ? 'text-indigo-600' : 'text-slate-600'}
                                    size={20}
                                />
                                <p className="font-semibold text-sm mt-2">Visioconférence</p>
                                <p className="text-[10px] text-slate-600">
                                    Depuis chez vous via Jitsi
                                </p>
                            </button>
                            ) : null}
                            {offeredModes.includes('IN_PERSON') ? (
                            <button
                                type="button"
                                onClick={() => setBookingMode('IN_PERSON')}
                                className={`p-4 rounded-xl border-2 text-left transition-all ${bookingMode === 'IN_PERSON'
                                    ? 'border-indigo-500 bg-indigo-50'
                                    : 'border-slate-200 hover:border-slate-300'
                                    }`}
                            >
                                <MapPin
                                    className={bookingMode === 'IN_PERSON' ? 'text-indigo-600' : 'text-slate-600'}
                                    size={20}
                                />
                                <p className="font-semibold text-sm mt-2">Sur place</p>
                                <p className="text-[10px] text-slate-600">
                                    En présentiel à la structure
                                </p>
                            </button>
                            ) : null}
                        </div>
                        {bookingMode === 'VIDEO' ? (
                            <label className="mb-6 flex items-start gap-2 text-sm text-slate-800" data-testid="booking-video-consent">
                                <input type="checkbox" className="mt-1" checked={videoConsent} onChange={(e) => setVideoConsent(e.target.checked)} />
                                <span>J’accepte un rendez-vous en visio : caméra et micro, sans enregistrement.</span>
                            </label>
                        ) : null}

                        <button
                            type="button"
                            onClick={confirmBooking}
                            data-testid="booking-confirm"
                            disabled={loading || (bookingMode === 'VIDEO' && !videoConsent)}
                            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm hover:bg-indigo-600 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={18} />
                            ) : (
                                <CheckCircle2 size={18} />
                            )}
                            {loading ? 'Confirmation en cours...' : 'Confirmer le rendez-vous'}
                        </button>
                    </div>
                )}

                {/* Step 4: Success */}
                {step === 4 && (
                    <div className="bg-white p-10 rounded-2xl border border-emerald-200 shadow-lg text-center" data-testid="booking-success">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                            <CheckCircle2 size={36} />
                        </div>
                        {/* owner usefulness pass (2026-10-25): the « gérer mon rendez-vous » link of the e-mail opens this view — it said « confirmé » even for a
                            cancelled appointment and spoke of a video room for an in-person one; it now reads the appointment's own status and mode */}
                        <h2 className="text-2xl font-bold text-slate-900 mb-2" data-testid="booking-state">
                            {String(confirmation?.status || '').startsWith('CANCEL') ? 'Ce rendez-vous est annulé' : 'C’est confirmé !'}
                        </h2>
                        <p className="text-slate-700 mb-6 max-w-md mx-auto">
                            {String(confirmation?.status || '').startsWith('CANCEL') ? 'Il n’aura pas lieu. Vous pouvez prendre un autre rendez-vous.' : 'Votre rendez-vous est enregistré.'}
                            {!String(confirmation?.status || '').startsWith('CANCEL') && (confirmation?.mode || bookingMode) === 'VIDEO' && (
                                <> Vous pourrez rejoindre la visio directement sur ADA.</>
                            )}
                        </p>
                        {!String(confirmation?.status || '').startsWith('CANCEL') ? (
                            <p className="mb-6 text-sm text-slate-700"><Link className="text-indigo-700 underline" to="/compte/rendez-vous" data-testid="booking-manage-link">Annuler ou déplacer ce rendez-vous depuis votre espace</Link></p>
                        ) : null}

                        {confirmation?.id && (
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6 inline-block">
                                <p className="text-[10px] font-bold uppercase text-slate-600 mb-1">
                                    Référence
                                </p>
                                <p className="text-lg font-mono font-bold text-slate-900">
                                    {confirmation.id.slice(0, 8).toUpperCase()}
                                </p>
                            </div>
                        )}

                        {/* R12 (B04): from the e-mail's link, the appointment can be cancelled without an account session (the link's capability, POST body only) */}
                        {manageCapability && confirmation?.id && String(confirmation.status || '').toLowerCase() === 'cancelled' && (
                            <p role="status" data-testid="booking-cancelled" className="mb-4 text-center font-medium text-slate-900">Ce rendez-vous est annulé.</p>
                        )}
                        {manageCapability && confirmation?.id && String(confirmation.status || '').toLowerCase() !== 'cancelled' && (
                            <div className="mb-4 flex flex-col items-center gap-2">
                                {cancelState === 'confirm' || cancelState === 'sending' ? (
                                    <div className="flex flex-wrap justify-center gap-2">
                                        <button type="button" data-testid="booking-cancel-confirm" disabled={cancelState === 'sending'}
                                            className="px-5 py-2.5 bg-red-700 text-white rounded-xl text-sm font-medium hover:bg-red-800"
                                            onClick={async () => {
                                                setCancelState('sending');
                                                try {
                                                    const res = await csrfFetch(`/api/rdv/appointments/${encodeURIComponent(confirmation.id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: manageCapability }) });
                                                    const data = await res.json().catch(() => null);
                                                    if (!res.ok || !data) { setCancelState('failed'); return; }
                                                    setConfirmation((c) => ({ ...c, ...data })); setCancelState('idle');
                                                } catch { setCancelState('failed'); }
                                            }}>Confirmer l’annulation</button>
                                        <button type="button" onClick={() => setCancelState('idle')} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium">Garder le rendez-vous</button>
                                    </div>
                                ) : (
                                    <button type="button" data-testid="booking-cancel" onClick={() => setCancelState('confirm')} className="px-5 py-2.5 border border-red-700 text-red-800 rounded-xl text-sm font-medium hover:bg-red-50">Annuler ce rendez-vous</button>
                                )}
                                {cancelState === 'failed' && <p role="alert" className="text-sm text-red-800">L’annulation n’a pas pu être faite. Réessayez, ou contactez la structure.</p>}
                            </div>
                        )}
                        <div className="flex flex-wrap justify-center gap-3">
                            {confirmation?.calendar?.content && String(confirmation.status || '').toLowerCase() !== 'cancelled' && (
                                <button
                                    type="button"
                                    onClick={downloadCalendar}
                                    data-testid="booking-download-ics"
                                    className="px-5 py-2.5 bg-emerald-700 text-white rounded-xl text-sm font-medium hover:bg-emerald-800 transition-colors"
                                >
                                    Ajouter au calendrier (.ics)
                                </button>
                            )}
                            <Link
                                to="/compte/messages"
                                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
                            >
                                Mes messages
                            </Link>
                            {nextPath && (
                                <Link
                                    to={nextPath}
                                    data-testid="booking-return-to-journey"
                                    className="px-5 py-2.5 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors"
                                >
                                    {journeyAideSlug ? 'Retour à l’aide' : 'Reprendre mon parcours'}
                                </Link>
                            )}
                            <Link
                                to="/"
                                className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors"
                            >
                                Retour à l&apos;accueil
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function StepIndicator(/** @type {{ current: string | number, label: string | number, target: string | number }} */ { current, target, label }) {
    const active = current >= target;
    const isNow = current === target;

    return (
        <div className="flex flex-col items-center gap-1.5">
            <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${active
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-600'
                    } ${isNow ? 'ring-4 ring-indigo-100' : ''}`}
            >
                {active && current > target ? <CheckCircle2 size={14} /> : target}
            </div>
            <span
                className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-slate-800' : 'text-slate-600'
                    }`}
            >
                {label}
            </span>
        </div>
    );
}

// @ts-ignore
function SummaryRow({ icon, label, value }) {
    return (
        <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
            <div className="p-2.5 bg-white rounded-lg shadow-sm">{icon}</div>
            <div>
                <p className="text-[10px] font-bold uppercase text-slate-600">
                    {label}
                </p>
                <p className="font-semibold text-slate-900">{value}</p>
            </div>
        </div>
    );
}

function createIdempotencyKey() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

    if (cryptoApi?.getRandomValues) {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    throw new Error('Générateur sécurisé indisponible. Veuillez recharger la page.');
}

function getToken() {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('access_token') || localStorage.getItem('pro_token') || null;
}
