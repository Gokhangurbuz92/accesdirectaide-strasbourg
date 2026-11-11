// @ts-nocheck
/**
 * Shared catalogue layout of the public pages (owner directive 11/11/2026 — Actualités, Aides, Démarches, Annuaire, Outils): one page structure
 *   A. PageHeader (compact branded banner) with the page's search inside it (HeroSearch)
 *   B. results bar: count, sort and view controls in the same place, active-filter chips, a « Filtres » button below `lg`
 *   C. main column + a sticky filter sidebar from `lg` (the same fields open in a bottom sheet on phones and tablets)
 *   D. Pager
 * Patterns adapted from shadcn/ui (MIT, already the base of src/components/ui) and the GOV.UK Design System filter pattern (MIT) — no code copied,
 * no new dependency. Colours come from the theme tokens (tailwind.config.js `bg-ada-hero`), not from hex values in components.
 */
import { useState } from 'react';
import PropTypes from 'prop-types';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

/** the content width shared by every catalogue page */
export const CONTAINER = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8';

/**
 * The search form inside the page banner: a large white field and its button, one row from `sm`.
 * @param {{ value: string, onChange: (v: string) => void, onSubmit: () => void, label: string, placeholder: string, submitLabel: string,
 *   inputTestId?: string, submitTestId?: string, maxLength?: number, children?: import('react').ReactNode }} props
 */
export function HeroSearch({ value, onChange, onSubmit, label, placeholder, submitLabel, inputTestId, submitTestId, maxLength, children = null }) {
  return (
    <div className="max-w-3xl">
      <form role="search" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex flex-col gap-2 sm:flex-row sm:gap-0 sm:rounded-2xl sm:bg-white sm:p-1.5 sm:shadow-float">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            maxLength={maxLength}
            data-testid={inputTestId}
            className="h-12 w-full rounded-xl border-0 bg-white ps-12 pe-4 text-base text-slate-900 shadow-float placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700 sm:shadow-none"
          />
        </div>
        <button
          type="submit"
          data-testid={submitTestId}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-blue-700 px-6 text-base font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-blue-800"
        >
          {submitLabel}
        </button>
      </form>
      {children && <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-blue-100">{children}</div>}
    </div>
  );
}
HeroSearch.propTypes = {
  value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, onSubmit: PropTypes.func.isRequired, label: PropTypes.string.isRequired,
  placeholder: PropTypes.string, submitLabel: PropTypes.string.isRequired, inputTestId: PropTypes.string, submitTestId: PropTypes.string,
  maxLength: PropTypes.number, children: PropTypes.node,
};

/**
 * The page body: main column, and from `lg` a sidebar that stays in view while the results scroll (below the fixed site header).
 * @param {{ sidebar?: import('react').ReactNode, sidebarLabel?: string, children: import('react').ReactNode, className?: string }} props
 */
export function CatalogBody({ sidebar = null, sidebarLabel, children, className = '' }) {
  return (
    <div className={`${CONTAINER} py-6 sm:py-8 ${className}`}>
      {sidebar ? (
        <div className="lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          <aside aria-label={sidebarLabel} className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-5 lg:shadow-subtle" data-testid="catalog-sidebar">
            {sidebar}
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      ) : children}
    </div>
  );
}
CatalogBody.propTypes = { sidebar: PropTypes.node, sidebarLabel: PropTypes.string, children: PropTypes.node, className: PropTypes.string };

/** a labelled filter group of the sidebar / sheet @param {{ id: string, label: string, children: import('react').ReactNode }} props */
export function FilterField({ id, label, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-900">{label}</label>
      {children}
    </div>
  );
}
FilterField.propTypes = { id: PropTypes.string.isRequired, label: PropTypes.string.isRequired, children: PropTypes.node };

/** the select style shared by every filter */
export const SELECT = 'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-1';
export const TEXT_INPUT = SELECT;

/**
 * The « Filtres » button shown below `lg`, opening the same fields in a bottom sheet (Radix Dialog: focus trap, Escape, labelled).
 * `render(prefix)` draws the fields with ids distinct from the sidebar's (`m-`).
 * @param {{ title: string, count?: number, render: (prefix: string) => import('react').ReactNode, onReset?: () => void, resultsLabel?: string }} props
 */
export function MobileFilters({ title, count = 0, render, onReset, resultsLabel }) {
  const { t } = useT('shared');
  const [open, setOpen] = useState(false);
  return (
    <SheetPrimitive.Root open={open} onOpenChange={setOpen}>
      <SheetPrimitive.Trigger asChild>
        <Button type="button" variant="outline" className="h-11 gap-2 lg:hidden" data-testid="mobile-filters-open">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {title}
          {count > 0 && <span className="rounded-full bg-blue-700 px-2 py-0.5 text-xs font-semibold text-white">{count}</span>}
        </Button>
      </SheetPrimitive.Trigger>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <SheetPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-xl focus-visible:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none" data-testid="mobile-filters">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <SheetPrimitive.Title className="text-lg font-bold text-slate-900">{title}</SheetPrimitive.Title>
            <SheetPrimitive.Close className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
              <X className="h-5 w-5" aria-hidden="true" /><span className="sr-only">{t('shared:filters.close', 'Fermer les filtres')}</span>
            </SheetPrimitive.Close>
          </div>
          <SheetPrimitive.Description className="sr-only">{t('shared:filters.sheet_help', 'Chaque choix met la liste à jour immédiatement.')}</SheetPrimitive.Description>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">{render('m-')}</div>
          <div className="flex gap-3 border-t border-slate-200 px-5 py-4">
            {onReset && <Button type="button" variant="ghost" className="h-11 flex-1" onClick={onReset}>{t('shared:filters.reset', 'Tout effacer')}</Button>}
            <SheetPrimitive.Close asChild>
              <Button type="button" className="h-11 flex-1">{resultsLabel || t('shared:filters.apply', 'Voir les résultats')}</Button>
            </SheetPrimitive.Close>
          </div>
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}
MobileFilters.propTypes = { title: PropTypes.string.isRequired, count: PropTypes.number, render: PropTypes.func.isRequired, onReset: PropTypes.func, resultsLabel: PropTypes.string };

/**
 * The row above the results: what was found on the start side, the controls (sort, view, mobile filters) on the end side.
 * @param {{ summary?: import('react').ReactNode, children?: import('react').ReactNode }} props
 */
export function ResultsBar({ summary = null, children = null }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" data-testid="results-bar">
      <div className="min-w-0 text-sm font-medium text-slate-700">{summary}</div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:gap-3">{children}</div>}
    </div>
  );
}
ResultsBar.propTypes = { summary: PropTypes.node, children: PropTypes.node };

/** a compact labelled select for the results bar (sort, per page) @param {{ id: string, label: string, value: string, onChange: (v: string) => void, children: import('react').ReactNode }} props */
export function InlineSelect({ id, label, value, onChange, children }) {
  return (
    <div className="flex items-center gap-2">
      {/* the label stays for screen readers on phones, where the row has room for the controls only */}
      <label htmlFor={id} className="sr-only text-sm text-slate-600 sm:not-sr-only">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-auto max-w-[9.5rem] rounded-lg sm:max-w-[13rem] border border-slate-300 bg-white ps-3 pe-8 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
        {children}
      </select>
    </div>
  );
}
InlineSelect.propTypes = { id: PropTypes.string.isRequired, label: PropTypes.string.isRequired, value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, children: PropTypes.node };

/**
 * The active filters as removable chips, and « Tout effacer ».
 * @param {{ items: { key: string, label: string, onRemove: () => void, lang?: string }[], onClear?: () => void }} props
 */
export function ActiveFilters({ items, onClear }) {
  const { t } = useT('shared');
  if (!items.length) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2" data-testid="active-filters">
      <span className="text-sm text-slate-600">{t('shared:filters.active', 'Filtres actifs :')}</span>
      <ul className="contents">
        {items.map((it) => (
          <li key={it.key}>
            <button type="button" onClick={it.onRemove} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 ps-3 pe-2 text-sm font-medium text-blue-900 hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
              aria-label={t('shared:filters.remove', 'Retirer le filtre {{label}}', { label: it.label })}>
              <span lang={it.lang}>{it.label}</span><X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {onClear && items.length > 1 && (
        <button type="button" onClick={onClear} className="min-h-9 rounded px-2 text-sm font-semibold text-blue-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700">
          {t('shared:filters.reset', 'Tout effacer')}
        </button>
      )}
    </div>
  );
}
ActiveFilters.propTypes = { items: PropTypes.array.isRequired, onClear: PropTypes.func };

/**
 * Previous / page x of y / next, the same on every page (texts come from the page's own namespace).
 * @param {{ page: number, totalPages: number, hasNext: boolean, onPage: (p: number) => void, label: string, previous: string, next: string, status: string }} props
 */
export function Pager({ page, totalPages, hasNext, onPage, label, previous, next, status }) {
  if (totalPages <= 1 && page <= 1) return null;
  return (
    <nav aria-label={label} className="mt-10 flex flex-wrap items-center justify-center gap-3" data-testid="pager">
      <Button type="button" variant="outline" className="h-11 min-w-28" disabled={page <= 1} onClick={() => onPage(page - 1)}>{previous}</Button>
      <span className="px-2 text-sm font-medium text-slate-700" aria-current="page">{status}</span>
      <Button type="button" variant="outline" className="h-11 min-w-28" disabled={!hasNext} onClick={() => onPage(page + 1)}>{next}</Button>
    </nav>
  );
}
Pager.propTypes = { page: PropTypes.number.isRequired, totalPages: PropTypes.number.isRequired, hasNext: PropTypes.bool.isRequired, onPage: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired, previous: PropTypes.string.isRequired, next: PropTypes.string.isRequired, status: PropTypes.string.isRequired };

/**
 * Horizontal quick choices (categories, types, zones): one row that scrolls on phones, wraps from `md`.
 * @param {{ label: string, options: { value: string, label: string, count?: number, lang?: string }[], value: string, onChange: (v: string) => void, testId?: string }} props
 */
export function ChoiceChips({ label, options, value, onChange, testId }) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 md:flex-wrap md:overflow-visible">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button key={o.value || 'all'} type="button" aria-pressed={active} onClick={() => onChange(active && o.value ? '' : o.value)}
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-1 ${active ? 'border-blue-800 bg-blue-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:text-blue-900'}`}>
            <span lang={o.lang}>{o.label}</span>
            {o.count != null && <span className={`text-xs ${active ? 'text-blue-100' : 'text-slate-500'}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
ChoiceChips.propTypes = { label: PropTypes.string.isRequired, options: PropTypes.array.isRequired, value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, testId: PropTypes.string };
