/**
 * E-mail templates (subject + HTML) used by the sign-up, verification and password-reset handlers; the sending is api/_utils/mailer.js.
 *
 * Launch-readiness item 67: the former sendEmail() of this module (Mailjet) was removed — no caller used it, and without credentials it answered
 * « success » while sending nothing and wrote the recipient's address to the logs. A nonfunctional provider must never look like a delivery.
 * Links built here follow APP_BASE_URL (alias PUBLIC_BASE_URL); production refuses to build one without it (launch-readiness item 41) — they used to fall back
 * to the production site from any environment.
 */

import { env } from '../_utils/env.js';

/** @param {string} path */
function appUrl(path) {
  const base = String(env.runtime.appBaseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base) && (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production')) {
    throw Object.assign(new Error('APP_BASE_URL (https) is required in production'), { code: 'APP_BASE_URL_MISSING' });
  }
  return `${base || 'http://localhost:3000'}${path}`;
}
/** PKG-11 audit: names in the templates come from the person (e-mail local part, structure name): data, never markup. */
const esc = (/** @type {unknown} */ v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);

// ─────────────────────────────────────────────
// Email Templates
// ─────────────────────────────────────────────

const FOOTER = `
  <hr style="border: 0; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="font-size: 11px; color: #999; text-align: center;">
    Accès Direct Aide — Plateforme d'aide sociale inclusive<br>
    Ceci est un message automatique, merci de ne pas y répondre.
  </p>
`;

/**
 * @param {string} content - Main HTML content
 * @returns {string} - Wrapped in branded email layout
 */
function wrapTemplate(content) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #2563eb, #1e40af); padding: 24px; text-align: center;">
        <h1 style="color: white; font-size: 20px; font-weight: 700; margin: 0;">Accès Direct Aide</h1>
      </div>
      <div style="padding: 32px 24px;">
        ${content}
      </div>
      ${FOOTER}
    </div>
  `;
}

/**
 * @param {string} text
 * @param {string} url
 */
function ctaButton(text, url) {
  return `
    <div style="text-align: center; margin: 28px 0;">
      <a href="${url}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px;">
        ${text}
      </a>
    </div>
    <p style="font-size: 11px; color: #999; text-align: center;">
      Si le bouton ne fonctionne pas, copiez ce lien :<br>
      <a href="${url}" style="color: #2563eb; word-break: break-all;">${url}</a>
    </p>
  `;
}

export const templates = {
  /**
   * Welcome / email verification.
   * PKG-11 audit: the button linked to /auth/verify, a page that does not exist, and said « 24 heures » for a 15-minute link; the professional welcome passed a
   * made-up « pro-<id> » token. Callers now pass the real verification link (or null: no button) and its validity.
   * @param {string} name
   * @param {string | null} verifyUrl the full link built by the handler, or null for a welcome without verification
   * @param {string} [validity]
   */
  welcome(name, verifyUrl, validity = '15 minutes') {
    const url = /^https?:\/\//.test(String(verifyUrl || '')) ? String(verifyUrl) : null;
    return {
      subject: url ? 'Bienvenue sur Accès Direct Aide — Vérifiez votre email' : 'Bienvenue sur Accès Direct Aide',
      html: wrapTemplate(`
        <h2 style="color: #1e293b; font-size: 22px;">Bienvenue, ${esc(name)} !</h2>
        <p style="color: #475569; line-height: 1.6;">
          Merci de vous être inscrit sur Accès Direct Aide.${url ? ` Pour accéder à votre espace personnel
          et bénéficier de toutes les fonctionnalités, veuillez vérifier votre adresse email :` : ''}
        </p>
        ${url ? `${ctaButton('Vérifier mon adresse email', url)}
        <p style="color: #94a3b8; font-size: 12px;">Ce lien expire dans ${esc(validity)}.</p>` : ''}
      `),
    };
  },

  /**
   * Password reset.
   * @param {string} name
   * @param {string} resetTokenOrUrl the full link (or, legacy callers, the raw citizen token)
   * @param {string} [validity] how long the link works (citizen 15 minutes, professional 1 heure)
   */
  resetPassword(name, resetTokenOrUrl, validity = '15 minutes') {
    // PKG-11 audit: the button linked to /auth/reset-password, a page that does not exist (the citizen page is /auth/reset); callers now pass the full link
    const url = /^https?:\/\//.test(String(resetTokenOrUrl)) ? String(resetTokenOrUrl) : appUrl(`/auth/reset?token=${encodeURIComponent(String(resetTokenOrUrl))}`);
    return {
      subject: 'Réinitialisation de votre mot de passe — Accès Direct Aide',
      html: wrapTemplate(`
        <h2 style="color: #1e293b; font-size: 22px;">Réinitialisation du mot de passe</h2>
        <p style="color: #475569; line-height: 1.6;">
          Bonjour ${esc(name)},<br><br>
          Vous avez demandé la réinitialisation de votre mot de passe.
          Cliquez sur le bouton ci-dessous pour en choisir un nouveau :
        </p>
        ${ctaButton('Réinitialiser mon mot de passe', url)}
        <p style="color: #94a3b8; font-size: 12px;">
          Ce lien expire dans ${esc(validity)}. Si vous n'avez pas fait cette demande, ignorez cet email.
        </p>
      `),
    };
  },

  /**
   * Launch-readiness item 66 — confirmation of a NEW e-mail address (sent to that address).
   * @param {string} url the single-use confirmation link
   */
  emailChangeConfirm(url) {
    return {
      subject: 'Confirmez votre nouvelle adresse — Accès Direct Aide',
      html: wrapTemplate(`
        <h2 style="color: #1e293b; font-size: 22px;">Nouvelle adresse e-mail</h2>
        <p style="color: #475569; line-height: 1.6;">
          Vous avez demandé que cette adresse devienne celle de votre compte Accès Direct Aide.
          Pour confirmer, cliquez sur le bouton ci-dessous :
        </p>
        ${ctaButton('Confirmer cette adresse', url)}
        <p style="color: #94a3b8; font-size: 12px;">
          Ce lien expire dans 30 minutes et ne sert qu'une fois. Après la confirmation, reconnectez-vous avec cette adresse.
          Si vous n'avez pas fait cette demande, ignorez cet e-mail : rien ne changera.
        </p>
      `),
    };
  },

  /** Launch-readiness item 66 — notice to the CURRENT address that a change was requested (no link, no new address). */
  emailChangeNotice() {
    const text = 'Une demande de changement de l’adresse e-mail de votre compte Accès Direct Aide vient d’être faite. Si ce n’est pas vous, connectez-vous et changez votre mot de passe : tant que la nouvelle adresse n’est pas confirmée, rien ne change.';
    return {
      subject: 'Demande de changement d’adresse — Accès Direct Aide',
      text,
      html: wrapTemplate(`
        <h2 style="color: #1e293b; font-size: 22px;">Changement d'adresse demandé</h2>
        <p style="color: #475569; line-height: 1.6;">${esc(text)}</p>
      `),
    };
  },

  /**
   * Appointment confirmation.
   * @param {{ name: string, service: string, date: string, time: string, mode: string, reference: string }} params
   */
  appointmentConfirmation({ name, service, date, time, mode, reference }) {
    return {
      subject: `Rendez-vous confirmé — ${service}`,
      html: wrapTemplate(`
        <h2 style="color: #1e293b; font-size: 22px;">Rendez-vous confirmé ✓</h2>
        <p style="color: #475569; line-height: 1.6;">
          Bonjour ${name}, votre rendez-vous est bien enregistré :
        </p>
        <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 12px;">Service</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">${service}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 12px;">Date</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">${date} à ${time}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 12px;">Mode</td><td style="padding: 6px 0; font-weight: 600; color: #1e293b;">${mode === 'VIDEO' ? 'Visioconférence' : 'Sur place'}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 12px;">Référence</td><td style="padding: 6px 0; font-family: monospace; font-weight: 600; color: #1e293b;">${reference}</td></tr>
          </table>
        </div>
        ${ctaButton('Voir mes rendez-vous', appUrl('/compte/rdv'))}
      `),
    };
  },

  /**
   * Appointment reminder (24h before).
   * @param {{ name: string, service: string, date: string, time: string }} params
   */
  appointmentReminder({ name, service, date, time }) {
    return {
      subject: `Rappel — RDV demain à ${time}`,
      html: wrapTemplate(`
        <h2 style="color: #1e293b; font-size: 22px;">Rappel de rendez-vous</h2>
        <p style="color: #475569; line-height: 1.6;">
          Bonjour ${name},<br><br>
          Vous avez un rendez-vous <strong>${service}</strong> prévu demain
          <strong>${date}</strong> à <strong>${time}</strong>.
        </p>
        ${ctaButton('Accéder à mon espace', appUrl('/compte/rdv'))}
      `),
    };
  },
};
