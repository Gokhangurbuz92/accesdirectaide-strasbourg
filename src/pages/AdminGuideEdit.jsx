// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { GUIDE_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit a guide and its steps (ADA's own editorial content). */
export default function AdminGuideEdit() {
  return <CatalogueEditor kind="guide" title="guide" fields={GUIDE_FIELDS} listPath="/admin/guides" />;
}
