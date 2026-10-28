// @ts-nocheck
import { sendMail } from '../_utils/mailer.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import logger from '../_utils/logger.js';

/**
 * POST /api/contact
 *
 * Sends a contact form submission by e-mail to the team inbox (contact@accesdirectaide.fr). Nothing is stored on the platform.
 * PKG-11 / P20 hardening:
 *  - CORS stays the router's allow-list (no `*`); the router refuses a cross-site browser Origin, but this path is exempt from the double-submit token
 *    (a first visit may have no token yet), so the per-IP rate limit CONTACT_FORM (fail-closed in production without KV) is the abuse control;
 *    a filled honeypot field is refused;
 *  - every value is validated (subject from the allow-list, bounded lengths, no line breaks in header-like fields) and HTML-escaped in the mail;
 *  - the « page concernée » is shown as text; it is a link only when it is a path or an https address of accesdirectaide.fr;
 *  - the acknowledgement sent to the given address carries no text from the form (no relay of attacker content to a third party);
 *  - the answer says honestly whether the message was handed to the mail provider, without naming the provider.
 */
const ADMIN_EMAIL = 'contact@accesdirectaide.fr';
const SUJET_LABELS = {
  question: 'Question',
  signalement_erreur: "Signalement d'erreur",
  suggestion: 'Suggestion',
  partenariat: 'Proposition de partenariat',
  autre: 'Autre',
};
const LIMITS = { nom: 100, email: 254, message: 5000, page: 300 };

export const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const oneLine = (v) => String(v ?? '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();   // control characters (CR, LF, NUL…) become a space

/** A path of the site or an https address of accesdirectaide.fr (or www.) — anything else is shown as plain text only. */
export function safePageLink(value) {
  const v = oneLine(value);
  if (/^\/(?!\/)[^\s]*$/.test(v)) return `https://accesdirectaide.fr${v}`;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' && ['accesdirectaide.fr', 'www.accesdirectaide.fr'].includes(u.hostname) && !u.username && !u.password) return u.href;
  } catch { /* not a URL */ }
  return null;
}

/** @returns {{ ok: true, value: { nom: string, email: string, sujet: string, message: string, page: string } } | { ok: false, status: number, body: object }} */
export function validateContact(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (oneLine(b.site_web)) return { ok: false, status: 400, body: { error: 'Formulaire non valide.', code: 'FORM_REJECTED' } };   // honeypot: hidden from people
  const email = oneLine(b.email);
  const sujet = oneLine(b.sujet);
  const message = String(b.message ?? '').replace(/\r\n?/g, '\n').trim();
  if (!email || !sujet || !message) return { ok: false, status: 400, body: { error: 'Champs obligatoires manquants', details: 'email, sujet et message sont requis.' } };
  if (email.length > LIMITS.email || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) return { ok: false, status: 400, body: { error: 'Format email invalide' } };
  if (!Object.hasOwn(SUJET_LABELS, sujet)) return { ok: false, status: 400, body: { error: 'Sujet inconnu' } };
  if (message.length > LIMITS.message) return { ok: false, status: 400, body: { error: `Message trop long (max ${LIMITS.message} caractères)` } };
  const nom = oneLine(b.nom).slice(0, LIMITS.nom);
  const page = oneLine(b.page_concernee).slice(0, LIMITS.page);
  return { ok: true, value: { nom, email, sujet, message, page } };
}

export default async function handler(/** @type {import('../_utils/http-types').ApiRequest} */ req, /** @type {import('../_utils/http-types').ApiResponse} */ res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rl = await checkRateLimit('CONTACT_FORM', getClientIp(req));
    if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Trop de tentatives.', code: 'RATE_LIMITED' });

    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body; } catch { return res.status(400).json({ error: 'Corps de requête invalide' }); }
    const v = validateContact(body);
    if (!v.ok) return res.status(v.status).json(v.body);
    const { nom, email, sujet, message, page } = v.value;

    const sujetLabel = SUJET_LABELS[sujet];
    const nomDisplay = nom || 'Anonyme';
    const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const link = page ? safePageLink(page) : null;

    const textContent = [
      `Nouveau message de contact — ${sujetLabel}`,
      '',
      `De : ${nomDisplay} (${email})`,
      `Date : ${timestamp}`,
      `Sujet : ${sujetLabel}`,
      page ? `Page concernée : ${page}` : null,
      '',
      '--- Message ---',
      message,
      '',
      '--- Fin du message ---',
      `Pour répondre, écrivez à ${email}.`,
    ].filter((l) => l !== null).join('\n');

    const e = escapeHtml;
    const pageRow = page ? `<tr><td style="padding: 4px 8px; color: #64748b;">Page</td><td style="padding: 4px 8px;">${link ? `<a href="${e(link)}">${e(page)}</a>` : e(page)}</td></tr>` : '';
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1e293b; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 18px;">Nouveau message de contact</h2>
          <p style="margin: 8px 0 0; opacity: 0.8; font-size: 14px;">${e(sujetLabel)}</p>
        </div>
        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
          <table style="width: 100%; font-size: 14px; margin-bottom: 16px;">
            <tr><td style="padding: 4px 8px; color: #64748b;">De</td><td style="padding: 4px 8px;"><strong>${e(nomDisplay)}</strong> &lt;${e(email)}&gt;</td></tr>
            <tr><td style="padding: 4px 8px; color: #64748b;">Date</td><td style="padding: 4px 8px;">${e(timestamp)}</td></tr>
            <tr><td style="padding: 4px 8px; color: #64748b;">Sujet</td><td style="padding: 4px 8px;">${e(sujetLabel)}</td></tr>
            ${pageRow}
          </table>
          <div style="background: white; padding: 16px; border-radius: 6px; border: 1px solid #e2e8f0; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${e(message)}</div>
          <p style="margin-top: 16px; font-size: 12px; color: #94a3b8;">Pour répondre, écrivez à ${e(email)} (adresse donnée par la personne, non vérifiée).</p>
        </div>
      </div>
    `.trim();

    const result = await sendMail({ to: ADMIN_EMAIL, subject: `[Contact] ${sujetLabel}`, text: textContent, html: htmlContent, category: 'contact-form' });
    logger.info({ sujet, outcome: result.outcome }, '[contact] Form submitted');

    if (!result.delivered) {
      return res.status(503).json({ ok: false, delivered: false, code: 'NOT_DELIVERED', error: "Votre message n'a pas pu être transmis. Écrivez-nous directement à contact@accesdirectaide.fr." });
    }

    // Acknowledgement: fixed text only — nothing typed in the form is sent to the given address.
    await sendMail({
      to: email,
      subject: 'Votre message a bien été transmis — Accès Direct Aide',
      text: "Bonjour,\n\nVotre message a bien été transmis à l'équipe d'Accès Direct Aide. Nous vous répondrons dès que possible.\n\nSi vous n'avez pas écrit à Accès Direct Aide, ignorez ce message.\n\nL'équipe Accès Direct Aide\ncontact@accesdirectaide.fr",
      category: 'contact-confirmation',
    });

    return res.status(200).json({ ok: true, delivered: true });
  } catch (err) {
    logger.error({ msg: '[contact] Error', name: err?.name }, '[contact] Error');
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
