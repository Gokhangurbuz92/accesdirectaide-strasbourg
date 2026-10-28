// @ts-nocheck
import crypto from 'crypto';
import * as Sentry from '@sentry/node';

import { db } from '../../src/db/index.js';
import { applyNoStore } from '../_utils/cache.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { buildProvenance } from '../_utils/provenance.js';
import { decide, visibleWhere } from '../lib/publicVisibility.js';
import { htmlToPlainText } from '../_utils/html-text.js';
import { logger } from '../lib/logger.js';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 48;
const UUID_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string | null | undefined} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toSafeString(value) {
  if (value == null) return '';
  return htmlToPlainText(String(value)).trim();
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toSafeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toSafeString(item))
    .filter(isNonEmptyString);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStepLines(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((step, idx) => {
      if (typeof step === 'string') {
        const line = toSafeString(step);
        return line ? `${idx + 1}. ${line}` : null;
      }
      if (!step || typeof step !== 'object') return null;

      const title = toSafeString(step.titre || step.title || step.nom || `Étape ${idx + 1}`);
      const description = toSafeString(step.description || step.contenu || step.text);
      if (!title && !description) return null;
      if (!description) return `${idx + 1}. ${title}`;
      return `${idx + 1}. ${title}: ${description}`;
    })
    .filter(isNonEmptyString);
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function sanitizeFileSegment(value) {
  const raw = String(value || '').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'fiche';
}

/**
 * @param {string | undefined} url
 * @param {string | undefined} host
 * @returns {{ kind: 'aides' | 'demarches', identifier: string } | null}
 */
function parsePdfPath(url, host = 'localhost') {
  try {
    const parsed = new URL(url || '/', `https://${host}`);
    const pathname = parsed.pathname || '';
    const match = pathname.match(/^\/(?:api\/)?pdf\/(aides|demarches)\/([^/?#]+)$/i);
    if (!match) return null;
    const kind = String(match[1]).toLowerCase();
    const identifier = decodeURIComponent(match[2] || '').trim();
    if (!identifier) return null;
    if (kind !== 'aides' && kind !== 'demarches') return null;
    return { kind, identifier };
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function formatDateFr(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR');
}

/**
 * @param {unknown} verifiedAt
 * @returns {string}
 */
function getFreshnessLabel(verifiedAt) {
  return formatDateFr(verifiedAt) ? 'Vérifié' : 'À vérifier';
}

/**
 * @param {string} identifier
 * @param {'aide' | 'demarche'} kind
 */
function buildIdentifierWhere(identifier, kind) {
  // D-5: a PDF is produced only for content that is publicly visible (published AND verified/current/eligible); otherwise the same 404 as an unknown identifier.
  if (UUID_LIKE_REGEX.test(identifier)) {
    // @ts-ignore
    return (/** @type {any} */ t, { eq, or, and: andOp }) => andOp(or(eq(t.slug, identifier), eq(t.id, identifier)), visibleWhere(t, kind));
  }
  // @ts-ignore
  return (/** @type {any} */ t, { eq, and: andOp }) => andOp(eq(t.slug, identifier), visibleWhere(t, kind));
}

/**
 * @param {string} identifier
 */
async function loadAide(identifier) {
  return db.query.Aide.findFirst({
    where: buildIdentifierWhere(identifier, 'aide'),
    columns: {
      id: true,
      slug: true,
      titre: true,
      categorie: true,
      cest_quoi: true,
      pour_qui: true,
      ce_que_ca_aide: true,
      documents_necessaires: true,
      etapes: true,
      ou_demander: true,
      apply_url: true,
      lien_demande: true,
      date_verification: true,
      statut: true, launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true, source_url_exact: true,
      source_name: true,
      source_url: true,
    },
    with: {
      sourceDocument: {
        columns: {
          fetched_at: true,
          source_url: true,
        },
      },
    },
  });
}

/**
 * @param {string} identifier
 */
async function loadDemarche(identifier) {
  return db.query.Demarche.findFirst({
    where: buildIdentifierWhere(identifier, 'demarche'),
    columns: {
      id: true,
      slug: true,
      titre: true,
      categorie: true,
      summary_falc: true,
      description_courte: true,
      pour_qui: true,
      documents_necessaires: true,
      etapes: true,
      ou_faire: true,
      lien_officiel: true,
      date_verification: true,
      statut: true, launch_eligible: true, verification_status: true, verified_by: true, territory_verified: true, publication_hold: true, data_origin: true, source_url_exact: true,
      source_url: true,
    },
    with: {
      sourceDocument: {
        columns: {
          fetched_at: true,
          source_url: true,
        },
      },
    },
  });
}

/**
 * @param {{
 *   title: string,
 *   subtitle?: string | null,
 *   typeLabel: string,
 *   provenance: {
 *     verifiedAt: string | null,
 *     fetchedAt: string | null,
 *     sourceUrl: string | null,
 *   },
 *   sections: Array<{ title: string, text?: string, items?: string[] }>,
 * }} payload
 */
async function renderPdf(payload) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  
  const BODY_COLOR = rgb(0.13, 0.16, 0.2);
  const MUTED_COLOR = rgb(0.36, 0.4, 0.47);

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - PAGE_MARGIN;
  const contentWidth = A4_WIDTH - PAGE_MARGIN * 2;

  /**
   * @param {number} size
   * @param {number} [lineHeight]
   * @returns {number}
   */
  function computeLineHeight(size, lineHeight) {
    return lineHeight || size * 1.4;
  }

  /**
   * @param {string} text
   * @param {import('pdf-lib').PDFFont} font
   * @param {number} size
   * @param {number} maxWidth
   * @returns {string[]}
   */
  function wrapText(text, font, size, maxWidth) {
    const paragraphs = String(text || '').split('\n');
    /** @type {string[]} */
    const lines = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push('');
        continue;
      }

      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
          continue;
        }

        if (current) {
          lines.push(current);
          current = '';
        }

        if (font.widthOfTextAtSize(word, size) <= maxWidth) {
          current = word;
          continue;
        }

        let chunk = '';
        for (const char of word) {
          const next = `${chunk}${char}`;
          if (font.widthOfTextAtSize(next, size) <= maxWidth) {
            chunk = next;
          } else {
            if (chunk) lines.push(chunk);
            chunk = char;
          }
        }
        current = chunk;
      }

      if (current) lines.push(current);
    }

    return lines.length > 0 ? lines : [''];
  }

  function addPage() {
    page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - PAGE_MARGIN;
  }

  /**
   * @param {number} lines
   * @param {number} size
   * @param {number} [lineHeight]
   */
  function ensureSpace(lines, size, lineHeight) {
    const effectiveLineHeight = computeLineHeight(size, lineHeight);
    const required = lines * effectiveLineHeight + 4;
    if (y - required < PAGE_MARGIN) addPage();
  }

  /**
   * @param {string} text
   * @param {{
   *   font?: import('pdf-lib').PDFFont,
   *   size?: number,
   *   color?: import('pdf-lib').RGB,
   *   lineHeight?: number,
   *   indent?: number,
   * }} [options]
   */
  function drawParagraph(text, options = {}) {
    const safeText = String(text || '').trim();
    if (!safeText) return;

    const font = options.font || fontRegular;
    const size = options.size || 11;
    const color = options.color || BODY_COLOR;
    const indent = options.indent || 0;
    const lineHeight = computeLineHeight(size, options.lineHeight);
    const lines = wrapText(safeText, font, size, contentWidth - indent);
    ensureSpace(lines.length, size, lineHeight);

    for (const line of lines) {
      if (y - lineHeight < PAGE_MARGIN) addPage();
      if (line) {
        page.drawText(line, {
          x: PAGE_MARGIN + indent,
          y,
          size,
          font,
          color,
        });
      }
      y -= lineHeight;
    }
  }

  function addGap(height = 8) {
    y -= height;
    if (y < PAGE_MARGIN) addPage();
  }

  drawParagraph(payload.title, { font: fontBold, size: 20, lineHeight: 26, color: rgb(0.08, 0.12, 0.2) });
  if (payload.subtitle) {
    drawParagraph(payload.subtitle, { size: 11, color: MUTED_COLOR });
  }
  addGap(8);

  drawParagraph(`Type: ${payload.typeLabel}`, { size: 10, color: MUTED_COLOR });
  drawParagraph(`Fraîcheur: ${getFreshnessLabel(payload.provenance.verifiedAt)}`, { size: 10, color: MUTED_COLOR });
  drawParagraph(
    `Date de vérification: ${formatDateFr(payload.provenance.verifiedAt) || 'Non renseignée'}`,
    { size: 10, color: MUTED_COLOR },
  );
  drawParagraph(
    `Dernière collecte: ${formatDateFr(payload.provenance.fetchedAt) || 'Non renseignée'}`,
    { size: 10, color: MUTED_COLOR },
  );
  drawParagraph(
    `Source officielle: ${payload.provenance.sourceUrl || 'Non renseignée'}`,
    { size: 10, color: MUTED_COLOR },
  );

  addGap(10);

  for (const section of payload.sections) {
    const title = toSafeString(section.title);
    if (!title) continue;
    drawParagraph(title, { font: fontBold, size: 13, lineHeight: 18, color: rgb(0.1, 0.14, 0.22) });
    addGap(4);

    if (section.text) {
      drawParagraph(section.text, { size: 11, lineHeight: 15.5 });
      addGap(8);
      continue;
    }

    if (Array.isArray(section.items) && section.items.length > 0) {
      for (const item of section.items) {
        drawParagraph(`- ${item}`, { size: 11, lineHeight: 15.5 });
      }
      addGap(8);
    }
  }

  addGap(12);
  drawParagraph(`Document généré par Accès Direct Aide le ${new Date().toLocaleString('fr-FR')}.`, {
    size: 9,
    color: MUTED_COLOR,
  });
  if (payload.provenance.sourceUrl) {
    drawParagraph(`URL source officielle: ${payload.provenance.sourceUrl}`, {
      size: 9,
      color: MUTED_COLOR,
    });
  }

  return Buffer.from(await pdfDoc.save());
}

/**
 * @param {{
 *  kind: 'aides' | 'demarches',
 *  identifier: string,
 * }} target
 */
async function buildPayload(target) {
  if (target.kind === 'aides') {
    const aide = await loadAide(target.identifier);
    if (!aide) return null;

    const provenance = buildProvenance({
      verifiedAt: decide(aide, 'aide').contentStatus === 'VERIFIED' ? aide.date_verification : null,
      fetchedAt: aide.sourceDocument?.fetched_at,
      sourceUrl: aide.sourceDocument?.source_url || aide.source_url,
    });

    return {
      type: 'aides',
      filename: `acces-direct-aide-aide-${sanitizeFileSegment(aide.slug || aide.id)}.pdf`,
      document: {
        title: toSafeString(aide.titre) || 'Fiche aide',
        subtitle: aide.categorie ? `Catégorie: ${toSafeString(aide.categorie)}` : null,
        typeLabel: 'Aide',
        provenance,
        sections: [
          { title: "C'est quoi ?", text: toSafeString(aide.cest_quoi) },
          { title: 'Pour qui ?', text: toSafeString(aide.pour_qui) },
          { title: 'Ce que ça aide', text: toSafeString(aide.ce_que_ca_aide) },
          { title: 'Documents nécessaires', items: toSafeStringArray(aide.documents_necessaires) },
          { title: 'Étapes', items: toStepLines(aide.etapes) },
          {
            title: 'Où faire la demande ?',
            text: toSafeString(aide.ou_demander)
              || toSafeString(aide.apply_url)
              || toSafeString(aide.lien_demande),
          },
        ],
      },
    };
  }

  const demarche = await loadDemarche(target.identifier);
  if (!demarche) return null;

  const provenance = buildProvenance({
    verifiedAt: decide(demarche, 'demarche').contentStatus === 'VERIFIED' ? demarche.date_verification : null,
    fetchedAt: demarche.sourceDocument?.fetched_at,
    sourceUrl: demarche.sourceDocument?.source_url || demarche.source_url,
  });

  return {
    type: 'demarches',
    filename: `acces-direct-aide-demarche-${sanitizeFileSegment(demarche.slug || demarche.id)}.pdf`,
    document: {
      title: toSafeString(demarche.titre) || 'Fiche démarche',
      subtitle: demarche.categorie ? `Catégorie: ${toSafeString(demarche.categorie)}` : null,
      typeLabel: 'Démarche',
      provenance,
      sections: [
        { title: 'Résumé', text: toSafeString(demarche.summary_falc || demarche.description_courte) },
        { title: 'Pour qui ?', text: toSafeString(demarche.pour_qui) },
        { title: 'Documents nécessaires', items: toSafeStringArray(demarche.documents_necessaires) },
        { title: 'Étapes', items: toStepLines(demarche.etapes) },
        { title: 'Où faire cette démarche ?', text: toSafeString(demarche.ou_faire || demarche.lien_officiel) },
      ],
    },
  };
}

/**
 * @param {import('../_utils/http-types').ApiRequest} req
 * @param {import('../_utils/http-types').ApiResponse} res
 */
export default async function handler(req, res) {
  const requestId = req.requestId || crypto.randomUUID();
  applyNoStore(res);

  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      requestId,
      error: 'method_not_allowed',
    });
  }
  // R12: rate limited (was unbounded; each request renders a PDF)
  const limited = await checkRateLimit('PDF_EXPORT', getClientIp(req));
  if (!limited.allowed) return res.status(getRateLimitStatus(limited)).json({ ok: false, requestId, ...(limited.error || { error: 'rate_limited' }) });

  const route = parsePdfPath(req.url, req.headers?.host);
  if (!route) {
    return res.status(404).json({
      ok: false,
      requestId,
      error: 'not_found',
    });
  }

  try {
    const payload = await buildPayload(route);
    if (!payload) {
      return res.status(404).json({
        ok: false,
        requestId,
        error: 'not_found',
      });
    }

    const pdfBuffer = await renderPdf(payload.document);
    logger.info('pdf.export.success', {
      requestId,
      type: payload.type,
      identifier: route.identifier,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    logger.warn('pdf.export.error', {
      requestId,
      type: route.kind,
      identifier: route.identifier,
      error: error instanceof Error ? error.message : 'unknown_error',
    });

    Sentry.captureException(error, {
      tags: {
        requestId,
        route: 'pdf',
        module: 'pdf-export',
      },
      extra: {
        type: route.kind,
      },
    });

    return res.status(500).json({
      ok: false,
      requestId,
      error: 'internal_error',
    });
  }
}
