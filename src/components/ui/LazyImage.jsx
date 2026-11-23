import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';
import { useReducedData } from '@/lib/dataSaver';

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
export default function LazyImage({ src, alt, className, fallbackText, ...props }) {
  const { t } = useT('guides');
  // R32: the default fallback in the interface language (the component is only used by the guide page)
  const fallback = fallbackText ?? t('guides:image.unavailable', 'Image indisponible');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  // G14-LITE: with data saving on, the image is downloaded only when the person asks for it (text first)
  const saveData = useReducedData();
  const [asked, setAsked] = useState(false);

  // launch-readiness item 49: the fallback is drawn here — it used to load an image from placehold.co, a third party that then saw every visitor's address
  if (error) {
    return (
      <div role="img" aria-label={alt || fallback} className={cn('relative flex items-center justify-center overflow-hidden bg-muted p-4 text-sm text-muted-foreground', className)}>
        {fallback}
      </div>
    );
  }

  if (saveData && !asked) {
    return (
      <div className={cn('relative flex items-center justify-center overflow-hidden bg-muted p-4', className)}>
        <button type="button" data-testid="lazy-image-show" onClick={() => setAsked(true)} className="min-h-11 rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('guides:image.show_data_saver', 'Afficher l’image (économie de données activée)')}
        </button>
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
