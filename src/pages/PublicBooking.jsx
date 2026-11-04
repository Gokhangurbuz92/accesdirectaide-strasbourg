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
import i18n, { formatDate, useT } from '@/i18n';
// R42: account-required journey pieces (suitability, professional choice, optional message, age statement, true e-mail outcome)
import BookingMessageField from '@/components/rdv/BookingMessageField.jsx';
import ProfessionalChoice from '@/components/rdv/ProfessionalChoice.jsx';
import { SuitabilityQuestions, WrongStructure } from '@/components/rdv/SuitabilityCheck.jsx';
import AgeDeclarationPrompt from '@/components/rdv/AgeDeclarationPrompt.jsx';
import MailOutcomeNote from '@/components/rdv/MailOutcomeNote.jsx';
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
    const { t } = useT('booking');
    const { structureSlug } = useParams();
    const [searchParams] = useSearchParams();
    const nextPath = normalizeNextPath(searchParams.get('next') || '', '');
    const journeyAideSlug = String(searchParams.get('aide') || '').trim();
    const appointmentId = String(searchParams.get('appointment') || '').trim();
    // R43: a link that already names the service (e.g. an old /rdv/<slug>/creneaux?serviceId=… link) opens that service's next step; the server
    // re-validates the id (unknown / another structure's → it is simply not preselected)
    const presetServiceId = String(searchParams.get('serviceId') || '').trim();
    const presetMode = String(searchParams.get('mode') || '').trim().toUpperCase();
    const presetDoneRef = useRef(false);

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
    // R42: team choice (only when the structure enabled it), suitability answers (never sent: they only guide the next steps), the optional message,
    // Mode A / Mode B of the chosen service, and the age statement step for an account that has none yet
    const [teamChoice, setTeamChoice] = useState(false);
    const [team, setTeam] = useState(null);
    const [professional, setProfessional] = useState('ANY');
    const [suitability, setSuitability] = useState({ firstContact: '', samePerson: false });
    const [wrongStructure, setWrongStructure] = useState(false);
    const [message, setMessage] = useState('');
    // R43 (E6): the explicit consent to transmit the message (never pre-ticked; asked only while a message is written)
    const [messageConsent, setMessageConsent] = useState(false);
    const [messageConsentError, setMessageConsentError] = useState(false);
    const messageConsentRef = useRef(null);
    const [confirmationMode, setConfirmationMode] = useState('DIRECT');
    const [ageStep, setAgeStep] = useState('');
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
            if (!res.ok) throw new Error(t('booking:public.impossible_de_charger_les_services', "Impossible de charger les services."));
            const data = await res.json();
            setServices(data.items || []);
            setTeamChoice(data.teamChoice === true);
            // Tracker le début du flow si on a réussi à charger la page structure
            track('start_booking_flow', { structure: structureSlug });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [structureSlug, t]);

    // Fetch available slots for selected service
    const fetchSlots = useCallback(async (/** @type {string | number | boolean} */ serviceId, /** @type {string} */ who = 'ANY') => {
        setLoading(true);
        setSlotsError('');
        try {
            const token = getToken();
            const from = new Date().toISOString().slice(0, 10);
            // R7: 14 days INCLUDING today (the server counts the last day to its end: today + 14 was 15 days, always refused with 400 — no slot ever loaded)
            const to = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
            const res = await fetch(
                `/api/rdv/structures/${encodeURIComponent(structureSlug)}/slots?serviceId=${encodeURIComponent(serviceId)}&from=${from}&to=${to}${teamChoice ? `&professional=${encodeURIComponent(who)}` : ''}`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {} }
            );
            if (!res.ok) throw new Error(t('booking:public.impossible_de_charger_les_creneaux', "Impossible de charger les créneaux."));
            const data = await res.json();
            setConfirmationMode(data.confirmation === 'APPROVAL' ? 'APPROVAL' : 'DIRECT');

            // Flatten days → slots
            const flatSlots = (data.days || []).flatMap((day) =>
                (day.slots || []).map((/** @type {{ startAt: string | number | Date; }} */ s) => ({
                    ...s,
                    date: day.date,
                    // R40: in the interface language (Intl, Europe/Paris)
                    displayTime: formatDate(s.startAt, { hour: '2-digit', minute: '2-digit' }),
                    displayDate: formatDate(s.startAt, { weekday: 'short', day: 'numeric', month: 'short' }),
                }))
            );
            setSlots(flatSlots);
        } catch (err) {
            setSlotsError(err.message);   // R7: its own state — a refused booking (409) no longer reads as « the slots could not be loaded »
        } finally {
            setLoading(false);
        }
    }, [structureSlug, t, teamChoice]);

    // Book the appointment
    const confirmBooking = useCallback(async () => {
        if (!selectedService || !selectedSlot) return;
        if (message.trim() && !messageConsent) {
            setMessageConsentError(true);
            messageConsentRef.current?.focus();
            return;
        }
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
                    ...(teamChoice ? { professional } : {}),
                    ...(message.trim() ? { message, messageConsent: true } : {}),
                    idempotencyKey,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                // R42-A07: an account without an age statement declares it here, then the request is sent again
                if (errData.code === 'AGE_DECLARATION_REQUIRED') { setAgeStep('declare'); return; }
                if (errData.code === 'ADULT_ACCOUNT_REQUIRED') { setAgeStep('minor'); throw new Error(errData.message); }
                if (errData.code === 'PROFESSIONAL_UNAVAILABLE') { setStep(1.5); throw new Error(errData.message); }
                if (errData.code === 'MESSAGE_CONSENT_REQUIRED') { setMessageConsentError(true); setMessageConsent(false); return; }
                if (res.status === 409) {
                    await fetchSlots(selectedService.id);
                    setStep(2);
                    throw new Error(
                        errData.message || t('booking:public.ce_creneau_vient_d_etre', "Ce créneau vient d’être réservé. Choisissez un autre horaire.")
                    );
                }
                throw new Error(errData.message || t('booking:public.impossible_de_confirmer_le_rendez', "Impossible de confirmer le rendez-vous."));
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
    }, [selectedService, selectedSlot, bookingMode, videoConsent, structureSlug, fetchSlots, t, teamChoice, professional, message, messageConsent]);

    // Handle service selection
    const handleSelectService = async (service) => {
        track('booking_select_service', { structure: structureSlug });
        setSelectedService(service);
        if (teamChoice) {
            // R42: the professional choice of this service (signed-in only); « same person » preselects the previous professional when this account has one
            try {
                const res = await fetch(`/api/rdv/structures/${encodeURIComponent(structureSlug)}/team?serviceId=${encodeURIComponent(service.id)}`, { credentials: 'same-origin' });
                const data = res.ok ? await res.json() : null;
                if (data?.choice) {
                    setTeam(data);
                    setProfessional(suitability.samePerson && data.previous?.available ? 'PREVIOUS' : 'ANY');
                    setStep(1.5);
                    return;
                }
            } catch { /* no choice offered: the structure routes the request */ }
        }
        setTeam(null);
        setProfessional('ANY');
        fetchSlots(service.id, 'ANY');
        setStep(2);
    };

    // Handle slot selection
    const handleSelectSlot = (/** @type {import("react").SetStateAction<null>} */ slot) => {
        setSelectedSlot(slot);
        setStep(3);
    };

    useEffect(() => {
        if (presetDoneRef.current || !presetServiceId || !services.length || step !== 1) return;
        presetDoneRef.current = true;
        const preset = services.find((s) => String(s.id) === presetServiceId);
        if (!preset) return;
        if ((presetMode === 'IN_PERSON' || presetMode === 'VIDEO') && Array.isArray(preset.modes) && preset.modes.includes(presetMode)) setBookingMode(presetMode);
        handleSelectService(preset);
    }, [services]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the services of the structure are known

    // Load services only for a fresh booking, never for a capability manage link.
    useEffect(() => {
        if (!appointmentId) fetchServices();
    }, [appointmentId, fetchServices]);

    // Resolve appointment manage links without ever moving the raw capability
    // into URL query/path. The fragment was scrubbed synchronously above.
    useEffect(() => {
        if (!appointmentId || manageCapability === null) return;
        if (!manageCapability) {
            setError(t('booking:public.lien_de_gestion_du_rendez', "Lien de gestion du rendez-vous invalide ou incomplet."));
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
                if (!res.ok) throw new Error(data.error || t('booking:public.lien_de_gestion_invalide_ou', "Lien de gestion invalide ou expiré."));
                if (!cancelled) {
                    setConfirmation(data);
                    setStep(4);
                }
            } catch (err) {
                if (!cancelled) setError(err.message || t('booking:public.lien_de_gestion_invalide_ou', "Lien de gestion invalide ou expiré."));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadManagedAppointment();
        return () => {
            cancelled = true;
        };
    }, [appointmentId, manageCapability, t]);

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
                title={t('booking:public.prendre_rendez_vous', "Prendre rendez-vous")}
                description={t('booking:public.reservez_un_creneau_avec_un', "Réservez un créneau avec un conseiller ADA")}
                noindex
            />

            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="inline-flex p-3 bg-indigo-100 rounded-2xl mb-4">
                        <CalendarCheck className="text-indigo-600" size={32} />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                        {t('booking:public.prendre_rendez_vous', "Prendre rendez-vous")}
                    </h1>
                    <p className="text-slate-500 mt-2">
                        {t('booking:public.service_acces_direct_aide', "Service Accès Direct Aide")}
                    </p>
                </div>

                {/* Progress bar */}
                <div className="flex justify-between items-center mb-12 px-6">
                    <StepIndicator current={step} target={1} label={t('booking:public.service', "Service")} />
                    <div className="flex-1 h-px bg-slate-200 mx-3" />
                    <StepIndicator current={step} target={2} label={t('booking:public.creneau', "Créneau")} />
                    <div className="flex-1 h-px bg-slate-200 mx-3" />
                    <StepIndicator current={step} target={3} label={t('booking:public.mode', "Mode")} />
                    <div className="flex-1 h-px bg-slate-200 mx-3" />
                    <StepIndicator current={step} target={4} label={t('booking:public.confirme', "Confirmé")} />
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
                            {t('booking:public.choisissez_un_service', "Choisissez un service")}
                        </h2>

                        {loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : error ? (
                            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center" data-testid="booking-services-error">
                                <p className="text-sm text-slate-700">
                                    {t('booking:public.les_services_n_ont_pas', "Les services n'ont pas pu être chargés. Ce n'est pas une absence de service : réessayez, ou contactez la structure directement.")}
                                </p>
                                <button
                                    type="button"
                                    data-testid="booking-services-retry"
                                    onClick={fetchServices}
                                    className="mt-3 inline-block rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                                >
                                    {t('booking:public.reessayer', "Réessayer")}
                                </button>
                                <Link
                                    to={`/structures/${encodeURIComponent(structureSlug)}`}
                                    className="block text-indigo-600 text-sm font-medium mt-3 hover:underline"
                                >
                                    {t('booking:public.revenir_a_la_fiche_de', "Revenir à la fiche de la structure")}
                                </Link>
                            </div>
                        ) : services.length === 0 ? (
                            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center" data-testid="booking-services-empty">
                                <CalendarIcon className="mx-auto text-slate-600 mb-3" size={40} />
                                <p className="text-sm text-slate-600">
                                    {t('booking:public.aucun_service_n_est_propose', "Aucun service n'est proposé en ligne pour cette structure. Cela ne dit rien de ce qu'elle propose par ailleurs : consultez sa fiche pour ses coordonnées.")}
                                </p>
                                <Link
                                    to={`/structures/${encodeURIComponent(structureSlug)}`}
                                    className="block text-indigo-600 text-sm font-medium mt-3 hover:underline"
                                >
                                    {t('booking:public.revenir_a_la_fiche_de', "Revenir à la fiche de la structure")}
                                </Link>
                                <Link
                                    to="/structures"
                                    className="text-indigo-600 text-sm font-medium mt-3 inline-block hover:underline"
                                >
                                    {t('booking:public.retour_a_l_annuaire', "Retour à l'annuaire")}
                                </Link>
                            </div>
                        ) : wrongStructure ? (
                            <WrongStructure structureSlug={structureSlug} onBack={() => setWrongStructure(false)} />
                        ) : (
                            <>
                            <p className="text-sm text-slate-700" data-testid="booking-account-note">{t('booking:journey.account_note', 'Vous êtes connecté(e) : votre demande sera suivie dans « Mes rendez-vous ». Choisissez le service qui correspond à votre besoin.')}</p>
                            <SuitabilityQuestions value={suitability} onChange={setSuitability} teamChoice={teamChoice} />
                            {services.map((/** @type {{ durationMinutes: string | number, id: string | number, name: string | number }} */ service) => (
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
                                                {t('booking:public.minutes', '{{minutes}} min', { minutes: service.durationMinutes || 30 })}
                                            </p>
                                        </div>
                                    </div>
                                    <ChevronRight className="text-slate-600 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                                </button>
                            ))}
                            <button type="button" data-testid="booking-not-listed" onClick={() => setWrongStructure(true)}
                                className="min-h-11 text-sm font-medium text-indigo-800 underline">
                                {t('booking:suitability.not_listed', 'Mon besoin ne figure pas dans cette liste')}
                            </button>
                            </>
                        )}
                    </div>
                )}

                {/* R42 Step 1.5: who to meet (only when the structure offers the choice) */}
                {step === 1.5 && team && (
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-lg space-y-6">
                        <button type="button" onClick={() => setStep(1)} className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600">
                            <ArrowLeft size={14} /> {t('booking:public.retour_aux_services', "Retour aux services")}
                        </button>
                        <ProfessionalChoice team={team} value={professional} onChange={setProfessional} />
                        <button type="button" data-testid="booking-professional-continue" onClick={() => { fetchSlots(selectedService.id, professional); setStep(2); }}
                            className="w-full min-h-11 bg-slate-900 text-white py-3 rounded-xl font-bold text-sm hover:bg-indigo-700">
                            {t('booking:pro_choice.continue', 'Voir les créneaux disponibles')}
                        </button>
                    </div>
                )}

                {/* Step 2: Choose Slot */}
                {step === 2 && (
                    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-lg">
                        <button
                            type="button"
                            onClick={() => setStep(team ? 1.5 : 1)}
                            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600 mb-6"
                        >
                            <ArrowLeft size={14} /> {t('booking:public.retour_aux_services', "Retour aux services")}
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
                                    <ShieldCheck size={10} /> {t('booking:public.creneaux_en_temps_reel', "Créneaux en temps réel")}
                                </p>
                            </div>
                        </div>

                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-4">
                            {t('booking:public.creneaux_disponibles', "Créneaux disponibles")}
                        </h3>

                        {loading ? <div className="p-6"><SkeletonList count={3} variant="card" /></div> : slotsError ? (
                            <div className="py-8 text-center" data-testid="booking-slots-error">
                                <p className="text-sm text-slate-700">
                                    {t('booking:public.les_creneaux_n_ont_pas', "Les créneaux n'ont pas pu être chargés. Ce n'est pas une absence de créneau.")}
                                </p>
                                <button
                                    type="button"
                                    data-testid="booking-slots-retry"
                                    onClick={() => fetchSlots(selectedService?.id, professional)}
                                    className="mt-3 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                                >
                                    {t('booking:public.reessayer', "Réessayer")}
                                </button>
                            </div>
                        ) : slots.length === 0 ? (
                            <p className="text-sm text-slate-600 py-8 text-center" data-testid="booking-slots-empty">
                                {t('booking:public.aucun_creneau_disponible_sur_les', "Aucun créneau disponible sur les 14 prochains jours. Choisissez un autre service ou contactez la structure.")}
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
                            <ArrowLeft size={14} /> {t('booking:public.retour', "Retour")}
                        </button>

                        <h2 className="text-xl font-bold text-slate-900 mb-2">
                            {t('booking:public.recapitulatif', "Récapitulatif")}
                        </h2>
                        <p className="text-slate-500 text-sm mb-8">
                            {t('booking:public.verifiez_les_informations_puis_confirmez', "Vérifiez les informations puis confirmez.")}
                        </p>

                        {/* Summary */}
                        <div className="space-y-4 mb-8">
                            <SummaryRow
                                icon={<CalendarIcon className="text-indigo-600" size={18} />}
                                label={t('booking:public.service', "Service")}
                                value={selectedService?.name}
                            />
                            <SummaryRow
                                icon={<Clock className="text-indigo-600" size={18} />}
                                label={t('booking:public.date_et_heure', "Date et heure")}
                                value={`${selectedSlot?.displayDate} à ${selectedSlot?.displayTime}`}
                            />
                        </div>

                        {/* Mode selector */}
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3">
                            {t('booking:public.type_de_rendez_vous', "Type de rendez-vous")}
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
                                <p className="font-semibold text-sm mt-2">{t('booking:public.visioconference', "Visioconférence")}</p>
                                <p className="text-[10px] text-slate-600">
                                    {t('booking:public.depuis_chez_vous_via_jitsi', "Depuis chez vous via Jitsi")}
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
                                <p className="font-semibold text-sm mt-2">{t('booking:public.sur_place', "Sur place")}</p>
                                <p className="text-[10px] text-slate-600">
                                    {t('booking:public.en_presentiel_a_la_structure', "En présentiel à la structure")}
                                </p>
                            </button>
                            ) : null}
                        </div>
                        <div className="mb-6"><BookingMessageField ref={messageConsentRef} value={message} onChange={(v) => { setMessage(v); if (!v.trim()) { setMessageConsent(false); setMessageConsentError(false); } }} consent={messageConsent} onConsentChange={(v) => { setMessageConsent(v); if (v) setMessageConsentError(false); }} consentError={messageConsentError} disabled={loading} /></div>
                        {confirmationMode === 'APPROVAL' ? (
                            <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="booking-approval-notice">
                                {t('booking:journey.approval_notice', 'Cette structure valide chaque demande : votre rendez-vous ne sera confirmé qu’après son accord. Vous serez informé(e) de sa réponse.')}
                            </p>
                        ) : null}
                        {ageStep === 'declare' ? <div className="mb-6"><AgeDeclarationPrompt onDeclared={() => { setAgeStep(''); confirmBooking(); }} /></div> : null}
                        {bookingMode === 'VIDEO' ? (
                            <label className="mb-6 flex items-start gap-2 text-sm text-slate-800" data-testid="booking-video-consent">
                                <input type="checkbox" className="mt-1" checked={videoConsent} onChange={(e) => setVideoConsent(e.target.checked)} />
                                <span>{t('booking:public.j_accepte_un_rendez_vous', "J’accepte un rendez-vous en visio : caméra et micro, sans enregistrement.")}</span>
                            </label>
                        ) : null}

                        <button
                            type="button"
                            onClick={confirmBooking}
                            data-testid="booking-confirm"
                            disabled={loading || ageStep !== '' || (bookingMode === 'VIDEO' && !videoConsent)}
                            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm hover:bg-indigo-600 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={18} />
                            ) : (
                                <CheckCircle2 size={18} />
                            )}
                            {loading ? t('booking:public.confirmation_en_cours', "Confirmation en cours...") : confirmationMode === 'APPROVAL' ? t('booking:journey.send_request', 'Envoyer la demande de rendez-vous') : t('booking:public.confirmer_le_rendez_vous', "Confirmer le rendez-vous")}
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
                        <h2 className="text-2xl font-bold text-slate-900 mb-2" data-testid="booking-state" data-state={confirmation?.state || ''}>
                            {String(confirmation?.status || '').startsWith('CANCEL') ? t('booking:public.ce_rendez_vous_est_annule_2', "Ce rendez-vous est annulé")
                                : confirmation?.state === 'REQUESTED' ? t('booking:journey.requested_title', 'Demande envoyée : en attente de la structure')
                                : confirmation?.state === 'REFUSED' ? t('booking:state.refused', 'Demande refusée par la structure')
                                : confirmation?.state === 'EXPIRED' ? t('booking:state.expired', 'Demande expirée sans réponse')
                                : t('booking:public.c_est_confirme', "C’est confirmé !")}
                        </h2>
                        {confirmation?.state === 'REQUESTED' ? (
                            <p className="text-slate-700 mb-4 max-w-md mx-auto" data-testid="booking-requested-note">{t('booking:journey.requested_text', 'Ce rendez-vous n’est pas encore confirmé : la structure doit accepter votre demande. Suivez sa réponse dans « Mes rendez-vous ».')}</p>
                        ) : null}
                        {confirmation?.notification ? <div className="mb-4 max-w-md mx-auto"><MailOutcomeNote outcome={confirmation.notification.email} /></div> : null}
                        <p className="text-slate-700 mb-6 max-w-md mx-auto" hidden={confirmation?.state === 'REQUESTED'}>
                            {String(confirmation?.status || '').startsWith('CANCEL') ? t('booking:public.il_n_aura_pas_lieu', "Il n’aura pas lieu. Vous pouvez prendre un autre rendez-vous.") : t('booking:public.votre_rendez_vous_est_enregistre', "Votre rendez-vous est enregistré.")}
                            {!String(confirmation?.status || '').startsWith('CANCEL') && (confirmation?.mode || bookingMode) === 'VIDEO' && (
                                <> {t('booking:public.vous_pourrez_rejoindre_la_visio', "Vous pourrez rejoindre la visio directement sur ADA.")}</>
                            )}
                        </p>
                        {!String(confirmation?.status || '').startsWith('CANCEL') ? (
                            <p className="mb-6 text-sm text-slate-700"><Link className="text-indigo-700 underline" to="/compte/rendez-vous" data-testid="booking-manage-link">{t('booking:public.annuler_ou_deplacer_ce_rendez', "Annuler ou déplacer ce rendez-vous depuis votre espace")}</Link></p>
                        ) : null}

                        {confirmation?.id && (
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-6 inline-block">
                                <p className="text-[10px] font-bold uppercase text-slate-600 mb-1">
                                    {t('booking:public.reference', "Référence")}
                                </p>
                                <p className="text-lg font-mono font-bold text-slate-900">
                                    {confirmation.id.slice(0, 8).toUpperCase()}
                                </p>
                            </div>
                        )}

                        {/* R12 (B04): from the e-mail's link, the appointment can be cancelled without an account session (the link's capability, POST body only) */}
                        {manageCapability && confirmation?.id && String(confirmation.status || '').toLowerCase() === 'cancelled' && (
                            <p role="status" data-testid="booking-cancelled" className="mb-4 text-center font-medium text-slate-900">{t('booking:public.ce_rendez_vous_est_annule', "Ce rendez-vous est annulé.")}</p>
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
                                            }}>{t('booking:public.confirmer_l_annulation', "Confirmer l’annulation")}</button>
                                        <button type="button" onClick={() => setCancelState('idle')} className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium">{t('booking:public.garder_le_rendez_vous', "Garder le rendez-vous")}</button>
                                    </div>
                                ) : (
                                    <button type="button" data-testid="booking-cancel" onClick={() => setCancelState('confirm')} className="px-5 py-2.5 border border-red-700 text-red-800 rounded-xl text-sm font-medium hover:bg-red-50">{t('booking:public.annuler_ce_rendez_vous', "Annuler ce rendez-vous")}</button>
                                )}
                                {cancelState === 'failed' && <p role="alert" className="text-sm text-red-800">{t('booking:public.l_annulation_n_a_pas', "L’annulation n’a pas pu être faite. Réessayez, ou contactez la structure.")}</p>}
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
                                    {t('booking:public.ajouter_au_calendrier_ics', "Ajouter au calendrier (.ics)")}
                                </button>
                            )}
                            <Link
                                to="/compte/messages"
                                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
                            >
                                {t('booking:public.mes_messages', "Mes messages")}
                            </Link>
                            {nextPath && (
                                <Link
                                    to={nextPath}
                                    data-testid="booking-return-to-journey"
                                    className="px-5 py-2.5 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors"
                                >
                                    {journeyAideSlug ? t('booking:public.retour_a_l_aide', "Retour à l’aide") : t('booking:public.reprendre_mon_parcours', "Reprendre mon parcours")}
                                </Link>
                            )}
                            <Link
                                to="/"
                                className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors"
                            >
                                {t('booking:public.retour_a_l_accueil', "Retour à l'accueil")}
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

    throw new Error(i18n.t('booking:public.secure_generator', 'Générateur sécurisé indisponible. Veuillez recharger la page.'));
}

function getToken() {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('access_token') || localStorage.getItem('pro_token') || null;
}
