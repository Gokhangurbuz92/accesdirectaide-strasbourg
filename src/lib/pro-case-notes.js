// @ts-check
/**
 * A25: who wrote a case note — the member's address (the team's identifier everywhere else on the case page); a member who left the team shows
 * « compte inactif », never an internal id.
 * @param {string | null | undefined} authorId @param {{ id: string, email: string }[] | null | undefined} members the organisation's ACTIVE members
 * @param {import('i18next').TFunction} t @returns {string}
 */
export function noteAuthor(authorId, members, t) {
  const m = authorId ? (members || []).find((x) => x.id === authorId) : null;
  return m ? m.email : t('pro:cases.inactive_account', 'compte inactif');
}
