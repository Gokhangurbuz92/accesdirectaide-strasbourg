/**
 * R47 — GET / PUT /api/pro/profile: a professional's PUBLIC display name and title (rules and validation: api/_services/pro-public-profile.js).
 *
 * GET  [?memberId=]  → { profile: { memberId, displayName, jobTitle }, canManageOthers, members? }   (members: the administrator only — their structure)
 * PUT  { memberId?, displayName, jobTitle } → 200 { ok, profile } | 400 { code, field } | 403 PROFILE_ADMIN_ONLY | 404 MEMBER_NOT_FOUND
 * Self-service for every member; the structure administrator for a member of their own structure. Journaled with ids and booleans only.
 */
import { AUTH_ROLE, logProAudit, requireProStructureContext } from '../../_utils/auth.js';
import { clientIp } from '../../_utils/client-ip.js';
import { withProRdvHandler } from '../../_utils/with-pro-rdv-handler.js';
import { membersWithProfiles, validatePublicProfile, writePublicProfile } from '../../_services/pro-public-profile.js';

const NOT_FOUND = Object.freeze({ error: 'Membre introuvable dans cette structure.', code: 'MEMBER_NOT_FOUND' });
const MESSAGES = Object.freeze({
  DISPLAYNAME_TOO_SHORT: 'Le nom affiché doit compter au moins 2 caractères.',
  DISPLAYNAME_TOO_LONG: 'Le nom affiché ne peut pas dépasser 60 caractères.',
  DISPLAYNAME_INVALID: 'Le nom affiché ne peut contenir que des lettres, des chiffres, des espaces et . , \' - ( ) & / — ni balise, ni adresse e-mail, ni lien.',
  JOBTITLE_TOO_LONG: 'La fonction ne peut pas dépasser 80 caractères.',
  JOBTITLE_INVALID: 'La fonction ne peut contenir que des lettres, des chiffres, des espaces et . , \' - ( ) & / — ni balise, ni adresse e-mail, ni lien.',
});

/** @param {{ role: string }} ctx */
const isAdmin = (ctx) => ctx.role === AUTH_ROLE.STRUCTURE_ADMIN || ctx.role === AUTH_ROLE.SUPERADMIN;

/**
 * @param {import('../../_utils/http-types').ApiRequest} req
 * @param {import('../../_utils/http-types').ApiResponse} res
 */
async function handler(req, res) {
  const proCtx = requireProStructureContext(req, res);
  if (!proCtx) return;
  const { structureId, userId } = proCtx;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.method === 'PUT' && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? /** @type {Record<string, unknown>} */ (req.body) : {};
  const rawId = req.method === 'PUT' ? (body.memberId ?? req.query?.memberId) : req.query?.memberId;
  const memberId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : userId;
  if (memberId !== userId && !isAdmin(proCtx)) return res.status(403).json({ error: 'PROFILE_ADMIN_ONLY', code: 'PROFILE_ADMIN_ONLY', message: 'Seul l’administrateur de la structure peut modifier le nom public d’un autre membre.' });
  const members = await membersWithProfiles(structureId);
  const member = members.find((m) => m.id === memberId);
  if (!member) return res.status(404).json(NOT_FOUND);

  if (req.method === 'GET') {
    return res.status(200).json({
      profile: { memberId, displayName: member.displayName, jobTitle: member.jobTitle },
      canManageOthers: isAdmin(proCtx),
      ...(isAdmin(proCtx) ? { members: members.map((m) => ({ id: m.id, email: m.email, displayName: m.displayName, jobTitle: m.jobTitle })) } : {}),
    });
  }

  const checked = validatePublicProfile(body);
  if (!checked.ok) return res.status(400).json({ error: checked.code, code: checked.code, field: checked.field, message: MESSAGES[/** @type {keyof typeof MESSAGES} */ (checked.code)] || 'Valeur refusée.' });
  await writePublicProfile(memberId, checked.value);
  await logProAudit('PRO_PROFILE_UPDATED', userId, structureId, { memberId, self: memberId === userId, displayNameSet: Boolean(checked.value.displayName), jobTitleSet: Boolean(checked.value.jobTitle) }, clientIp(req));
  return res.status(200).json({ ok: true, profile: { memberId, ...checked.value } });
}

export default withProRdvHandler('pro.profile', handler);
