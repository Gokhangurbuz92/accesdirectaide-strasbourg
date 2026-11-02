// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { GUIDE_FIELDS } from '@/lib/adminCatalogueFields';

/** PKG-11 / A02 — create or edit a guide and its steps (ADA's own editorial content). */
export default function AdminGuideEdit() {
  const { t } = useT('admin');
  return <CatalogueEditor kind="guide" title={t('admin:catalogue.guide.noun', 'guide')} fields={GUIDE_FIELDS} listPath="/admin/guides" />;
}
