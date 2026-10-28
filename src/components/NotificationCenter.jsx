import { useState, useEffect, useCallback, useRef } from 'react';
import { getCsrfHeaders } from '@/lib/csrf';
import {
    Bell,
    MessageSquare,
    Calendar,
    FileText,
    Clock,
    UserPlus,
    ShieldCheck,
    Settings,
    X,
} from 'lucide-react';

/**
 * NotificationCenter — Composant souverain (sans Firebase)
 *
 * Utilise le polling sur /api/pro/notifications pour alerter
 * les agents des événements de leur structure.
 *
 * Props:
 * - className: classes CSS additionnelles
 */
export default function NotificationCenter({ className = '' }) {
    const [notifications, setNotifications] = useState(/** @type {Array<{ createdAt: string | number, id: string | number, message: string | number, readAt: string | number, title: string | number, type: string | number }>} */ ([]));
    const [unreadCount, setUnreadCount] = useState(0);
    const [unreadMessages, setUnreadMessages] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const panelRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    const token =
        typeof window !== 'undefined'
            ? localStorage.getItem('pro_token')
            : null;

    const fetchNotifications = useCallback(async () => {
        if (!token) return;
        try {
            const [notifRes, countRes] = await Promise.all([
                fetch('/api/pro/notifications?limit=20', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
                fetch('/api/pro/notifications/unread-count', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            ]);

            if (notifRes.ok) {
                const data = await notifRes.json();
                setNotifications(data.notifications || []);
                setUnreadCount(data.unreadCount || 0);
            }

            if (countRes.ok) {
                const countData = await countRes.json();
                setUnreadMessages(countData.messages || 0);
            }
        } catch {
            // Silently handle
        }
    }, [token]);

    // Total badge = notifications + unread messages
    const totalBadge = unreadCount + unreadMessages;

    // Initial fetch + polling every 30s
    useEffect(() => {
        fetchNotifications();
        const timer = setInterval(fetchNotifications, 30000);
        return () => clearInterval(timer);
    }, [fetchNotifications]);

    // Close panel on outside click
    useEffect(() => {
        const handleClick = (/** @type {{ target: any; }} */ e) => {
            if (panelRef.current && !panelRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    // Mark notification as read via API
    const markAsRead = async (/** @type {string | number | boolean | null | undefined} */ id) => {
        if (!token) return;
        // Optimistic update
        setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));

        try {
            const res = await fetch('/api/pro/notifications', {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: [id], action: 'read' }),
            });
            if (!res.ok) fetchNotifications();   // R12: a refused change is not shown as done — the server's state comes back
        } catch {
            // Revert on failure
            fetchNotifications();
        }
    };

    const markAllRead = async () => {
        if (!token || loading) return;
        setLoading(true);

        const unreadIds = notifications.filter((n) => !n.readAt).map((n) => n.id);
        if (unreadIds.length === 0) {
            setLoading(false);
            return;
        }

        // Optimistic update
        setNotifications((prev) =>
            prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
        );
        setUnreadCount(0);

        try {
            const res = await fetch('/api/pro/notifications', {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ids: unreadIds, action: 'read' }),
            });
            if (!res.ok) fetchNotifications();   // R12: a refused change is not shown as done — the server's state comes back
        } catch {
            fetchNotifications();
        } finally {
            setLoading(false);
        }
    };

    return (
        <div ref={panelRef} className={`relative ${className}`}>
            {/* Bell button */}
            <button
                onClick={() => setIsOpen((v) => !v)}
                className="relative p-2 rounded-xl hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label={`Notifications${totalBadge > 0 ? `, ${totalBadge} non lues` : ''}`}
            >
                <Bell
                    className={totalBadge > 0 ? 'text-indigo-600' : 'text-slate-400'}
                    size={20}
                />
                {totalBadge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white min-w-[18px]">
                        {totalBadge > 9 ? '9+' : totalBadge}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 bg-slate-900 text-white flex justify-between items-center">
                        <h3 className="text-xs font-bold uppercase tracking-wider">
                            Alertes
                        </h3>
                        <div className="flex items-center gap-2">
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllRead}
                                    disabled={loading}
                                    className="text-[10px] font-bold text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                                >
                                    Tout lire
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-slate-400 hover:text-white transition-colors"
                                aria-label="Fermer"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Items */}
                    <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-50">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center text-slate-400">
                                <Bell size={24} className="mx-auto mb-2 opacity-20" />
                                <p className="text-xs">Vous êtes à jour ! Aucune nouvelle notification.</p>
                            </div>
                        ) : (
                            notifications.map((/** @type {{ createdAt: string | number, id: string | number, message: string | number, readAt: string | number, title: string | number, type: string | number }} */ notif) => {
                                const isRead = Boolean(notif.readAt);
                                return (
                                    <button
                                        key={notif.id}
                                        onClick={() => !isRead && markAsRead(notif.id)}
                                        className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 transition-colors ${isRead ? 'opacity-60' : ''
                                            }`}
                                    >
                                        <div
                                            className={`p-1.5 rounded-lg h-fit mt-0.5 shrink-0 ${getIconBg(
                                                notif.type
                                            )}`}
                                        >
                                            {getIcon(notif.type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-slate-900 truncate">
                                                {notif.title}
                                            </p>
                                            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                                                {notif.message}
                                            </p>
                                            <p className="text-[9px] text-slate-400 mt-1 flex items-center gap-1">
                                                <Clock size={8} />
                                                {formatTime(notif.createdAt)}
                                            </p>
                                        </div>
                                        {!isRead && (
                                            <span className="w-2 h-2 bg-indigo-500 rounded-full mt-2 shrink-0" />
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function getIcon(/** @type {string | number | boolean | null | undefined} */ type) {
    const size = 14;
    switch (type) {
        case 'message_new':
        case 'message':
            return <MessageSquare size={size} className="text-blue-600" />;
        case 'rdv_new':
        case 'rdv_cancel':
        case 'appointment':
            return <Calendar size={size} className="text-indigo-600" />;
        case 'dossier':
            return <FileText size={size} className="text-amber-600" />;
        case 'team_join':
        case 'team_role_change':
        case 'auth':
            return <UserPlus size={size} className="text-emerald-600" />;
        case 'team':
            return <Settings size={size} className="text-red-500" />;
        default:
            return <ShieldCheck size={size} className="text-slate-500" />;
    }
}

function getIconBg(/** @type {string | number | boolean | null | undefined} */ type) {
    switch (type) {
        case 'message_new':
        case 'message':
            return 'bg-blue-50';
        case 'rdv_new':
        case 'rdv_cancel':
        case 'appointment':
            return 'bg-indigo-50';
        case 'dossier':
            return 'bg-amber-50';
        case 'team_join':
        case 'team_role_change':
        case 'auth':
            return 'bg-emerald-50';
        case 'team':
            return 'bg-red-50';
        default:
            return 'bg-slate-100';
    }
}

/**
 * @param {string | number | Date} ts
 */
function formatTime(ts) {
    if (!ts) return "À l'instant";
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "À l'instant";
    if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
