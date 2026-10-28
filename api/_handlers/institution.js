// @ts-nocheck
import logger from '../_utils/logger.js';
import { checkRateLimit, getClientIp, getRateLimitStatus } from '../_utils/rateLimit.js';
import { resolveInstitution } from '../_utils/institution-auth.js';
import { institutionLogin, changeInstitutionPassword, institutionLogout, requestInstitutionReset, completeInstitutionReset, INSTITUTION_RESET_MINUTES } from '../_services/institutions.js';
import { sendMail, getMailerStatus } from '../_utils/mailer.js';
import { templates } from '../lib/email-service.js';
import { env } from '../_utils/env.js';
import { observatoire, territoryCsv } from '../_services/territorial-stats.js';
import { isFeatureOn } from '../_services/feature-flags.js';

/**
 * PKG-5 / I01 I03 I04 — the institutional space (separate login, aggregates only):
 *   POST institution/login {email, password}
 *   POST institution/password {currentPassword, newPassword} (R21: other sessions end, a new token for this one) | POST institution/logout (R21: server-side)
 *   POST institution/forgot {email} | POST institution/reset {token, password} (R24, owner decision R21.1: self-service reset link by e-mail, 30 minutes, once)
 *   GET  institution/me | institution/observatoire | institution/export?period=month|quarter|year (CSV; needs the OPEN_DATA_EXPORT flag: licence still to decide)
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const path = new URL(req.url || '/', 'http://x').pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  try {
    if (path === 'institution/login') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const rl = await checkRateLimit('LOGIN_USER', `institution:${getClientIp(req)}`);
      if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Too many attempts' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const out = await institutionLogin(b);
      return out.ok ? res.status(200).json({ token: out.token, temporaryPassword: out.temporaryPassword }) : res.status(out.status).json({ error: out.code, message: out.message });
    }
    if (path === 'institution/forgot') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const ip = getClientIp(req);
      const rl = await checkRateLimit('RESET_PASSWORD', `institution-forgot:${ip}`);
      if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Too many attempts', message: 'Trop de demandes : réessayez plus tard.' });
      const email = String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 254);
      if (!email) return res.status(400).json({ error: 'MISSING_EMAIL', message: 'Indiquez l’adresse e-mail de votre compte.' });
      // R12 (C01) like the professional page: « a link was sent » only when this service can send e-mail at all (configuration only, the same for every address)
      if (!getMailerStatus().deliverable) {
        return res.status(200).json({ emailDelivery: 'UNAVAILABLE', message: 'L’envoi d’e-mails n’est pas disponible sur ce service pour le moment : aucun lien n’a pu être envoyé. Contactez ADA, qui peut vous remettre un mot de passe provisoire.' });
      }
      const perAddress = await checkRateLimit('RESET_PASSWORD', `institution-forgot-to:${email}`);
      const link = perAddress.allowed ? await requestInstitutionReset(email) : null;   // the answer below never says whether the address is known
      if (link) {
        const url = `${env.runtime.appBaseUrl || 'http://localhost:3000'}/institution/reinitialiser#token=${link.token}`;   // in the fragment: never sent to a server log
        const tpl = templates.resetPassword(link.organisationName, url, `${INSTITUTION_RESET_MINUTES} minutes`);
        await sendMail({ to: link.email, subject: `${tpl.subject} — espace institutionnel`, text: `Lien de réinitialisation de votre espace institutionnel (valable ${INSTITUTION_RESET_MINUTES} minutes, une seule fois) : ${url}`, html: tpl.html, category: 'password_reset' });
      }
      return res.status(200).json({ emailDelivery: 'SENT_IF_VALID', message: `Si un compte institutionnel actif correspond à cette adresse, un lien valable ${INSTITUTION_RESET_MINUTES} minutes vient de lui être envoyé.` });
    }
    if (path === 'institution/reset') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const rl = await checkRateLimit('LOGIN_USER', `institution-reset:${getClientIp(req)}`);
      if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Too many attempts', message: 'Trop d’essais : réessayez plus tard.' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const out = await completeInstitutionReset({ token: b.token, password: b.password });
      return out.ok ? res.status(200).json({ ok: true, message: out.message }) : res.status(out.status).json({ error: out.code, message: out.message });
    }
    if (path === 'institution/password' || path === 'institution/logout') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const who = await resolveInstitution(req);
      if (!who) return res.status(401).json({ error: 'Unauthorized', message: 'Votre session a pris fin. Reconnectez-vous.' });
      if (path === 'institution/logout') {
        try { await institutionLogout(who); } catch { return res.status(503).json({ error: 'LOGOUT_FAILED', message: 'Déconnexion impossible pour le moment. Fermez votre navigateur et réessayez.' }); }
        return res.status(200).json({ ok: true });
      }
      const rl = await checkRateLimit('LOGIN_USER', `institution-password:${who.id}`);
      if (!rl.allowed) return res.status(getRateLimitStatus(rl)).json(rl.error || { error: 'Too many attempts', message: 'Trop d’essais : réessayez dans quelques minutes.' });
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const out = await changeInstitutionPassword(who, b);
      return out.ok ? res.status(200).json({ token: out.token, message: out.message }) : res.status(out.status).json({ error: out.code, message: out.message });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const inst = await resolveInstitution(req);
    if (!inst) return res.status(401).json({ error: 'Unauthorized' });
    if (path === 'institution/me') return res.status(200).json({ organisation: inst.organisation, territory: inst.territory, email: inst.email, temporaryPassword: inst.temporaryPassword });
    if (path === 'institution/observatoire') return res.status(200).json(await observatoire());
    if (path === 'institution/export') {
      if (!(await isFeatureOn('OPEN_DATA_EXPORT'))) return res.status(503).json({ error: 'EXPORT_NOT_OPEN', message: 'Export fermé : la licence et la publication des données restent à décider par ADA.' });
      const out = await territoryCsv(String(req.query?.period || 'quarter'));
      if (!out.ok) return res.status(out.status || 400).json({ error: out.code, message: out.message });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="territoire-${out.period}.csv"`); res.setHeader('X-Content-SHA256', out.sha256);
      return res.status(200).send(out.csv);
    }
    return res.status(404).json({ error: 'Not Found' });
  } catch (error) {
    logger.error({ err: { name: error?.name } }, '[Institution] failed');
    return res.status(500).json({ error: 'INSTITUTION_FAILED' });
  }
}
