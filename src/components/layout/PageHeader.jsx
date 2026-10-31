import PropTypes from 'prop-types';

/**
 * The page header of the public site (R26 design pass): the Démarches banner — dark blue gradient, left-aligned title and one sentence — shared by
 * every catalogue, information and legal page instead of each page drawing its own (centered dark blocks, icons in tiles, bare titles…).
 */
export default function PageHeader({ title, description, eyebrow = null, children = null, width = 'wide', titleId = undefined }) {
  return (
    <div
      className="relative overflow-hidden py-10 sm:py-14"
      style={{ background: 'linear-gradient(135deg, #020617 0%, #002D5A 30%, #1e3a8a 60%, #3730a3 85%, #4F46E5 100%)' }}
      data-testid="page-header"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #818cf8 0%, transparent 70%)' }} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-50 to-transparent" aria-hidden="true" />
      <div className={`relative z-10 mx-auto px-4 sm:px-6 lg:px-8 ${width === 'reading' ? 'max-w-4xl' : 'max-w-7xl'}`}>
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-200">{eyebrow}</p>}
        <h1 id={titleId} className="text-2xl sm:text-3xl font-bold text-white drop-shadow-md">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-blue-100/90 text-sm sm:text-base">{description}</p>}
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}

PageHeader.propTypes = {
  title: PropTypes.node.isRequired,
  description: PropTypes.node,
  eyebrow: PropTypes.node,
  children: PropTypes.node,
  width: PropTypes.oneOf(['wide', 'reading']),
  titleId: PropTypes.string,
};
