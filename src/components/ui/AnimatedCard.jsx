// @ts-nocheck
import { motion, useReducedMotion } from 'framer-motion';

/**
 * AnimatedCard
 * Wrapper pour les cartes publiques avec animations d'entrée en cascade (stagger)
 * et effet de survol subtil. Respecte prefers-reduced-motion.
 * @param {number} index - Position dans la liste (pour le stagger delay)
 */
// @ts-ignore
export default function AnimatedCard({ children, index = 0, className = '' }) {
    const shouldReduceMotion = useReducedMotion();

    const variants = {
        // R37: with reduced motion nothing fades (the cards were transparent during the stagger and failed the contrast check)
        hidden: {
            opacity: shouldReduceMotion ? 1 : 0,
            y: shouldReduceMotion ? 0 : 20,
        },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                delay: Math.min(index, 8) * 0.05,   // R37: capped — with 75 guides the last cards waited 3.7 s, half transparent
                duration: 0.4,
                ease: 'easeOut',
            },
        },
    };

    const hoverProps = shouldReduceMotion
        ? {}
        : {
            whileHover: {
                y: -4,
                boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.08), 0 4px 10px -6px rgb(0 0 0 / 0.04)',
                transition: { duration: 0.2 },
            },
        };

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            variants={variants}
            {...hoverProps}
            className={`h-full ${className}`}
        >
            {children}
        </motion.div>
    );
}
