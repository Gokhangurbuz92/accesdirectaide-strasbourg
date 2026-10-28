import Sentry from './sentryServer.js';

export const setUserContext = (/** @type {Sentry.User | null} */ user) => {
  Sentry.setUser(user);
};

export const setTags = (/** @type {Record<string, string | number | boolean | null | undefined>} */ tags) => {
  Sentry.setTags(tags);
};

export default Sentry;
