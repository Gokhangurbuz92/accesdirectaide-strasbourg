import { cn } from '@/lib/utils';

/**
 * The building blocks of the colour system (src/design/categoryTone.js): a chip, an icon tile and an accent bar. Every page uses these, so a topic
 * looks the same everywhere. `tone` is a TONES entry (topicTone(...), structureTone(...), contentTone(...), sectionTone(...)).
 */

/** @param {{ tone: { chip: string }, className?: string, children: import('react').ReactNode, lang?: string, size?: 'sm' | 'md' }} props */
export function ToneChip({ tone, className = '', children, lang, size = 'sm' }) {
  return (
    <span lang={lang} className={cn('inline-flex max-w-full items-center rounded-md border font-semibold leading-snug', size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs', tone.chip, className)}>
      {children}
    </span>
  );
}

/** @param {{ tone: { tile: string }, icon: import('react').ElementType, className?: string, size?: 'sm' | 'md' | 'lg' }} props */
export function ToneIcon({ tone, icon: Icon, className = '', size = 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8 rounded-lg' : size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-10 w-10 rounded-xl';
  const ic = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';
  return <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center', box, tone.tile, className)}><Icon className={ic} /></span>;
}

/** the thin accent bar at the top (or the start side) of a card; the card must be `relative overflow-hidden` @param {{ tone: { bar: string }, side?: 'top' | 'start', className?: string }} props */
export function ToneBar({ tone, side = 'top', className = '' }) {
  return <span aria-hidden="true" data-testid="card-tone" className={cn('pointer-events-none absolute', side === 'top' ? 'inset-x-0 top-0 h-1' : 'inset-y-0 start-0 w-1', tone.bar, className)} />;
}
