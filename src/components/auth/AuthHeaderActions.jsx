// @ts-nocheck
import { Link, useNavigate } from 'react-router-dom';
import { User, Briefcase, ChevronDown, LogIn, UserPlus, Settings, MessageCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from '@tanstack/react-query';
import { rdvMessagingClient } from '@/api/rdv-messaging-client';
import { useT } from '@/i18n';

import { logoutOnServer } from '@/lib/citizenSession';
/**
 * AuthHeaderActions — Menus "Se connecter" / "S'inscrire" unifiés
 * 
 * Quand l'utilisateur est connecté : affiche un avatar dropdown avec
 * Paramètres, Messages, Déconnexion.
 * 
 * Quand non connecté : affiche les dropdowns Particulier / Professionnel.
 * 
 * Sécurité : le bouton "Administration" est supprimé de la vue publique.
 * L'admin accède via /admin/login directement.
 */
export function AuthHeaderActions() {
    const { t } = useT('layout');
    const navigate = useNavigate();

    const authQuery = useQuery({
        queryKey: ['header-auth-check'],
        queryFn: () => rdvMessagingClient.authMe(),
        staleTime: 60_000,
        retry: false,
        refetchOnWindowFocus: false,
    });

    const isUser = authQuery.data?.session?.kind === 'user';
    const userEmail = (authQuery.data?.user?.email ?? authQuery.data?.session?.user?.email);

    const handleLogout = async () => {
        if (!(await logoutOnServer())) return;
        localStorage.removeItem('ada_citizen_prefs');
        navigate('/');
        window.location.reload();
    };

    // ─── Connected user ───────────────────────
    if (isUser) {
        return (
            <div className="flex items-center gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-1.5">
                            <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold flex-shrink-0">
                                {userEmail ? userEmail[0].toUpperCase() : 'U'}
                            </div>
                            <span className="hidden sm:inline text-sm max-w-[120px] truncate">
                                {userEmail || t('layout:account.mine', 'Mon compte')}
                            </span>
                            <ChevronDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <div className="px-3 py-2 border-b mb-1">
                            <p className="text-xs text-slate-500">{t('layout:account.signedInAs', 'Connecté en tant que')}</p>
                            <p className="text-sm font-medium truncate">{userEmail}</p>
                        </div>
                        <DropdownMenuItem asChild>
                            <Link to="/compte" className="flex items-center gap-2.5 cursor-pointer">
                                <User className="h-4 w-4 text-blue-500" />
                                <span>{t('layout:account.space', 'Mon Espace')}</span>
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link to="/compte/messages" className="flex items-center gap-2.5 cursor-pointer">
                                <MessageCircle className="h-4 w-4 text-blue-500" />
                                <span>{t('layout:account.messages', 'Mes messages')}</span>
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link to="/compte/parametres" className="flex items-center gap-2.5 cursor-pointer">
                                <Settings className="h-4 w-4 text-slate-500" />
                                <span>{t('layout:account.settings', 'Paramètres')}</span>
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="flex items-center gap-2.5 cursor-pointer text-red-600 focus:text-red-600"
                            onClick={handleLogout}
                        >
                            <LogOut className="h-4 w-4" />
                            <span>{t('layout:account.logout', 'Déconnexion')}</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        );
    }

    // ─── Not connected ────────────────────────
    return (
        <div className="flex items-center gap-2">
            {/* Menu "Se connecter" */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5">
                        <LogIn className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{t('layout:account.signIn', 'Se connecter')}</span>
                        <ChevronDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem asChild>
                        <Link to="/auth/login" className="flex items-center gap-2.5 cursor-pointer">
                            <User className="h-4 w-4 text-indigo-500" />
                            <div>
                                <p className="font-medium">{t('layout:account.personal', 'Espace Particulier')}</p>
                                <p className="text-xs text-slate-500">{t('layout:account.personal.text', 'Gérer mes aides et RDV')}</p>
                            </div>
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link to="/pro/login" className="flex items-center gap-2.5 cursor-pointer">
                            <Briefcase className="h-4 w-4 text-emerald-500" />
                            <div>
                                <p className="font-medium">{t('layout:account.pro', 'Espace Professionnel')}</p>
                                <p className="text-xs text-slate-500">{t('layout:account.pro.text', 'Accéder à ma structure')}</p>
                            </div>
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Bouton "S'inscrire" */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button size="sm" className="gap-1.5 rounded-full px-5 shadow-sm">
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{t('layout:account.signUp', "S'inscrire")}</span>
                        <ChevronDown className="h-3 w-3 opacity-50" aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem asChild>
                        <Link to="/auth/signup" className="flex items-center gap-2.5 cursor-pointer">
                            <User className="h-4 w-4 text-indigo-500" />
                            <div>
                                <p className="font-medium">{t('layout:account.personalAccount', 'Compte Particulier')}</p>
                                <p className="text-xs text-slate-500">{t('layout:account.personalAccount.text', 'Simuler mes droits, prendre RDV')}</p>
                            </div>
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link to="/pro/register" className="flex items-center gap-2.5 cursor-pointer">
                            <Briefcase className="h-4 w-4 text-emerald-500" />
                            <div>
                                <p className="font-medium">{t('layout:account.proAccount', 'Compte Structure / Pro')}</p>
                                <p className="text-xs text-slate-500">{t('layout:account.proAccount.text', 'Accompagner les usagers')}</p>
                            </div>
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

/**
 * AuthMobileActions — Version mobile pour le menu hamburger
 * Affiche les liens directement (pas de dropdown)
 */
export function AuthMobileActions({ onNavigate }) {
    const { t } = useT('layout');
    const linkClass = "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-slate-50";

    const authQuery = useQuery({
        queryKey: ['header-auth-check'],
        queryFn: () => rdvMessagingClient.authMe(),
        staleTime: 60_000,
        retry: false,
        refetchOnWindowFocus: false,
    });

    const isUser = authQuery.data?.session?.kind === 'user';

    const handleLogout = async () => {
        if (!(await logoutOnServer())) return;
        localStorage.removeItem('ada_citizen_prefs');
        if (onNavigate) onNavigate();
        window.location.href = '/';
    };

    if (isUser) {
        return (
            <div className="space-y-1">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600">
                    {t('layout:account.mine', 'Mon compte')}
                </p>
                <Link to="/compte" className={linkClass} onClick={onNavigate}>
                    <User className="h-4 w-4 text-blue-500" />
                    {t('layout:account.space', 'Mon Espace')}
                </Link>
                <Link to="/compte/messages" className={linkClass} onClick={onNavigate}>
                    <MessageCircle className="h-4 w-4 text-blue-500" />
                    {t('layout:account.messages', 'Mes messages')}
                </Link>
                <Link to="/compte/parametres" className={linkClass} onClick={onNavigate}>
                    <Settings className="h-4 w-4 text-slate-500" />
                    {t('layout:account.settings', 'Paramètres')}
                </Link>
                <button onClick={handleLogout} className={`${linkClass} w-full text-red-600 hover:bg-red-50`}>
                    <LogOut className="h-4 w-4" />
                    {t('layout:account.logout', 'Déconnexion')}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600">
                {t('layout:account.signIn', 'Se connecter')}
            </p>
            <Link to="/auth/login" className={linkClass} onClick={onNavigate}>
                <User className="h-4 w-4 text-indigo-500" />
                {t('layout:account.personal', 'Espace Particulier')}
            </Link>
            <Link to="/pro/login" className={linkClass} onClick={onNavigate}>
                <Briefcase className="h-4 w-4 text-emerald-500" />
                {t('layout:account.pro', 'Espace Professionnel')}
            </Link>

            <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-600">
                {t('layout:account.signUp', "S'inscrire")}
            </p>
            <Link to="/auth/signup" className={linkClass} onClick={onNavigate}>
                <UserPlus className="h-4 w-4 text-indigo-500" />
                {t('layout:account.personalAccount', 'Compte Particulier')}
            </Link>
            <Link to="/pro/register" className={linkClass} onClick={onNavigate}>
                <UserPlus className="h-4 w-4 text-emerald-500" />
                {t('layout:account.proAccount', 'Compte Structure / Pro')}
            </Link>
        </div>
    );
}

export default AuthHeaderActions;
