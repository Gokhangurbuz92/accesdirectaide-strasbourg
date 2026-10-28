// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import SEO from '@/components/SEO';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client } from '@/api/client';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';

import { CsrfBootstrapError, csrfFetch, getCsrfHeaders } from '@/lib/csrf';
/**
 * @returns {string | null}
 */
function getSessionToken() {
  if (typeof window === 'undefined') return null;

  const adminToken = sessionStorage.getItem('access_token');
  if (adminToken) return adminToken;

  const proToken = localStorage.getItem('pro_token');
  if (proToken) return proToken;

  return null;
}

/**
 * @param {any} queryData
 */
function resolveStructure(queryData) {
  if (Array.isArray(queryData)) return queryData[0] || null;
  if (queryData?.items && Array.isArray(queryData.items)) return queryData.items[0] || null;
  return queryData || null;
}

/**
 * @param {string} raw
 */
function toDateInput(raw) {
  const date = new Date(String(raw || ''));
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

/**
 * @param {number} days
 */
function futureDateInput(days) {
  const value = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

/**
 * @param {string} raw
 */
function formatDateTime(raw) {
  const date = new Date(String(raw || ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  });
}

/**
 * @param {any} error
 * @param {string} fallback
 */
function getErrorMessage(error, fallback) {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error?.payload?.error && typeof error.payload.error === 'string') return error.payload.error;
  if (error?.message && typeof error.message === 'string') return error.message;
  return fallback;
}

/**
 * @param {string} path
 * @param {{ method?: string, token?: string | null, body?: any }=} options
 */
async function apiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();

  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/json',
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  // PKG-3 / B03: protected writes (book, cancel, open a conversation) go through csrfFetch (CSRF bootstrap + one safe retry). They used a plain fetch WITHOUT the CSRF
  // header, so the API's double-submit check refused every booking made from this screen (403) — found by the first real-browser booking journey (DTA-B26/B27).
  const init = { method, headers, credentials: /** @type {RequestCredentials} */ ('include'), body: options.body ? JSON.stringify(options.body) : undefined };
  // If no CSRF cookie can be obtained at all, the request is sent as before (the server's CSRF check stays the only authority and refuses it); it is never sent with a forged token.
  const response = await (method === 'GET' ? fetch(path, init) : csrfFetch(path, init).catch((err) => (err instanceof CsrfBootstrapError
    ? fetch(path, { ...init, headers: { ...headers, ...getCsrfHeaders() } }) : Promise.reject(err)))).catch(() => null);

  if (!response) {
    const error = new Error('Network error');
    error.status = 0;
    throw error;
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
    const error = new Error(message);
    // @ts-ignore
    error.status = response.status;
    // @ts-ignore
    error.payload = payload;
    throw error;
  }

  return payload;
}

/**
 * @param {{ view?: 'landing' | 'services' | 'creneaux' }} props
 */
export default function PublicRdvEntry({ view = 'landing' }) {
  const { structureSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const structureId = String(searchParams.get('structureId') || '').trim();
  const selectedServiceId = String(searchParams.get('serviceId') || '').trim();
  const appointmentId = String(searchParams.get('appointment') || '').trim();
  // PKG-3: the modality chosen by the person (IN_PERSON | VIDEO); it filters services and slots and is sent with the booking
  const modeParam = String(searchParams.get('mode') || '').trim().toUpperCase();
  const token = getSessionToken();

  const [fromDate, setFromDate] = useState(toDateInput(searchParams.get('from')));
  // PKG-3 / B03: the API accepts at most 14 days INCLUDING the last day (end of day); a 14-day default (today + 14) was always refused, so no slot was ever shown
  const [toDate, setToDate] = useState(toDateInput(searchParams.get('to') || futureDateInput(13)));
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingInfo, setBookingInfo] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [openConversationBusy, setOpenConversationBusy] = useState(false);
  const [videoConsent, setVideoConsent] = useState(false);
  // the radio follows the click at once (F6 lesson: a control bound only to the URL did not); the URL is updated alongside so the step links keep the choice
  const [modeChoice, setModeChoice] = useState(modeParam);
  useEffect(() => { if (modeParam && modeParam !== modeChoice) setModeChoice(modeParam); }, [modeParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    data: structureData,
    isLoading: structureLoading,
    isError: structureFailed,
    refetch: refetchStructure,
  } = useQuery({
    queryKey: ['public-rdv-structure', structureId || structureSlug],
    queryFn: () => client.entities.Structure.filter(structureId ? { id: structureId } : { slug: structureSlug }),
    enabled: Boolean(structureId || structureSlug),
  });

  const {
    data: authState,
    isLoading: authLoading,
  } = useQuery({
    queryKey: ['public-rdv-auth', token ? 'bearer' : 'cookie'],
    enabled: true,
    staleTime: 30 * 1000,
    queryFn: async () => {
      try {
        const payload = await apiRequest('/api/auth/me', {
          method: 'GET',
          token,
        });

        return {
          authenticated: true,
          sessionKind: payload?.session?.kind || null,
          user: payload?.user || null,
        };
      } catch {
        return { authenticated: false, sessionKind: null, user: null };
      }
    },
  });

  const structure = resolveStructure(structureData);
  const safeNext = normalizeNextPath(location.pathname + location.search, '/annuaire');
  const isRdvPublished = Boolean(structure?.rdv?.isPublished ?? structure?.is_pro_enabled);

  const baseSlug = String(structure?.slug || structureSlug || '').trim();
  const basePath = baseSlug ? `/rdv/${encodeURIComponent(baseSlug)}` : '/annuaire';

  const isUserSession = authState?.sessionKind === 'user';

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams();
    if (structureId) params.set('structureId', structureId);
    if (selectedServiceId) params.set('serviceId', selectedServiceId);
    if (modeParam) params.set('mode', modeParam);
    if (appointmentId) params.set('appointment', appointmentId);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    const text = params.toString();
    return text ? `?${text}` : '';
  }, [appointmentId, fromDate, modeParam, selectedServiceId, structureId, toDate]);

  const {
    data: servicesPayload,
    isLoading: servicesLoading,
    error: servicesError,
  } = useQuery({
    queryKey: ['public-rdv-services', baseSlug, isUserSession],
    enabled: Boolean(baseSlug && isRdvPublished && isUserSession),
    queryFn: () => apiRequest(`/api/rdv/structures/${encodeURIComponent(baseSlug)}/services`, { token }),
  });

  const allServices = Array.isArray(servicesPayload?.items)
    ? servicesPayload.items
    : Array.isArray(structure?.proServices)
      ? structure.proServices.filter(Boolean)
      : [];
  // a services answer without modality information (older API) means in person — the historical behaviour; video is never assumed
  const offeredModes = !servicesPayload ? [] : Array.isArray(servicesPayload?.structure?.modes) ? servicesPayload.structure.modes : ['IN_PERSON'];
  const selectedMode = offeredModes.includes(modeChoice) ? modeChoice : offeredModes.length === 1 ? offeredModes[0] : '';
  const videoNotice = servicesPayload?.video || null;
  const videoAnnounced = ['VIDEO', 'BOTH'].includes(servicesPayload?.structure?.bookingMode);
  const services = selectedMode ? allServices.filter((/** @type {any} */ service) => !Array.isArray(service.modes) || service.modes.includes(selectedMode)) : [];

  const selectedService =
    services.find((/** @type {{ id: string | number | boolean | null | undefined }} */ service) => String(service.id) === selectedServiceId) ||
    null;

  const {
    data: slotsPayload,
    isLoading: slotsLoading,
    error: slotsError,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: ['public-rdv-slots', baseSlug, selectedServiceId, selectedMode, fromDate, toDate, isUserSession],
    enabled: Boolean(
      view === 'creneaux' &&
      baseSlug &&
      isRdvPublished &&
      isUserSession &&
      selectedServiceId &&
      selectedMode,
    ),
    queryFn: () =>
      apiRequest(
        `/api/rdv/structures/${encodeURIComponent(baseSlug)}/slots?serviceId=${encodeURIComponent(selectedServiceId)}&mode=${encodeURIComponent(selectedMode)}&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`,
        { token },
      ),
  });

  const {
    data: appointmentPayload,
    isLoading: appointmentLoading,
    error: appointmentError,
    refetch: refetchAppointment,
  } = useQuery({
    queryKey: ['public-rdv-appointment', appointmentId, isUserSession],
    enabled: Boolean(appointmentId && isUserSession),
    queryFn: () => apiRequest(`/api/rdv/appointments/${encodeURIComponent(appointmentId)}`, { token }),
  });

  const appointment = appointmentPayload && typeof appointmentPayload === 'object' ? appointmentPayload : null;

  const steps = useMemo(() => {
    return [
      {
        key: 'landing',
        label: 'Structure',
        description: 'Verification du contexte',
        href: `${basePath}${querySuffix}`,
      },
      {
        key: 'services',
        label: 'Service',
        description: 'Choix du motif',
        href: `${basePath}/services${querySuffix}`,
      },
      {
        key: 'creneaux',
        label: 'Creneau',
        description: 'Selection de la date',
        href: `${basePath}/creneaux${querySuffix}`,
      },
    ];
  }, [basePath, querySuffix]);

  const updateParams = (/** @type {Record<string, string | number | boolean | null | undefined>} */ patch) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || typeof value === 'undefined' || value === '') {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    setSearchParams(next, { replace: true });
  };

  const handleChooseService = (/** @type {number} */ serviceId) => {
    updateParams({ serviceId, appointment: null });
  };
  const handleChooseMode = (/** @type {string} */ mode) => {
    // a service that does not offer the new modality is unselected (never booked in another modality)
    const keep = allServices.find((/** @type {any} */ service) => String(service.id) === selectedServiceId && (!Array.isArray(service.modes) || service.modes.includes(mode)));
    setVideoConsent(false);
    setModeChoice(mode);
    updateParams({ mode, serviceId: keep ? selectedServiceId : null, appointment: null });
  };

  const handleBookSlot = async (/** @type {{ startAt: string | number | boolean | null | undefined }} */ slot) => {
    if (!selectedServiceId || !baseSlug || !slot?.startAt || !selectedMode) return;
    if (selectedMode === 'VIDEO' && !videoConsent) {
      setBookingError('Pour un rendez-vous en visio, cochez d’abord votre accord.');
      return;
    }

    setBookingBusy(true);
    setBookingError('');
    setBookingInfo('');

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      const payload = await apiRequest('/api/rdv/appointments', {
        method: 'POST',
        token,
        body: {
          structureSlug: baseSlug,
          serviceId: selectedServiceId,
          startAt: slot.startAt,
          idempotencyKey,
          mode: selectedMode,
          ...(selectedMode === 'VIDEO' ? { videoConsent: true } : {}),
        },
      });

      if (payload?.id) {
        updateParams({ appointment: payload.id });
        setBookingInfo(selectedMode === 'VIDEO'
          ? 'Rendez-vous en visio confirmé. L’accès sécurisé se fera depuis Mes rendez-vous, après validation par la structure.'
          : 'Rendez-vous en présentiel confirmé. Un e-mail de confirmation a été préparé.');
        await refetchAppointment();
      }
    } catch (error) {
      // @ts-ignore
      if (error?.status === 409) {
        setBookingError("Ce creneau n'est plus disponible. Rechargez la liste.");
        await refetchSlots();
        return;
      }

      // @ts-ignore
      if (error?.status === 403 && error?.payload?.code === 'EMAIL_NOT_VERIFIED') {
        setBookingError('Veuillez verifier votre email avant de confirmer un rendez-vous.');
        return;
      }

      setBookingError(getErrorMessage(error, 'Impossible de confirmer ce rendez-vous.'));
    } finally {
      setBookingBusy(false);
    }
  };

  const handleCancelAppointment = async () => {
    if (!appointment?.id) return;

    setCancelBusy(true);
    setBookingError('');
    setBookingInfo('');

    try {
      await apiRequest(`/api/rdv/appointments/${encodeURIComponent(appointment.id)}/cancel`, {
        method: 'POST',
        token,
      });
      await refetchAppointment();
      setBookingInfo('Rendez-vous annule.');
    } catch (error) {
      setBookingError(getErrorMessage(error, "Impossible d'annuler ce rendez-vous."));
    } finally {
      setCancelBusy(false);
    }
  };

  const handleOpenConversation = async () => {
    if (!appointment?.id) return;

    setOpenConversationBusy(true);
    setBookingError('');
    setBookingInfo('');

    try {
      const payload = await apiRequest(
        `/api/messages/from-appointment/${encodeURIComponent(appointment.id)}`,
        {
          method: 'POST',
          token,
        },
      );

      if (payload?.conversationId) {
        navigate(`/compte/messages/${encodeURIComponent(payload.conversationId)}`);
        return;
      }

      setBookingError("Impossible d'ouvrir la conversation.");
    } catch (error) {
      setBookingError(getErrorMessage(error, 'Impossible d’ouvrir la conversation.'));
    } finally {
      setOpenConversationBusy(false);
    }
  };

  if (structureLoading || authLoading) {
    return (
      <div className="w-full p-4"><SkeletonList count={3} variant="card" /></div>
    );
  }

  // Q10: an outage is not « this structure does not exist »
  if (!structure && structureFailed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" data-testid="rdv-structure-error">
        <SEO title="Prise de rendez-vous indisponible" description="Prise de rendez-vous" path={safeNext} noindex={true} />
        <Card className="w-full max-w-xl" role="alert">
          <CardHeader>
            <CardTitle as="h1">Prise de rendez-vous momentanément indisponible</CardTitle>
            <CardDescription>Le service n&apos;a pas répondu : la structure n&apos;a pas pu être chargée. Réessayez dans un instant.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => refetchStructure()}>Réessayer</Button>
            <Link to="/annuaire" className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">Retour à l&apos;annuaire</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!structure) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <SEO title="Structure introuvable" description="Prise de rendez-vous" path={safeNext} noindex={true} />
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle as="h1">Cette structure n&apos;existe pas</CardTitle>
            <CardDescription>
              Vérifiez l&apos;adresse ou revenez à l&apos;annuaire pour choisir une autre structure.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link
              to="/annuaire"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Retour à l&apos;annuaire
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
            >
              Signaler un probleme
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!authState?.authenticated) {
    return <Navigate to={appendNext('/auth/login', safeNext)} replace />;
  }

  if (!isRdvPublished) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <SEO
          title="RDV indisponible"
          description="La prise de rendez-vous n'est pas publiee pour cette structure."
          path={safeNext}
          noindex={true}
        />
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle as="h1" className="flex items-center gap-2 text-slate-900" data-testid="rdv-unpublished">
              <ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden="true" />
              Rendez-vous indisponible (non publié)
            </CardTitle>
            <CardDescription>
              La structure <strong>{structure.nom}</strong> n&apos;a pas encore publie la prise de rendez-vous en ligne.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              Vous pouvez demander a etre rappelle, ou inviter la structure a activer les rendez-vous en ligne.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                Demander &agrave; &ecirc;tre rappel&eacute;
              </Link>
              <Link
                to="/proposer-une-structure"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                Inviter la structure
              </Link>
              <Link
                to={structure.slug ? `/structures/${structure.slug}` : '/annuaire'}
                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Retour à la structure
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isUserSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <SEO
          title="Connexion necessaire"
          description="Connectez-vous avec un compte particulier pour prendre rendez-vous."
          path={safeNext}
          noindex={true}
        />
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle as="h1" data-testid="rdv-citizen-required">Connexion particulier nécessaire</CardTitle>
            <CardDescription>
              Cette étape est réservée aux comptes particuliers (usagers).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link
              to={appendNext('/auth/login', safeNext)}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Se connecter
            </Link>
            <Link
              to={appendNext('/auth/signup', safeNext)}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
            >
              Creer un compte
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentStep = view;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <SEO
        title={`Prise de RDV - ${structure.nom}`}
        description="Parcours de rendez-vous en ligne"
        path={safeNext}
        noindex={true}
      />

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Prise de rendez-vous</h1>
            <p className="text-slate-600">{structure.nom}</p>
          </div>
          <Link
            to={structure.slug ? `/structures/${structure.slug}` : '/annuaire'}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          >
            Retour à la fiche structure
          </Link>
        </div>

        <Card className="mb-6">
          <CardContent className="p-5">
            <ol className="grid gap-3 md:grid-cols-3" aria-label="Progression du parcours rendez-vous">
              {steps.map((step) => {
                const isCurrent = step.key === currentStep;
                return (
                  <li key={step.key}>
                    <Link
                      to={step.href}
                      className={`block rounded-lg border p-3 transition ${
                        isCurrent
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                      }`}
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide">{step.label}</div>
                      <div className="text-sm">{step.description}</div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-6">
            {currentStep === 'landing' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-900">Commencer votre demande</h2>
                <p className="text-slate-700">
                  Choisissez un service puis un creneau disponible pour obtenir une confirmation immediate.
                </p>
                <Link
                  to={`${basePath}/services${querySuffix}`}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  Choisir un service
                </Link>
              </div>
            )}

            {currentStep === 'services' && (
              <div className="space-y-4">
                <fieldset className="space-y-2" data-testid="rdv-mode-choice">
                  <legend className="text-xl font-semibold text-slate-900">Comment souhaitez-vous être reçu·e ?</legend>
                  {servicesLoading ? null : offeredModes.length ? (
                    <div className="flex flex-wrap gap-3">
                      {offeredModes.map((/** @type {string} */ m) => (
                        <label key={m} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 ${selectedMode === m ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}>
                          <input type="radio" name="rdv-mode" value={m} data-testid={`rdv-mode-${m}`} checked={selectedMode === m} onChange={() => handleChooseMode(m)} />
                          {m === 'VIDEO' ? 'À distance (visio)' : 'En présentiel'}
                        </label>
                      ))}
                    </div>
                  ) : <p className="text-slate-600" data-testid="rdv-no-mode">Aucune modalité de rendez-vous n’est proposée en ligne pour le moment.</p>}
                  {videoAnnounced && videoNotice && !videoNotice.available ? (
                    <p className="text-sm text-slate-700" data-testid="rdv-video-unavailable">Les rendez-vous en visio ne sont pas encore disponibles sur ce service : ils ne sont donc pas proposés.</p>
                  ) : null}
                  {selectedMode === 'VIDEO' && videoNotice?.sandbox ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" data-testid="rdv-video-sandbox">Environnement de test : la connexion au fournisseur de visio n’est pas vérifiée ici.</p>
                  ) : null}
                  {selectedMode === 'IN_PERSON' && servicesPayload?.structure?.location ? (
                    <p className="text-sm text-slate-700" data-testid="rdv-location">Lieu : {servicesPayload.structure.location.address}{servicesPayload.structure.location.verified ? '' : ' (adresse non encore vérifiée : confirmez-la auprès de la structure)'}{servicesPayload.structure.location.stepFreeAccess ? ' — accessible aux personnes à mobilité réduite' : ''}</p>
                  ) : null}
                </fieldset>

                <h2 className="text-xl font-semibold text-slate-900">Choix du service</h2>

                {servicesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" /> Chargement des services...
                  </div>
                ) : services.length > 0 ? (
                  <ul className="space-y-2">
                    {services.map((/** @type {{ id: number; name: any; durationMinutes: any; }} */ service) => {
                      const selected = String(service.id) === selectedServiceId;
                      return (
                        <li key={service.id} className={`rounded-md border p-3 ${selected ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-slate-900">{service.name}</p>
                              <p className="text-sm text-slate-600">Duree: {service.durationMinutes || 30} min</p>
                            </div>
                            <Button
                              type="button"
                              variant={selected ? 'default' : 'outline'}
                              data-testid={`choose-service-${service.id}`}
                              onClick={() => handleChooseService(service.id)}
                            >
                              {selected ? 'Selectionne' : 'Choisir ce service'}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-slate-600" data-testid="rdv-no-service">{selectedMode ? 'Aucun service n’est proposé dans cette modalité.' : 'Choisissez d’abord comment vous souhaitez être reçu·e.'}</p>
                )}

                {servicesError ? (
                  <p className="text-sm text-rose-700">{getErrorMessage(servicesError, 'Impossible de charger les services.')}</p>
                ) : null}

                <Link
                  to={`${basePath}/creneaux${querySuffix}`}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  Voir les creneaux
                </Link>
              </div>
            )}

            {currentStep === 'creneaux' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-900">Choix du creneau</h2>

                {!selectedServiceId ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Selectionnez d&apos;abord un service.
                    <div className="mt-2">
                      <Link to={`${basePath}/services${querySuffix}`} className="underline">
                        Retour aux services
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1 text-sm">
                        <span className="text-slate-700">Du</span>
                        <Input
                          type="date"
                          value={fromDate}
                          onChange={(event) => {
                            setFromDate(event.target.value);
                            updateParams({ from: event.target.value });
                          }}
                        />
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="text-slate-700">Au</span>
                        <Input
                          type="date"
                          value={toDate}
                          onChange={(event) => {
                            setToDate(event.target.value);
                            updateParams({ to: event.target.value });
                          }}
                        />
                      </label>

                      <div className="flex items-end">
                        <Button type="button" variant="outline" onClick={() => refetchSlots()}>
                          Recharger les creneaux
                        </Button>
                      </div>
                    </div>

                    {selectedService ? (
                      <p className="text-sm text-slate-600" data-testid="rdv-selected">
                        Service selectionne: <strong>{selectedService.name}</strong> — <strong>{selectedMode === 'VIDEO' ? 'À distance (visio)' : selectedMode === 'IN_PERSON' ? 'En présentiel' : 'modalité à choisir'}</strong>
                      </p>
                    ) : null}
                    {!selectedMode ? (
                      <p className="text-sm text-amber-900" data-testid="rdv-mode-missing">Choisissez d’abord la modalité (présentiel ou visio) à l’étape Service.</p>
                    ) : null}
                    {selectedMode === 'VIDEO' ? (
                      <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm" data-testid="rdv-video-consent-label">
                        <input type="checkbox" data-testid="rdv-video-consent" checked={videoConsent} onChange={(e) => setVideoConsent(e.target.checked)} />
                        <span>J’accepte que ce rendez-vous se fasse en visio (caméra et micro, aucun enregistrement). L’accès se fera depuis Mes rendez-vous, après validation par la structure.</span>
                      </label>
                    ) : null}

                    {slotsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des creneaux...
                      </div>
                    ) : null}

                    {!slotsLoading && slotsPayload?.days?.length > 0 ? (
                      <div className="space-y-4">
                        {slotsPayload.days.map((/** @type {{ date: any; slots: any[]; }} */ day) => (
                          <div key={day.date} className="rounded-md border border-slate-200 p-3">
                            <p className="mb-2 font-medium text-slate-900">{day.date}</p>
                            <div className="flex flex-wrap gap-2">
                              {day.slots.map((slot) => (
                                <Button
                                  key={slot.startAt}
                                  type="button"
                                  variant="outline"
                                  data-testid={`rdv-slot-${String(slot.startAt).replace(/[^a-zA-Z0-9]/g, '-')}`}
                                  disabled={bookingBusy || (selectedMode === 'VIDEO' && !videoConsent)}
                                  onClick={() => handleBookSlot(slot)}
                                >
                                  {formatDateTime(slot.startAt)}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {!slotsLoading && !slotsError && (!slotsPayload?.days || slotsPayload.days.length === 0) ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        Aucun creneau disponible sur la periode selectionnee.
                      </div>
                    ) : null}

                    {slotsError ? (
                      <p className="text-sm text-rose-700">{getErrorMessage(slotsError, 'Impossible de charger les creneaux.')}</p>
                    ) : null}
                  </>
                )}

                {bookingError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{bookingError}</div>
                ) : null}

                {bookingInfo ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="h-4 w-4" />
                      {bookingInfo}
                    </div>
                  </div>
                ) : null}

                {appointmentLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" /> Chargement du rendez-vous...
                  </div>
                ) : null}

                {appointmentError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    {getErrorMessage(appointmentError, 'Impossible de charger le rendez-vous.')}
                  </div>
                ) : null}

                {appointment ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 space-y-3" data-testid="rdv-booking-confirmation">
                    <h3 className="font-semibold text-emerald-900">RDV confirme</h3>
                    <p className="text-sm text-emerald-900">
                      {appointment.service?.name || 'Service'} - {formatDateTime(appointment.startsAt)}
                    </p>
                    <p className="text-xs text-emerald-900">Statut: {appointment.status}</p>
                    <p className="text-sm text-emerald-900" data-testid="rdv-confirmation-mode">{appointment.mode === 'VIDEO' ? 'À distance (visio) : l’accès sécurisé se fera depuis Mes rendez-vous, 15 minutes avant, après validation par la structure. Aucun lien n’est envoyé par e-mail.' : `En présentiel${appointment.location ? ` — ${appointment.location.address}${appointment.location.verified ? '' : ' (adresse non encore vérifiée : confirmez-la auprès de la structure)'}` : ''}`}</p>
                    <Link to="/compte/rendez-vous" className="text-sm text-emerald-900 underline" data-testid="rdv-to-my-appointments">Voir mes rendez-vous</Link>

                    {appointment.status !== 'CANCELLED' ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={openConversationBusy}
                          onClick={handleOpenConversation}
                        >
                          {openConversationBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Ecrire un message
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={cancelBusy}
                          onClick={handleCancelAppointment}
                        >
                          {cancelBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                          Annuler mon RDV
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-700">Ce rendez-vous est annule.</p>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            <p className="text-xs text-slate-500">
              Ces informations sont fournies a titre indicatif. La confirmation finale depend de la disponibilite du creneau au moment de la validation.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
