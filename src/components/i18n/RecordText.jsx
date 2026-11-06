import { useLanguage } from '@/i18n';
import { frAttrs } from '@/lib/recordLang';

/**
 * R47 — French record text (a name, a title, a description written in French) on a page in any interface language: marked lang="fr" dir="ltr" outside
 * French, unless `translated` (the text shown is a checked translation). See src/lib/recordLang.js.
 * @param {{ as?: any, translated?: boolean, children?: import('react').ReactNode } & Record<string, unknown>} props
 */
export default function RecordText({ as: Tag = 'span', translated = false, children, ...rest }) {
  const { code } = useLanguage();
  return <Tag {...rest} {...frAttrs(code, { translated })}>{children}</Tag>;
}
