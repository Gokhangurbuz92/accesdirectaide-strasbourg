import { Suspense, lazy, Component } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, Navigate, useParams } from 'react-router-dom';
import ScrollToTop from '@/components/navigation/ScrollToTop';
import RouteFocus from '@/components/navigation/RouteFocus';
import { m, LazyMotion, domAnimation, AnimatePresence, useReducedMotion } from 'framer-motion';
import { frontendEnv } from "@/config/env";
import { isBetaRestrictedPath } from "@/lib/publicBeta";
import { situationSearchPath } from "@/config/situations";
import { PublicBetaBanner, PublicBetaUnavailable } from "@/components/beta/PublicBeta";

/**
 * ErrorBoundary — catches chunk-load or mount errors in lazy-loaded routes.
 * Displays a clear fallback instead of a blank page.
 */
class RouteErrorBoundary extends Component {
    constructor(/** @type {number} */ props) {
        super(props);
        this.state = { hasError: false, errorMessage: '' };
    }
    static getDerivedStateFromError(/** @type {{ message: string | number | boolean | null | undefined }} */ error) {
        return {
            hasError: true,
            errorMessage: error?.message || 'Erreur inconnue',
        };
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="flex min-h-[50vh] items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                        <h1 className="mb-2 text-xl font-bold text-red-800">
                            Impossible de charger cette page
                        </h1>
                        <p className="mb-4 text-sm text-red-700">
                            Une erreur est survenue lors du chargement. Veuillez rafraîchir la page.
                        </p>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                        >
                            Rafraîchir
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

// [LAZY LOADED PAGES]
// Public
const Home = lazy(() => import("./Home.jsx"));
const Login = lazy(() => import("./Login.jsx"));
const Orientation = lazy(() => import("./Orientation.jsx"));
const APropos = lazy(() => import("./APropos.jsx"));
const Accessibilite = lazy(() => import("./Accessibilite.jsx"));
const Actualites = lazy(() => import("./Actualites.jsx"));
const ActualiteDetail = lazy(() => import("./ActualiteDetail.jsx"));
const AideDetail = lazy(() => import("./AideDetail.jsx"));
const AideLegacyLink = lazy(() => import("./AideLegacyLink.jsx"));   // R7: /aidedetail?slug|id, /aide/view?id
const Aides = lazy(() => import("./Aides.jsx"));
const Recherche = lazy(() => import("./Recherche.jsx"));
const RechercheAide = lazy(() => import("./RechercheAide.jsx"));
const Annuaire = lazy(() => import("./Annuaire.jsx"));
const Confidentialite = lazy(() => import("./Confidentialite.jsx"));
const CGU = lazy(() => import("./CGU.jsx"));
const Contact = lazy(() => import("./Contact.jsx"));
const Cookies = lazy(() => import("./Cookies.jsx"));
const DemarcheDetail = lazy(() => import("./DemarcheDetail.jsx"));
const Demarches = lazy(() => import("./Demarches.jsx"));
const DispositifDetail = lazy(() => import("./DispositifDetail.jsx"));
const Dispositifs = lazy(() => import("./Dispositifs.jsx"));
const Ressources = lazy(() => import("./Ressources.jsx"));
const RessourceDetail = lazy(() => import("./RessourceDetail.jsx"));
const Guides = lazy(() => import("./Guides.jsx"));
const GuideDetail = lazy(() => import("./GuideDetail.jsx"));
const Tools = lazy(() => import("./Tools.jsx"));
const ToolDetail = lazy(() => import("./ToolDetail.jsx"));
const MentionsLegales = lazy(() => import("./MentionsLegales.jsx"));
const SourcesMethode = lazy(() => import("./SourcesMethode.jsx"));
const Impact = lazy(() => import("./Impact.jsx"));
const Mission = lazy(() => import("./Mission.jsx"));
const Method = lazy(() => import("./Method.jsx"));
const Sources = lazy(() => import("./Sources.jsx"));
const Security = lazy(() => import("./Security.jsx"));
const Partners = lazy(() => import("./Partners.jsx"));
const SuggestStructure = lazy(() => import("./SuggestStructure.jsx"));
const Status = lazy(() => import("./Status.jsx"));
const TerritoireCouvert = lazy(() => import("./TerritoireCouvert.jsx"));
const StructureDetail = lazy(() => import("./StructureDetail.jsx"));
const DiagnosticPage = lazy(() => import("./DiagnosticPage.jsx"));
const SharedDiagnostic = lazy(() => import("./SharedDiagnostic.jsx"));
const AdminAudit = lazy(() => import("./AdminAudit.jsx"));
const AdminParametres = lazy(() => import("./admin/AdminParametres.jsx"));
const ServiceError = lazy(() => import("./ServiceError.jsx"));

const AppointmentRequest = lazy(() => import("./AppointmentRequest.jsx"));
const AppointmentCancel = lazy(() => import("./AppointmentCancel.jsx"));
const AppointmentReschedule = lazy(() => import("./AppointmentReschedule.jsx"));
const LegacyAppointmentLink = lazy(() => import("./LegacyAppointmentLink.jsx"));
const PublicRdvEntry = lazy(() => import("./PublicRdvEntry.jsx"));
const PublicBooking = lazy(() => import("./PublicBookingAccessGate.jsx"));
const RegisterPro = lazy(() => import("./pro/RegisterPro.jsx"));
const SharedDossier = lazy(() => import("./pro/SharedDossier.jsx"));
const ProAuditLog = lazy(() => import("./pro/AuditLog.jsx"));
const ImpactReports = lazy(() => import("./pro/ImpactReports.jsx"));
const UserPassport = lazy(() => import("./UserPassport.jsx"));
const RegionalDashboard = lazy(() => import("./pro/RegionalDashboard.jsx"));
const OfficialAttestation = lazy(() => import("./pro/OfficialAttestation.jsx"));
// Orphan routes removed (V2): HiveOrchestrator, ContentFactory, StorybookExplorer
// Retained for future re-activation but removed from routing to pass interface audit.
const AuthRdvAccess = lazy(() => import("./AuthRdvAccess.jsx"));
const AuthVerifyEmail = lazy(() => import("./AuthVerifyEmail.jsx"));
const AuthForgotPassword = lazy(() => import("./AuthForgotPassword.jsx"));
const AuthResetPassword = lazy(() => import("./AuthResetPassword.jsx"));
const CompteMessages = lazy(() => import("./CompteMessages.jsx"));
const CompteMessageThread = lazy(() => import("./CompteMessageThread.jsx"));
const CompteParametres = lazy(() => import("./CompteParametres.jsx"));
const CompteProfil = lazy(() => import("./CompteProfil.jsx"));
const MonEspace = lazy(() => import("./MonEspace.jsx"));
const CompteParcours = lazy(() => import("./CompteParcours.jsx"));
const CompteCoffre = lazy(() => import("./CompteCoffre.jsx"));
const CompteFavoris = lazy(() => import("./CompteFavoris.jsx"));
const CompteHistorique = lazy(() => import("./CompteHistorique.jsx"));
const CompteDelegations = lazy(() => import("./CompteDelegations.jsx"));
const CompteDelegationVue = lazy(() => import("./CompteDelegationVue.jsx"));
const CompteRendezVous = lazy(() => import("./CompteRendezVous.jsx"));
const ComptePartageDetail = lazy(() => import("./ComptePartageDetail.jsx"));
const Layout = lazy(() => import("./Layout.jsx"));
const AdminGuard = lazy(() => import("@/components/AdminGuard"));
const ProGuard = lazy(() => import("@/components/ProGuard"));
const AdminLayout = lazy(() => import("./admin/AdminLayout.jsx"));

// Admin
const AdminLogin = lazy(() => import("./AdminLogin.jsx"));
const AdminHealth = lazy(() => import("./admin/Health.jsx"));
const AdminInbox = lazy(() => import("./admin/Inbox.jsx"));
const AdminRuns = lazy(() => import("./admin/Runs.jsx"));
const AdminObservability = lazy(() => import("./admin/Observability.jsx"));
const AdminReviewQueue = lazy(() => import("./admin/ReviewQueue.jsx"));
const AdminStructureProposals = lazy(() => import("./admin/StructureProposals.jsx"));
const AdminOrganizations = lazy(() => import("./admin/Organizations.jsx"));
const AdminWs2Queue = lazy(() => import("./admin/Ws2Queue.jsx"));
const AdminVeille = lazy(() => import("./admin/Veille.jsx"));
const AdminOperations = lazy(() => import("./admin/k5/Operations.jsx"));
const AdminPrivacy = lazy(() => import("./admin/k5/Privacy.jsx"));
const AdminSupport = lazy(() => import("./admin/k5/Support.jsx"));
const AdminDataQuality = lazy(() => import("./admin/k5/DataQuality.jsx"));
const AdminInstitutions = lazy(() => import("./admin/k5/Institutions.jsx"));
const AdminFunding = lazy(() => import("./admin/k5/Funding.jsx"));
const AdminPilot = lazy(() => import("./admin/k5/Pilot.jsx"));
const AdminSubmissions = lazy(() => import("./admin/k5/Submissions.jsx"));
const AdminVersions = lazy(() => import("./admin/k5/Versions.jsx"));
const AdminFalc = lazy(() => import("./admin/k5/Falc.jsx"));
const AdminDuplicates = lazy(() => import("./admin/k5/Duplicates.jsx"));
const AdminAiOversight = lazy(() => import("./admin/k5/AiOversight.jsx"));
const DemandeAide = lazy(() => import("./DemandeAide.jsx"));
const InstitutionEspace = lazy(() => import("./institution/Espace.jsx"));
const InstitutionForgot = lazy(() => import("./institution/Recuperation.jsx").then((m) => ({ default: m.InstitutionForgot })));
const InstitutionReset = lazy(() => import("./institution/Recuperation.jsx").then((m) => ({ default: m.InstitutionReset })));
const AdminAideEdit = lazy(() => import("./AdminAideEdit.jsx"));
const AdminAides = lazy(() => import("./AdminAides.jsx"));
const AdminAppointments = lazy(() => import("./AdminAppointments.jsx"));
const AdminStructures = lazy(() => import("./AdminStructures.jsx"));
const AdminStructureEdit = lazy(() => import("./AdminStructureEdit.jsx"));
const AdminDemarcheEdit = lazy(() => import("./AdminDemarcheEdit.jsx"));
const AdminDemarches = lazy(() => import("./AdminDemarches.jsx"));
const AdminDispositifs = lazy(() => import("./AdminDispositifs.jsx"));
const AdminDispositifEdit = lazy(() => import("./AdminDispositifEdit.jsx"));
const AdminGuides = lazy(() => import("./AdminGuides.jsx"));
const AdminGuideEdit = lazy(() => import("./AdminGuideEdit.jsx"));
const AdminMessages = lazy(() => import("./AdminMessages.jsx"));
const AdminSources = lazy(() => import("./AdminSources.jsx"));
const AdminSync = lazy(() => import("./AdminSync.jsx"));
const AdminReview = lazy(() => import("./AdminReview.jsx"));
const AdminDashboard = lazy(() => import("./AdminDashboard.jsx"));
const AdminFeatures = lazy(() => import("./AdminFeatures.jsx"));
const AdminConversations = lazy(() => import("./AdminConversations.jsx"));
const AdminNationalDashboard = lazy(() => import("./admin/NationalDashboard.jsx"));
const AIOrchestrator = lazy(() => import("./admin/AIOrchestrator.jsx"));
const AdminAiMetrics = lazy(() => import("./AdminAiMetrics.jsx"));
const AdminLogs = lazy(() => import("./AdminLogs.jsx"));

// Pro
const ProLayout = lazy(() => import("./pro/ProLayout.jsx"));
const ProLogin = lazy(() => import("./pro/Login.jsx"));
const ProRegister = lazy(() => import("./pro/Register.jsx"));
const ProForgotPassword = lazy(() => import("./pro/ForgotPassword.jsx"));
const ProResetPassword = lazy(() => import("./pro/ResetPassword.jsx"));
const ProDashboard = lazy(() => import("./pro/Dashboard.jsx"));
const ProServices = lazy(() => import("./pro/Services.jsx"));
const ProAvailability = lazy(() => import("./pro/Availability.jsx"));
const ProTeam = lazy(() => import("./pro/Team.jsx"));
const ProStructure = lazy(() => import("./pro/Structure.jsx"));
const ProParametres = lazy(() => import("./pro/ProParametres.jsx"));
const ProAppointments = lazy(() => import("./pro/Appointments.jsx"));
const ProAppointmentDetail = lazy(() => import("./pro/AppointmentDetail.jsx"));
const ProRdvLayout = lazy(() => import("./pro/RdvLayout.jsx"));
const ProRdvNew = lazy(() => import("./pro/RdvNew.jsx"));
const ProRdvAbsences = lazy(() => import("./pro/RdvAbsences.jsx"));
const ProMessages = lazy(() => import("./pro/Messages.jsx"));
const ProMessageThread = lazy(() => import("./pro/MessageThread.jsx"));
const ProVisio = lazy(() => import("./pro/Visio.jsx"));
const ProMfaSettings = lazy(() => import("./pro/MfaSettings.jsx"));
const ProCases = lazy(() => import("./pro/Cases.jsx"));
const ProReferrals = lazy(() => import("./pro/Referrals.jsx"));
const ProSelections = lazy(() => import("./pro/Selections.jsx"));
const CompteOrientations = lazy(() => import("./CompteOrientations.jsx"));

// Sentry
const SentryTestPage = lazy(() => import("./SentryTestPage.jsx"));

// Styleguide

// Glossaire
const Glossaire = lazy(() => import("./Glossaire.jsx"));
const Besoins = lazy(() => import("./Besoins.jsx"));   // extension R32: entry by need (social-sector reference)

// Map for _getCurrentPage logic (keeping structure for logic compatibility)
const PAGES = {
    AdminLogin, APropos, Accessibilite, Actualites, ActualiteDetail,
    AdminAideEdit, AdminAides, AdminMessages,
    AdminSources, AdminSync,
    AideDetail, Aides, Annuaire, Confidentialite, Contact, Cookies,
    DemarcheDetail, DispositifDetail, Login, Demarches, Home, Orientation,
    MentionsLegales, SourcesMethode, StructureDetail,
    AdminInbox, AdminRuns, AdminObservability, AdminReviewQueue, AppointmentRequest, AppointmentCancel, AppointmentReschedule, AdminStructures, AdminStructureEdit,
    AdminDemarches, AdminDemarcheEdit, AdminAppointments, AdminReview, Status, PublicRdvEntry, AuthRdvAccess, AuthVerifyEmail, AuthForgotPassword, AuthResetPassword,
    CompteMessages, CompteMessageThread, ProMessages, ProMessageThread, AdminDashboard, AdminFeatures
};

// Loading Fallback
const PageLoader = () => (
    <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
);

function LegacyAideRedirect() {
    const { slug } = useParams();
    return <Navigate to={`/aides/${slug}`} replace />;
}

/** PKG-11 audit: the sitemap lists /annuaire/<slug> (pinned by the frozen URL contract); the detail page lives at /structures/<slug> — it used to be a 404. */
/** R26: an old /situations/<slug> link opens the same search as the home situation tile (the situation filter has no data: it showed an empty list) */
function SituationRedirect() {
    const { slug } = useParams();
    return <Navigate to={situationSearchPath(slug)} replace />;
}

function AnnuaireSlugRedirect() {
    const { slug } = useParams();
    return <Navigate to={`/structures/${encodeURIComponent(slug || '')}`} replace />;
}

/**
 * Redirects legacy /entity/view?id=xxx URLs to /entity/xxx
 */
function LegacyViewRedirect(/** @type {{ basePath: string | number | boolean | null | undefined }} */ { basePath }) {
    const location = useLocation();
    const id = new URLSearchParams(location.search).get('id');
    return <Navigate to={`${basePath}/${id || ''}`} replace />;
}

/**
 * A section owns its own path and the paths below it — not every path that merely begins with the same letters (« /proposer-une-structure » is a
 * public page, not a Pro one; « /adminaides » is a legacy public redirect, not an admin page).
 * @param {string} pathname @param {string} prefix
 */
const inSection = (pathname, prefix) => pathname === prefix || pathname.startsWith(prefix + '/');

/**
 * @param {string} url
 */
function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop() || '';
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => {
        return page.toLowerCase() === urlLastPart.toLowerCase()
    });
    return pageName || 'Home';
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const shouldReduceMotion = useReducedMotion();


    // LOT SENTRY: Special standalone route that bypasses Layout (and thus Base44 auth imports)
    // LOT 5.1: Production Hardening - Only available if VITE_PUBLIC_DIAGNOSTICS is true
    if (location.pathname === '/__sentry_test' && frontendEnv.flags.publicDiagnostics) {
        return (
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route path="/__sentry_test" element={<SentryTestPage />} />
                </Routes>
            </Suspense>
        );
    }

    // Restricted public beta: screens that need an account, a booking, a document or a form explain why they are closed (the API refuses them too)
    if (frontendEnv.flags.publicBeta && isBetaRestrictedPath(location.pathname)) {
        return (
            <Suspense fallback={<PageLoader />}>
                <Layout currentPageName="Home">
                    <PublicBetaBanner />
                    <PublicBetaUnavailable />
                </Layout>
            </Suspense>
        );
    }

    const currentPage = _getCurrentPage(location.pathname);

    // Admin Routes (Bypass Public Layout — AdminLayout provides sidebar navigation + auth)
    if (inSection(location.pathname, '/admin')) {
        return (
            <Suspense fallback={<PageLoader />}>
                <LazyMotion features={domAnimation} strict>
                    <AnimatePresence mode="wait">
                        <m.div
                            key={location.pathname}
                            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
                            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeInOut' }}
                            className="w-full h-full min-h-screen"
                        >
                            <Routes location={location}>
                                <Route path="/admin" element={<AdminLayout />}>
                                    <Route index element={<Navigate to="dashboard" replace />} />
                                    <Route path="login" element={<AdminLogin />} />
                                    <Route path="dashboard" element={<AdminDashboard />} />
                                    <Route path="aides" element={<AdminAides />} />
                                    <Route path="aides/:id" element={<AdminAideEdit />} />
                                    <Route path="structures" element={<AdminStructures />} />
                                    <Route path="structures/:id" element={<AdminStructureEdit />} />
                                    <Route path="demarches" element={<AdminDemarches />} />
                                    <Route path="demarches/:id" element={<AdminDemarcheEdit />} />
                                    <Route path="dispositifs" element={<AdminDispositifs />} />
                                    <Route path="dispositifs/:id" element={<AdminDispositifEdit />} />
                                    <Route path="guides" element={<AdminGuides />} />
                                    <Route path="guides/:id" element={<AdminGuideEdit />} />
                                    <Route path="sources" element={<AdminSources />} />
                                    <Route path="appointments" element={<AdminAppointments />} />
                                    <Route path="messages" element={<AdminMessages />} />
                                    <Route path="inbox" element={<AdminInbox />} />
                                    {/* owner LAB audit: the old review page published through an endpoint that refuses it (405); the governed review is the verification queue */}
                                    <Route path="review" element={<Navigate to="/admin/ws2" replace />} />
                                    <Route path="review-queue" element={<AdminReviewQueue />} />
                                    <Route path="structure-proposals" element={<AdminStructureProposals />} />
                                    <Route path="organizations" element={<AdminOrganizations />} />
                                    <Route path="veille" element={<AdminVeille />} />
                                    <Route path="ws2" element={<AdminWs2Queue />} />
                                    <Route path="operations" element={<AdminOperations />} />
                                    <Route path="privacy" element={<AdminPrivacy />} />
                                    <Route path="support" element={<AdminSupport />} />
                                    <Route path="data-quality" element={<AdminDataQuality />} />
                                    <Route path="institutions" element={<AdminInstitutions />} />
                                    <Route path="financement" element={<AdminFunding />} />
                                    <Route path="financement/:id" element={<AdminFunding />} />
                                    <Route path="pilote" element={<AdminPilot />} />
                                    <Route path="signalements" element={<AdminSubmissions />} />
                                    <Route path="versions" element={<AdminVersions />} />
                                    <Route path="falc" element={<AdminFalc />} />
                                    <Route path="doublons" element={<AdminDuplicates />} />
                                    <Route path="ai-oversight" element={<AdminAiOversight />} />
                                    <Route path="orchestrator" element={<AIOrchestrator />} />
                                    <Route path="features" element={<AdminFeatures />} />
                                    <Route path="conversations" element={<AdminConversations />} />
                                    <Route path="national" element={<AdminNationalDashboard />} />
                                    <Route path="sync" element={<AdminSync />} />
                                    <Route path="sync/test" element={<Navigate to="/admin/sync" replace />} />
                                    {/* R7: the former page queried columns that do not exist and could only show « aucune fiche » */}
                                    <Route path="sync/recent" element={<Navigate to="/admin/sync" replace />} />
                                    <Route path="guides/sync" element={<Navigate to="/admin/sync" replace />} />
                                    <Route path="health" element={<AdminHealth />} />
                                    <Route path="observability" element={<AdminObservability />} />
                                    <Route path="runs" element={<AdminRuns />} />
                                    <Route path="audit" element={<AdminAudit />} />
                                    <Route path="ai-metrics" element={<AdminAiMetrics />} />
                                    <Route path="logs" element={<AdminLogs />} />
                                    <Route path="parametres" element={<AdminParametres />} />
                                </Route>
                            </Routes>
                        </m.div>
                    </AnimatePresence>
                </LazyMotion>
            </Suspense>
        );
    }

    // Lot 4: Pro Routes (Bypass Public Layout)
    if (inSection(location.pathname, '/pro')) {
        return (
            <Suspense fallback={<PageLoader />}>
                <LazyMotion features={domAnimation} strict>
                    <AnimatePresence mode="wait">
                        <m.div
                            key="pro-shell"
                            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
                            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeInOut' }}
                            className="w-full h-full min-h-screen"
                        >
                            <Routes location={location}>
                                <Route path="/pro" element={<ProLayout />}>
                                    <Route index element={<Navigate to="dashboard" replace />} />
                                    <Route path="login" element={<ProLogin />} />
                                    <Route path="register" element={<ProRegister />} />
                                    <Route path="register-invite" element={<RegisterPro />} />
                                    <Route path="forgot-password" element={<ProForgotPassword />} />
                                    <Route path="reset-password" element={<ProResetPassword />} />
                                    <Route path="dashboard" element={<ProGuard><ProDashboard /></ProGuard>} />
                                    <Route path="rdv" element={<ProGuard><ProRdvLayout /></ProGuard>}>
                                        <Route index element={<Navigate to="agenda" replace />} />
                                        <Route path="services" element={<ProServices />} />
                                        <Route path="disponibilites" element={<ProAvailability />} />
                                        <Route path="agenda" element={<ProAppointments />} />
                                        <Route path="new" element={<ProRdvNew />} />
                                        <Route path="absences" element={<ProRdvAbsences />} />
                                    </Route>
                                    <Route path="messages" element={<ProGuard><ProMessages /></ProGuard>} />
                                    <Route path="messages/:conversationId" element={<ProGuard><ProMessageThread /></ProGuard>} />
                                    <Route path="visio/:roomId" element={<ProGuard><ProVisio /></ProGuard>} />
                                    <Route path="visio" element={<ProGuard><ProVisio /></ProGuard>} />
                                    <Route path="services" element={<Navigate to="/pro/rdv/services" replace />} />
                                    <Route path="availability" element={<Navigate to="/pro/rdv/disponibilites" replace />} />
                                    <Route path="appointments" element={<Navigate to="/pro/rdv/agenda" replace />} />
                                    <Route path="team" element={<ProGuard><ProTeam /></ProGuard>} />
                                    <Route path="structure" element={<ProGuard><ProStructure /></ProGuard>} />
                                    <Route path="appointments/:id" element={<ProGuard><ProAppointmentDetail /></ProGuard>} />
                                    <Route path="dossier/:shareId" element={<ProGuard><SharedDossier /></ProGuard>} />
                                    <Route path="dossiers" element={<ProGuard><ProCases /></ProGuard>} />
                                    <Route path="dossiers/:id" element={<ProGuard><ProCases /></ProGuard>} />
                                    <Route path="orientations" element={<ProGuard><ProReferrals /></ProGuard>} />
                                    <Route path="orientations/:id" element={<ProGuard><ProReferrals /></ProGuard>} />
                                    <Route path="selections" element={<ProGuard><ProSelections /></ProGuard>} />
                                    <Route path="selections/:id" element={<ProGuard><ProSelections /></ProGuard>} />
                                    <Route path="audit" element={<ProGuard><ProAuditLog /></ProGuard>} />
                                    <Route path="reports" element={<ProGuard><ImpactReports /></ProGuard>} />
                                    <Route path="regional" element={<ProGuard><RegionalDashboard /></ProGuard>} />
                                    <Route path="attestation/:shareId" element={<ProGuard><OfficialAttestation /></ProGuard>} />
                                    {/* owner usefulness pass: developer pages (health probe, rehearsal, simulation) are not part of the professional space */}
                                    <Route path="health" element={<Navigate to="/pro/dashboard" replace />} />
                                    <Route path="simulation" element={<Navigate to="/pro/dashboard" replace />} />
                                    {/* Orphan routes removed: hive, content-factory, storybook (not V1-ready) */}
                                    <Route path="rehearsal" element={<Navigate to="/pro/dashboard" replace />} />
                                    <Route path="mfa-settings" element={<ProGuard><ProMfaSettings /></ProGuard>} />
                                    <Route path="parametres" element={<ProGuard><ProParametres /></ProGuard>} />
                                </Route>
                            </Routes>
                        </m.div>
                    </AnimatePresence>
                </LazyMotion>
            </Suspense>
        );
    }

    return (
        <Suspense fallback={<PageLoader />}>
            <Layout currentPageName={currentPage}>
                {frontendEnv.flags.publicBeta && <PublicBetaBanner />}
                <LazyMotion features={domAnimation} strict>
                    <AnimatePresence mode="wait">
                        <m.div
                            key={location.pathname}
                            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -15 }}
                            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
                            className="w-full h-full"
                        >
                            <Routes location={location}>
                                <Route path="/" element={<Home />} />
                                <Route path="/login" element={<Login />} />
                                <Route path="/auth/login" element={<RouteErrorBoundary><AuthRdvAccess mode="login" /></RouteErrorBoundary>} />
                                <Route path="/auth/signup" element={<RouteErrorBoundary><AuthRdvAccess mode="signup" /></RouteErrorBoundary>} />
                                <Route path="/auth/verify-email" element={<AuthVerifyEmail />} />
                                <Route path="/auth/forgot" element={<AuthForgotPassword />} />
                                <Route path="/auth/reset" element={<AuthResetPassword />} />
                                <Route path="/compte/messages" element={<CompteMessages />} />
                                <Route path="/compte/messages/:conversationId" element={<CompteMessageThread />} />
                                <Route path="/compte/parametres" element={<CompteParametres />} />
                                <Route path="/compte/profil" element={<CompteProfil />} />
                                <Route path="/compte" element={<MonEspace />} />
                                <Route path="/compte/parcours" element={<CompteParcours />} />
                                <Route path="/compte/coffre" element={<CompteCoffre />} />
                                <Route path="/compte/favoris" element={<CompteFavoris />} />
                                <Route path="/compte/historique" element={<CompteHistorique />} />
                                <Route path="/compte/delegations" element={<CompteDelegations />} />
                                <Route path="/compte/delegations/:id" element={<CompteDelegationVue />} />
                                <Route path="/compte/rendez-vous" element={<CompteRendezVous />} />
                                <Route path="/compte/orientations" element={<CompteOrientations />} />
                                <Route path="/compte/partages/:shareId" element={<ComptePartageDetail />} />
                                <Route path="/a-propos" element={<APropos />} />
                                <Route path="/accessibilite" element={<Accessibilite />} />
                                <Route path="/actualites" element={<Actualites />} />
                                <Route path="/actualites/view" element={<LegacyViewRedirect basePath="/actualites" />} />
                                <Route path="/actualites/:slug" element={<ActualiteDetail />} />
                                <Route path="/share/:id" element={<SharedDiagnostic />} />

                                <Route path="/appointments/request" element={<LegacyAppointmentLink kind="request" />} />
                                <Route path="/appointments/cancel" element={<LegacyAppointmentLink kind="cancel" />} />
                                <Route path="/appointments/cancel/:token" element={<LegacyAppointmentLink kind="cancel" />} />
                                <Route path="/passport/:shareId" element={<UserPassport />} />
                                <Route path="/appointments/reschedule" element={<LegacyAppointmentLink kind="reschedule" />} />
                                <Route path="/appointments/reschedule/:token" element={<LegacyAppointmentLink kind="reschedule" />} />
                                <Route path="/rdv/:structureSlug" element={<PublicRdvEntry view="landing" />} />
                                <Route path="/rdv/:structureSlug/services" element={<PublicRdvEntry view="services" />} />
                                <Route path="/rdv/:structureSlug/creneaux" element={<PublicRdvEntry view="creneaux" />} />
                                <Route path="/rdv/:structureSlug/booking" element={<PublicBooking />} />

                                {/* Legacy Admin Redirects */}
                                <Route path="/adminaides" element={<Navigate to="/admin/aides" replace />} />
                                <Route path="/adminstructures" element={<Navigate to="/admin/structures" replace />} />
                                <Route path="/adminappointments" element={<Navigate to="/admin/appointments" replace />} />
                                <Route path="/admindemarches" element={<Navigate to="/admin/demarches" replace />} />

                                <Route path="/aidedetail" element={<AideLegacyLink />} />
                                <Route path="/aide/view" element={<AideLegacyLink />} />
                                <Route path="/aides/view" element={<LegacyViewRedirect basePath="/aides" />} />
                                <Route path="/aide/:slug" element={<LegacyAideRedirect />} />
                                <Route path="/aides/theme/:categorySlug/:territorySlug" element={<Aides />} />
                                <Route path="/aides/theme/:categorySlug" element={<Aides />} />
                                <Route path="/aides/:slug" element={<AideDetail />} />
                                <Route path="/aides" element={<Aides />} />
                                <Route path="/recherche" element={<Recherche />} />
                                <Route path="/trouver-aide" element={<RechercheAide />} />
                                <Route path="/categories/:slug" element={<Aides />} />
                                <Route path="/situations/:slug" element={<SituationRedirect />} />
                                <Route path="/glossaire" element={<Glossaire />} />
                                <Route path="/besoins" element={<Besoins />} />

                                <Route path="/structures" element={<Annuaire />} />
                                <Route path="/annuaire" element={<Navigate to="/structures" replace />} />
                                <Route path="/annuaire/:slug" element={<AnnuaireSlugRedirect />} />
                                <Route path="/structures/view" element={<LegacyViewRedirect basePath="/structures" />} />
                                <Route path="/structures/:slug" element={<StructureDetail />} />

                                <Route path="/politique-confidentialite" element={<Confidentialite />} />
                                <Route path="/confidentialite" element={<Navigate to="/politique-confidentialite" replace />} />
                                <Route path="/contact" element={<Contact />} />
                                <Route path="/demande-aide" element={<DemandeAide />} />
                                <Route path="/institution" element={<InstitutionEspace />} />
                                <Route path="/institution/mot-de-passe-oublie" element={<InstitutionForgot />} />
                                <Route path="/institution/reinitialiser" element={<InstitutionReset />} />
                                <Route path="/cookies" element={<Cookies />} />
                                <Route path="/demarches/view" element={<LegacyViewRedirect basePath="/demarches" />} />
                                <Route path="/demarches/:slug" element={<DemarcheDetail />} />

                                {/* Legacy alias — canonical route is /pro/login */}
                                <Route path="/login/pro" element={<Navigate to="/pro/login" replace />} />

                                <Route path="/orientation" element={<Orientation />} />
                                <Route path="/demarches" element={<Demarches />} />
                                <Route path="/home" element={<Navigate to="/" replace />} />
                                <Route path="/mentions-legales" element={<MentionsLegales />} />
                                <Route path="/cgu" element={<CGU />} />
                                <Route path="/conditions-generales" element={<Navigate to="/cgu" replace />} />
                                <Route path="/sourcesmethode" element={<SourcesMethode />} />
                                <Route path="/sentry-test" element={<Navigate to="/" replace />} />{/* owner usefulness pass: a developer error-trigger page (English) was public; /__sentry_test stays behind the diagnostics flag */}
                                <Route path="/r/messages" element={<LegacyAppointmentLink kind="messages" />} />
                                <Route path="/r/:token/messages" element={<LegacyAppointmentLink kind="messages" />} />
                                <Route path="/bonnes-pratiques" element={<Guides />} />
                                <Route path="/bonnes-pratiques/:slug" element={<GuideDetail />} />
                                <Route path="/outils" element={<Tools />} />
                                <Route path="/outils/:slug" element={<ToolDetail />} />
                                <Route path="/dispositifs" element={<Dispositifs />} />
                                <Route path="/dispositifs/:slug" element={<DispositifDetail />} />
                                <Route path="/dispositifs/view" element={<DispositifDetail />} />

                                <Route path="/ressources" element={<Ressources />} />
                                <Route path="/ressources/:slug" element={<RessourceDetail />} />
                                <Route path="/ressources/view" element={<RessourceDetail />} />

                                <Route path="/impact" element={<Impact />} />
                                <Route path="/notre-mission" element={<Mission />} />
                                <Route path="/notre-methode" element={<Method />} />
                                <Route path="/sources" element={<Sources />} />
                                <Route path="/securite-et-rgpd" element={<Security />} />
                                <Route path="/partenaires" element={<Partners />} />
                                <Route path="/proposer-une-structure" element={<RouteErrorBoundary><SuggestStructure /></RouteErrorBoundary>} />
                                <Route path="/status" element={<Status />} />
                                <Route path="/territoire" element={<TerritoireCouvert />} />
                                <Route path="/diagnostic" element={<DiagnosticPage />} />

                                {/* Styleguide */}
                                <Route path="/styleguide/branding" element={<Navigate to="/" replace />} />{/* internal design page, not for the public */}

                                <Route path="/AideDetail" element={<Navigate to="/aidedetail" replace />} />
                                <Route path="/StructureDetail" element={<Navigate to="/annuaire" replace />} />
                                <Route path="/structuredetail" element={<Navigate to="/annuaire" replace />} />
                                <Route path="/DemarcheDetail" element={<Navigate to="/demarches" replace />} />
                                <Route path="/demarchedetail" element={<Navigate to="/demarches" replace />} />
                                <Route path="/Annuaire" element={<Navigate to="/annuaire" replace />} />
                                <Route path="/Aides" element={<Navigate to="/aides" replace />} />

                                {/* Phase 1: /assistant redirect → /orientation */}
                                <Route path="/assistant" element={<Navigate to="/orientation" replace />} />

                                {/* P0.5: /mon-assistant → redirect to /orientation */}
                                <Route path="/mon-assistant" element={<Navigate to="/orientation" replace />} />


                                <Route path="*" element={<ServiceError code={404} />} />
                            </Routes>
                        </m.div>
                    </AnimatePresence>
                </LazyMotion>
            </Layout>
        </Suspense>
    );
}

export default function Pages(/** @type {{ url: unknown }} */ { url }) {
    const isServer = typeof window === 'undefined' || url !== undefined;
    if (isServer) {
        return (
            <MemoryRouter initialEntries={[url || '/']}>
                <PagesContent />
            </MemoryRouter>
        );
    }
    return (
        <BrowserRouter>
            <ScrollToTop />
            <RouteFocus />
            <PagesContent />
        </BrowserRouter>
    );
}
