import React from 'react';
import PropTypes from 'prop-types';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

/**
 * Composant Logo unifié pour l'application AccesDirectAide
 * Design System v1.0 - Branding
 * 
 * @param {Object} props
 * @param {'a' | 'b' | 'c' | 'current'} props.family - Famille de logo (a/b/c pour preview, current pour prod)
 * @param {'full' | 'icon' | 'tagline'} props.variant - Type de logo
 * @param {'default' | 'white'} props.tone - Tonalité (default = couleur, white = blanc)
 * @param {number | 'sm' | 'md' | 'lg'} props.size - Hauteur en pixels ou preset
 * @param {boolean} props.asLink - Si true, enveloppe dans un Link vers l'accueil
 * @param {string} props.alt - Texte alternatif personnalisé
 * @param {string} props.className - Classes CSS additionnelles
 */
const Logo = ({
    family = 'current',
    variant = 'full',
    tone = 'default',
    size = 40,
    asLink = false,
    alt,
    className,
    ...props
}: import("react").ImgHTMLAttributes<HTMLImageElement> & { family?: string; variant?: string; tone?: string; size?: number | "sm" | "md" | "lg"; asLink?: boolean }) => {
    // Conversion size preset vers pixels
    const sizeMap = {
        sm: 24,
        md: 40,
        lg: 64
    };
    const heightPx = typeof size === 'string' ? sizeMap[size] : size;

    // Source of truth en prod: /public/logo.svg
    const isCurrentFamily = family === 'current';
    const basePath = '/assets/branding';
    const familySuffix = isCurrentFamily ? '' : `-${family}`;

    let logoSrc = '/logo.svg';
    let fallbackSrc = '/logo.svg';

    if (!isCurrentFamily) {
        if (tone === 'white') {
            logoSrc = `${basePath}/logo${familySuffix}-white.svg`;
            fallbackSrc = '/brand/logo-horizontal-transparent.webp';
        } else if (variant === 'icon') {
            logoSrc = `${basePath}/logo${familySuffix}-icon.svg`;
            fallbackSrc = '/brand/logo-mark.webp';
        } else if (variant === 'tagline') {
            logoSrc = `${basePath}/logo${familySuffix}-tagline.svg`;
            fallbackSrc = '/brand/logo-horizontal.webp';
        } else {
            logoSrc = `${basePath}/logo${familySuffix}-full.svg`;
            fallbackSrc = '/brand/logo-horizontal.webp';
        }
    }

    // Texte alternatif
    const altText = alt || 'Logo AccesDirectAide';
    const whiteToneClass = tone === 'white' && isCurrentFamily ? 'brightness-0 invert' : '';

    // Composant image
    const logoImage = (
        <img
            src={logoSrc}
            alt={altText}
            className={cn('object-contain', whiteToneClass, className)}
            style={{ height: `${heightPx}px`, width: variant === 'icon' ? `${heightPx}px` : 'auto' }}
            onError={(e) => {
                if (e.currentTarget.src !== fallbackSrc) {
                    e.currentTarget.src = fallbackSrc;
                }
            }}
            {...props}
        />
    );

    // Si asLink, envelopper dans un Link
    if (asLink) {
        return (
            <Link
                to="/"
                className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 rounded"
                aria-label="Aller à l’accueil"
            >
                {logoImage}
            </Link>
        );
    }

    return logoImage;
};

Logo.propTypes = {
    family: PropTypes.oneOf(['a', 'b', 'c', 'current']),
    variant: PropTypes.oneOf(['full', 'icon', 'tagline']),
    tone: PropTypes.oneOf(['default', 'white']),
    size: PropTypes.oneOfType([
        PropTypes.number,
        PropTypes.oneOf(['sm', 'md', 'lg'])
    ]),
    asLink: PropTypes.bool,
    alt: PropTypes.string,
    className: PropTypes.string,
};

export default Logo;
