/**
 * Sanitize strings for logging so API keys and secrets are never written to logs.
 * Used in error handler and any place we log user-provided or third-party data.
 */

const REDACT = '[REDACTED]';

/** Google API key prefix; redact entire match. */
const GOOGLE_KEY_RE = /\bAIza[A-Za-z0-9_-]{35}\b/g;
/** key=value (redact value only). */
const KEY_VALUE_RE = /(key|api[_-]?key|apikey|secret|token|auth)=([^&\s]+)/gi;
/** Bearer tokens. */
const BEARER_RE = /Bearer\s+[A-Za-z0-9_.-]+/gi;

/**
 * Redact API keys and secret-like values from a string. Safe to pass to console/logging.
 */
export function sanitizeForLog(value: unknown): string {
  if (value == null) return String(value);
  let s = typeof value === 'string' ? value : String(value);
  s = s.replace(GOOGLE_KEY_RE, REDACT);
  s = s.replace(KEY_VALUE_RE, `$1=${REDACT}`);
  s = s.replace(BEARER_RE, `Bearer ${REDACT}`);
  return s;
}
