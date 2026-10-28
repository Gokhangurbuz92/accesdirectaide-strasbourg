import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * ⚡ LazyImage — Optimized image component with native lazy loading
 *
 * Features:
 * - Native browser `loading="lazy"` for deferred offscreen loading
 * - Skeleton pulse placeholder while loading
 * - Graceful fallback on load error
 * - Smooth fade-in transition on load
 *
 * @param {{ src: string, alt: string, className?: string, fallbackText?: string, [key: string]: any }} props
 */
export default function LazyImage({ src, alt, className, fallbackText = 'Image indisponible', ...props }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // launch-readiness item 49: the fallback is drawn here — it used to load an image from placehold.co, a third party that then saw every visitor's address
  if (error) {
    return (
      <div role="img" aria-label={alt || fallbackText} className={cn('relative flex items-center justify-center overflow-hidden bg-muted p-4 text-sm text-muted-foreground', className)}>
        {fallbackText}
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden bg-slate-100', !loaded && 'animate-pulse', className)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (!error) setError(true);
        }}
        className={cn(
          'h-full w-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        {...props}
      />
    </div>
  );
}
