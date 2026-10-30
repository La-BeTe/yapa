const DUPLICATE_KEY = 11000;

export function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === DUPLICATE_KEY;
}

/** True when a (possibly bulk) write failed only because of duplicate keys. */
export function isDuplicateKeyOnly(error: unknown): boolean {
  if (isDuplicateKeyError(error)) {
    return true;
  }
  const writeErrors = (
    error as { writeErrors?: Array<{ code?: number; err?: { code?: number } }> } | null
  )?.writeErrors;
  return (
    Array.isArray(writeErrors) &&
    writeErrors.length > 0 &&
    writeErrors.every((e) => (e.code ?? e.err?.code) === DUPLICATE_KEY)
  );
}
