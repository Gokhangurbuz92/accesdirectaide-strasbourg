// @ts-nocheck

import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { adminClient } from '@/api/client';
import { Loader2 } from 'lucide-react';

export default function RequireAuth(/** @type {Record<string, string | number | boolean | null | undefined>} */ { children }) {
    const [isAuthorized, setIsAuthorized] = useState(null);
    const location = useLocation();

    useEffect(() => {
        const checkAuth = async () => {
            try {
                // Auth client handles token persistence via sessionStorage. 
                // We check if we can get the current user or if the client is authenticated.
                const user = adminClient.auth?.user || await adminClient.auth?.getUser?.().catch(() => null);

                if (user && (user.role === 'admin' || user.is_admin === true)) {
                    setIsAuthorized(true);
                } else {
                    // If no user, or not admin, we redirect.
                    // In a real OAuth flow, we might trigger a login redirect here.
                    // For now, if not authorized, we assume they need to log in or go home.
                    setIsAuthorized(false);
                }
            } catch (err) {
                if (import.meta.env.DEV) console.error("Auth check failed", err);
                setIsAuthorized(false);
            }
        };
        checkAuth();
    }, [location.pathname]);

    if (isAuthorized === null) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!isAuthorized) {
        // Redirect to Home or a Login page if one existed. 
        // Since we don't have a public login page yet, sending to Home is safer.
        return <Navigate to="/home" state={{ from: location }} replace />;
    }

    return children;
}
