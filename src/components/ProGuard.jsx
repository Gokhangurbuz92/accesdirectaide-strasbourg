// @ts-nocheck
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { rememberPendingInvite } from '@/lib/pendingInvite';

/**
 * ProGuard — Early authorization guard for Pro routes.
 *
 * Performs a quick localStorage check to avoid any content flash.
 * The **real** server-side token validation (GET /api/pro/me) is handled
 * by ProLayout, which wraps all protected Pro routes.
 *
 * This guard adds:
 *  1. Immediate redirect when no token is present (no flash)
 *  2. noindex/nofollow meta for SEO protection
 */
export default function ProGuard({ children }) {
    const location = useLocation();
    const [isReady, setIsReady] = useState(false);
    const [shouldRedirect, setShouldRedirect] = useState(false);

    useEffect(() => {
        const token = typeof window !== 'undefined'
            ? localStorage.getItem('pro_token')
            : null;

        if (!token) {
            setShouldRedirect(true);
        }

        setIsReady(true);
    }, []);

    if (!isReady) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" />
            </div>
        );
    }

    if (shouldRedirect) {
        rememberPendingInvite(location);       // the fragment (organization invitation) would be lost by the redirect
        const next = encodeURIComponent(location.pathname + location.search);
        return <Navigate to={`/pro/login?next=${next}`} replace />;
    }

    return (
        <>
            <Helmet>
                <meta name="robots" content="noindex, nofollow" />
            </Helmet>
            {children}
        </>
    );
}
