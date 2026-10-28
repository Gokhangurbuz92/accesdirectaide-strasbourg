/**
 * Prompt Sanitizer — strip dangerous patterns before feeding user input to AI models.
 *
 * Prevents prompt injection, HTML injection, and excessive input length.
 *
 * @param {string} input - raw user input
 * @param {number} [maxLength=2000] - maximum allowed length
 * @returns {string} - sanitized string safe for LLM prompt interpolation
 */
export function sanitizePromptInput(input, maxLength = 2000) {
  if (typeof input !== 'string') return '';

  return input
    .replace(/<[^>]*>/g, '')             // Strip HTML tags
    .replace(/```[\s\S]*?```/g, '')      // Strip markdown code blocks
    .replace(/\{[\s\S]*?\}/g, '')        // Strip JSON-like injections
    .replace(/\\/g, '')                  // Strip backslashes
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Strip control chars
    .trim()
    .slice(0, maxLength);
}
