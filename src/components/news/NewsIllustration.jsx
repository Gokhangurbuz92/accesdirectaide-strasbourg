// @ts-nocheck
/**
 * Actualités v2 — original ADA category illustrations (drawn for AccesDirectAide, no third-party image, no rights to clear). Used whenever an item has
 * no image with recorded rights. They illustrate a THEME; they never pretend to show the event. Decorative by default (the title says what the item is).
 */
import { useT } from '@/i18n';

/** colours come from the design tokens only (src/index.css: --muted, --chart-1..5; dark mode included): one motif colour and one accent per theme */
const tok = (n) => `hsl(var(--chart-${n}))`;
const BG = 'hsl(var(--muted))';
/** @type {Record<string, [number, number]>} */
const PAIRS = { logement: [4, 3], famille: [2, 3], sante: [1, 5], droits: [5, 3], emploi: [2, 4], education: [3, 4], handicap: [4, 3], justice: [5, 3],
  environnement: [2, 1], economie: [1, 4], international: [4, 2], politique: [5, 1], technologie: [4, 5], culture: [5, 3], strasbourg: [1, 3], societe: [1, 3] };
const PALETTE = Object.fromEntries(Object.entries(PAIRS).map(([k, [f, a]]) => [k, { bg: BG, fg: tok(f), accent: tok(a) }]));

/** simple geometric motifs, one per theme (paths in a 160×90 box) */
function Motif({ topic, fg, accent }) {
  switch (topic) {
    case 'logement': return (<g><path d="M40 62 L80 30 L120 62 Z" fill={fg} /><rect x="52" y="60" width="56" height="22" fill={fg} /><rect x="74" y="66" width="12" height="16" fill={accent} /></g>);
    case 'famille': return (<g fill={fg}><circle cx="62" cy="40" r="9" /><circle cx="98" cy="40" r="9" /><circle cx="80" cy="52" r="6" fill={accent} /><rect x="52" y="52" width="20" height="26" rx="8" /><rect x="88" y="52" width="20" height="26" rx="8" /><rect x="74" y="60" width="12" height="18" rx="5" fill={accent} /></g>);
    case 'sante': return (<g><rect x="68" y="24" width="24" height="56" rx="4" fill={fg} /><rect x="52" y="40" width="56" height="24" rx="4" fill={fg} /><circle cx="80" cy="52" r="6" fill={accent} /></g>);
    case 'justice': return (<g stroke={fg} strokeWidth="4" fill="none"><path d="M80 24 V78 M56 34 H104" /><path d="M56 34 L46 56 H66 Z M104 34 L94 56 H114 Z" fill={accent} /><path d="M66 80 H94" /></g>);
    case 'emploi': return (<g><rect x="50" y="38" width="60" height="40" rx="6" fill={fg} /><rect x="70" y="28" width="20" height="12" rx="3" fill="none" stroke={fg} strokeWidth="4" /><rect x="50" y="52" width="60" height="6" fill={accent} /></g>);
    case 'education': return (<g><path d="M40 44 L80 28 L120 44 L80 60 Z" fill={fg} /><path d="M58 52 V66 C70 74 90 74 102 66 V52" fill="none" stroke={fg} strokeWidth="4" /><path d="M116 46 V64" stroke={accent} strokeWidth="4" /></g>);
    case 'handicap': return (<g fill="none" stroke={fg} strokeWidth="5"><circle cx="82" cy="28" r="5" fill={fg} /><path d="M82 36 V56 H100 L106 72" /><circle cx="74" cy="62" r="16" stroke={accent} /></g>);
    case 'environnement': return (<g><path d="M80 80 C40 70 44 30 96 26 C100 60 90 76 80 80 Z" fill={fg} /><path d="M80 80 C80 60 86 46 96 30" stroke={accent} strokeWidth="3" fill="none" /></g>);
    case 'economie': return (<g fill={fg}><rect x="48" y="58" width="12" height="20" /><rect x="68" y="46" width="12" height="32" /><rect x="88" y="36" width="12" height="42" /><path d="M46 52 L74 36 L92 44 L116 24" stroke={accent} strokeWidth="4" fill="none" /></g>);
    case 'international': return (<g fill="none" stroke={fg} strokeWidth="4"><circle cx="80" cy="52" r="26" /><path d="M54 52 H106 M80 26 C66 40 66 64 80 78 C94 64 94 40 80 26" /><circle cx="80" cy="52" r="5" fill={accent} stroke="none" /></g>);
    case 'politique': return (<g><path d="M52 40 L80 26 L108 40 Z" fill={fg} /><g fill={fg}><rect x="56" y="44" width="8" height="28" /><rect x="76" y="44" width="8" height="28" /><rect x="96" y="44" width="8" height="28" /></g><rect x="50" y="74" width="60" height="6" fill={accent} /></g>);
    case 'technologie': return (<g><rect x="50" y="30" width="60" height="40" rx="5" fill={fg} /><rect x="56" y="36" width="48" height="26" fill="hsl(var(--background))" opacity=".85" /><path d="M64 50 L72 44 L80 52 L92 40" stroke={accent} strokeWidth="3" fill="none" /><rect x="66" y="72" width="28" height="6" rx="3" fill={fg} /></g>);
    case 'culture': return (<g><path d="M60 72 V34 L100 28 V66" stroke={fg} strokeWidth="5" fill="none" /><circle cx="54" cy="72" r="9" fill={fg} /><circle cx="94" cy="66" r="9" fill={accent} /></g>);
    case 'strasbourg': return (<g><path d="M80 18 L86 46 H74 Z" fill={fg} /><rect x="70" y="46" width="20" height="34" fill={fg} /><rect x="54" y="58" width="16" height="22" fill={fg} opacity=".8" /><rect x="90" y="58" width="16" height="22" fill={fg} opacity=".8" /><circle cx="80" cy="56" r="4" fill={accent} /></g>);
    case 'droits': return (<g><rect x="56" y="24" width="48" height="58" rx="4" fill={fg} /><g stroke="hsl(var(--background))" strokeWidth="3"><path d="M64 38 H96 M64 48 H96 M64 58 H86" /></g><circle cx="98" cy="72" r="10" fill={accent} /><path d="M93 72 L97 76 L104 68" stroke="hsl(var(--background))" strokeWidth="3" fill="none" /></g>);
    default: return (<g fill={fg}><circle cx="62" cy="44" r="8" /><circle cx="80" cy="38" r="8" fill={accent} /><circle cx="98" cy="44" r="8" /><rect x="52" y="54" width="20" height="22" rx="8" /><rect x="70" y="48" width="20" height="28" rx="8" /><rect x="88" y="54" width="20" height="22" rx="8" /></g>);
  }
}

/**
 * @param {{ topic?: string, className?: string, decorative?: boolean }} props
 */
export default function NewsIllustration({ topic = 'societe', className = '', decorative = true }) {
  const { t } = useT('news');
  const p = PALETTE[topic] || PALETTE.societe;
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t('news:image.illustration', 'Illustration de la rubrique (dessin original AccesDirectAide)') };
  return (
    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className={className} {...a11y} data-testid="news-illustration" data-topic={topic} focusable="false">
      <rect width="160" height="90" fill={p.bg} />
      <circle cx="140" cy="12" r="28" fill={p.accent} opacity=".18" />
      <circle cx="14" cy="84" r="22" fill={p.fg} opacity=".08" />
      <Motif topic={topic} fg={p.fg} accent={p.accent} />
    </svg>
  );
}
