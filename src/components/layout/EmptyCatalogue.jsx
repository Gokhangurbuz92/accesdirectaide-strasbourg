import PropTypes from 'prop-types';
import VerifiedCatalogue from '@/components/layout/VerifiedCatalogue';

/**
 * An empty catalogue said plainly (R26): why nothing is published yet, then what the visitor can use instead — never decorative filters over nothing.
 */
export default function EmptyCatalogue({ title, children, testId, exclude = [] }) {
  return (
    <div className="space-y-10" data-testid={testId}>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <div className="mt-2 max-w-3xl space-y-2 text-slate-700">{children}</div>
      </div>
      <VerifiedCatalogue heading="En attendant, vous pouvez consulter" exclude={exclude} />
    </div>
  );
}

EmptyCatalogue.propTypes = { title: PropTypes.string.isRequired, children: PropTypes.node, testId: PropTypes.string, exclude: PropTypes.arrayOf(PropTypes.string) };
