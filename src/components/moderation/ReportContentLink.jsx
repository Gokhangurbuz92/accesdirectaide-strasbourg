// @ts-nocheck
/**
 * G14 / DSA art. 16 — the link to « Signaler un contenu » under content published by users (testimonials, stories, job listings). Shown only when the build
 * opens the « notices » surface (the server keeps the form closed otherwise). The in-app report buttons of each item stay available to signed-in persons.
 */
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { frontendEnv } from '@/config/env';
import { noticesOpened } from '@/lib/publicBeta';

export default function ReportContentLink() {
  const { t } = useT('moderation');
  if (!noticesOpened(frontendEnv.flags.publicBeta)) return null;
  return (
    <p className="text-sm text-slate-700" data-testid="report-content-link">
      {t('moderation:link.text', 'Un contenu vous paraît illicite ou contraire aux règles ?')}{' '}
      <Link to="/signaler-un-contenu" className="font-semibold text-blue-800 underline underline-offset-2">{t('moderation:link.action', 'Signaler un contenu (sans compte)')}</Link>
    </p>
  );
}
