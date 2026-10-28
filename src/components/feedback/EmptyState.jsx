// @ts-nocheck
import { Search, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export default function EmptyState({
    title = "Aucune aide trouvée",
    message = "Essayez de modifier vos filtres ou d'élargir votre recherche.",
    actionLabel = "Réinitialiser les filtres",
    onAction,
    icon: Icon = Search,
}) {
    const bgColor = 'bg-slate-50/80';
    const iconColor = 'text-brand-500'; // Utilisons une couleur un peu plus vivante que le gris

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className={`text-center py-16 px-6 rounded-3xl ${bgColor} border border-dashed border-slate-200/60 shadow-sm backdrop-blur-sm`}
            role="status"
            aria-live="polite"
            data-testid="empty-state"
        >
            <div className="flex justify-center mb-6">
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: 0.5, type: "spring", stiffness: 200 }}
                    className="w-20 h-20 rounded-2xl flex items-center justify-center bg-white shadow-sm rotate-3 border border-slate-100"
                >
                    <Icon className={`h-10 w-10 ${iconColor} -rotate-3`} aria-hidden="true" alt="" />
                </motion.div>
            </div>

            <motion.h3
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-2xl font-bold text-slate-900 mb-3"
            >
                {title}
            </motion.h3>

            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-slate-600 max-w-md mx-auto mb-8 text-lg font-light leading-relaxed"
            >
                {message}
            </motion.p>

            {onAction && actionLabel && (
                <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                >
                    <Button
                        onClick={onAction}
                        variant="default"
                        className="gap-2 rounded-full px-6 py-6 text-base font-medium shadow-md hover:shadow-lg transition-all"
                        data-testid="empty-reset"
                    >
                        {actionLabel}
                        <ArrowRight className="h-5 w-5" />
                    </Button>
                </motion.div>
            )}
        </motion.div>
    );
}
