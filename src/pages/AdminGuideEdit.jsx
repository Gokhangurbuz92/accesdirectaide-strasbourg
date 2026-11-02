// @ts-nocheck
import CatalogueEditor from '@/components/admin/CatalogueEditor';
import { useT } from '@/i18n';
import { useAdminCatalogueFields } from '@/lib/adminCatalogueFieldsI18n';

/** PKG-11 / A02 — create or edit a guide and its steps (ADA's own editorial content). */
export default function AdminGuideEdit() {
  const { t } = useT('admin');
  const { GUIDE_FIELDS } = useAdminCatalogueFields();
  return <CatalogueEditor kind="guide" title={t('admin:catalogue.guide.noun', 'guide')} fields={GUIDE_FIELDS} listPath="/admin/guides" />;
}
