import PropTypes from 'prop-types';

/**
 * The page header of the public site: the Démarches banner (navy → blue → indigo, theme token `bg-ada-hero`), left-aligned title and one sentence,
 * shared by every catalogue, information and legal page.
 * 11/11/2026 redesign: compact (it used to take up to a third of a phone screen), no fade band into the page, the page's search can sit inside it
 * (`children`), and an optional `aside` (e.g. a count) on the end side from `md`.
 * @param {{ title: import('react').ReactNode, description?: import('react').ReactNode, eyebrow?: import('react').ReactNode, children?: import('react').ReactNode,
 *   aside?: import('react').ReactNode, width?: 'wide' | 'reading', titleId?: string }} props
 */
export default function PageHeader({ title, description, eyebrow = null, children = null, aside = null, width = 'wide', titleId = undefined }) {
  return (
    <div className="relative isolate overflow-hidden bg-ada-hero" data-testid="page-header">
      <div className="pointer-events-none absolute -top-32 -end-24 -z-10 h-96 w-96 rounded-full bg-ada-hero-glow opacity-40" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-40 start-1/3 -z-10 h-80 w-80 rounded-full bg-ada-hero-glow opacity-20" aria-hidden="true" />
      <div className={`relative mx-auto px-4 sm:px-6 lg:px-8 ${width === 'reading' ? 'max-w-4xl' : 'max-w-7xl'} ${children ? 'pb-7 pt-7 sm:pb-9 sm:pt-9' : 'py-7 sm:py-9'}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 max-w-3xl">
            {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-200">{eyebrow}</p>}
            <h1 id={titleId} className="font-heading text-[1.75rem] font-bold leading-tight tracking-tight text-white sm:text-4xl">{title}</h1>
            {description && <p className="mt-2 text-base leading-relaxed text-blue-100 sm:text-lg">{description}</p>}
          </div>
          {aside && <div className="shrink-0 text-blue-100">{aside}</div>}
        </div>
        {children && <div className="mt-5 sm:mt-6">{children}</div>}
      </div>
    </div>
  );
}

PageHeader.propTypes = {
  title: PropTypes.node.isRequired,
  description: PropTypes.node,
  eyebrow: PropTypes.node,
  children: PropTypes.node,
  aside: PropTypes.node,
  width: PropTypes.oneOf(['wide', 'reading']),
  titleId: PropTypes.string,
};
