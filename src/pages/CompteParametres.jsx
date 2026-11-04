// @ts-nocheck
import { SkeletonList } from '@/components/ui/skeleton';
import { useState, useMemo, useEffect } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    User, Bell, Shield, Accessibility, Database,
    Mail, Phone, CheckCircle, XCircle, ExternalLink,
    Download, Trash2, AlertTriangle, Eye,
    Sun, Type, Minus
} from 'lucide-react';

import SEO from '@/components/SEO';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { citizenApi } from '@/lib/citizenApi';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import { appendNext, normalizeNextPath } from '@/lib/rdvRouting';
import { csrfFetch } from '@/lib/csrf';
import { logoutOnServer } from '@/lib/citizenSession';
import { applyDeviceAccessibility } from '@/lib/accountAccessibility';
import { formatDate, useT } from '@/i18n';

// ─── Local Preferences helpers ────────────────────────────────
const PREFS_KEY = 'ada_citizen_prefs';

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch {
        return {};
    }
}

function savePrefs(/** @type {Record<string, string | number | boolean | null | undefined>} */ prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// ─── Tab Components ───────────────────────────────────────────

/** Launch-readiness item 66: change the e-mail address (password + confirmation link to the new address) and the phone number. */
function ContactChange({ user }) {
    const { t } = useT('compte');
    const [newEmail, setNewEmail] = useState('');
    const [password, setPassword] = useState('');
    const [phone, setPhone] = useState(user?.phone || '');
    const [emailMsg, setEmailMsg] = useState({ ok: true, text: '' });
    const [phoneMsg, setPhoneMsg] = useState({ ok: true, text: '' });
    const [busy, setBusy] = useState(false);
    const submitEmail = async (e) => {
        e.preventDefault(); setBusy(true); setEmailMsg({ ok: true, text: '' });
        try { const r = await citizenApi.requestEmailChange({ newEmail, password }); setEmailMsg({ ok: r.linkSent !== false, text: r.message }); setPassword(''); }
        catch (err) { setEmailMsg({ ok: false, text: err instanceof Error ? err.message : t('compte:settings.error_generic', 'Une erreur est survenue.') }); }
        finally { setBusy(false); }
    };
    const submitPhone = async (e, remove = false) => {
        e.preventDefault(); setBusy(true); setPhoneMsg({ ok: true, text: '' });
        try { await citizenApi.setPhone(remove ? null : phone); if (remove) setPhone(''); setPhoneMsg({ ok: true, text: remove ? t('compte:settings.phone_removed', 'Numéro supprimé.') : t('compte:settings.phone_saved', 'Numéro enregistré (non vérifié : aucun SMS ne vous est envoyé).') }); }
        catch (err) { setPhoneMsg({ ok: false, text: err instanceof Error ? err.message : t('compte:settings.error_generic', 'Une erreur est survenue.') }); }
        finally { setBusy(false); }
    };
    return (
        <div className="space-y-4" data-testid="contact-change">
            <form onSubmit={submitEmail} className="space-y-2 rounded-lg border bg-white p-4">
                <p className="text-sm font-medium text-slate-900">{t('compte:settings.changer_adresse_mail', 'Changer d’adresse e-mail')}</p>
                <Label htmlFor="cc-new-email">{t('compte:settings.nouvelle_adresse', 'Nouvelle adresse')}</Label>
                <Input id="cc-new-email" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                <Label htmlFor="cc-password">{t('compte:settings.mot_passe_actuel', 'Mot de passe actuel')}</Label>
                <Input id="cc-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="text-xs text-slate-700">{t('compte:settings.lien_confirmation_est_envoye', 'Un lien de confirmation est envoyé à la nouvelle adresse (valable 30 minutes) ; votre adresse actuelle est prévenue. Après la confirmation, reconnectez-vous.')}</p>
                <Button type="submit" disabled={busy} data-testid="cc-email-submit">{t('compte:settings.envoyer_lien_confirmation', 'Envoyer le lien de confirmation')}</Button>
                {emailMsg.text ? <p role="status" data-testid="cc-email-status" className={emailMsg.ok ? 'text-sm text-slate-900' : 'text-sm text-red-800'}>{emailMsg.text}</p> : null}
            </form>
            <form onSubmit={(e) => submitPhone(e)} className="space-y-2 rounded-lg border bg-white p-4">
                <p className="text-sm font-medium text-slate-900">{t('compte:settings.mon_numero_telephone', 'Mon numéro de téléphone')}</p>
                <Label htmlFor="cc-phone">{t('compte:settings.numero_facultatif', 'Numéro (facultatif)')}</Label>
                <Input id="cc-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" />
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy} data-testid="cc-phone-submit">{t('compte:settings.enregistrer_numero', 'Enregistrer le numéro')}</Button>
                    {user?.phone ? <Button type="button" variant="outline" disabled={busy} onClick={(e) => submitPhone(e, true)} data-testid="cc-phone-remove">{t('compte:settings.supprimer_numero', 'Supprimer le numéro')}</Button> : null}
                </div>
                {phoneMsg.text ? <p role="status" data-testid="cc-phone-status" className={phoneMsg.ok ? 'text-sm text-slate-900' : 'text-sm text-red-800'}>{phoneMsg.text}</p> : null}
            </form>
        </div>
    );
}

function ProfilTab({ user }) {
    const { t } = useT('compte');
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">{t('compte:settings.informations_compte', 'Informations du compte')}</h3>
                <div className="space-y-4">
                    {/* Email */}
                    <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                        <Mail className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-slate-500">{t('compte:settings.adresse_email', 'Adresse email')}</span>
                            <p className="text-sm font-semibold text-slate-900 break-all">{user?.email || '-'}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                                {user?.emailVerifiedAt ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                                        <CheckCircle className="h-3 w-3" />
                                        {t('compte:settings.verifie', 'Vérifié')}
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                        <XCircle className="h-3 w-3" />
                                        {t('compte:settings.non_verifie', 'Non vérifié')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Phone */}
                    <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                        <Phone className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium text-slate-500">{t('compte:settings.telephone', 'Téléphone')}</span>
                            <p className="text-sm font-semibold text-slate-900">
                                {user?.phone || <span className="text-slate-600 font-normal italic">{t('compte:settings.non_renseigne', 'Non renseigné')}</span>}
                            </p>
                        </div>
                    </div>

                    {/* Account dates */}
                    <div className="p-4 rounded-lg border bg-slate-50 text-sm text-slate-600 space-y-1">
                        <p>{t('compte:settings.compte_cree', 'Compte créé le :')} <span className="font-medium">{user?.createdAt ? formatDate(user.createdAt, { dateStyle: 'short' }) : '-'}</span></p>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                <p className="font-medium mb-1"><Link to="/compte/profil" className="underline" data-testid="link-compte-profil">{t('compte:settings.gerer_mon_profil_mon', 'Gérer mon profil, mon foyer, mes notifications et mes dossiers partagés')}</Link></p>
            </div>

            <ContactChange user={user} />
        </div>
    );
}

function NotificationsTab() {
    const { t } = useT('compte');
    // PKG-11 audit: these switches used to be saved only in this browser (switching e-mails off stopped nothing; switching SMS or the newsletter on recorded no
    // consent). The real, server-side preferences — with the consent they need — are on the profile page.
    return (
        <div className="space-y-4" data-testid="compte-notifications-pointer">
            <h3 className="text-lg font-semibold">{t('compte:settings.preferences_notification', 'Préférences de notification')}</h3>
            <p className="text-sm text-slate-700">
                {t('compte:settings.vos_choix_notification_mail', 'Vos choix de notification (e-mail, SMS, rappels) sont enregistrés sur votre compte, avec votre consentement quand il est nécessaire. Ils se règlent sur la page de votre profil.')}
            </p>
            <Link to="/compte/profil" className="inline-flex min-h-[44px] items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 underline">
                {t('compte:settings.gerer_mes_notifications', 'Gérer mes notifications')}
            </Link>
        </div>
    );
}

function SecurityTab({ user }) {
    const { t } = useT('compte');
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">{t('compte:settings.securite_compte', 'Sécurité du compte')}</h3>
                <div className="space-y-4">
                    {/* Email verification */}
                    <div className="flex items-start gap-4 p-4 rounded-lg border bg-white">
                        <Mail className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <span className="text-sm font-medium">{t('compte:settings.email_verifie', 'Email vérifié')}</span>
                            <div className="mt-1">
                                {user?.emailVerifiedAt ? (
                                    <span className="inline-flex items-center gap-1.5 text-sm text-green-700">
                                        <CheckCircle className="h-4 w-4" />
                                        {t('compte:settings.verified_on', 'Vérifié le {{date}}', { date: formatDate(user.emailVerifiedAt, { dateStyle: 'short' }) })}
                                    </span>
                                ) : (
                                    <div className="space-y-2">
                                        <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
                                            <AlertTriangle className="h-4 w-4" />
                                            {t('compte:settings.non_verifie', 'Non vérifié')}
                                        </span>
                                        <p className="text-xs text-slate-500">
                                            {t('compte:settings.verifiez_votre_boite_mail', 'Vérifiez votre boîte mail pour le lien de confirmation.')}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Password */}
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <Shield className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <span className="text-sm font-medium">{t('compte:settings.mot_passe', 'Mot de passe')}</span>
                                <p className="text-xs text-slate-500 mt-0.5">{t('compte:settings.modifiez_votre_mot_passe', 'Modifiez votre mot de passe régulièrement')}</p>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                            <Link to="/auth/forgot">
                                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                {t('compte:settings.modifier', 'Modifier')}
                            </Link>
                        </Button>
                    </div>

                    {/* Sessions */}
                    <div className="p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4 mb-3">
                            <Eye className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium">{t('compte:settings.sessions', 'Sessions')}</span>
                                {/* R18: the panel claimed to list the connected devices but only showed this browser; what the server really does is said instead */}
                                <p className="text-xs text-slate-700 mt-0.5">{t('compte:settings.logout_all_before', 'Se déconnecter met fin à votre session sur')} <strong>{t('compte:settings.logout_all_strong', 'tous')}</strong> {t('compte:settings.logout_all_after', 'les appareils où vous êtes connecté·e (téléphone, ordinateur partagé…).')}</p>
                            </div>
                        </div>
                        <div className="ml-9 flex flex-wrap items-center gap-3 p-3 bg-slate-50 rounded text-sm text-slate-700">
                            <span>{t('compte:settings.cet_appareil', 'Cet appareil —')} {typeof navigator !== 'undefined' ? navigator.userAgent.split('(')[1]?.split(')')[0] || t('compte:settings.browser', 'Navigateur') : t('compte:settings.browser', 'Navigateur')}</span>
                            <Button type="button" variant="outline" size="sm" className="min-h-11" data-testid="compte-logout-everywhere" onClick={async () => { if (await logoutOnServer()) window.location.assign('/auth/login'); }}>{t('compte:settings.deconnecter_partout', 'Me déconnecter partout')}</Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AccessibilityTab() {
    const { t } = useT('compte');
    const [prefs, setPrefs] = useState(() => {
        const saved = loadPrefs();
        return {
            fontSize: saved.fontSize ?? 100,
            reduceMotion: saved.reduceMotion ?? false,
            highContrast: saved.highContrast ?? false,
        };
    });

    const handleChange = (/** @type {string} */ key, value) => {
        setPrefs(prev => {
            const next = { ...prev, [key]: value };
            savePrefs(next);

            // Apply immediately
            if (key === 'fontSize' || key === 'highContrast') {
                applyDeviceAccessibility({ [key]: value });   // K0 / C04: the same settings the whole site applies (survives a reload)
                document.documentElement.style.fontSize = `${key === 'fontSize' ? value : (next.fontSize ?? 100)}%`;
            }
            if (key === 'reduceMotion') {
                document.body.classList.toggle('reduce-motion', value);
            }
            if (key === 'highContrast') {
                document.body.classList.toggle('high-contrast', value);
            }

            return next;
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">{t('compte:settings.preferences_accessibilite', 'Préférences d\'accessibilité')}</h3>
                <div className="space-y-4">
                    {/* Font Size */}
                    <div className="p-4 rounded-lg border bg-white">
                        <div className="flex items-center gap-4 mb-3">
                            <Type className="h-5 w-5 text-blue-500 flex-shrink-0" />
                            <div>
                                <span className="text-sm font-medium">{t('compte:settings.taille_texte', 'Taille du texte')}</span>
                                <p className="text-xs text-slate-500 mt-0.5">{t('compte:settings.font_size_hint', 'Ajuster la taille de l’interface ({{size}} %)', { size: prefs.fontSize })}</p>
                            </div>
                        </div>
                        <div className="ml-9 flex items-center gap-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleChange('fontSize', Math.max(80, prefs.fontSize - 10))}
                                disabled={prefs.fontSize <= 80}
                            >
                                <Minus className="h-4 w-4" />
                            </Button>
                            <div className="flex-1 bg-slate-100 rounded-full h-2">
                                <div
                                    className="bg-blue-500 rounded-full h-2 transition-all"
                                    style={{ width: `${((prefs.fontSize - 80) / 60) * 100}%` }}
                                />
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleChange('fontSize', Math.min(140, prefs.fontSize + 10))}
                                disabled={prefs.fontSize >= 140}
                            >
                                <Type className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Reduce Motion */}
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <Minus className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <Label htmlFor="sw-reduce-motion" className="text-sm font-medium">{t('compte:settings.reduire_les_animations', 'Réduire les animations')}</Label>
                                <p className="text-xs text-slate-500 mt-0.5">{t('compte:settings.desactiver_les_transitions_effets', 'Désactiver les transitions et effets visuels')}</p>
                            </div>
                        </div>
                        <Switch
                            id="sw-reduce-motion"
                            checked={prefs.reduceMotion}
                            onCheckedChange={(v) => handleChange('reduceMotion', v)}
                        />
                    </div>

                    {/* High Contrast */}
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <Sun className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <Label htmlFor="sw-high-contrast" className="text-sm font-medium">{t('compte:settings.contraste_eleve', 'Contraste élevé')}</Label>
                                <p className="text-xs text-slate-500 mt-0.5">{t('compte:settings.augmenter_contraste_des_couleurs', 'Augmenter le contraste des couleurs')}</p>
                            </div>
                        </div>
                        <Switch
                            id="sw-high-contrast"
                            checked={prefs.highContrast}
                            onCheckedChange={(v) => handleChange('highContrast', v)}
                        />
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                <p>{t('compte:settings.a11y_panel_before', '💡 Vous pouvez aussi utiliser le')} <strong>{t('compte:settings.a11y_panel_strong', 'panneau d\'accessibilité')}</strong> {t('compte:settings.a11y_panel_after', 'dans le header (bouton « Accessibilité ») pour des contrôles rapides.')}</p>
            </div>
        </div>
    );
}

/** PKG-11 / C21 — restriction of processing (RGPD art. 18): applies at once; the person lifts it whenever they want; ADA informs them before lifting it. */
const restrictionGrounds = (t) => [
    ['ACCURACY_CONTESTED', t('compte:settings.ground.accuracy', 'Je conteste l’exactitude de mes données (le temps de vérifier)')],
    ['UNLAWFUL_PROCESSING', t('compte:settings.ground.unlawful', 'Le traitement me semble illicite, mais je ne veux pas que mes données soient effacées')],
    ['LEGAL_CLAIMS', t('compte:settings.ground.legal_claims', 'J’ai besoin que mes données soient conservées pour faire valoir un droit en justice')],
    ['OBJECTION_PENDING', t('compte:settings.ground.objection', 'Je me suis opposé·e au traitement et j’attends la réponse')],
];
function RestrictionPanel() {
    const { t } = useT('compte');
    const [state, setState] = useState(null); const [ground, setGround] = useState(''); const [msg, setMsg] = useState(''); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
    // R18: an unreadable state is said and nothing is offered on top of it (the request form showed as if no restriction were active)
    const [loadFailed, setLoadFailed] = useState(false);
    const load = () => fetch('/api/citizen/restriction', { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then((d) => { setLoadFailed(false); setState(d); }).catch(() => { setLoadFailed(true); setState(null); });
    useEffect(() => { load(); }, []);
    const act = async (body, ok) => {
        setBusy(true); setMsg(''); setProblem('');
        try {
            const res = await csrfFetch('/api/citizen/restriction', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) { setProblem(d.message || t('compte:settings.request_not_saved', 'La demande n’a pas pu être enregistrée.')); return; }
            setMsg(ok); await load();
        } catch { setProblem(t('compte:settings.request_not_sent', 'La demande n’a pas pu être envoyée.')); } finally { setBusy(false); }
    };
    const active = state?.restriction;
    return (
        <div className="p-4 rounded-lg border border-slate-300" data-testid="compte-restriction">
            <span className="text-sm font-medium text-slate-900">{t('compte:settings.limiter_utilisation_mes_donnees', 'Limiter l’utilisation de mes données (RGPD, article 18)')}</span>
            <p className="text-xs text-slate-700 mt-1">{t('compte:settings.vos_donnees_sont_alors', 'Vos données sont alors seulement conservées : aucune structure ne peut ouvrir vos dossiers, rien n’est partagé, vous ne recevez plus de notification et rien n’est effacé automatiquement. Vous gardez vos droits (consulter, exporter, demander l’effacement).')}</p>
            <p role="status" aria-live="polite" data-testid="compte-restriction-status" className="text-xs text-slate-900 mt-2">{msg}</p>
            {problem ? <p role="alert" className="text-xs text-red-800 mt-1">{problem}</p> : null}
            {loadFailed ? (
                <div className="mt-2" role="alert" data-testid="compte-restriction-load-error">
                    <p className="text-sm text-red-800">{t('compte:settings.etat_limitation_pas_etre', 'L’état de la limitation n’a pas pu être lu.')}</p>
                    <Button type="button" variant="outline" size="sm" className="mt-1 min-h-11" onClick={load}>{t('compte:settings.reessayer', 'Réessayer')}</Button>
                </div>
            ) : active ? (
                <div className="mt-2 space-y-2">
                    <p className="text-sm text-slate-900" data-testid="compte-restriction-active">{t('compte:settings.restriction_since', 'Limitation en cours depuis le {{date}}.', { date: formatDate(active.since, { dateStyle: 'short' }) })}</p>
                    <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => act({ action: 'lift' }, t('compte:settings.restriction_lifted', 'Limitation levée : les structures auxquelles vous aviez donné accès retrouvent cet accès.'))}>{t('compte:settings.lever_limitation', 'Lever la limitation')}</Button>
                </div>
            ) : (
                <fieldset className="mt-2 space-y-2">
                    <legend className="text-sm text-slate-900">{t('compte:settings.pourquoi_demandez_vous_limitation', 'Pourquoi demandez-vous la limitation ?')}</legend>
                    {restrictionGrounds(t).map(([code, label]) => (
                        <label key={code} className="flex min-h-11 items-start gap-2 text-sm text-slate-900">
                            <input type="radio" name="restriction-ground" value={code} checked={ground === code} onChange={() => setGround(code)} className="mt-1 h-5 w-5" />{label}
                        </label>
                    ))}
                    {state?.lastLifted ? <p className="text-xs text-slate-700">{t('compte:settings.last_lifted', 'Dernière limitation levée le {{date}} par {{by}}', { date: formatDate(state.lastLifted.at, { dateStyle: 'short' }), by: state.lastLifted.by })}{state.lastLifted.reason ? ` : « ${state.lastLifted.reason} »` : ''}.</p> : null}
                    <Button type="button" size="sm" className="min-h-11" disabled={busy || !ground} onClick={() => act({ action: 'request', ground }, t('compte:settings.restriction_active', 'Limitation en place : vos données sont seulement conservées.'))}>{t('compte:settings.demander_limitation', 'Demander la limitation')}</Button>
                </fieldset>
            )}
        </div>
    );
}

function DataTab() {
    const { t } = useT('compte');
    const [deletionRequest, setDeletionRequest] = useState(null);
    // PKG-11 / C21: the state of the latest erasure request is read from the server (in review, refused with its reason, blocked by a legal hold)
    useEffect(() => {
        let alive = true;
        fetch('/api/auth/delete-account', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.request) setDeletionRequest(d.request); }).catch(() => undefined);
        return () => { alive = false; };
    }, []);   // K0: the server QUEUES an erasure request for review (202); the screen says exactly that
    const [exporting, setExporting] = useState(false);

    // PKG-4: the export is the SERVER's DSR export of the account (it used to download only what this browser knew). When organization-held records still need a
    // human review, the file says so and the screen tells the person that this part of the request remains open.
    const [exportNote, setExportNote] = useState('');
    const handleExport = async () => {
        setExporting(true); setExportNote('');
        try {
            const res = await fetch('/api/auth/export-data', { credentials: 'include' });
            if (!res.ok) throw new Error(String(res.status));
            const exportData = await res.json();
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `accesdirectaide-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setExportNote(exportData?.exportInfo?.completeness === 'PARTIALLY_COMPLETED'
                ? t('compte:settings.export_partial', 'Export téléchargé. Une partie de votre demande reste ouverte : des notes internes de structures vous concernant doivent être examinées par une personne habilitée avant toute communication.')
                : t('compte:settings.export_done', 'Export téléchargé.'));
        } catch {
            setExportNote(t('compte:settings.export_failed', 'L’export n’a pas pu être réalisé. Réessayez plus tard.'));
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">{t('compte:settings.mes_donnees_personnelles', 'Mes données personnelles')}</h3>
                <div className="space-y-4">
                    {/* Export */}
                    <div className="p-4 rounded-lg border bg-white">
                        <div className="flex items-start gap-4">
                            <Download className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium">{t('compte:settings.exporter_mes_donnees', 'Exporter mes données')}</span>
                                <p className="text-xs text-slate-500 mt-1">
                                    {t('compte:settings.telechargez_une_copie_des', 'Téléchargez une copie des données personnelles de votre compte (droit d’accès et portabilité, RGPD art. 15 et 20).')}
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleExport}
                                    disabled={exporting}
                                    className="mt-3"
                                >
                                    <Download className="h-3.5 w-3.5 mr-1.5" />
                                    {exporting ? t('compte:settings.exporting', 'Export en cours...') : t('compte:settings.download_json', 'Télécharger (JSON)')}
                                </Button>
                                <p role="status" aria-live="polite" data-testid="compte-export-status" className="text-xs text-slate-700 mt-2">{exportNote}</p>
                            </div>
                        </div>
                    </div>

                    <RestrictionPanel />

                    {/* Delete Account */}
                    <div className="p-4 rounded-lg border border-red-200 bg-red-50/50">
                        <div className="flex items-start gap-4">
                            <Trash2 className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <span className="text-sm font-medium text-red-800">{t('compte:settings.supprimer_mon_compte', 'Supprimer mon compte')}</span>
                                <p className="text-xs text-red-700 mt-1">
                                    {t('compte:settings.votre_demande_est_enregistree', 'Votre demande est enregistrée puis traitée par notre équipe : vos données personnelles, rendez-vous et messages sont alors supprimés, sauf ce que la loi oblige à conserver.')}
                                </p>
                                {deletionRequest && deletionRequest.status === 'REJECTED' ? (
                                    <p role="status" data-testid="deletion-rejected" className="mt-3 rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-900">
                                        {t('compte:settings.deletion_rejected', 'Votre demande de suppression (référence {{ref}}) n’a pas pu être exécutée', { ref: deletionRequest.requestId })}{deletionRequest.reason ? ` : ${deletionRequest.reason}` : '.'} {t('compte:settings.vous_pouvez_nous_ecrire', 'Vous pouvez nous écrire ou refaire une demande.')}
                                    </p>
                                ) : deletionRequest && deletionRequest.status === 'BLOCKED' ? (
                                    <p role="status" data-testid="deletion-blocked" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                                        {t('compte:settings.deletion_blocked', 'Votre demande de suppression (référence {{ref}}) est suspendue : une obligation légale de conservation s’applique à certaines de vos données. L’effacement reprendra quand elle prendra fin.', { ref: deletionRequest.requestId })}
                                    </p>
                                ) : deletionRequest && deletionRequest.status !== 'COMPLETED' ? (
                                    <p role="status" data-testid="deletion-requested" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                                        {t('compte:settings.deletion_requested', 'Demande de suppression enregistrée (référence {{ref}}). Votre compte reste actif jusqu’à son traitement.', { ref: deletionRequest.requestId })}
                                        {deletionRequest.dueAt ? ` ${t('compte:settings.deletion_due', 'Nous devons vous répondre au plus tard le {{date}}.', { date: formatDate(deletionRequest.dueAt) })}` : ''}
                                    </p>
                                ) : null}

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" className="mt-3">
                                            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                            {t('compte:settings.supprimer_mon_compte', 'Supprimer mon compte')}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>{t('compte:settings.supprimer_votre_compte', 'Supprimer votre compte ?')}</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                {t('compte:settings.votre_demande_sera_examinee', 'Votre demande sera examinée puis exécutée : vos données personnelles, rendez-vous et conversations seront alors définitivement supprimés, sauf obligation légale de conservation. Une fois exécutée, la suppression est irréversible.')}
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>{t('compte:settings.annuler', 'Annuler')}</AlertDialogCancel>
                                            <AlertDialogAction
                                                className="bg-red-600 hover:bg-red-700"
                                                onClick={async () => {
                                                    try {
                                                        // K0: a protected mutation like any other; without the CSRF pair the API refused every erasure request (403)
                                                        const res = await csrfFetch('/api/auth/delete-account', {
                                                            method: 'DELETE',
                                                            credentials: 'include',
                                                            headers: { 'Content-Type': 'application/json' },
                                                        });
                                                        if (!res.ok) {
                                                            const data = await res.json().catch(() => ({}));
                                                            throw new Error(data.error || t('compte:settings.deletion_error', 'Erreur lors de la suppression'));
                                                        }
                                                        setDeletionRequest(await res.json().catch(() => ({ requestId: '—' })));
                                                    } catch (err) {
                                                        alert(err.message);
                                                    }
                                                }}
                                            >
                                                {t('compte:settings.demander_suppression', 'Demander la suppression')}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                <p>
                    {t('compte:settings.gdpr_before', 'Conformément au RGPD, vous disposez d\'un droit d\'accès, de rectification et de suppression de vos données. Pour toute demande, contactez-nous via la')} <Link to="/contact" className="underline">{t('compte:settings.gdpr_contact', 'page contact')}</Link> {t('compte:settings.gdpr_or', 'ou consultez notre')} <Link to="/securite-et-rgpd" className="underline">{t('compte:settings.politique_confidentialite', 'politique de confidentialité')}</Link>.
                </p>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────

export default function CompteParametres() {
    const { t } = useT('compte');
    const location = useLocation();
    const safeNext = useMemo(
        () => normalizeNextPath(location.pathname + location.search, '/compte/parametres'),
        [location.pathname, location.search],
    );

    const authQuery = useQuery({
        queryKey: ['compte-parametres-auth'],
        queryFn: () => rdvMessagingClient.authMe(),
        staleTime: 30_000,
    });

    const isUser = authQuery.data?.session?.kind === 'user';
    const user = authQuery.data?.user;

    if (authQuery.isLoading) {
        return (
            <div className="w-full p-4"><SkeletonList count={4} variant="card" /></div>
        );
    }

    if (!isUser) {
        return <Navigate to={appendNext('/auth/login', safeNext)} replace />;
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <SEO
                title={t('compte:settings.parametres_compte', 'Paramètres du compte')}
                description={t('compte:settings.gerez_vos_parametres_notifications', 'Gérez vos paramètres, notifications et données personnelles.')}
                path="/compte/parametres"
                noindex={true}
            />

            <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-slate-900">{t('compte:settings.parametres', 'Paramètres')}</h1>
                    <p className="text-sm text-slate-500 mt-1">{t('compte:settings.gerez_votre_compte_vos', 'Gérez votre compte et vos préférences')}</p>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="profil" className="space-y-6">
                    <TabsList className="grid w-full grid-cols-5 h-auto p-1">
                        <TabsTrigger value="profil" className="text-xs sm:text-sm gap-1.5 py-2.5">
                            <User className="h-4 w-4 hidden sm:block" />
                            {t('compte:settings.profil', 'Profil')}
                        </TabsTrigger>
                        <TabsTrigger value="notifications" className="text-xs sm:text-sm gap-1.5 py-2.5">
                            <Bell className="h-4 w-4 hidden sm:block" />
                            {t('compte:settings.notifs', 'Notifs')}
                        </TabsTrigger>
                        <TabsTrigger value="security" className="text-xs sm:text-sm gap-1.5 py-2.5">
                            <Shield className="h-4 w-4 hidden sm:block" />
                            {t('compte:settings.securite', 'Sécurité')}
                        </TabsTrigger>
                        <TabsTrigger value="accessibility" className="text-xs sm:text-sm gap-1.5 py-2.5">
                            <Accessibility className="h-4 w-4 hidden sm:block" />
                            {t('compte:settings.acces', 'Accès')}
                        </TabsTrigger>
                        <TabsTrigger value="data" className="text-xs sm:text-sm gap-1.5 py-2.5">
                            <Database className="h-4 w-4 hidden sm:block" />
                            {t('compte:settings.donnees', 'Données')}
                        </TabsTrigger>
                    </TabsList>

                    <Card>
                        <CardContent className="pt-6">
                            <TabsContent value="profil" className="mt-0">
                                <ProfilTab user={user} />
                            </TabsContent>
                            <TabsContent value="notifications" className="mt-0">
                                <NotificationsTab />
                            </TabsContent>
                            <TabsContent value="security" className="mt-0">
                                <SecurityTab user={user} />
                            </TabsContent>
                            <TabsContent value="accessibility" className="mt-0">
                                <AccessibilityTab />
                            </TabsContent>
                            <TabsContent value="data" className="mt-0">
                                <DataTab user={user} />
                            </TabsContent>
                        </CardContent>
                    </Card>
                </Tabs>

                {/* Back to messages */}
                <div className="mt-6 text-center">
                    <Link to="/compte/messages" className="text-sm text-blue-600 hover:underline">
                        {t('compte:settings.retour_mes_messages', '← Retour à mes messages')}
                    </Link>
                </div>
            </div>
        </div>
    );
}
