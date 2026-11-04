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
import i18n, { formatDate, useT } from '@/i18n';
import { Trans } from 'react-i18next';
import AgeDeclarationPrompt from '@/components/rdv/AgeDeclarationPrompt.jsx';
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
  return formatDate(date, { dateStyle: 'short', timeStyle: 'short' });   // R40: in the interface language (Europe/Paris)
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
  // R42-A07 (R42-QA): an account without an age statement declares it here, then the SAME slot is requested again (as on /rdv/:slug/booking)
  const [ageSlot, setAgeSlot] = useState(/** @type {{ startAt: string | number | boolean | null | undefined } | null} */ (null));
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

  // R42 (DEC-R42-01): no account-free booking — a visitor without a citizen session goes to the login (the context is kept in `next`)
  const { t } = useT('booking');

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
        label: t('booking:rdv.structure', "Structure"),
        description: t('booking:rdv.verification_du_contexte', "Verification du contexte"),
        href: `${basePath}${querySuffix}`,
      },
      {
        key: 'services',
        label: t('booking:rdv.service', "Service"),
        description: t('booking:rdv.choix_du_motif', "Choix du motif"),
        href: `${basePath}/services${querySuffix}`,
      },
      {
        key: 'creneaux',
        label: t('booking:rdv.creneau', "Creneau"),
        description: t('booking:rdv.selection_de_la_date', "Selection de la date"),
        href: `${basePath}/creneaux${querySuffix}`,
      },
    ];
  }, [basePath, querySuffix, t]);

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
      setBookingError(t('booking:rdv.pour_un_rendez_vous_en', "Pour un rendez-vous en visio, cochez d’abord votre accord."));
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
        // R42-A03 (R42-QA): a structure in approval mode answers REQUESTED: never presented as confirmed
        if (payload.state === 'REQUESTED' || payload.awaitingApproval === true) setBookingInfo(t('booking:journey.requested_title', 'Demande envoyée : en attente de la structure'));
        else setBookingInfo(selectedMode === 'VIDEO'
          ? t('booking:rdv.rendez_vous_en_visio_confirme', "Rendez-vous en visio confirmé. L’accès sécurisé se fera depuis Mes rendez-vous, après validation par la structure.")
          : t('booking:rdv.rendez_vous_en_presentiel_confirme', "Rendez-vous en présentiel confirmé. Un e-mail de confirmation a été préparé."));
        await refetchAppointment();
      }
    } catch (error) {
      const refusal = /** @type {{ status?: number, payload?: { code?: string, message?: string } } | null} */ (error);
      // R42-A07 (R42-QA): not a slot conflict — the account has no age statement yet: ask for it, then book the same slot
      if (refusal?.status === 409 && refusal.payload?.code === 'AGE_DECLARATION_REQUIRED') {
        setAgeSlot(slot);
        return;
      }
      // R42-A07: a person who stated they are under 18 gets the server's explanation (with 119 / 112), never a raw code
      if (refusal?.status === 403 && refusal.payload?.code === 'ADULT_ACCOUNT_REQUIRED') {
        setBookingError(String(refusal.payload.message || t('booking:rdv.impossible_de_confirmer_ce_rendez', "Impossible de confirmer ce rendez-vous.")));
        return;
      }
      // @ts-ignore
      if (error?.status === 409) {
        setBookingError(t('booking:rdv.ce_creneau_n_est_plus', "Ce creneau n'est plus disponible. Rechargez la liste."));
        await refetchSlots();
        return;
      }

      // @ts-ignore
      if (error?.status === 403 && error?.payload?.code === 'EMAIL_NOT_VERIFIED') {
        setBookingError(t('booking:rdv.veuillez_verifier_votre_email_avant', "Veuillez verifier votre email avant de confirmer un rendez-vous."));
        return;
      }

      setBookingError(getErrorMessage(error, t('booking:rdv.impossible_de_confirmer_ce_rendez', "Impossible de confirmer ce rendez-vous.")));
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
      setBookingInfo(t('booking:rdv.rendez_vous_annule', "Rendez-vous annule."));
    } catch (error) {
      setBookingError(getErrorMessage(error, t('booking:rdv.impossible_d_annuler_ce_rendez', "Impossible d'annuler ce rendez-vous.")));
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

      setBookingError(t('booking:rdv.impossible_d_ouvrir_la_conversation', "Impossible d'ouvrir la conversation."));
    } catch (error) {
      setBookingError(getErrorMessage(error, t('booking:rdv.impossible_d_ouvrir_la_conversation_2', "Impossible d’ouvrir la conversation.")));
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
        <SEO title={t('booking:rdv.prise_de_rendez_vous_indisponible', "Prise de rendez-vous indisponible")} description={t('booking:rdv.prise_de_rendez_vous', "Prise de rendez-vous")} path={safeNext} noindex={true} />
        <Card className="w-full max-w-xl" role="alert">
          <CardHeader>
            <CardTitle as="h1">{t('booking:rdv.prise_de_rendez_vous_momentanement', "Prise de rendez-vous momentanément indisponible")}</CardTitle>
            <CardDescription>{t('booking:rdv.le_service_n_a_pas', "Le service n'a pas répondu : la structure n'a pas pu être chargée. Réessayez dans un instant.")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => refetchStructure()}>{t('booking:rdv.reessayer', "Réessayer")}</Button>
            <Link to="/annuaire" className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">{t('booking:rdv.retour_a_l_annuaire', "Retour à l'annuaire")}</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!structure) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <SEO title={t('booking:rdv.structure_introuvable', "Structure introuvable")} description={t('booking:rdv.prise_de_rendez_vous', "Prise de rendez-vous")} path={safeNext} noindex={true} />
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle as="h1">{t('booking:rdv.cette_structure_n_existe_pas', "Cette structure n'existe pas")}</CardTitle>
            <CardDescription>
              {t('booking:rdv.verifiez_l_adresse_ou_revenez', "Vérifiez l'adresse ou revenez à l'annuaire pour choisir une autre structure.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link
              to="/annuaire"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              {t('booking:rdv.retour_a_l_annuaire', "Retour à l'annuaire")}
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
            >
              {t('booking:rdv.signaler_un_probleme', "Signaler un probleme")}
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
          title={t('booking:rdv.rdv_indisponible', "RDV indisponible")}
          description={t('booking:rdv.la_prise_de_rendez_vous', "La prise de rendez-vous n'est pas publiee pour cette structure.")}
          path={safeNext}
          noindex={true}
        />
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle as="h1" className="flex items-center gap-2 text-slate-900" data-testid="rdv-unpublished">
              <ShieldAlert className="h-5 w-5 text-amber-600" aria-hidden="true" />
              {t('booking:rdv.rendez_vous_indisponible_non_publie', "Rendez-vous indisponible (non publié)")}
            </CardTitle>
            <CardDescription>
              <Trans i18n={i18n} i18nKey="booking:entry.unpublished_text" defaults="La structure <0>{{name}}</0> n'a pas encore publie la prise de rendez-vous en ligne." values={{ name: structure.nom }} components={[<strong key="n" lang="fr" dir="ltr" />]} />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600">
              {t('booking:rdv.vous_pouvez_demander_a_etre', "Vous pouvez demander a etre rappelle, ou inviter la structure a activer les rendez-vous en ligne.")}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                {t('booking:rdv.demander_a_etre_rappele', "Demander à être rappelé")}
              </Link>
              <Link
                to="/proposer-une-structure"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                {t('booking:rdv.inviter_la_structure', "Inviter la structure")}
              </Link>
              <Link
                to={structure.slug ? `/structures/${structure.slug}` : '/annuaire'}
                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {t('booking:rdv.retour_a_la_structure', "Retour à la structure")}
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
          title={t('booking:rdv.connexion_necessaire', "Connexion necessaire")}
          description={t('booking:rdv.connectez_vous_avec_un_compte', "Connectez-vous avec un compte particulier pour prendre rendez-vous.")}
          path={safeNext}
          noindex={true}
        />
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle as="h1" data-testid="rdv-citizen-required">{t('booking:rdv.connexion_particulier_necessaire', "Connexion particulier nécessaire")}</CardTitle>
            <CardDescription>
              {t('booking:rdv.cette_etape_est_reservee_aux', "Cette étape est réservée aux comptes particuliers (usagers).")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link
              to={appendNext('/auth/login', safeNext)}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              {t('booking:rdv.se_connecter', "Se connecter")}
            </Link>
            <Link
              to={appendNext('/auth/signup', safeNext)}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
            >
              {t('booking:rdv.creer_un_compte', "Creer un compte")}
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
        description={t('booking:rdv.parcours_de_rendez_vous_en', "Parcours de rendez-vous en ligne")}
        path={safeNext}
        noindex={true}
      />

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('booking:rdv.prise_de_rendez_vous', "Prise de rendez-vous")}</h1>
            <p className="text-slate-600">{structure.nom}</p>
          </div>
          <Link
            to={structure.slug ? `/structures/${structure.slug}` : '/annuaire'}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          >
            {t('booking:rdv.retour_a_la_fiche_structure', "Retour à la fiche structure")}
          </Link>
        </div>

        <Card className="mb-6">
          <CardContent className="p-5">
            <ol className="grid gap-3 md:grid-cols-3" aria-label={t('booking:rdv.progression_du_parcours_rendez_vous', "Progression du parcours rendez-vous")}>
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
                <h2 className="text-xl font-semibold text-slate-900">{t('booking:rdv.commencer_votre_demande', "Commencer votre demande")}</h2>
                <p className="text-slate-700">
                  {t('booking:rdv.choisissez_un_service_puis_un', "Choisissez un service puis un creneau disponible pour obtenir une confirmation immediate.")}
                </p>
                <Link
                  to={`${basePath}/services${querySuffix}`}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  {t('booking:rdv.choisir_un_service', "Choisir un service")}
                </Link>
              </div>
            )}

            {currentStep === 'services' && (
              <div className="space-y-4">
                <fieldset className="space-y-2" data-testid="rdv-mode-choice">
                  <legend className="text-xl font-semibold text-slate-900">{t('booking:rdv.comment_souhaitez_vous_etre_recu', "Comment souhaitez-vous être reçu·e ?")}</legend>
                  {servicesLoading ? null : offeredModes.length ? (
                    <div className="flex flex-wrap gap-3">
                      {offeredModes.map((/** @type {string} */ m) => (
                        <label key={m} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 ${selectedMode === m ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}>
                          <input type="radio" name="rdv-mode" value={m} data-testid={`rdv-mode-${m}`} checked={selectedMode === m} onChange={() => handleChooseMode(m)} />
                          {m === 'VIDEO' ? t('booking:rdv.a_distance_visio', "À distance (visio)") : t('booking:rdv.en_presentiel', "En présentiel")}
                        </label>
                      ))}
                    </div>
                  ) : <p className="text-slate-600" data-testid="rdv-no-mode">{t('booking:rdv.aucune_modalite_de_rendez_vous', "Aucune modalité de rendez-vous n’est proposée en ligne pour le moment.")}</p>}
                  {videoAnnounced && videoNotice && !videoNotice.available ? (
                    <p className="text-sm text-slate-700" data-testid="rdv-video-unavailable">{t('booking:rdv.les_rendez_vous_en_visio', "Les rendez-vous en visio ne sont pas encore disponibles sur ce service : ils ne sont donc pas proposés.")}</p>
                  ) : null}
                  {selectedMode === 'VIDEO' && videoNotice?.sandbox ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" data-testid="rdv-video-sandbox">{t('booking:rdv.environnement_de_test_la_connexion', "Environnement de test : la connexion au fournisseur de visio n’est pas vérifiée ici.")}</p>
                  ) : null}
                  {selectedMode === 'IN_PERSON' && servicesPayload?.structure?.location ? (
                    <p className="text-sm text-slate-700" data-testid="rdv-location">{t('booking:rdv.lieu', "Lieu :")} {servicesPayload.structure.location.address}{servicesPayload.structure.location.verified ? '' : ' (adresse non encore vérifiée : confirmez-la auprès de la structure)'}{servicesPayload.structure.location.stepFreeAccess ? ' — accessible aux personnes à mobilité réduite' : ''}</p>
                  ) : null}
                </fieldset>

                <h2 className="text-xl font-semibold text-slate-900">{t('booking:rdv.choix_du_service', "Choix du service")}</h2>

                {servicesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('booking:rdv.chargement_des_services', "Chargement des services...")}
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
                              <p className="text-sm text-slate-600">{t('booking:rdv.duree', "Duree:")} {t('booking:rdv.minutes', '{{minutes}} min', { minutes: service.durationMinutes || 30 })}</p>
                            </div>
                            <Button
                              type="button"
                              variant={selected ? 'default' : 'outline'}
                              data-testid={`choose-service-${service.id}`}
                              onClick={() => handleChooseService(service.id)}
                            >
                              {selected ? t('booking:rdv.selectionne', "Selectionne") : t('booking:rdv.choisir_ce_service', "Choisir ce service")}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-slate-600" data-testid="rdv-no-service">{selectedMode ? t('booking:rdv.aucun_service_n_est_propose', "Aucun service n’est proposé dans cette modalité.") : t('booking:rdv.choisissez_d_abord_comment_vous', "Choisissez d’abord comment vous souhaitez être reçu·e.")}</p>
                )}

                {servicesError ? (
                  <p className="text-sm text-rose-700">{getErrorMessage(servicesError, 'Impossible de charger les services.')}</p>
                ) : null}

                <Link
                  to={`${basePath}/creneaux${querySuffix}`}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  {t('booking:rdv.voir_les_creneaux', "Voir les creneaux")}
                </Link>
              </div>
            )}

            {currentStep === 'creneaux' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-900">{t('booking:rdv.choix_du_creneau', "Choix du creneau")}</h2>

                {!selectedServiceId ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {t('booking:rdv.selectionnez_d_abord_un_service', "Selectionnez d'abord un service.")}
                    <div className="mt-2">
                      <Link to={`${basePath}/services${querySuffix}`} className="underline">
                        {t('booking:rdv.retour_aux_services', "Retour aux services")}
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1 text-sm">
                        <span className="text-slate-700">{t('booking:rdv.du', "Du")}</span>
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
                        <span className="text-slate-700">{t('booking:rdv.au', "Au")}</span>
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
                          {t('booking:rdv.recharger_les_creneaux', "Recharger les creneaux")}
                        </Button>
                      </div>
                    </div>

                    {selectedService ? (
                      <p className="text-sm text-slate-600" data-testid="rdv-selected">
                        {t('booking:rdv.service_selectionne', "Service selectionne:")} <strong>{selectedService.name}</strong> — <strong>{selectedMode === 'VIDEO' ? 'À distance (visio)' : selectedMode === 'IN_PERSON' ? 'En présentiel' : 'modalité à choisir'}</strong>
                      </p>
                    ) : null}
                    {!selectedMode ? (
                      <p className="text-sm text-amber-900" data-testid="rdv-mode-missing">{t('booking:rdv.choisissez_d_abord_la_modalite', "Choisissez d’abord la modalité (présentiel ou visio) à l’étape Service.")}</p>
                    ) : null}
                    {selectedMode === 'VIDEO' ? (
                      <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm" data-testid="rdv-video-consent-label">
                        <input type="checkbox" data-testid="rdv-video-consent" checked={videoConsent} onChange={(e) => setVideoConsent(e.target.checked)} />
                        <span>{t('booking:rdv.j_accepte_que_ce_rendez', "J’accepte que ce rendez-vous se fasse en visio (caméra et micro, aucun enregistrement). L’accès se fera depuis Mes rendez-vous, après validation par la structure.")}</span>
                      </label>
                    ) : null}

                    {slotsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" /> {t('booking:rdv.chargement_des_creneaux', "Chargement des creneaux...")}
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
                        {t('booking:rdv.aucun_creneau_disponible_sur_la', "Aucun creneau disponible sur la periode selectionnee.")}
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

                {ageSlot ? <AgeDeclarationPrompt onDeclared={() => { const again = ageSlot; setAgeSlot(null); handleBookSlot(again); }} /> : null}

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
                    <Loader2 className="h-4 w-4 animate-spin" /> {t('booking:rdv.chargement_du_rendez_vous', "Chargement du rendez-vous...")}
                  </div>
                ) : null}

                {appointmentError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    {getErrorMessage(appointmentError, t('booking:rdv.impossible_de_charger_le_rendez', "Impossible de charger le rendez-vous."))}
                  </div>
                ) : null}

                {appointment ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 space-y-3" data-testid="rdv-booking-confirmation">
                    <h3 className="font-semibold text-emerald-900" data-testid="rdv-booking-state" data-state={appointment.state || ''}>{appointment.state === 'REQUESTED' || appointment.awaitingApproval === true
                      ? t('booking:journey.requested_title', 'Demande envoyée : en attente de la structure')
                      : t('booking:rdv.rdv_confirme', "RDV confirme")}</h3>
                    {appointment.state === 'REQUESTED' || appointment.awaitingApproval === true ? (
                      <p className="text-sm text-emerald-900" data-testid="rdv-requested-note">{t('booking:journey.requested_text', 'Ce rendez-vous n’est pas encore confirmé : la structure doit accepter votre demande. Suivez sa réponse dans « Mes rendez-vous ».')}</p>
                    ) : null}
                    <p className="text-sm text-emerald-900">
                      {appointment.service?.name || 'Service'} - {formatDateTime(appointment.startsAt)}
                    </p>
                    <p className="text-xs text-emerald-900">{t('booking:rdv.statut', "Statut:")} {appointment.status}</p>
                    <p className="text-sm text-emerald-900" data-testid="rdv-confirmation-mode">{appointment.mode === 'VIDEO' ? t('booking:rdv.a_distance_visio_l_acces', "À distance (visio) : l’accès sécurisé se fera depuis Mes rendez-vous, 15 minutes avant, après validation par la structure. Aucun lien n’est envoyé par e-mail.") : `${t('booking:rdv.en_presentiel', 'En présentiel')}${appointment.location ? ` — ${appointment.location.address}${appointment.location.verified ? '' : t('booking:rdv.adresse_non_encore_verifiee_confirmez', " (adresse non encore vérifiée : confirmez-la auprès de la structure)")}` : ''}`}</p>
                    <Link to="/compte/rendez-vous" className="text-sm text-emerald-900 underline" data-testid="rdv-to-my-appointments">{t('booking:rdv.voir_mes_rendez_vous', "Voir mes rendez-vous")}</Link>

                    {appointment.status !== 'CANCELLED' ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={openConversationBusy}
                          onClick={handleOpenConversation}
                        >
                          {openConversationBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {t('booking:rdv.ecrire_un_message', "Ecrire un message")}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={cancelBusy}
                          onClick={handleCancelAppointment}
                        >
                          {cancelBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                          {t('booking:rdv.annuler_mon_rdv', "Annuler mon RDV")}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-700">{t('booking:rdv.ce_rendez_vous_est_annule', "Ce rendez-vous est annule.")}</p>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            <p className="text-xs text-slate-500">
              {t('booking:rdv.ces_informations_sont_fournies_a', "Ces informations sont fournies a titre indicatif. La confirmation finale depend de la disponibilite du creneau au moment de la validation.")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
