/**
 * R47 — the password rule and the « too weak » message IN THE INTERFACE LANGUAGE. src/lib/passwordPolicy.js stays the one French definition shared with the
 * server (its refusal is the same sentence); the screens show it through these keys, whose French defaults are that same text (a unit test keeps them equal),
 * so a visitor reading in English, Turkish, Arabic, German or Ukrainian is no longer told the rule in French.
 */
import i18n from '@/i18n';

/** the rule, stated before the password is typed */
export const passwordRuleText = () => i18n.t('common:password.rule', 'Au moins 8 caractères, dont une majuscule, une minuscule et un chiffre.');

/** @param {string} problem one item of passwordProblems() (French, the server's `details` wording) */
const problemText = (problem) => ({
  '8 caractères minimum': i18n.t('common:password.problem.length', '8 caractères minimum'),
  '1 majuscule requise': i18n.t('common:password.problem.upper', '1 majuscule requise'),
  '1 minuscule requise': i18n.t('common:password.problem.lower', '1 minuscule requise'),
  '1 chiffre requis': i18n.t('common:password.problem.digit', '1 chiffre requis'),
})[problem] || problem;

/** @param {string[]} problems what passwordProblems() found missing @returns {string} « Mot de passe trop faible : … » in the interface language */
export const passwordMessageText = (problems) => i18n.t('common:password.too_weak', 'Mot de passe trop faible : {{problems}}.', { problems: problems.map(problemText).join(', ') });
