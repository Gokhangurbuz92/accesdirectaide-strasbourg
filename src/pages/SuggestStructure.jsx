
import { useEffect, useRef, useState } from 'react';
import SEO from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { getCsrfHeaders } from '@/lib/csrf';
import {
    Building2,
    MapPin,
    Mail,
    Phone,
    CheckCircle2,
    AlertCircle,
    ArrowRight,
    ArrowLeft,
    Info,
    Globe,
    Users,
    Clock,
    Search,
    ExternalLink,
    ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import i18n, { useT } from '@/i18n';
import { ErrorSummary, FieldError } from '@/components/forms/FieldErrors';
import { fieldA11y, looksLikeEmail, plainLabel, withoutError } from '@/lib/fieldErrors';

// R42 (A5): the fields checked on each step, in reading order
const STEP_FIELDS = [['name'], ['address', 'zipCode', 'city', 'email'], ['consent']];
import { Trans } from 'react-i18next';

/** French text inside any interface language: the server's own message */
const FR = { lang: 'fr', dir: 'ltr' };

/**
 * SuggestStructure — Formulaire multi-étapes premium
 * Permet aux citoyens de proposer une structure d'aide sociale.
 * 3 étapes : Identité → Contact → Missions
 * R40: the screen is in the interface language (namespace `structures`, `suggest.*`); the proposal itself is sent with French field names
 * (it is read by a French moderator), and a message written by the server is shown as it is (French, lang="fr").
 */

const STEPS = [
    { id: 'identity', icon: Building2 },
    { id: 'location', icon: MapPin },
    { id: 'details', icon: Info },
];

export default function SuggestStructure() {
    const { t } = useT('structures');
    /** @type {Record<string, string>} */
    const STEP_TITLES = { identity: t('structures:suggest.step_identity', 'Identité'), location: t('structures:suggest.step_contact', 'Contact'), details: t('structures:suggest.step_missions', 'Missions') };
    const [currentStep, setCurrentStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState(/** @type {{ text: string, fr?: boolean } | null} */ (null));

    const [formData, setFormData] = useState({
        name: '',
        type: 'public',
        siret: '',
        address: '',
        city: '',
        zipCode: '',
        email: '',
        phone: '',
        website: '',
        description: '',
        publics: '',
        openingHours: '',
        consent: false,
    });

    const [fieldErrors, setFieldErrors] = useState(/** @type {Record<string, string>} */ ({}));
    const [attempt, setAttempt] = useState(0);
    const summaryRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    useEffect(() => { if (attempt) summaryRef.current?.focus(); }, [attempt]);

    const updateField = (/** @type {string} */ field, /** @type {string} */ value) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setFieldErrors((prev) => withoutError(prev, field));
        if (error) setError(null);
    };

    /** the errors of one step (R42, A5): one message per field, in the interface language @param {number} step */
    const stepErrors = (step) => {
        const required = (/** @type {string} */ label) => t('common:form.errors.required', '{{label}} : ce champ est obligatoire.', { label: plainLabel(label) });
        /** @type {Record<string, string>} */
        const errs = {};
        if (step === 0 && !formData.name.trim()) errs.name = required(t('structures:suggest.name', 'Nom de la structure *'));
        if (step === 1) {
            if (!formData.address.trim()) errs.address = required(t('structures:suggest.address', 'Adresse postale complète *'));
            if (!formData.zipCode.trim()) errs.zipCode = required(t('structures:suggest.zip', 'Code Postal *'));
            if (!formData.city.trim()) errs.city = required(t('structures:suggest.city', 'Ville *'));
            if (formData.email.trim() && !looksLikeEmail(formData.email)) errs.email = t('common:form.errors.email', '{{label}} : saisissez une adresse e-mail valide, par exemple nom@exemple.fr.', { label: plainLabel(t('structures:suggest.email', 'Email')) });
        }
        if (step === 2 && !formData.consent) errs.consent = t('structures:suggest.error_consent', 'Cochez la case d’accord pour envoyer la proposition.');
        return errs;
    };
    /** check the steps up to `last`; on an error, show that step with its errors and move the focus to the summary @param {number} last */
    const checkSteps = (last) => {
        for (let step = 0; step <= last; step += 1) {
            const errs = stepErrors(step);
            if (Object.keys(errs).length) { setCurrentStep(step); setFieldErrors(errs); setAttempt((n) => n + 1); return false; }
        }
        setFieldErrors({});
        return true;
    };

    const nextStep = () => {
        if (currentStep < STEPS.length - 1) setCurrentStep((prev) => prev + 1);
    };

    const prevStep = () => {
        if (currentStep > 0) setCurrentStep((prev) => prev - 1);
    };

    const handleSubmit = async (/** @type {{ preventDefault: () => void; }} */ e) => {
        e.preventDefault();
        if (!checkSteps(currentStep)) return;
        if (currentStep < STEPS.length - 1) {
            nextStep();
            return;
        }

        // owner usefulness pass (2026-10-25): the form sent « name » and no consent while the server (api/_utils/schemas.js suggestStructureSchema)
        // requires « structureName », « city » and « consent » — every proposal was refused and shown as an outage. The payload now matches the server;
        // the other details travel in « message »; the server's own message is shown.
        if (!checkSteps(STEPS.length - 1)) return;   // R42: every step again (name, city, consent are what the server requires)
        const website = formData.website.trim() && !/^https?:\/\//i.test(formData.website.trim()) ? `https://${formData.website.trim()}` : formData.website.trim();
        const details = [['SIRET', formData.siret], ['Adresse', formData.address], ['Code postal', formData.zipCode], ['Téléphone', formData.phone],
            ['Missions', formData.description], ['Publics', formData.publics], ['Horaires', formData.openingHours]].filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k} : ${String(v).trim()}`).join('\n');
        setLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/public/suggest-structure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
                body: JSON.stringify({ structureName: formData.name.trim(), city: formData.city.trim(), type: formData.type, website, email: formData.email.trim(), message: details.slice(0, 2000), consent: true, honeypot: '' }),
            });

            if (!response.ok) {
                const data = /** @type {{ message?: string }} */ (await response.json().catch(() => ({})));
                setError(data.message ? { text: data.message, fr: true } : { text: response.status === 400 ? t('structures:suggest.error_invalid', 'Certaines informations ne sont pas valides : vérifiez le site web et l’adresse e-mail.') : t('structures:suggest.error_unavailable', 'Le service est momentanément indisponible. Veuillez réessayer ultérieurement.') });
                return;
            }

            setSuccess(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            if (import.meta.env.DEV) console.error('[SuggestStructure]', err);
            setError({ text: t('structures:suggest.error_unavailable', 'Le service est momentanément indisponible. Veuillez réessayer ultérieurement.') });
        } finally {
            setLoading(false);
        }
    };

    /* ── Écran de succès ────────────────────────────── */
    if (success) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center p-6 bg-slate-50/30">
                <SEO title={t('structures:suggest.success_meta_title', 'Merci — Structure proposée')} description={t('structures:suggest.success_meta_description', 'Votre suggestion a été envoyée')} path="/proposer-une-structure" />
                <div className="max-w-md w-full text-center space-y-8">
                    <div className="relative inline-block">
                        <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto ring-8 ring-emerald-50">
                            <CheckCircle2 size={48} aria-hidden="true" />
                        </div>
                        <div className="absolute -bottom-2 -end-2 bg-white p-2 rounded-full shadow-lg border border-emerald-100">
                            <ShieldCheck className="text-emerald-500 w-5 h-5" aria-hidden="true" />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h1 className="text-4xl font-black text-slate-900 tracking-tight">{t('structures:suggest.success_title', 'C’est envoyé !')}</h1>
                        <p className="text-lg text-slate-600 leading-relaxed">
                            {t('structures:suggest.success_text', "Votre contribution est précieuse. Un modérateur va vérifier les informations avant la publication dans l'annuaire.")}
                        </p>
                    </div>
                    <div className="pt-4 space-y-3">
                        <Button onClick={() => (window.location.href = '/')} className="w-full h-12 bg-slate-900 rounded-xl font-bold">
                            {t('structures:suggest.success_home', "Retour à l'accueil")}
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setSuccess(false);
                                setCurrentStep(0);
                            }}
                            className="w-full text-indigo-600"
                        >
                            {t('structures:suggest.success_again', 'Faire une autre suggestion')}
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    /* ── Formulaire multi-étapes ────────────────────── */
    return (
        <div className="min-h-screen bg-[#fbfcfd] py-16 px-4">
            <SEO title={t('structures:suggest.title', 'Proposer une structure')} description={t('structures:suggest.meta_description', "Aidez les citoyens en référençant un CCAS, une association ou un service public dans l'annuaire.")} path="/proposer-une-structure" />

            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-12 text-center space-y-4">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm font-bold tracking-wide mb-2 uppercase">
                        <Search size={14} aria-hidden="true" />
                        <span>{t('structures:suggest.badge', "Enrichir l'annuaire")}</span>
                    </div>
                    <h1 className="text-5xl font-black text-slate-900 tracking-tight lg:text-6xl">{t('structures:suggest.title', 'Proposer une structure')}</h1>
                    <p className="text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">
                        {t('structures:suggest.intro', 'Aidez les citoyens à trouver le bon interlocuteur en référençant un CCAS, une association ou un service public.')}
                    </p>
                </div>

                {/* Stepper */}
                <div className="mb-12 relative flex justify-between max-w-2xl mx-auto">
                    <div className="absolute top-1/2 start-0 w-full h-0.5 bg-slate-100 -translate-y-1/2 z-0" />
                    {STEPS.map((step, idx) => {
                        const Icon = step.icon;
                        const isActive = idx === currentStep;
                        const isCompleted = idx < currentStep;
                        return (
                            <div key={step.id} className="relative z-10 flex flex-col items-center gap-3 group">
                                <div
                                    className={cn(
                                        'w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 border-2',
                                        isActive
                                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-100 scale-110'
                                            : isCompleted
                                              ? 'bg-emerald-500 border-emerald-500 text-white'
                                              : 'bg-white border-slate-200 text-slate-400 group-hover:border-slate-300',
                                    )}
                                >
                                    {isCompleted ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                                </div>
                                <span className={cn('text-xs font-bold uppercase tracking-widest', isActive ? 'text-indigo-600' : 'text-slate-600')}>
                                    {STEP_TITLES[step.id]}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Error */}
                {error && (
                    <Alert variant="destructive" className="mb-8 rounded-2xl bg-red-50 border-red-100">
                        <AlertCircle className="h-5 w-5" aria-hidden="true" />
                        <AlertTitle>{t('structures:suggest.error_title', "Erreur d'envoi")}</AlertTitle>
                        <AlertDescription><span {...(error.fr ? FR : {})}>{error.text}</span></AlertDescription>
                    </Alert>
                )}

                {/* Form Card */}
                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden transition-all duration-500">
                    <div className="p-8 md:p-14">
                        <form onSubmit={handleSubmit} noValidate className="space-y-10">
                            <ErrorSummary ref={summaryRef} errors={fieldErrors} order={STEP_FIELDS[currentStep]} testid="suggest-error-summary" />
                            {/* STEP 1 — Identité */}
                            {currentStep === 0 && (
                                <div className="space-y-8">
                                    <div className="flex items-center gap-3 pb-4 border-b border-slate-50">
                                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                            <Building2 size={24} />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-slate-900">{t('structures:suggest.identity_title', 'Informations de base')}</h2>
                                            <p className="text-sm text-slate-500">{t('structures:suggest.identity_intro', 'Identifiez la structure légalement')}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <Label htmlFor="name" className="text-slate-700 font-semibold">
                                                {t('structures:suggest.name', 'Nom de la structure *')}
                                            </Label>
                                            <Input
                                                id="name"
                                                value={formData.name}
                                                onChange={(e) => updateField('name', e.target.value)}
                                                placeholder={t('structures:suggest.name_placeholder', 'ex: CCAS de Lyon')}
                                                required
                                                {...fieldA11y('name', fieldErrors)}
                                                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                                            />
                                            <FieldError field="name" errors={fieldErrors} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="type" className="text-slate-700 font-semibold">
                                                {t('structures:suggest.type', "Type d'établissement")}
                                            </Label>
                                            <select
                                                id="type"
                                                value={formData.type}
                                                onChange={(e) => updateField('type', e.target.value)}
                                                className="w-full h-12 px-4 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all"
                                            >
                                                <option value="public">{t('structures:suggest.type_public', 'Public (CCAS, Mairie...)')}</option>
                                                <option value="association">{t('structures:suggest.type_association', 'Association')}</option>
                                                <option value="fondation">{t('structures:suggest.type_foundation', 'Fondation / Autre')}</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2 md:col-span-2">
                                            <Label htmlFor="siret" className="text-slate-700 font-semibold">
                                                {t('structures:suggest.siret', 'Numéro SIRET (optionnel)')}
                                            </Label>
                                            <Input
                                                id="siret"
                                                value={formData.siret}
                                                onChange={(e) => updateField('siret', e.target.value)}
                                                placeholder={t('structures:suggest.siret_placeholder', '14 chiffres pour une identification précise')}
                                                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STEP 2 — Contact & Localisation */}
                            {currentStep === 1 && (
                                <div className="space-y-8">
                                    <div className="flex items-center gap-3 pb-4 border-b border-slate-50">
                                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                            <MapPin size={24} />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-slate-900">{t('structures:suggest.contact_title', 'Contact et Accès')}</h2>
                                            <p className="text-sm text-slate-500">{t('structures:suggest.contact_intro', 'Où se situe la structure ?')}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <Label htmlFor="address" className="text-slate-700 font-semibold">
                                                {t('structures:suggest.address', 'Adresse postale complète *')}
                                            </Label>
                                            <Input
                                                id="address"
                                                value={formData.address}
                                                onChange={(e) => updateField('address', e.target.value)}
                                                placeholder={t('structures:suggest.address_placeholder', 'Numéro et nom de rue')}
                                                required
                                                {...fieldA11y('address', fieldErrors)}
                                                className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                            />
                                            <FieldError field="address" errors={fieldErrors} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <Label htmlFor="zipCode" className="text-slate-700 font-semibold">
                                                    {t('structures:suggest.zip', 'Code Postal *')}
                                                </Label>
                                                <Input
                                                    id="zipCode"
                                                    value={formData.zipCode}
                                                    onChange={(e) => updateField('zipCode', e.target.value)}
                                                    placeholder="75001"
                                                    required
                                                    {...fieldA11y('zipCode', fieldErrors)}
                                                    className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                                />
                                                <FieldError field="zipCode" errors={fieldErrors} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="city" className="text-slate-700 font-semibold">
                                                    {t('structures:suggest.city', 'Ville *')}
                                                </Label>
                                                <Input
                                                    id="city"
                                                    value={formData.city}
                                                    onChange={(e) => updateField('city', e.target.value)}
                                                    placeholder="Paris"
                                                    required
                                                    {...fieldA11y('city', fieldErrors)}
                                                    className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                                />
                                                <FieldError field="city" errors={fieldErrors} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="email" className="text-slate-700 font-semibold flex items-center gap-2">
                                                    <Mail size={14} className="text-slate-400" />
                                                    {t('structures:suggest.email', 'Email')}
                                                </Label>
                                                <Input
                                                    id="email"
                                                    type="email"
                                                    value={formData.email}
                                                    onChange={(e) => updateField('email', e.target.value)}
                                                    placeholder="contact@structure.fr"
                                                    {...fieldA11y('email', fieldErrors)}
                                                    className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                                />
                                                <FieldError field="email" errors={fieldErrors} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="phone" className="text-slate-700 font-semibold flex items-center gap-2">
                                                    <Phone size={14} className="text-slate-400" />
                                                    {t('structures:suggest.phone', 'Téléphone')}
                                                </Label>
                                                <Input
                                                    id="phone"
                                                    value={formData.phone}
                                                    onChange={(e) => updateField('phone', e.target.value)}
                                                    placeholder="04 XX XX XX XX"
                                                    className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2 pt-2">
                                            <Label htmlFor="website" className="text-slate-700 font-semibold flex items-center gap-2">
                                                <Globe size={14} className="text-slate-400" />
                                                {t('structures:suggest.website', 'Site internet')}
                                            </Label>
                                            <Input
                                                id="website"
                                                value={formData.website}
                                                onChange={(e) => updateField('website', e.target.value)}
                                                placeholder={t('structures:suggest.website_placeholder', 'https://www.ma-structure.fr')}
                                                className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STEP 3 — Missions & Détails */}
                            {currentStep === 2 && (
                                <div className="space-y-8">
                                    <div className="flex items-center gap-3 pb-4 border-b border-slate-50">
                                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                            <Info size={24} />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-bold text-slate-900">{t('structures:suggest.missions_title', 'Missions et Publics')}</h2>
                                            <p className="text-sm text-slate-500">{t('structures:suggest.missions_intro', "Précisez les domaines d'intervention")}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div className="space-y-2">
                                            <Label htmlFor="description" className="text-slate-700 font-semibold flex items-center gap-2">
                                                <Clock size={14} className="text-slate-400" />
                                                {t('structures:suggest.description', 'Description des missions')}
                                            </Label>
                                            <textarea
                                                id="description"
                                                value={formData.description}
                                                onChange={(e) => updateField('description', e.target.value)}
                                                placeholder={t('structures:suggest.description_placeholder', 'Quels sont les services proposés par cette structure ?')}
                                                className="w-full min-h-[140px] rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div className="space-y-2">
                                                <Label htmlFor="publics" className="text-slate-700 font-semibold flex items-center gap-2">
                                                    <Users size={14} className="text-slate-400" />
                                                    {t('structures:suggest.publics', 'Publics accueillis')}
                                                </Label>
                                                <Input
                                                    id="publics"
                                                    value={formData.publics}
                                                    onChange={(e) => updateField('publics', e.target.value)}
                                                    placeholder={t('structures:suggest.publics_placeholder', 'Seniors, jeunes, familles...')}
                                                    className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="openingHours" className="text-slate-700 font-semibold flex items-center gap-2">
                                                    <Clock size={14} className="text-slate-400" />
                                                    {t('structures:suggest.hours', "Horaires d'ouverture")}
                                                </Label>
                                                <Input
                                                    id="openingHours"
                                                    value={formData.openingHours}
                                                    onChange={(e) => updateField('openingHours', e.target.value)}
                                                    placeholder={t('structures:suggest.hours_placeholder', 'ex: Lun-Ven 9h-17h')}
                                                    className="h-12 rounded-xl bg-slate-50 border-slate-200"
                                                />
                                            </div>
                                        </div>
                                        <label className="flex items-start gap-3 text-sm text-slate-800" data-testid="suggest-consent">
                                            <input id="consent" type="checkbox" className="mt-1 h-4 w-4" required {...fieldA11y('consent', fieldErrors)} checked={formData.consent} onChange={(e) => { const checked = e.target.checked; setFormData((prev) => ({ ...prev, consent: checked })); setFieldErrors((prev) => withoutError(prev, 'consent')); }} />
                                            <span><Trans i18n={i18n} i18nKey="structures:suggest.consent" defaults="J’accepte qu’ADA conserve ces informations pour étudier la proposition (voir la <0>politique de confidentialité</0>)." components={[<Link key="privacy" className="text-indigo-700 underline" to="/politique-confidentialite" />]} /></span>
                                        </label>
                                        <FieldError field="consent" errors={fieldErrors} />
                                    </div>
                                </div>
                            )}

                            {/* Action bar */}
                            <div className="pt-8 flex items-center justify-between gap-4 border-t border-slate-100">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={prevStep}
                                    disabled={currentStep === 0 || loading}
                                    className="h-12 px-6 rounded-xl text-slate-500 font-bold disabled:opacity-0"
                                >
                                    <ArrowLeft className="me-2 w-4 h-4 rtl:-scale-x-100" aria-hidden="true" /> {t('structures:suggest.back', 'Retour')}
                                </Button>

                                <Button
                                    type="submit"
                                    disabled={loading}
                                    className={cn(
                                        'h-14 px-10 rounded-2xl font-black text-lg transition-all shadow-lg group',
                                        currentStep === STEPS.length - 1
                                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                            : 'bg-slate-900 hover:bg-slate-800 text-white',
                                    )}
                                >
                                    {loading ? (
                                        <div className="flex items-center gap-2">
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            {t('structures:suggest.sending', 'Traitement...')}
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <span>{currentStep === STEPS.length - 1 ? t('structures:suggest.submit', 'Soumettre le dossier') : t('structures:suggest.continue', 'Continuer')}</span>
                                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform rtl:-scale-x-100 rtl:group-hover:-translate-x-1" aria-hidden="true" />
                                        </div>
                                    )}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Footer CTA */}
                <div className="mt-12 flex flex-col md:flex-row items-center justify-between p-6 bg-indigo-900 rounded-[2rem] text-white gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/10 rounded-2xl">
                            <Users className="w-6 h-6 text-indigo-300" />
                        </div>
                        <div className="text-start">
                            <p className="font-bold">{t('structures:suggest.pro_title', 'Vous travaillez dans cette structure ?')}</p>
                            <p className="text-indigo-200 text-sm">{t('structures:suggest.pro_text', 'Écrivez-nous pour obtenir la gestion de cette fiche (créer un compte pro ouvrirait une nouvelle structure).')}</p>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => (window.location.href = '/contact?sujet=partenariat')}
                        className="bg-transparent border-white/20 text-white hover:bg-white hover:text-indigo-900 rounded-xl px-6"
                    >
                        {t('structures:suggest.contact_us', 'Nous contacter')} <ExternalLink className="ms-2 w-4 h-4" aria-hidden="true" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
