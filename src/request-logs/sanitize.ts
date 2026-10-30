export const REDACTED = '[REDACTED]';
export const MAX_LOGGED_BODY_BYTES = 16 * 1024;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-admin-key',
]);

export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value,
    ]),
  );
}

/** Keeps logged payloads bounded; oversized bodies are replaced by a truncated preview. */
export function truncateBody(body: unknown): unknown {
  if (body === undefined || body === null) {
    return null;
  }
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  if (Buffer.byteLength(serialized) <= MAX_LOGGED_BODY_BYTES) {
    return body;
  }
  return { truncated: true, preview: serialized.slice(0, MAX_LOGGED_BODY_BYTES) };
}
