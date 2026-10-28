/**
 * 👑 RBAC — Role-Based Access Control
 *
 * Defines granular roles and permissions for the Admin interface.
 * Used by AdminLayout to conditionally show/hide sidebar sections.
 *
 * Roles hierarchy:
 * - SUPER_ADMIN: Full access to everything
 * - EDITOR: Can manage content (aides, structures, démarches)
 * - MODERATOR: Can review and approve content
 * - VIEWER: Read-only access for auditing
 */

export const ROLES = /** @type {const} */ ({
  SUPER_ADMIN: 'super_admin',
  EDITOR: 'editor',
  MODERATOR: 'moderator',
  VIEWER: 'viewer',
});

/**
 * Permission → list of roles that have it.
 * @type {Record<string, readonly string[]>}
 */
export const PERMISSIONS = {
  // System admin
  MANAGE_USERS:    [ROLES.SUPER_ADMIN],
  MANAGE_FEATURES: [ROLES.SUPER_ADMIN],
  VIEW_SYSTEM:     [ROLES.SUPER_ADMIN],

  // Content management
  EDIT_CONTENT:    [ROLES.SUPER_ADMIN, ROLES.EDITOR],
  REVIEW_CONTENT:  [ROLES.SUPER_ADMIN, ROLES.EDITOR, ROLES.MODERATOR],

  // Read-only
  VIEW_DASHBOARD:  [ROLES.SUPER_ADMIN, ROLES.EDITOR, ROLES.MODERATOR, ROLES.VIEWER],
  VIEW_STATS:      [ROLES.SUPER_ADMIN, ROLES.EDITOR, ROLES.MODERATOR, ROLES.VIEWER],
};

/**
 * Check if a user role has a given permission.
 *
 * @param {string | undefined | null} userRole
 * @param {string} permission — key from PERMISSIONS
 * @returns {boolean}
 */
export function hasPermission(userRole, permission) {
  if (!userRole) return false;

  // Legacy 'admin' role is treated as SUPER_ADMIN
  // the server names its super-administrator role 'superadmin' (AdminUser.role); it was not mapped, so a real super-administrator saw fewer menu sections than an administrator
  const normalizedRole = userRole === 'admin' || userRole === 'superadmin' ? ROLES.SUPER_ADMIN : userRole;

  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(normalizedRole);
}

/**
 * Map sidebar section labels to their required permission.
 * Sections not listed here are visible to all authenticated admins.
 *
 * @type {Record<string, string>}
 */
export const SIDEBAR_PERMISSIONS = {
  'IA et fonctionnalités': 'MANAGE_FEATURES',
  'Technique': 'VIEW_SYSTEM',
};
